import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const extensionRoot = new URL("../", import.meta.url);

async function loadShared() {
  const source = await readFile(new URL("shared.js", extensionRoot), "utf8");
  const context = { URL };
  context.globalThis = context;
  runInNewContext(source, context);
  return context.PinterestInboxShared;
}

test("derives stable board, pin, and safe Inbox filenames", async () => {
  const shared = await loadShared();
  assert.equal(shared.parsePinId("https://www.pinterest.com/pin/123456/"), "123456");
  assert.equal(shared.boardSlugFromUrl("https://www.pinterest.com/panda/Character-Ideas/section/"), "character-ideas");
  assert.equal(shared.buildDownloadFilename({
    boardSlug: "Character Ideas",
    pinId: "123456",
    title: "red/dress: study",
    imageUrl: "https://i.pinimg.com/originals/example.webp"
  }), "PinterestInbox/character-ideas/123456__red-dress- study.webp");
});

test("accepts only static HTTPS pinimg assets and selects the largest srcset", async () => {
  const shared = await loadShared();
  assert.equal(shared.isPinterestImageUrl("https://i.pinimg.com/736x/a/b/c/photo.jpg"), true);
  assert.equal(shared.isPinterestImageUrl("https://www.pinterest.com/image.jpg"), false);
  assert.equal(shared.isPinterestImageUrl("http://i.pinimg.com/image.jpg"), false);
  assert.equal(shared.isPinterestImageUrl("https://i.pinimg.com/video/master.m3u8"), false);
  assert.equal(shared.bestSrcsetUrl("https://i.pinimg.com/236x/a.jpg 236w, https://i.pinimg.com/736x/a.jpg 736w"), "https://i.pinimg.com/736x/a.jpg");
});

test("manifest keeps the browser permission surface narrow", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", extensionRoot), "utf8"));
  assert.deepEqual(manifest.permissions, ["downloads"]);
  assert.deepEqual(manifest.host_permissions, ["https://*.pinterest.com/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://*.pinterest.com/*"]);
});
