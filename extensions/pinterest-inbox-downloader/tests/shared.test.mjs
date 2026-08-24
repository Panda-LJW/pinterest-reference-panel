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
  assert.equal(shared.cleanPinTitle("其中包括图片：ruggie bucchi poster !!"), "ruggie bucchi poster !!");
  assert.equal(shared.cleanPinTitle("其中包括图片：", "pin-123"), "pin-123");
  assert.equal(shared.buildDownloadFilename({
    boardSlug: "Character Ideas",
    pinId: "123456",
    title: "red/dress: study",
    imageUrl: "https://i.pinimg.com/originals/example.webp"
  }, ".webp"), "PinterestInbox/character-ideas/red-dress- study__pin-123456.webp");
  assert.throws(() => shared.buildDownloadFilename({ boardSlug: "board", pinId: "1", title: "bad" }), /verified|\u5df2\u9a8c\u8bc1/);
});

test("builds originals-only candidates and preserves the verified native format", async () => {
  const shared = await loadShared();
  assert.deepEqual(Array.from(shared.originalImageCandidates("https://i.pinimg.com/736x/aa/bb/hash.webp")), [
    "https://i.pinimg.com/originals/aa/bb/hash.jpg",
    "https://i.pinimg.com/originals/aa/bb/hash.jpeg",
    "https://i.pinimg.com/originals/aa/bb/hash.png",
    "https://i.pinimg.com/originals/aa/bb/hash.webp"
  ]);
  assert.deepEqual(Array.from(shared.originalImageCandidates("https://i.pinimg.com/474x/aa/bb/hash.png")), [
    "https://i.pinimg.com/originals/aa/bb/hash.png",
    "https://i.pinimg.com/originals/aa/bb/hash.jpg",
    "https://i.pinimg.com/originals/aa/bb/hash.jpeg",
    "https://i.pinimg.com/originals/aa/bb/hash.webp"
  ]);
  assert.equal(
    shared.originalImageCandidates("https://i.pinimg.com/75x75_RS/aa/bb/avatar.webp")[0],
    "https://i.pinimg.com/originals/aa/bb/avatar.jpg"
  );
  assert.equal(shared.originalExtensionForContentType("image/jpeg; charset=binary"), ".jpg");
  assert.equal(shared.originalExtensionForContentType("image/png"), ".png");
  assert.equal(shared.originalExtensionForContentType("image/webp"), ".webp");
  assert.equal(shared.originalExtensionForContentType("image/gif"), null);
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
  assert.deepEqual(manifest.host_permissions, ["https://*.pinterest.com/*", "https://*.pinimg.com/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://*.pinterest.com/*"]);
});

test("content panel exposes a functional pause control", async () => {
  const content = await readFile(new URL("content.js", extensionRoot), "utf8");
  assert.match(content, /id="toggleEnabled"/);
  assert.match(content, /if \(!enabled\) return;/);
  assert.match(content, /采集已暂停/);
  assert.ok(content.indexOf("pinrep-footer-organic-title") < content.indexOf('image.getAttribute("alt")'));
});
