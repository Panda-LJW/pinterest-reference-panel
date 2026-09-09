import { randomBytes } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { InboxService } from "./inbox.js";
import { ReferenceError, ReferenceSessions, REFERENCE_SESSION_PATTERN } from "./references.js";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_JSON_BYTES = 2_048;
const CLOSE_GRACE_MS = 500;
const ASSET_ID_PATTERN = /^[a-f0-9]{24}$/;

type ClipboardWriter = (text: string) => Promise<void>;

export type LocalPanelServerOptions = {
  inbox: InboxService;
  port?: number;
  assetRoot?: string;
  clipboardWriter?: ClipboardWriter;
  references?: ReferenceSessions;
};

export type LocalPanelServerHandle = {
  host: typeof LOOPBACK_HOST;
  port: number;
  url: string;
  close: () => Promise<void>;
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function commonHeaders() {
  return {
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { ...commonHeaders(), "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function requestCookie(request: IncomingMessage, name: string) {
  const cookieHeader = request.headers.cookie ?? "";
  for (const entry of cookieHeader.split(";")) {
    const [key, ...parts] = entry.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return null;
}

function assertLoopbackRequest(request: IncomingMessage, expectedHost: string) {
  const remoteAddress = request.socket.remoteAddress;
  if (remoteAddress !== LOOPBACK_HOST && remoteAddress !== `::ffff:${LOOPBACK_HOST}`) {
    throw new HttpError(403, "仅允许本机访问 Pinterest Inbox 面板");
  }
  if (request.headers.host !== expectedHost) {
    throw new HttpError(421, "请求主机与本地面板不匹配");
  }
}

function assertApiSession(request: IncomingMessage, sessionId: string, csrfToken: string, cookieName: string) {
  if (requestCookie(request, cookieName) !== sessionId) {
    throw new HttpError(401, "本地面板会话已失效，请刷新页面");
  }
  if (request.headers["x-pinterest-panel-token"] !== csrfToken) {
    throw new HttpError(403, "本地面板令牌无效，请刷新页面");
  }
}

function assertSameOriginMutation(request: IncomingMessage, origin: string) {
  if (request.headers.origin !== origin) {
    throw new HttpError(403, "拒绝来自其他页面的写操作");
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin") {
    throw new HttpError(403, "拒绝跨站写操作");
  }
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "请求必须使用 JSON");
  }
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_JSON_BYTES) throw new HttpError(413, "请求内容过大");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "请求 JSON 无效");
  }
}

function parseAssetId(value: unknown) {
  if (typeof value !== "string" || !ASSET_ID_PATTERN.test(value)) {
    throw new HttpError(400, "素材 ID 无效");
  }
  return value;
}

function parsePort(value: number | undefined) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 65_535) throw new Error("PINTEREST_PANEL_PORT 必须是 0 到 65535 的整数");
  return value;
}

function runClipboardCommand(command: "pbcopy" | "pbpaste", input: string, deadline: number) {
  return new Promise<Buffer>((resolveCommand, rejectCommand) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { rejectCommand(new Error("clipboard timeout")); return; }
    const child = spawn(`/usr/bin/${command}`, command === "pbpaste" ? ["-Prefer", "txt"] : [], {
      stdio: ["pipe", "pipe", "ignore"],
      // GUI/MCP hosts may use C or no locale. pbcopy can exit 0 yet discard
      // non-ASCII input in that environment; stdin's UTF-8 flag alone is insufficient.
      env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", LC_CTYPE: "en_US.UTF-8" }
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectCommand(error); else resolveCommand(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("clipboard timeout"));
    }, remaining);
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.byteLength;
      if (size > 16_384) {
        child.kill("SIGKILL");
        finish(new Error("clipboard content changed"));
      } else chunks.push(Buffer.from(chunk));
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error("clipboard command failed"));
    });
    child.stdin.once("error", (error) => finish(error));
    child.stdin.end(input, "utf8");
  });
}

export async function writeTextToMacClipboard(text: string) {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/pbcopy") || !existsSync("/usr/bin/pbpaste")) {
    throw new HttpError(503, "当前系统没有可用的 macOS 剪贴板服务");
  }
  if (!text || text.includes("\0") || Buffer.byteLength(text, "utf8") > 16_384) {
    throw new HttpError(400, "待复制路径无效或过长");
  }
  try {
    const deadline = Date.now() + 5_000;
    await runClipboardCommand("pbcopy", text, deadline);
    const copied = await runClipboardCommand("pbpaste", "", deadline);
    if (!copied.equals(Buffer.from(text, "utf8"))) throw new Error("clipboard verification failed");
  } catch {
    // Never return clipboard contents or paths in an HTTP error, and never
    // retry automatically: another application may have just copied something.
    throw new HttpError(503, "未能确认路径已写入剪贴板，请重新复制");
  }
}

export async function startLocalPanelServer(options: LocalPanelServerOptions): Promise<LocalPanelServerHandle> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const assetRoot = options.assetRoot ?? join(moduleDirectory, "../assets");
  const [htmlTemplate, css, javascript] = await Promise.all([
    readFile(join(assetRoot, "local-panel.html"), "utf8"),
    readFile(join(assetRoot, "local-panel.css"), "utf8"),
    readFile(join(assetRoot, "local-panel.js"), "utf8")
  ]);
  const clipboardWriter = options.clipboardWriter ?? writeTextToMacClipboard;
  const references = options.references ?? new ReferenceSessions(options.inbox);
  const sessionId = randomBytes(24).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  let origin = "";
  let expectedHost = "";
  let cookieName = "";

  const httpServer = createServer((request, response) => {
    void (async () => {
      assertLoopbackRequest(request, expectedHost);
      const method = request.method ?? "GET";
      const requestUrl = new URL(request.url ?? "/", origin);

      if (method === "GET" && requestUrl.pathname === "/") {
        const referenceSessionId = requestUrl.searchParams.get("ref") ?? "";
        if (referenceSessionId && !REFERENCE_SESSION_PATTERN.test(referenceSessionId)) throw new HttpError(400, "参考会话地址无效");
        const html = htmlTemplate.replace("__PINTEREST_PANEL_TOKEN__", csrfToken)
          .replace("__PINTEREST_REFERENCE_SESSION__", referenceSessionId);
        response.writeHead(200, {
          ...commonHeaders(),
          "Content-Security-Policy": "default-src 'self'; img-src 'self' blob: data:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": `${cookieName}=${sessionId}; HttpOnly; SameSite=Strict; Path=/`
        });
        response.end(html);
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/local-panel.css") {
        response.writeHead(200, { ...commonHeaders(), "Content-Type": "text/css; charset=utf-8" });
        response.end(css);
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/local-panel.js") {
        response.writeHead(200, { ...commonHeaders(), "Content-Type": "text/javascript; charset=utf-8" });
        response.end(javascript);
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/favicon.ico") {
        response.writeHead(204, commonHeaders());
        response.end();
        return;
      }

      if (!requestUrl.pathname.startsWith("/api/")) throw new HttpError(404, "页面不存在");
      assertApiSession(request, sessionId, csrfToken, cookieName);

      const referenceSessionId = () => {
        const id = request.headers["x-pinterest-reference-session"];
        if (typeof id !== "string") throw new HttpError(400, "请从当前 Codex 任务打开参考篮");
        references.require(id);
        return id;
      };

      if (method === "GET" && requestUrl.pathname === "/api/references") {
        sendJson(response, 200, await references.describe(referenceSessionId()));
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/api/status") {
        const knownVersionRaw = requestUrl.searchParams.get("knownVersion");
        const knownVersion = knownVersionRaw && /^\d+$/.test(knownVersionRaw) ? Number.parseInt(knownVersionRaw, 10) : null;
        const summary = options.inbox.getSummary();
        sendJson(response, 200, { unchanged: knownVersion !== null && knownVersion === summary.version, ...summary });
        return;
      }
      if (method === "GET" && requestUrl.pathname === "/api/inbox") {
        const cursorRaw = requestUrl.searchParams.get("cursor");
        const limitRaw = requestUrl.searchParams.get("limit");
        const boardIdRaw = requestUrl.searchParams.get("boardId");
        const query = requestUrl.searchParams.get("q") ?? "";
        const sort = requestUrl.searchParams.get("sort") ?? "recent";
        if (query.length > 200) throw new HttpError(400, "搜索内容过长，请缩短关键词");
        if (sort !== "recent" && sort !== "oldest" && sort !== "title") throw new HttpError(400, "排序方式无效");
        if (cursorRaw && !/^\d{1,9}$/.test(cursorRaw)) throw new HttpError(400, "分页游标无效");
        if (limitRaw && !/^\d{1,2}$/.test(limitRaw)) throw new HttpError(400, "分页数量无效");
        if (boardIdRaw && (boardIdRaw.length > 255 || /[\u0000-\u001f]/.test(boardIdRaw))) throw new HttpError(400, "图版 ID 无效");
        const page = await options.inbox.getPublicPage({
          ...(cursorRaw ? { cursor: cursorRaw } : {}),
          ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
          ...(boardIdRaw ? { boardId: boardIdRaw } : {}),
          query, sort
        });
        sendJson(response, 200, { page });
        return;
      }
      const thumbnailMatch = method === "GET" ? requestUrl.pathname.match(/^\/api\/thumbnails\/([a-f0-9]{24})$/) : null;
      if (thumbnailMatch) {
        const thumbnail = await options.inbox.getThumbnail(thumbnailMatch[1] ?? "");
        if (!thumbnail) throw new HttpError(404, "素材已不在 Inbox 中");
        response.writeHead(200, { ...commonHeaders(), "Content-Type": thumbnail.contentType });
        response.end(thumbnail.data);
        return;
      }

      const previewMatch = method === "GET" ? requestUrl.pathname.match(/^\/api\/previews\/([a-f0-9]{24})$/) : null;
      if (previewMatch) {
        const asset = await options.inbox.resolveAsset(previewMatch[1] ?? "");
        if (!asset) throw new HttpError(404, "原图已不在素材库中，请刷新后重试");
        const file = await open(asset.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await file.stat();
          if (!info.isFile()) throw new HttpError(404, "原图不可用");
          if (info.size > 64 * 1024 * 1024) throw new HttpError(413, "原图超过 64 MB，请复制路径后交给 Codex 查看");
          const current = await options.inbox.resolveAsset(asset.id);
          if (!current || current.sourcePath !== asset.sourcePath) throw new HttpError(409, "原图位置已变化，请刷新后重试");
          const types: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif" };
          const contentType = types[asset.extension];
          if (!contentType) throw new HttpError(415, "暂不支持预览此格式");
          const bytes = await file.readFile();
          response.writeHead(200, { ...commonHeaders(), "Content-Type": contentType, "Content-Length": bytes.length });
          response.end(bytes);
        } finally { await file.close(); }
        return;
      }

      if (method === "POST") assertSameOriginMutation(request, origin);
      if (method === "POST" && requestUrl.pathname === "/api/references") {
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "参考篮请求无效");
        const value = body as { assetIds?: unknown; revision?: unknown };
        if (Object.keys(body).sort().join() !== "assetIds,revision" || !Array.isArray(value.assetIds)
          || !value.assetIds.every(id => typeof id === "string") || !Number.isInteger(value.revision) || Number(value.revision) < 0) {
          throw new HttpError(400, "参考篮只能提交素材 ID 列表与版本号");
        }
        sendJson(response, 200, await references.replace(referenceSessionId(), value.assetIds, Number(value.revision)));
        return;
      }
      if (method === "POST" && requestUrl.pathname === "/api/references/clipboard") {
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "revision"
          || !Number.isInteger((body as { revision?: unknown }).revision)) throw new HttpError(400, "复制请求需要参考篮版本号");
        const selected = await references.resolve(referenceSessionId(), (body as { revision: number }).revision);
        await clipboardWriter(selected.files.map(file => file.path).join("\n"));
        sendJson(response, 200, { status: "copied", count: selected.files.length });
        return;
      }
      if (method === "POST" && requestUrl.pathname === "/api/refresh") {
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
          throw new HttpError(400, "刷新请求不接受额外参数");
        }
        await options.inbox.reconcile();
        sendJson(response, 200, { status: "refreshed", ...options.inbox.getSummary() });
        return;
      }
      if (method === "POST" && requestUrl.pathname === "/api/clipboard") {
        const body = await readJson(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "复制请求无效");
        const entries = Object.keys(body);
        if (entries.length !== 1 || entries[0] !== "assetId") throw new HttpError(400, "复制请求只能提交素材 ID");
        const assetId = parseAssetId((body as { assetId?: unknown }).assetId);
        const asset = await options.inbox.resolveAsset(assetId);
        if (!asset) throw new HttpError(404, "素材已不在 Inbox 中，请刷新后重试");
        await clipboardWriter(asset.sourcePath);
        sendJson(response, 200, {
          status: "copied",
          assetId,
          title: asset.title,
          fileName: asset.sourceRelativePath.split("/").at(-1) ?? asset.title
        });
        return;
      }

      throw new HttpError(404, "接口不存在");
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof HttpError || error instanceof ReferenceError ? error.status : 500;
      const message = error instanceof HttpError || error instanceof ReferenceError
        ? error.message
        : "本地面板暂时无法完成请求，请重试";
      sendJson(response, status, { error: message });
    });
  });

  const requestedPort = parsePort(options.port);
  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => rejectListen(error);
    httpServer.once("error", onError);
    httpServer.listen(requestedPort, LOOPBACK_HOST, () => {
      httpServer.off("error", onError);
      resolveListen();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    httpServer.close();
    throw new Error("无法确定 Pinterest Inbox 本地面板端口");
  }
  origin = `http://${LOOPBACK_HOST}:${address.port}`;
  expectedHost = `${LOOPBACK_HOST}:${address.port}`;
  cookieName = `pinterest_panel_session_${address.port}`;
  let closePromise: Promise<void> | null = null;

  return {
    host: LOOPBACK_HOST,
    port: address.port,
    url: `${origin}/`,
    close: () => {
      if (!closePromise) {
        closePromise = new Promise<void>((resolveClose, rejectClose) => {
          const forceClose = setTimeout(() => httpServer.closeAllConnections(), CLOSE_GRACE_MS);
          forceClose.unref();
          httpServer.close((error) => {
            clearTimeout(forceClose);
            if (error) rejectClose(error); else resolveClose();
          });
          httpServer.closeIdleConnections();
        }).catch((error: unknown) => {
          closePromise = null;
          throw error;
        });
      }
      return closePromise;
    }
  };
}
