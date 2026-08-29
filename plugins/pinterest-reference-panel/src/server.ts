import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InboxService } from "./inbox.js";
import { startLocalPanelServer, type LocalPanelServerHandle } from "./local-panel-server.js";
import { WorkspaceRegistry } from "./workspace.js";

export { InboxService, parseInboxFilename } from "./inbox.js";
export { startLocalPanelServer, writeTextToMacClipboard } from "./local-panel-server.js";
export { WorkspaceRegistry } from "./workspace.js";

const PANEL_URI = "ui://pinterest-reference-panel/panel.html";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const panelHtml = readFileSync(join(moduleDirectory, "../assets/pinterest-panel.html"), "utf8");

export const inbox = new InboxService();
export const workspaces = new WorkspaceRegistry();
let localPanel: LocalPanelServerHandle | null = null;
let localPanelStart: Promise<LocalPanelServerHandle> | null = null;
let localPanelStop: Promise<boolean> | null = null;

async function ensureLocalPanel() {
  if (localPanelStop) await localPanelStop;
  if (localPanel) return localPanel;
  if (!localPanelStart) {
    const configuredPort = process.env.PINTEREST_PANEL_PORT ? Number(process.env.PINTEREST_PANEL_PORT) : 0;
    localPanelStart = startLocalPanelServer({ inbox, port: configuredPort }).then((handle) => {
      localPanel = handle;
      return handle;
    }).finally(() => { localPanelStart = null; });
  }
  return localPanelStart;
}

async function stopLocalPanel() {
  if (!localPanelStop) {
    localPanelStop = (async () => {
      const handle = localPanel ?? (localPanelStart ? await localPanelStart : null);
      if (!handle) return false;
      await handle.close();
      if (localPanel === handle) localPanel = null;
      return true;
    })().finally(() => { localPanelStop = null; });
  }
  return localPanelStop;
}

function reportInternalError(context: string, error: unknown) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[pinterest-reference-panel] ${context}: ${detail}\n`);
}

export const server = new McpServer(
  { name: "pinterest-reference-panel", version: "0.4.0" },
  {
    capabilities: { resources: {}, tools: {} },
    instructions: "Use open_pinterest_inbox_web as the primary experience: open its loopback URL in the Codex in-app browser, then let the user click an indexed image to copy its canonical absolute path and paste it into the conversation. Do not auto-send a message, re-encode, copy, or modify the selected source. The embedded workspace-import panel remains a legacy fallback only. Never accept arbitrary source URLs or paths."
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
        stagingPath: inbox.stagingRoot,
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
  "open_pinterest_inbox_web",
  {
    title: "打开 Pinterest Inbox 本地网页",
    description: "启动只绑定本机回环地址的 Pinterest Inbox 瀑布流网页，并返回可在 Codex 内嵌浏览器中打开的 URL。",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      "openai/toolInvocation/invoking": "正在启动 Pinterest Inbox 本地网页…",
      "openai/toolInvocation/invoked": "Pinterest Inbox 本地网页已就绪"
    }
  },
  async () => {
    try {
      const handle = await ensureLocalPanel();
      return {
        structuredContent: { status: "running", url: handle.url, host: handle.host, port: handle.port, inbox: inbox.getSummary() },
        content: [{ type: "text" as const, text: `Pinterest Inbox 本地网页已启动：${handle.url}。请在 Codex 内嵌浏览器右侧打开此地址。` }]
      };
    } catch (error) {
      reportInternalError("local panel start failed", error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: "无法启动 Pinterest Inbox 本地网页；请检查插件安装后重试。" }]
      };
    }
  }
);

server.registerTool(
  "get_pinterest_inbox_web_status",
  {
    title: "查看 Pinterest Inbox 网页状态",
    description: "查看当前任务中的 Pinterest Inbox 本地网页是否正在运行。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async () => {
    const status = localPanelStop ? "stopping" : localPanel ? "running" : "stopped";
    return {
      structuredContent: {
        status,
        ...(localPanel ? { url: localPanel.url, host: localPanel.host, port: localPanel.port } : {}),
        inbox: inbox.getSummary()
      },
      content: [{
        type: "text" as const,
        text: status === "stopping"
          ? "Pinterest Inbox 本地网页正在停止。"
          : localPanel
            ? `Pinterest Inbox 本地网页正在运行：${localPanel.url}`
            : "Pinterest Inbox 本地网页当前未启动。"
      }]
    };
  }
);

server.registerTool(
  "stop_pinterest_inbox_web",
  {
    title: "停止 Pinterest Inbox 本地网页",
    description: "停止当前任务的本地网页服务；Inbox 监听和旧 MCP 面板保持可用。",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      "openai/toolInvocation/invoking": "正在停止 Pinterest Inbox 本地网页…",
      "openai/toolInvocation/invoked": "Pinterest Inbox 本地网页已停止"
    }
  },
  async () => {
    try {
      const stopped = await stopLocalPanel();
      return {
        structuredContent: { status: "stopped", wasRunning: stopped, inbox: inbox.getSummary() },
        content: [{ type: "text" as const, text: stopped ? "Pinterest Inbox 本地网页已停止；Inbox 监听仍在运行。" : "Pinterest Inbox 本地网页原本就未启动。" }]
      };
    } catch (error) {
      reportInternalError("local panel stop failed", error);
      return { isError: true, content: [{ type: "text" as const, text: "停止 Pinterest Inbox 本地网页失败；请稍后重试。" }] };
    }
  }
);

server.registerTool(
  "render_pinterest_reference_panel",
  {
    title: "打开 Pinterest Inbox 旧面板",
    description: "打开旧的内嵌 MCP 素材面板，作为本地网页不可用时的工作区导入回滚方案。",
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
  const transport = new StdioServerTransport();
  const requestShutdown = () => {
    void shutdown().catch((error: unknown) => {
      process.stderr.write(`[pinterest-reference-panel] shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
      const forceExit = setTimeout(() => process.exit(1), 1_000);
      forceExit.unref();
    });
  };
  transport.onclose = requestShutdown;
  process.stdin.once("end", requestShutdown);
  process.stdin.once("close", requestShutdown);
  try {
    await server.connect(transport);
  } catch (error) {
    process.stdin.off("end", requestShutdown);
    process.stdin.off("close", requestShutdown);
    await inbox.close();
    throw error;
  }
}

let shutdownPromise: Promise<void> | null = null;

async function shutdown() {
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      try {
        await stopLocalPanel();
      } finally {
        try {
          await inbox.close();
        } finally {
          await server.close();
        }
      }
    })();
  }
  return shutdownPromise;
}

function shutdownFromSignal() {
  void shutdown().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(`[pinterest-reference-panel] shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  );
}

process.once("SIGINT", shutdownFromSignal);
process.once("SIGTERM", shutdownFromSignal);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((error: unknown) => {
    process.stderr.write(`[pinterest-reference-panel] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
