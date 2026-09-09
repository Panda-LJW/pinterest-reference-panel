import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InboxService } from "./inbox.js";
import { startLocalPanelServer, type LocalPanelServerHandle } from "./local-panel-server.js";
import { WorkspaceRegistry } from "./workspace.js";
import { ReferenceError, ReferenceSessions, REFERENCE_SESSION_PATTERN } from "./references.js";

export { InboxService, parseInboxFilename } from "./inbox.js";
export { startLocalPanelServer, writeTextToMacClipboard } from "./local-panel-server.js";
export { WorkspaceRegistry } from "./workspace.js";
export { ReferenceSessions, ReferenceError } from "./references.js";

const PANEL_URI = "ui://pinterest-reference-panel/panel.html";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const panelHtml = readFileSync(join(moduleDirectory, "../assets/pinterest-panel.html"), "utf8");

export const inbox = new InboxService();
export const workspaces = new WorkspaceRegistry();
export const references = new ReferenceSessions(inbox);
let localPanel: LocalPanelServerHandle | null = null;
let localPanelStart: Promise<LocalPanelServerHandle> | null = null;
let localPanelStop: Promise<boolean> | null = null;

async function ensureLocalPanel() {
  if (localPanelStop) await localPanelStop;
  if (localPanel) return localPanel;
  if (!localPanelStart) {
    const configuredPort = process.env.PINTEREST_PANEL_PORT ? Number(process.env.PINTEREST_PANEL_PORT) : 0;
    localPanelStart = startLocalPanelServer({ inbox, references, port: configuredPort }).then((handle) => {
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
  { name: "pinterest-reference-panel", version: "0.4.1" },
  {
    capabilities: { resources: {}, tools: {} },
    instructions: "When Pinterest BoardFlow (formerly Pinterest Inbox) is selected or mentioned, an unqualified request to open it (including 打开项目) means launch its running Board-style masonry material panel, unless the user explicitly asks for source code, documentation or Codex project management. Call open_pinterest_inbox_web, then actually call the Codex open_in_codex tool with target {type: 'browser', url: the complete returned URL} and placement 'right' for THIS task. Discover deferred tools when needed. Opening README or locating a repository does not fulfill this request. Do not use desktop automation on Codex or start a second InboxService as a workaround. Report opened only after the browser action succeeds; distinguish queued from displayed. Retain the returned referenceSessionId for THIS task. When the user asks to use selected references, call get_pinterest_reference_selection with that exact ID, then read the returned original local image files before visual analysis or generation. Use numbered files in returned order. Never guess a session or read another task's basket. To reopen the same basket pass its referenceSessionId; omitting it creates an empty independent basket. Recheck the returned revision before using references if the user changes selection. Selecting images never sends a message. Do not copy, re-encode or modify originals. Path copying remains an explicit fallback. Never accept arbitrary source URLs or paths."
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
        content: [{ type: "text" as const, text: "Pinterest BoardFlow 没有变化。" }],
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
      text: `Pinterest BoardFlow 已读取 ${pageResult.page.total} 张图片。${workspace?.available ? `当前工作区：${workspace.name}。` : ""}`
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
      "openai/widgetDescription": "Pinterest BoardFlow 本地 Board 瀑布流看板，可将选中图片导入当前工作区。"
    }
  }]
}));

server.registerTool(
  "list_pinterest_inbox",
  {
    title: "读取 Pinterest BoardFlow",
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
    title: "启动 Pinterest BoardFlow 瀑布流看板",
    description: "选择或提到 Pinterest BoardFlow（旧称 Pinterest Inbox）插件后要求打开/启动（如‘打开项目’）时调用。启动 Board 瀑布流素材看板后，继续调用 Codex open_in_codex，以 target.type=browser、target.url=返回的完整 URL、placement=right 显示到当前任务右侧。首次不传参数创建独立参考篮；保存 referenceSessionId，重开或读取选图时传回，不得借用其他任务的会话。只有明确要源码或文档时才打开文件。",
    inputSchema: { referenceSessionId: z.string().regex(REFERENCE_SESSION_PATTERN).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: {
      "openai/toolInvocation/invoking": "正在启动 Pinterest BoardFlow…",
      "openai/toolInvocation/invoked": "Pinterest BoardFlow 已就绪"
    }
  },
  async ({ referenceSessionId }) => {
    try {
      const handle = await ensureLocalPanel();
      const id = referenceSessionId ? references.require(referenceSessionId).id : references.create();
      const url = `${handle.url}?ref=${id}`;
      return {
        structuredContent: { status: "running", url, referenceSessionId: id, host: handle.host, port: handle.port, inbox: inbox.getSummary() },
        content: [{ type: "text" as const, text: `Pinterest BoardFlow 服务已就绪：${url}。下一步必须调用 Codex open_in_codex：target={type:"browser",url:"${url}"}，placement="right"。服务就绪不等于看板已显示，请根据浏览器工具结果报告已打开或已排队。保留本任务的参考会话 ${id}。用户选图后，通过 get_pinterest_reference_selection 读取该会话，再读取原图。` }]
      };
    } catch (error) {
      reportInternalError("local panel start failed", error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: error instanceof ReferenceError ? error.message : "无法启动 Pinterest BoardFlow 本地网页；请检查插件安装后重试。" }]
      };
    }
  }
);

server.registerTool(
  "get_pinterest_reference_selection",
  {
    title: "读取当前任务的 Pinterest 参考图",
    description: "当用户要求使用已选参考图时，传入本任务 open_pinterest_inbox_web 返回的 referenceSessionId。按用户排序返回经验证的原图路径与编号；必须继续读取图片后才能进行视觉分析或生图。不要创建新参考篮或猜测其他任务的会话 ID。",
    inputSchema: {
      referenceSessionId: z.string().regex(REFERENCE_SESSION_PATTERN),
      expectedRevision: z.number().int().min(0).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  async ({ referenceSessionId, expectedRevision }) => {
    try {
      const selected = await references.resolve(referenceSessionId, expectedRevision);
      return {
        structuredContent: selected,
        content: [{ type: "text" as const, text: `已确认 ${selected.files.length} 张参考图（版本 ${selected.revision}）。请按顺序读取原图：\n${selected.files.map(file => `${file.number}. ${file.title}\n${file.path}`).join("\n")}` }]
      };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: error instanceof ReferenceError ? error.message : "参考图暂时不可读，请刷新参考篮后重试" }] };
    }
  }
);

server.registerTool(
  "get_pinterest_inbox_web_status",
  {
    title: "查看 Pinterest BoardFlow 网页状态",
    description: "查看当前任务中的 Pinterest BoardFlow 本地网页是否正在运行。",
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
          ? "Pinterest BoardFlow 本地网页正在停止。"
          : localPanel
            ? `Pinterest BoardFlow 本地网页正在运行：${localPanel.url}`
            : "Pinterest BoardFlow 本地网页当前未启动。"
      }]
    };
  }
);

server.registerTool(
  "stop_pinterest_inbox_web",
  {
    title: "停止 Pinterest BoardFlow 本地网页",
    description: "停止当前任务的本地网页服务；Inbox 监听和旧 MCP 面板保持可用。",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      "openai/toolInvocation/invoking": "正在停止 Pinterest BoardFlow 本地网页…",
      "openai/toolInvocation/invoked": "Pinterest BoardFlow 本地网页已停止"
    }
  },
  async () => {
    try {
      const stopped = await stopLocalPanel();
      return {
        structuredContent: { status: "stopped", wasRunning: stopped, inbox: inbox.getSummary() },
        content: [{ type: "text" as const, text: stopped ? "Pinterest BoardFlow 本地网页已停止；Inbox 监听仍在运行。" : "Pinterest BoardFlow 本地网页原本就未启动。" }]
      };
    } catch (error) {
      reportInternalError("local panel stop failed", error);
      return { isError: true, content: [{ type: "text" as const, text: "停止 Pinterest BoardFlow 本地网页失败；请稍后重试。" }] };
    }
  }
);

server.registerTool(
  "render_pinterest_reference_panel",
  {
    title: "打开 Pinterest BoardFlow 旧面板",
    description: "打开旧的内嵌 MCP 素材面板，作为本地网页不可用时的工作区导入回滚方案。",
    inputSchema: { workspaceRoot: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      ui: { resourceUri: PANEL_URI },
      "openai/outputTemplate": PANEL_URI,
      "openai/toolInvocation/invoking": "正在打开 Pinterest BoardFlow…",
      "openai/toolInvocation/invoked": "Pinterest BoardFlow 已打开"
    }
  },
  async ({ workspaceRoot }) => panelResult({ ...(workspaceRoot ? { workspaceRoot } : {}), registerWorkspace: true })
);

server.registerTool(
  "import_pinterest_reference",
  {
    title: "导入 Pinterest 参考图",
    description: "将 Pinterest BoardFlow 中明确选中的一张已索引图片复制到当前工作区 references/pinterest 目录。",
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
