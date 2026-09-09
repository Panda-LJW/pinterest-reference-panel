import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InboxService, parseInboxFilename } from "../dist/server.bundle.js";

async function waitFor(assertion, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error("condition did not become true");
}

test("parses deterministic Pinterest Inbox filenames", () => {
  assert.deepEqual(parseInboxFilename("warm-light-study__pin-123456.jpg"), {
    pinId: "123456",
    title: "warm light study",
    extension: ".jpg"
  });
  assert.deepEqual(parseInboxFilename("123456__warm-light-study.jpg"), {
    pinId: "123456",
    title: "warm light study",
    extension: ".jpg"
  });
  assert.deepEqual(parseInboxFilename("loose-reference.webp"), {
    pinId: "loose-reference",
    title: "loose reference",
    extension: ".webp"
  });
});

test("initial scan groups board folders and ignores temporary files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-inbox-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  const cacheRoot = join(root, "cache");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(inboxRoot, "character-study"), { recursive: true });
  await writeFile(join(inboxRoot, "character-study", "123__red-dress.jpg"), "image-a");
  await writeFile(join(inboxRoot, "character-study", "unfinished.png.crdownload"), "partial");
  await writeFile(join(inboxRoot, "notes.txt"), "not an image");

  const service = new InboxService({ inboxRoot, cacheRoot, reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());
  const result = await service.getPage();

  assert.equal(result.page.total, 1);
  assert.equal(result.page.assets[0].pinId, "123");
  assert.equal(result.page.assets[0].boardId, "character-study");
  assert.equal(result.page.boards[0].pinCount, 1);
  assert.equal(result.page.watcherStatus, "watching");
  assert.ok(result.thumbnailErrors[result.page.assets[0].id]);
});

test("scan version changes only when indexed files change", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-version-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(inboxRoot, { recursive: true });
  const service = new InboxService({ inboxRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());
  const initial = (await service.getPage()).page.version;
  await service.scan();
  assert.equal((await service.getPage()).page.version, initial);
  await writeFile(join(inboxRoot, "99__new-pin.jpg"), "new-image");
  await service.scan();
  assert.equal((await service.getPage()).page.version, initial + 1);
});

test("forceRescan refreshes the long-term index without draining Downloads", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-readonly-rescan-test-"));
  const inboxRoot = join(root, "Pictures", "PinterestInbox");
  const stagingRoot = join(root, "Downloads", "PinterestInbox");
  const staged = join(stagingRoot, "pending__pin-77.jpg");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(inboxRoot, { recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  await writeFile(staged, "pending-download");
  const service = new InboxService({ inboxRoot, stagingRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  context.after(() => service.close());

  const empty = await service.getPublicPage({ forceRescan: true });
  assert.equal(empty.total, 0);
  assert.equal(await readFile(staged, "utf8"), "pending-download");
  await writeFile(join(inboxRoot, "indexed__pin-88.jpg"), "indexed-image");
  const refreshed = await service.getPublicPage({ forceRescan: true });
  assert.equal(refreshed.total, 1);
  assert.equal(await readFile(staged, "utf8"), "pending-download");
});

test("startup moves stable downloads into the long-term library before indexing", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-transfer-test-"));
  const stagingRoot = join(root, "Downloads", "PinterestInbox");
  const inboxRoot = join(root, "Pictures", "PinterestInbox");
  const source = join(stagingRoot, "posters", "neon-study__pin-77.jpg");
  const destination = join(inboxRoot, "posters", "neon-study__pin-77.jpg");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(stagingRoot, "posters"), { recursive: true });
  await writeFile(source, "downloaded-image");

  const service = new InboxService({ inboxRoot, stagingRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());

  assert.equal(await readFile(destination, "utf8"), "downloaded-image");
  await assert.rejects(access(source), { code: "ENOENT" });
  const page = (await service.getPage()).page;
  assert.equal(page.total, 1);
  assert.equal(page.assets[0].boardId, "posters");
  assert.equal(page.transfer.moved, 1);
  assert.equal(page.transfer.failed, 0);
});

test("identical destination content is reused without creating duplicates", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-dedupe-test-"));
  const stagingRoot = join(root, "Downloads", "PinterestInbox");
  const inboxRoot = join(root, "Pictures", "PinterestInbox");
  const relativePath = join("editorial", "same__pin-88.webp");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(stagingRoot, "editorial"), { recursive: true });
  await mkdir(join(inboxRoot, "editorial"), { recursive: true });
  await writeFile(join(stagingRoot, relativePath), "same-content");
  await writeFile(join(inboxRoot, relativePath), "same-content");

  const service = new InboxService({ inboxRoot, stagingRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());

  await assert.rejects(access(join(stagingRoot, relativePath)), { code: "ENOENT" });
  assert.deepEqual(await readdir(join(inboxRoot, "editorial")), ["same__pin-88.webp"]);
  assert.equal((await service.getPage()).page.transfer.deduplicated, 1);
});

test("different content with the same filename receives a deterministic hash suffix", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-conflict-test-"));
  const stagingRoot = join(root, "Downloads", "PinterestInbox");
  const inboxRoot = join(root, "Pictures", "PinterestInbox");
  const relativePath = join("editorial", "poster__pin-99.jpg");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(stagingRoot, "editorial"), { recursive: true });
  await mkdir(join(inboxRoot, "editorial"), { recursive: true });
  await writeFile(join(stagingRoot, relativePath), "new-content");
  await writeFile(join(inboxRoot, relativePath), "old-content");

  const service = new InboxService({ inboxRoot, stagingRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());

  const names = (await readdir(join(inboxRoot, "editorial"))).sort();
  assert.equal(names.length, 2);
  assert.ok(names.includes("poster__pin-99.jpg"));
  assert.ok(names.some((name) => /^poster__pin-99--[a-f0-9]{8}\.jpg$/.test(name)));
  const page = (await service.getPage()).page;
  assert.equal(page.total, 2);
  assert.equal(page.transfer.renamed, 1);
});

test("staging watcher with periodic reconciliation imports a newly completed download", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-watch-transfer-test-"));
  const stagingRoot = join(root, "Downloads", "PinterestInbox");
  const inboxRoot = join(root, "Pictures", "PinterestInbox");
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new InboxService({ inboxRoot, stagingRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 500 });
  await service.start();
  context.after(() => service.close());
  await mkdir(join(stagingRoot, "live"), { recursive: true });
  await writeFile(join(stagingRoot, "live", "fresh__pin-101.png"), "fresh-image");

  await waitFor(async () => {
    const page = (await service.getPage()).page;
    assert.equal(page.total, 1);
    assert.equal(page.assets[0].pinId, "101");
  });
  assert.equal(await readFile(join(inboxRoot, "live", "fresh__pin-101.png"), "utf8"), "fresh-image");
});

test("an unsafe destination symlink leaves the staged source untouched", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-transfer-boundary-test-"));
  const stagingRoot = join(root, "Downloads", "PinterestInbox");
  const inboxRoot = join(root, "Pictures", "PinterestInbox");
  const outside = join(root, "outside");
  const source = join(stagingRoot, "escaped", "unsafe__pin-102.jpg");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(stagingRoot, "escaped"), { recursive: true });
  await mkdir(inboxRoot, { recursive: true });
  await mkdir(outside, { recursive: true });
  await symlink(outside, join(inboxRoot, "escaped"));
  await writeFile(source, "must-stay-staged");

  const service = new InboxService({ inboxRoot, stagingRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());

  assert.equal(await readFile(source, "utf8"), "must-stay-staged");
  const page = (await service.getPage()).page;
  assert.equal(page.total, 0);
  assert.equal(page.transfer.failed, 1);
  assert.match(page.transfer.lastError, /未能安全收取/);
  assert.equal(page.transfer.lastError.includes(root), false);
});

test("a destination file symlink cannot impersonate an identical library asset", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-transfer-file-symlink-test-"));
  const stagingRoot = join(root, "Downloads", "PinterestInbox");
  const inboxRoot = join(root, "Pictures", "PinterestInbox");
  const outside = join(root, "outside.jpg");
  const relativePath = join("safe", "linked__pin-103.jpg");
  const source = join(stagingRoot, relativePath);
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(stagingRoot, "safe"), { recursive: true });
  await mkdir(join(inboxRoot, "safe"), { recursive: true });
  await writeFile(outside, "same-content");
  await writeFile(source, "same-content");
  await symlink(outside, join(inboxRoot, relativePath));

  const service = new InboxService({ inboxRoot, stagingRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());

  await assert.rejects(access(source), { code: "ENOENT" });
  const names = await readdir(join(inboxRoot, "safe"));
  assert.ok(names.includes("linked__pin-103.jpg"));
  assert.ok(names.some((name) => /^linked__pin-103--[a-f0-9]{8}\.jpg$/.test(name)));
  const page = (await service.getPage()).page;
  assert.equal(page.total, 1);
  assert.equal(page.transfer.renamed, 1);
  assert.equal(await readFile(outside, "utf8"), "same-content");
});

test("rejects an indexed file replaced by a symlink outside the Inbox", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-source-boundary-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  const source = join(inboxRoot, "42__inside.jpg");
  const outside = join(root, "outside.jpg");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(inboxRoot, { recursive: true });
  await writeFile(source, "inside");
  await writeFile(outside, "outside");
  const service = new InboxService({ inboxRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());
  const assetId = (await service.getPage()).page.assets[0].id;
  await unlink(source);
  await symlink(outside, source);
  assert.equal(await service.resolveAsset(assetId), null);
  assert.equal(await service.getThumbnail(assetId), null);
});

test("macOS thumbnail generation returns a small JPEG data URL", { skip: process.platform !== "darwin" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-thumb-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(inboxRoot, "preview"), { recursive: true });
  const fixture = new URL("../../../docs/images/preview.png", import.meta.url);
  await writeFile(join(inboxRoot, "preview", "preview__panel.png"), await readFile(fixture));
  const service = new InboxService({ inboxRoot, cacheRoot: join(root, "cache"), reconcileIntervalMs: 60_000 });
  await service.start();
  context.after(() => service.close());
  const publicPage = await service.getPublicPage();
  const assetId = publicPage.assets[0].id;
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => service.getThumbnail(assetId)));
  assert.ok(concurrent.every((thumbnail) => thumbnail?.data.equals(concurrent[0].data)));
  const result = await service.getPage();
  assert.match(result.thumbnails[assetId], /^data:image\/jpeg;base64,/);
  assert.equal(result.thumbnailErrors[assetId], undefined);
  assert.equal((await readdir(join(root, "cache"))).filter((name) => name.endsWith(".jpg")).length, 1);
});
