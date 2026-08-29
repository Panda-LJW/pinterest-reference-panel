import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { InboxService } from "./inbox.js";

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

function assertApiSession(request: IncomingMessage, sessionId: string, csrfToken: string) {
  if (requestCookie(request, "pinterest_panel_session") !== sessionId) {
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

export async function writeTextToMacClipboard(text: string) {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/pbcopy")) {
    throw new Error("当前系统没有可用的 macOS 剪贴板服务");
  }
  if (!text || Buffer.byteLength(text, "utf8") > 16_384) throw new Error("待复制路径无效或过长");

  await new Promise<void>((resolveWrite, rejectWrite) => {
    const child = spawn("/usr/bin/pbcopy", [], { stdio: ["pipe", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectWrite(error); else resolveWrite();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("写入剪贴板超时"));
    }, 5_000);
    child.stderr.on("data", (chunk) => errors.push(Buffer.from(chunk)));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(Buffer.concat(errors).toString("utf8").trim() || `pbcopy 退出码 ${code}`));
    });
    child.stdin.once("error", (error) => finish(error));
    child.stdin.end(text, "utf8");
  });
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
  const sessionId = randomBytes(24).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  let origin = "";
  let expectedHost = "";

  const httpServer = createServer((request, response) => {
    void (async () => {
      assertLoopbackRequest(request, expectedHost);
      const method = request.method ?? "GET";
      const requestUrl = new URL(request.url ?? "/", origin);

      if (method === "GET" && requestUrl.pathname === "/") {
        const html = htmlTemplate.replace("__PINTEREST_PANEL_TOKEN__", csrfToken);
        response.writeHead(200, {
          ...commonHeaders(),
          "Content-Security-Policy": "default-src 'self'; img-src 'self' blob: data:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": `pinterest_panel_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/`
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
      assertApiSession(request, sessionId, csrfToken);

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
        if (cursorRaw && !/^\d{1,9}$/.test(cursorRaw)) throw new HttpError(400, "分页游标无效");
        if (limitRaw && !/^\d{1,2}$/.test(limitRaw)) throw new HttpError(400, "分页数量无效");
        if (boardIdRaw && (boardIdRaw.length > 255 || /[\u0000-\u001f]/.test(boardIdRaw))) throw new HttpError(400, "图版 ID 无效");
        const page = await options.inbox.getPublicPage({
          ...(cursorRaw ? { cursor: cursorRaw } : {}),
          ...(limitRaw ? { limit: Number.parseInt(limitRaw, 10) } : {}),
          ...(boardIdRaw ? { boardId: boardIdRaw } : {})
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

      if (method === "POST") assertSameOriginMutation(request, origin);
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
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError
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
