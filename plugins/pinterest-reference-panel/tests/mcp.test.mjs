import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pluginRoot = new URL("../", import.meta.url);

async function openWebSession(url) {
  const response = await fetch(url);
  const html = await response.text();
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  const token = html.match(/name="pinterest-panel-token" content="([^"]+)"/)?.[1];
  assert.ok(cookie);
  assert.ok(token);
  return { cookie, token };
}

function holdRefreshRequest(url, session) {
  const target = new URL("/api/refresh", url);
  const request = httpRequest(target, {
    method: "POST",
    headers: {
      Cookie: session.cookie,
      "X-Pinterest-Panel-Token": session.token,
      Origin: target.origin,
      "Content-Type": "application/json",
      "Content-Length": "2",
      Expect: "100-continue"
    }
  });
  const accepted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => request.destroy(new Error("timed out waiting for 100 Continue")), 2_000);
    timer.unref();
    request.once("continue", () => {
      clearTimeout(timer);
      resolve();
    });
    request.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  request.on("error", () => {});
  request.flushHeaders();
  return { request, accepted };
}

test("stdio MCP lists Inbox content and safely imports one indexed image", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-mcp-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(inboxRoot, "editorial"), { recursive: true });
  await mkdir(workspaceRoot);
  await writeFile(join(inboxRoot, "editorial", "456__signal-poster.jpg"), "image-fixture");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.bundle.js"],
    cwd: pluginRoot,
    env: { ...process.env, PINTEREST_INBOX_DIR: inboxRoot },
    stderr: "pipe"
  });
  const client = new Client({ name: "inbox-test", version: "0.2.0" });
  context.after(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });
  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "get_pinterest_inbox_web_status",
    "import_pinterest_reference",
    "list_pinterest_inbox",
    "open_pinterest_inbox_web",
    "render_pinterest_reference_panel",
    "stop_pinterest_inbox_web"
  ]);
  assert.equal(tools.tools.find((tool) => tool.name === "list_pinterest_inbox")?.annotations?.readOnlyHint, true);
  assert.equal(tools.tools.find((tool) => tool.name === "import_pinterest_reference")?.annotations?.readOnlyHint, false);
  assert.equal(tools.tools.find((tool) => tool.name === "open_pinterest_inbox_web")?.annotations?.readOnlyHint, false);
  assert.equal(tools.tools.find((tool) => tool.name === "get_pinterest_inbox_web_status")?.annotations?.readOnlyHint, true);

  const rendered = await client.callTool({
    name: "render_pinterest_reference_panel",
    arguments: { workspaceRoot }
  });
  assert.equal(rendered.structuredContent.mode, "inbox");
  assert.equal(rendered.structuredContent.total, 1);
  assert.equal(rendered.structuredContent.workspace.available, true);
  assert.equal(rendered.structuredContent.workspace.token, undefined);
  assert.equal(rendered._meta.pinterestInbox.inboxPath, inboxRoot);
  assert.equal(rendered._meta.pinterestInbox.stagingPath, inboxRoot);
  assert.match(rendered._meta.pinterestInbox.workspaceToken, /^[a-zA-Z0-9_-]+$/);

  const opened = await client.callTool({ name: "open_pinterest_inbox_web", arguments: {} });
  assert.equal(opened.structuredContent.status, "running");
  assert.match(opened.structuredContent.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const webStatus = await client.callTool({ name: "get_pinterest_inbox_web_status", arguments: {} });
  assert.equal(webStatus.structuredContent.status, "running");
  assert.equal(webStatus.structuredContent.url, opened.structuredContent.url);

  const stopped = await client.callTool({ name: "stop_pinterest_inbox_web", arguments: {} });
  assert.equal(stopped.structuredContent.status, "stopped");
  assert.equal(stopped.structuredContent.wasRunning, true);
  const stoppedStatus = await client.callTool({ name: "get_pinterest_inbox_web_status", arguments: {} });
  assert.equal(stoppedStatus.structuredContent.status, "stopped");
  assert.equal(stoppedStatus.structuredContent.url, undefined);

  const imported = await client.callTool({
    name: "import_pinterest_reference",
    arguments: {
      assetId: rendered.structuredContent.assets[0].id,
      workspaceToken: rendered._meta.pinterestInbox.workspaceToken
    }
  });
  assert.equal(imported.structuredContent.status, "imported");
  assert.equal(imported.structuredContent.relativePath, "references/pinterest/editorial/456__signal-poster.jpg");

  const resource = await client.readResource({ uri: "ui://pinterest-reference-panel/panel.html" });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text, /Pinterest Inbox/);
});

test("stdio EOF shuts down an active local panel without waiting for a signal", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-mcp-eof-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  await mkdir(inboxRoot, { recursive: true });
  await writeFile(join(inboxRoot, "one__asset.jpg"), "image-fixture");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.bundle.js"],
    cwd: pluginRoot,
    env: { ...process.env, PINTEREST_INBOX_DIR: inboxRoot },
    stderr: "pipe"
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const client = new Client({ name: "inbox-eof-test", version: "0.4.0" });

  try {
    await client.connect(transport);
    const opened = await client.callTool({ name: "open_pinterest_inbox_web", arguments: {} });
    assert.equal(opened.structuredContent.status, "running");
    const child = transport._process;
    assert.ok(child, "stdio child process should be available after connect");
    const startedAt = Date.now();
    await client.close();
    assert.ok(Date.now() - startedAt < 1_800, "EOF cleanup should finish before the client termination fallback");
    assert.equal(child.exitCode, 0, Buffer.concat(stderr).toString("utf8"));
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("open waits for an in-flight stop and never overlaps local panel instances", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-mcp-lifecycle-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  await mkdir(inboxRoot, { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.bundle.js"],
    cwd: pluginRoot,
    env: { ...process.env, PINTEREST_INBOX_DIR: inboxRoot },
    stderr: "pipe"
  });
  const client = new Client({ name: "inbox-lifecycle-test", version: "0.4.0" });
  let heldRequest;

  try {
    await client.connect(transport);
    const first = await client.callTool({ name: "open_pinterest_inbox_web", arguments: {} });
    const session = await openWebSession(first.structuredContent.url);
    const held = holdRefreshRequest(first.structuredContent.url, session);
    heldRequest = held.request;
    await held.accepted;

    const completionOrder = [];
    const stopping = client.callTool({ name: "stop_pinterest_inbox_web", arguments: {} }).then((result) => {
      completionOrder.push("stop");
      return result;
    });
    const duringStop = await client.callTool({ name: "get_pinterest_inbox_web_status", arguments: {} });
    assert.equal(duringStop.structuredContent.status, "stopping");

    const reopening = client.callTool({ name: "open_pinterest_inbox_web", arguments: {} }).then((result) => {
      completionOrder.push("open");
      return result;
    });

    const [stopped, reopened] = await Promise.all([stopping, reopening]);
    assert.equal(stopped.structuredContent.status, "stopped");
    assert.equal(reopened.structuredContent.status, "running");
    assert.deepEqual(completionOrder, ["stop", "open"], "the old service must finish stopping before reopen resolves");
    if (reopened.structuredContent.url !== first.structuredContent.url) {
      await assert.rejects(fetch(first.structuredContent.url));
    }
    assert.equal((await fetch(reopened.structuredContent.url)).status, 200);
    await client.callTool({ name: "stop_pinterest_inbox_web", arguments: {} });
  } finally {
    heldRequest?.destroy();
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("SIGTERM closes the local panel and exits cleanly", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-mcp-signal-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  await mkdir(inboxRoot, { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.bundle.js"],
    cwd: pluginRoot,
    env: { ...process.env, PINTEREST_INBOX_DIR: inboxRoot },
    stderr: "pipe"
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const client = new Client({ name: "inbox-signal-test", version: "0.4.0" });

  try {
    await client.connect(transport);
    const opened = await client.callTool({ name: "open_pinterest_inbox_web", arguments: {} });
    const child = transport._process;
    assert.ok(child, "stdio child process should be available after connect");
    const closed = new Promise((resolveClosed) => child.once("close", (code, signal) => resolveClosed({ code, signal })));
    const startedAt = Date.now();
    assert.equal(child.kill("SIGTERM"), true);
    const result = await closed;
    assert.ok(Date.now() - startedAt < 1_800, "signal cleanup should finish promptly");
    assert.deepEqual(result, { code: 0, signal: null }, Buffer.concat(stderr).toString("utf8"));
    await assert.rejects(fetch(opened.structuredContent.url));
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("local panel startup errors are sanitized in MCP tool output", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-mcp-start-error-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  await mkdir(inboxRoot, { recursive: true });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.bundle.js"],
    cwd: pluginRoot,
    env: { ...process.env, PINTEREST_INBOX_DIR: inboxRoot, PINTEREST_PANEL_PORT: "70000" },
    stderr: "pipe"
  });
  const client = new Client({ name: "inbox-start-error-test", version: "0.4.0" });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "open_pinterest_inbox_web", arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, "无法启动 Pinterest Inbox 本地网页；请检查插件安装后重试。");
    assert.equal(result.content[0].text.includes(inboxRoot), false);
    assert.equal(result.content[0].text.includes("70000"), false);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
