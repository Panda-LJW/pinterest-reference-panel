import assert from "node:assert/strict";
import { Server, request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InboxService, startLocalPanelServer } from "../dist/server.bundle.js";

async function openSession(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const html = await response.text();
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /pinterest_panel_session_\d+=[^;]+; HttpOnly; SameSite=Strict; Path=\//);
  const token = html.match(/name="pinterest-panel-token" content="([^"]+)"/)?.[1];
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  return {
    html,
    cookie: cookie.split(";", 1)[0],
    token,
    headers: { Cookie: cookie.split(";", 1)[0], "X-Pinterest-Panel-Token": token }
  };
}

async function api(url, session, path, options = {}) {
  const headers = { ...session.headers, ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(path, url), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return response;
}

async function waitFor(assertion, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await assertion(); }
    catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error("condition did not become true");
}

function requestWithHost(url, host) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: target.hostname, port: target.port, path: target.pathname, headers: { Host: host } }, resolve);
    request.once("error", reject);
    request.end();
  });
}

test("local panel is loopback-only, session protected, and copies only a resolved indexed path", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-local-panel-security-"));
  const inboxRoot = join(root, "PinterestInbox");
  const cacheRoot = join(root, "cache");
  const sourcePath = join(inboxRoot, "editorial", "signal-poster__pin-456.png");
  await mkdir(join(inboxRoot, "editorial"), { recursive: true });
  const fixture = await readFile(new URL("../../../docs/images/preview.png", import.meta.url));
  await writeFile(sourcePath, fixture);
  const before = await stat(sourcePath);
  const inbox = new InboxService({ inboxRoot, cacheRoot, reconcileIntervalMs: 60_000 });
  await inbox.start();
  const copied = [];
  const panel = await startLocalPanelServer({ inbox, port: 0, clipboardWriter: async (value) => { copied.push(value); } });

  try {
    assert.equal(panel.host, "127.0.0.1");
    assert.match(panel.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const session = await openSession(panel.url);
    assert.match(session.html, /Pinterest BoardFlow/);

    const rootResponse = await fetch(panel.url);
    assert.equal(rootResponse.headers.get("access-control-allow-origin"), null);
    assert.match(rootResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);

    const badHostResponse = await requestWithHost(panel.url, "attacker.example");
    assert.equal(badHostResponse.statusCode, 421);
    badHostResponse.resume();

    const missingSession = await fetch(new URL("/api/status", panel.url), { headers: { "X-Pinterest-Panel-Token": session.token } });
    assert.equal(missingSession.status, 401);
    const wrongToken = await fetch(new URL("/api/status", panel.url), { headers: { Cookie: session.cookie, "X-Pinterest-Panel-Token": "wrong" } });
    assert.equal(wrongToken.status, 403);

    const listResponse = await api(panel.url, session, "/api/inbox?limit=30");
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.page.total, 1);
    assert.equal(list.page.libraryTotal, 1);
    assert.equal(JSON.stringify(list).includes("sourcePath"), false);
    assert.equal(JSON.stringify(list).includes(inboxRoot), false);
    const assetId = list.page.assets[0].id;

    if (process.platform === "darwin") {
      const thumbnailResponse = await api(panel.url, session, `/api/thumbnails/${assetId}`);
      assert.equal(thumbnailResponse.status, 200);
      assert.equal(thumbnailResponse.headers.get("content-type"), "image/jpeg");
    }

    const wrongOrigin = await api(panel.url, session, "/api/clipboard", {
      method: "POST",
      body: { assetId },
      headers: { Origin: "https://attacker.example" }
    });
    assert.equal(wrongOrigin.status, 403);

    const simpleForm = await fetch(new URL("/api/clipboard", panel.url), {
      method: "POST",
      headers: { ...session.headers, Origin: new URL(panel.url).origin, "Content-Type": "text/plain" },
      body: JSON.stringify({ assetId })
    });
    assert.equal(simpleForm.status, 415);

    const oversized = await fetch(new URL("/api/clipboard", panel.url), {
      method: "POST",
      headers: { ...session.headers, Origin: new URL(panel.url).origin, "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, padding: "x".repeat(3_000) })
    });
    assert.equal(oversized.status, 413);

    const unknownAsset = await api(panel.url, session, "/api/clipboard", {
      method: "POST",
      body: { assetId: "0".repeat(24) },
      headers: { Origin: new URL(panel.url).origin }
    });
    assert.equal(unknownAsset.status, 404);

    const arbitraryPath = await api(panel.url, session, "/api/clipboard", {
      method: "POST",
      body: { assetId, path: "/tmp/escape.png" },
      headers: { Origin: new URL(panel.url).origin }
    });
    assert.equal(arbitraryPath.status, 400);

    const copiedResponse = await api(panel.url, session, "/api/clipboard", {
      method: "POST",
      body: { assetId },
      headers: { Origin: new URL(panel.url).origin }
    });
    assert.equal(copiedResponse.status, 200);
    const copiedResult = await copiedResponse.json();
    assert.deepEqual(Object.keys(copiedResult).sort(), ["assetId", "fileName", "status", "title"]);
    assert.deepEqual(copied, [await realpath(sourcePath)]);
    const after = await stat(sourcePath);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);

    const preflight = await api(panel.url, session, "/api/clipboard", { method: "OPTIONS" });
    assert.equal(preflight.status, 404);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);

    const currentVersion = inbox.getSummary().version;
    await inbox.close();
    const stoppedStatus = await api(panel.url, session, `/api/status?knownVersion=${currentVersion}`);
    assert.equal(stoppedStatus.status, 200);
    const stoppedSummary = await stoppedStatus.json();
    assert.equal(stoppedSummary.unchanged, true);
    assert.equal(stoppedSummary.watcherStatus, "stopped");
  } finally {
    await panel.close();
    await inbox.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("local panel paginates complete boards and reflects watcher updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-local-panel-pagination-"));
  const inboxRoot = join(root, "PinterestInbox");
  await mkdir(join(inboxRoot, "board-a"), { recursive: true });
  await mkdir(join(inboxRoot, "board-b"), { recursive: true });
  await Promise.all([
    ...Array.from({ length: 35 }, (_, index) => writeFile(join(inboxRoot, "board-a", `${index}__a-${index}.jpg`), `a-${index}`)),
    ...Array.from({ length: 2 }, (_, index) => writeFile(join(inboxRoot, "board-b", `${index}__b-${index}.jpg`), `b-${index}`))
  ]);
  const inbox = new InboxService({ inboxRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 500 });
  await inbox.start();
  const panel = await startLocalPanelServer({ inbox, port: 0, clipboardWriter: async () => {} });

  try {
    const session = await openSession(panel.url);
    const firstResponse = await api(panel.url, session, "/api/inbox?limit=30&boardId=board-a");
    const first = (await firstResponse.json()).page;
    assert.equal(first.total, 35);
    assert.equal(first.libraryTotal, 37);
    assert.equal(first.assets.length, 30);
    assert.equal(first.nextCursor, "30");
    assert.equal(first.boards.find((board) => board.id === "board-a").pinCount, 35);

    const secondResponse = await api(panel.url, session, "/api/inbox?limit=30&boardId=board-a&cursor=30");
    const second = (await secondResponse.json()).page;
    assert.equal(second.assets.length, 5);
    assert.equal(second.nextCursor, null);
    assert.ok(second.assets.every((asset) => asset.boardId === "board-a"));

    const initialVersion = first.version;
    await writeFile(join(inboxRoot, "board-b", "new__watched.jpg"), "new");
    await waitFor(async () => {
      const response = await api(panel.url, session, `/api/status?knownVersion=${initialVersion}`);
      const status = await response.json();
      assert.equal(status.unchanged, false);
      assert.ok(status.version > initialVersion);
    });
    const updated = await api(panel.url, session, "/api/inbox?limit=30");
    assert.equal((await updated.json()).page.libraryTotal, 38);

    await panel.close();
    await panel.close();
    await assert.rejects(fetch(panel.url));
  } finally {
    await panel.close();
    await inbox.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("local panel public responses sanitize filesystem errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-local-panel-errors-"));
  const inboxRoot = join(root, "PinterestInbox");
  await mkdir(inboxRoot, { recursive: true });
  const inbox = new InboxService({ inboxRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await inbox.start();
  const secretPath = join(root, "private", "asset.jpg");
  inbox.transfer = {
    ...inbox.getSummary().transfer,
    failed: 1,
    pending: 1,
    lastError: `EACCES: permission denied, mkdir '${secretPath}'`
  };
  const panel = await startLocalPanelServer({ inbox, port: 0, clipboardWriter: async () => {} });

  try {
    const session = await openSession(panel.url);
    const status = await (await api(panel.url, session, "/api/status")).json();
    const listing = await (await api(panel.url, session, "/api/inbox?limit=30")).json();
    assert.equal(JSON.stringify(status).includes(secretPath), false);
    assert.equal(JSON.stringify(listing).includes(secretPath), false);
    assert.match(status.transfer.lastError, /未能安全收取/);
    assert.match(listing.page.transfer.lastError, /未能安全收取/);
  } finally {
    await panel.close();
    await inbox.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("local panel shutdown is bounded even when a request is still active", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-local-panel-close-"));
  const inboxRoot = join(root, "PinterestInbox");
  await mkdir(inboxRoot, { recursive: true });
  await writeFile(join(inboxRoot, "one__asset.jpg"), "fixture");
  const inbox = new InboxService({ inboxRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await inbox.start();
  const originalReconcile = inbox.reconcile.bind(inbox);
  let releaseReconcile = () => {};
  const reconcileStarted = new Promise((resolveStarted) => {
    inbox.reconcile = async () => {
      resolveStarted();
      await new Promise((resolveRelease) => { releaseReconcile = resolveRelease; });
    };
  });
  const panel = await startLocalPanelServer({ inbox, port: 0, clipboardWriter: async () => {} });

  try {
    const session = await openSession(panel.url);
    const refreshRequest = api(panel.url, session, "/api/refresh", {
      method: "POST",
      body: {},
      headers: { Origin: new URL(panel.url).origin }
    }).catch((error) => error);
    await reconcileStarted;
    const startedAt = Date.now();
    const firstClose = panel.close();
    let secondCloseFinished = false;
    const secondClose = panel.close().then(() => { secondCloseFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(secondCloseFinished, false, "concurrent close calls should share the in-flight shutdown");
    await Promise.all([firstClose, secondClose]);
    assert.ok(Date.now() - startedAt < 1_800, "close should not wait indefinitely for active requests");
    await assert.rejects(fetch(panel.url));
    releaseReconcile();
    await refreshRequest;
  } finally {
    releaseReconcile();
    inbox.reconcile = originalReconcile;
    await panel.close();
    await inbox.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("local panel close can retry after a transient callback failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-local-panel-close-retry-"));
  const inboxRoot = join(root, "PinterestInbox");
  await mkdir(inboxRoot, { recursive: true });
  const inbox = new InboxService({ inboxRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await inbox.start();
  const panel = await startLocalPanelServer({ inbox, port: 0, clipboardWriter: async () => {} });
  const originalClose = Server.prototype.close;
  let failOnce = true;

  try {
    Server.prototype.close = function injectedClose(callback) {
      const address = this.address();
      if (failOnce && address && typeof address !== "string" && address.port === panel.port) {
        failOnce = false;
        queueMicrotask(() => callback?.(new Error("injected transient close failure")));
        return this;
      }
      return originalClose.call(this, callback);
    };

    await assert.rejects(panel.close(), /injected transient close failure/);
    assert.equal((await fetch(panel.url)).status, 200, "a failed close must leave the live service retryable");
    await panel.close();
    await assert.rejects(fetch(panel.url));
  } finally {
    Server.prototype.close = originalClose;
    await panel.close();
    await inbox.close();
    await rm(root, { recursive: true, force: true });
  }
});
