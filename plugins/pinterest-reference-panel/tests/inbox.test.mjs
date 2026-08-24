import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InboxService, parseInboxFilename } from "../dist/server.bundle.js";

test("parses deterministic Pinterest Inbox filenames", () => {
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
  const result = await service.getPage();
  const assetId = result.page.assets[0].id;
  assert.match(result.thumbnails[assetId], /^data:image\/jpeg;base64,/);
  assert.equal(result.thumbnailErrors[assetId], undefined);
});
