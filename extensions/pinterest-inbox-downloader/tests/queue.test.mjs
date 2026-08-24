import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const extensionRoot = new URL("../", import.meta.url);

function waitUntil(predicate, timeoutMs = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) resolve();
      else if (Date.now() - started > timeoutMs) reject(new Error("Timed out waiting for extension queue"));
      else setTimeout(poll, 5);
    };
    poll();
  });
}

async function createHarness(fetchImpl) {
  const sharedSource = await readFile(new URL("shared.js", extensionRoot), "utf8");
  const backgroundSource = await readFile(new URL("background.js", extensionRoot), "utf8");
  const downloadCalls = [];
  const progress = [];
  let onChanged;
  let onMessage;
  let nextId = 1;
  const runtime = { lastError: null, onMessage: { addListener(listener) { onMessage = listener; } } };
  const context = {
    URL,
    AbortController,
    console,
    crypto: { randomUUID: () => "generated-job" },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    globalThis: null,
    importScripts() {},
    chrome: {
      runtime,
      tabs: { sendMessage(_tabId, payload, callback) { progress.push(payload); callback?.(); } },
      downloads: {
        onChanged: { addListener(listener) { onChanged = listener; } },
        download(options, callback) { downloadCalls.push(options); callback(nextId++); },
        search(_query, callback) { callback([]); },
        cancel(_id, callback) { callback?.(); }
      }
    }
  };
  context.globalThis = context;
  runInNewContext(sharedSource, context);
  runInNewContext(backgroundSource, context);
  return {
    downloadCalls,
    progress,
    enqueue(message) {
      let response;
      onMessage(message, { tab: { id: 7 } }, (value) => { response = value; });
      return response;
    },
    complete(downloadId, state = "complete") {
      onChanged({ id: downloadId, state: { current: state } });
    }
  };
}

function successfulOriginal(url) {
  const extension = new URL(url).pathname.split(".").pop();
  const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  return Promise.resolve({ ok: true, url, headers: { get: () => contentType } });
}

test("download queue resolves originals, stays sequential, and retries once", async () => {
  const harness = await createHarness(successfulOriginal);
  const response = harness.enqueue({
    type: "pinterestInboxEnqueue",
    jobId: "job-1",
    assets: [
      { pinId: "1", boardSlug: "board", title: "one", imageUrl: "https://i.pinimg.com/736x/a/one.jpg" },
      { pinId: "2", boardSlug: "board", title: "two", imageUrl: "https://i.pinimg.com/474x/a/two.png" }
    ]
  });
  assert.equal(response.status.pending, 2);
  await waitUntil(() => harness.downloadCalls.length === 1);
  harness.complete(1, "interrupted");
  await waitUntil(() => harness.downloadCalls.length === 2);
  harness.complete(2);
  await waitUntil(() => harness.downloadCalls.length === 3);
  harness.complete(3);
  await waitUntil(() => harness.progress.some((item) => item.status?.done));

  assert.deepEqual(harness.downloadCalls.map((item) => item.url), [
    "https://i.pinimg.com/originals/a/one.jpg",
    "https://i.pinimg.com/originals/a/one.jpg",
    "https://i.pinimg.com/originals/a/two.png"
  ]);
  assert.deepEqual(harness.downloadCalls.map((item) => item.filename), [
    "PinterestInbox/board/one__pin-1.jpg",
    "PinterestInbox/board/one__pin-1.jpg",
    "PinterestInbox/board/two__pin-2.png"
  ]);
  const final = harness.progress.findLast((item) => item.status?.done).status;
  assert.equal(final.success, 2);
  assert.equal(final.failed, 0);
  assert.equal(final.skipped, 0);
  assert.equal(final.originalUnavailable, 0);
});

test("keeps WebP only when it is the sole available originals asset", async () => {
  const probes = [];
  const harness = await createHarness(async (url) => {
    probes.push(url);
    const isWebp = url.endsWith(".webp");
    return { ok: isWebp, url, headers: { get: () => isWebp ? "image/webp" : "text/html" } };
  });
  harness.enqueue({
    type: "pinterestInboxEnqueue",
    jobId: "job-webp",
    assets: [{ pinId: "3", boardSlug: "board", title: "native-webp", imageUrl: "https://i.pinimg.com/736x/b/native.webp" }]
  });
  await waitUntil(() => harness.downloadCalls.length === 1);
  assert.deepEqual(probes, [
    "https://i.pinimg.com/originals/b/native.jpg",
    "https://i.pinimg.com/originals/b/native.jpeg",
    "https://i.pinimg.com/originals/b/native.png",
    "https://i.pinimg.com/originals/b/native.webp"
  ]);
  assert.equal(harness.downloadCalls[0].url, "https://i.pinimg.com/originals/b/native.webp");
  assert.equal(harness.downloadCalls[0].filename, "PinterestInbox/board/native-webp__pin-3.webp");
  harness.complete(1);
  await waitUntil(() => harness.progress.some((item) => item.status?.done));
  assert.equal(harness.progress.findLast((item) => item.status?.done).status.success, 1);
});

test("skips an item when no JPG, PNG, or WebP originals asset exists", async () => {
  const harness = await createHarness(async (url) => ({
    ok: false,
    url,
    headers: { get: () => "text/html" }
  }));
  harness.enqueue({
    type: "pinterestInboxEnqueue",
    jobId: "job-missing",
    assets: [{ pinId: "4", boardSlug: "board", title: "missing", imageUrl: "https://i.pinimg.com/736x/c/missing.jpg" }]
  });
  await waitUntil(() => harness.progress.some((item) => item.status?.done));
  assert.equal(harness.downloadCalls.length, 0);
  const final = harness.progress.findLast((item) => item.status?.done).status;
  assert.equal(final.success, 0);
  assert.equal(final.skipped, 1);
  assert.equal(final.originalUnavailable, 1);
});
