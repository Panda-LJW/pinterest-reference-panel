import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InboxService } from "./inbox.js";
import { WorkspaceRegistry } from "./workspace.js";

export { InboxService, parseInboxFilename } from "./inbox.js";
export { WorkspaceRegistry } from "./workspace.js";

const PANEL_URI = "ui://pinterest-reference-panel/panel.html";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const panelHtml = readFileSync(join(moduleDirectory, "../assets/pinterest-panel.html"), "utf8");

export const inbox = new InboxService();
export const workspaces = new WorkspaceRegistry();

export const server = new McpServer(
  { name: "pinterest-reference-panel", version: "0.3.1" },
  {
    capabilities: { resources: {}, tools: {} },
    instructions: "Browse local PinterestInbox images. Import only an explicitly selected indexed asset into the current workspace. Never accept arbitrary source URLs or output paths."
  }
);

async function workspaceCandidate(explicitRoot?: string) {
  const capabilities = server.server.getClientCapabilities();
  if (capabilities?.roots) {
    try {
      const result = await server.server.listRoots();
      const fileRoots = result.roots.map((root) => {
        try {
          return root.uri.startsWith("file:") ? fileURLToPath(root.uri) : null;
        } catch {
          return null;
        }
      }).filter((root): root is string => Boolean(root));
      if (fileRoots.length === 1) return fileRoots[0] ?? null;
      if (explicitRoot && fileRoots.some((root) => explicitRoot === root || explicitRoot.startsWith(`${root}/`))) return explicitRoot;
    } catch {
      // Codex hosts are not required to support roots/list. Use the explicit fallback.
    }
  }
  return explicitRoot ?? null;
}

async function panelResult(options: {
  workspaceRoot?: string;
  cursor?: string;
  limit?: number;
  forceRescan?: boolean;
  knownVersion?: number;
  registerWorkspace?: boolean;
}) {
  if (!options.forceRescan && options.knownVersion !== undefined) {
    const summary = inbox.getSummary();
    if (summary.version === options.knownVersion) {
      return {
        structuredContent: { mode: "inbox" as const, unchanged: true, ...summary },
        content: [{ type: "text" as const, text: "Pinterest Inbox 没有变化。" }],
        _meta: { pinterestInbox: { thumbnails: {}, thumbnailErrors: {} } }
      };
    }
  }
  const pageResult = await inbox.getPage({
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.forceRescan !== undefined ? { forceRescan: options.forceRescan } : {})
  });
  const workspace = options.registerWorkspace ? await workspaces.register(await workspaceCandidate(options.workspaceRoot)) : null;
  const publicWorkspace = workspace ? { available: workspace.available, name: workspace.name, reason: workspace.reason } : null;
  return {
    structuredContent: { ...pageResult.page, ...(publicWorkspace ? { workspace: publicWorkspace } : {}) },
    content: [{
      type: "text" as const,
      text: `Pinterest Inbox 已读取 ${pageResult.page.total} 张图片。${workspace?.available ? `当前工作区：${workspace.name}。` : ""}`
    }],
    _meta: {
      pinterestInbox: {
        thumbnails: pageResult.thumbnails,
        thumbnailErrors: pageResult.thumbnailErrors,
        inboxPath: inbox.inboxRoot,
        workspaceToken: workspace?.token ?? null
      }
    }
  };
}

server.registerResource("pinterest-reference-panel", PANEL_URI, {}, async () => ({
  contents: [{
    uri: PANEL_URI,
    mimeType: "text/html;profile=mcp-app",
    text: panelHtml,
    _meta: {
      ui: { prefersBorder: false },
      "openai/widgetDescription": "Pinterest Inbox 本地素材瀑布流，可将选中图片导入当前工作区。"
    }
  }]
}));

server.registerTool(
  "list_pinterest_inbox",
  {
    title: "读取 Pinterest Inbox",
    description: "分页读取本地 PinterestInbox 的图片与图版目录。",
    inputSchema: {
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(30).optional(),
      forceRescan: z.boolean().optional(),
      knownVersion: z.number().int().min(0).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ cursor, limit, forceRescan, knownVersion }) => panelResult({
    ...(cursor ? { cursor } : {}),
    ...(limit ? { limit } : {}),
    ...(forceRescan !== undefined ? { forceRescan } : {}),
    ...(knownVersion !== undefined ? { knownVersion } : {})
  })
);

server.registerTool(
  "render_pinterest_reference_panel",
  {
    title: "打开 Pinterest Inbox",
    description: "打开本地 Pinterest Inbox 素材栏。在 Codex 中请将当前工作区绝对路径作为 workspaceRoot 传入，以便单击导入图片。",
    inputSchema: { workspaceRoot: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      ui: { resourceUri: PANEL_URI },
      "openai/outputTemplate": PANEL_URI,
      "openai/toolInvocation/invoking": "正在打开 Pinterest Inbox…",
      "openai/toolInvocation/invoked": "Pinterest Inbox 已打开"
    }
  },
  async ({ workspaceRoot }) => panelResult({ ...(workspaceRoot ? { workspaceRoot } : {}), registerWorkspace: true })
);

server.registerTool(
  "import_pinterest_reference",
  {
    title: "导入 Pinterest 参考图",
    description: "将 Pinterest Inbox 中明确选中的一张已索引图片复制到当前工作区 references/pinterest 目录。",
    inputSchema: { assetId: z.string().min(1), workspaceToken: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      "openai/toolInvocation/invoking": "正在导入参考图…",
      "openai/toolInvocation/invoked": "参考图已导入"
    }
  },
  async ({ assetId, workspaceToken }) => {
    const asset = await inbox.resolveAsset(assetId);
    if (!asset) return { isError: true, content: [{ type: "text" as const, text: "未找到该 Inbox 图片，请刷新后重试。" }] };
    try {
      const imported = await workspaces.importAsset(asset, workspaceToken);
      const optimizationNote = imported.optimization === "fallback" ? `（${imported.optimizationReason}）` : "（已准备轻量引用版）";
      return {
        structuredContent: { status: "imported", assetId, title: asset.title, boardTitle: asset.boardTitle, ...imported },
        content: [{ type: "text" as const, text: `已将「${asset.title}」导入工作区：${imported.relativePath}${optimizationNote}` }]
      };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  }
);

export async function startServer() {
  await inbox.start();
  await server.connect(new StdioServerTransport());
}

async function shutdown() {
  await inbox.close();
  await server.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((error: unknown) => {
    process.stderr.write(`[pinterest-reference-panel] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
