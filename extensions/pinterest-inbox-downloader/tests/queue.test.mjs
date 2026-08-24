import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const extensionRoot = new URL("../", import.meta.url);

function waitUntil(predicate, timeoutMs = 1000) {
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

test("download queue is sequential, retries once, and reports final counts", async () => {
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
    console,
    crypto: { randomUUID: () => "generated-job" },
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

  let response;
  onMessage({
    type: "pinterestInboxEnqueue",
    jobId: "job-1",
    assets: [
      { pinId: "1", boardSlug: "board", title: "one", imageUrl: "https://i.pinimg.com/a/one.jpg" },
      { pinId: "2", boardSlug: "board", title: "two", imageUrl: "https://i.pinimg.com/a/two.png" }
    ]
  }, { tab: { id: 7 } }, (value) => { response = value; });
  assert.equal(response.status.pending, 2);
  await waitUntil(() => downloadCalls.length === 1);
  onChanged({ id: 1, state: { current: "interrupted" } });
  await waitUntil(() => downloadCalls.length === 2);
  onChanged({ id: 2, state: { current: "complete" } });
  await waitUntil(() => downloadCalls.length === 3, 1500);
  onChanged({ id: 3, state: { current: "complete" } });
  await waitUntil(() => progress.some((item) => item.status?.done), 1500);

  assert.deepEqual(downloadCalls.map((item) => item.filename), [
    "PinterestInbox/board/1__one.jpg",
    "PinterestInbox/board/1__one.jpg",
    "PinterestInbox/board/2__two.png"
  ]);
  const final = progress.findLast((item) => item.status?.done).status;
  assert.equal(final.success, 2);
  assert.equal(final.failed, 0);
  assert.equal(final.skipped, 0);
});
