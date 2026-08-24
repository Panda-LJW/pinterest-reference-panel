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

async function createHarness(fetchImpl, convertImpl = null) {
  const sharedSource = await readFile(new URL("shared.js", extensionRoot), "utf8");
  const backgroundSource = await readFile(new URL("background.js", extensionRoot), "utf8");
  const downloadCalls = [];
  const filenameSuggestions = [];
  const progress = [];
  let onChanged;
  let onDeterminingFilename;
  let onMessage;
  let nextId = 1;
  const runtime = {
    id: "pinterest-inbox-test",
    lastError: null,
    onMessage: { addListener(listener) { onMessage = listener; } },
    sendMessage(message, callback) {
      if (message.type === "pinterestInboxConvertImage") {
        Promise.resolve(convertImpl?.(message) ?? { ok: false, error: "missing converter" }).then(callback);
        return;
      }
      callback?.({ ok: true });
    }
  };
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
      offscreen: {
        async hasDocument() { return true; },
        async createDocument() {}
      },
      tabs: { sendMessage(_tabId, payload, callback) { progress.push(payload); callback?.(); } },
      downloads: {
        onChanged: { addListener(listener) { onChanged = listener; } },
        onDeterminingFilename: { addListener(listener) { onDeterminingFilename = listener; } },
        download(options, callback) {
          const id = nextId++;
          downloadCalls.push(options);
          onDeterminingFilename({ id, url: options.url, filename: new URL(options.url).pathname.split("/").pop(), byExtensionId: runtime.id }, (suggestion = {}) => filenameSuggestions.push(suggestion));
          callback(id);
        },
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
    filenameSuggestions,
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
    ],
    quality: "original"
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
  assert.deepEqual(harness.filenameSuggestions.map((item) => item.filename), [
    "PinterestInbox/board/one__pin-1.jpg",
    "PinterestInbox/board/one__pin-1.jpg",
    "PinterestInbox/board/two__pin-2.png"
  ]);
  assert.ok(harness.filenameSuggestions.every((item) => item.conflictAction === "overwrite"));
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
    assets: [{ pinId: "3", boardSlug: "board", title: "native-webp", imageUrl: "https://i.pinimg.com/736x/b/native.webp" }],
    quality: "original"
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
    assets: [{ pinId: "4", boardSlug: "board", title: "missing", imageUrl: "https://i.pinimg.com/736x/c/missing.jpg" }],
    quality: "original"
  });
  await waitUntil(() => harness.progress.some((item) => item.status?.done));
  assert.equal(harness.downloadCalls.length, 0);
  const final = harness.progress.findLast((item) => item.status?.done).status;
  assert.equal(final.success, 0);
  assert.equal(final.skipped, 1);
  assert.equal(final.originalUnavailable, 1);
});

test("high and light jobs download the processed blob with the verified output extension", async () => {
  const conversions = [];
  const harness = await createHarness(successfulOriginal, (message) => {
    conversions.push(message);
    return {
      ok: true,
      requestId: message.requestId,
      url: `blob:chrome-extension://test/${message.requestId}`,
      extension: message.quality === "light" ? ".jpg" : ".png",
      sourceBytes: 3_000_000,
      outputBytes: 300_000
    };
  });
  harness.enqueue({
    type: "pinterestInboxEnqueue",
    jobId: "job-light",
    quality: "light",
    assets: [{ pinId: "5", boardSlug: "board", title: "light", imageUrl: "https://i.pinimg.com/736x/d/light.png" }]
  });
  await waitUntil(() => harness.downloadCalls.length === 1);
  assert.equal(conversions[0].quality, "light");
  assert.equal(conversions[0].url, "https://i.pinimg.com/originals/d/light.png");
  assert.equal(conversions[0].sourceExtension, ".png");
  assert.match(harness.downloadCalls[0].url, /^blob:chrome-extension:\/\/test\//);
  assert.equal(harness.downloadCalls[0].filename, "PinterestInbox/board/light__pin-5.jpg");
  harness.complete(1);
  await waitUntil(() => harness.progress.some((item) => item.status?.done));
  const final = harness.progress.findLast((item) => item.status?.done).status;
  assert.equal(final.quality, "light");
  assert.equal(final.processingFailed, 0);
});

test("reports an explicit processing failure instead of downloading a thumbnail fallback", async () => {
  const harness = await createHarness(successfulOriginal, () => ({ ok: false, error: "JPEG 编码失败" }));
  harness.enqueue({
    type: "pinterestInboxEnqueue",
    jobId: "job-processing-failure",
    quality: "high",
    assets: [{ pinId: "6", boardSlug: "board", title: "failure", imageUrl: "https://i.pinimg.com/736x/e/failure.jpg" }]
  });
  await waitUntil(() => harness.progress.some((item) => item.status?.done));
  assert.equal(harness.downloadCalls.length, 0);
  const final = harness.progress.findLast((item) => item.status?.done).status;
  assert.equal(final.failed, 1);
  assert.equal(final.processingFailed, 1);
  assert.equal(final.lastError, "JPEG 编码失败");
});

test("smart-light preserves a WebP originals asset without invoking the converter", async () => {
  let conversionCount = 0;
  const harness = await createHarness(async (url) => {
    const isWebp = url.endsWith(".webp");
    return { ok: isWebp, url, headers: { get: () => isWebp ? "image/webp" : "text/html" } };
  }, () => {
    conversionCount += 1;
    return { ok: false, error: "converter should not run" };
  });
  harness.enqueue({
    type: "pinterestInboxEnqueue",
    jobId: "job-smart-webp",
    quality: "light",
    assets: [{ pinId: "7", boardSlug: "board", title: "smart-webp", imageUrl: "https://i.pinimg.com/736x/f/smart.webp" }]
  });
  await waitUntil(() => harness.downloadCalls.length === 1);
  assert.equal(conversionCount, 0);
  assert.equal(harness.downloadCalls[0].url, "https://i.pinimg.com/originals/f/smart.webp");
  assert.equal(harness.downloadCalls[0].filename, "PinterestInbox/board/smart-webp__pin-7.webp");
  harness.complete(1);
  await waitUntil(() => harness.progress.some((item) => item.status?.done));
  assert.equal(harness.progress.findLast((item) => item.status?.done).status.success, 1);
});
