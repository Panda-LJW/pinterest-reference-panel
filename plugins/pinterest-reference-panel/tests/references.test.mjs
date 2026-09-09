import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { InboxService, ReferenceSessions, startLocalPanelServer } from "../dist/server.bundle.js";

async function fixture(t, count = 12) {
  const root = await mkdtemp(join(tmpdir(), "pinterest-references-test-"));
  const inboxRoot = join(root, "inbox");
  await mkdir(join(inboxRoot, "插画"), { recursive: true });
  const bytes = await readFile(new URL("../../../docs/images/preview.png", import.meta.url));
  for (let index = 1; index <= count; index++) await writeFile(join(inboxRoot, "插画", `参考 ${index}__pin-${index}.png`), bytes);
  const inbox = new InboxService({ inboxRoot, stagingRoot: inboxRoot, cacheRoot: join(root, "cache") });
  // A fixed index makes stale-file checks independent of watcher timing.
  await inbox.scan();
  const references = new ReferenceSessions(inbox);
  t.after(async () => { await inbox.close(); await rm(root, { recursive: true, force: true }); });
  return { root, inbox, references, assets: (await inbox.getPublicPage({ limit: 30, sort: "title" })).assets, bytes };
}

test("reference sessions isolate ordered selections and enforce optimistic revisions", async t => {
  const { references, assets } = await fixture(t);
  const a = references.create(), b = references.create();
  const ids = assets.slice(0, 3).map(asset => asset.id);
  const selected = await references.replace(a, ids, 0);
  assert.equal(selected.revision, 1);
  assert.deepEqual(selected.entries.map(entry => entry.number), [1, 2, 3]);
  assert.equal((await references.describe(b)).entries.length, 0);
  await assert.rejects(references.resolve(b), /还是空/);
  await assert.rejects(references.replace(a, [], 0), /其他页面/);
  assert.equal((await references.replace(a, ids, 1)).revision, 1, "no-op retains revision");
  await references.replace(a, [ids[2], ids[0]], 1);
  assert.deepEqual((await references.resolve(a, 2)).files.map(file => file.assetId), [ids[2], ids[0]]);
  await assert.rejects(references.resolve(a, 1), /已经变化/);
  const competing = await Promise.allSettled([references.replace(a, [ids[1]], 2), references.replace(a, [ids[2]], 2)]);
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  await references.replace(a, [], 3);
  assert.equal((await references.describe(a)).entries.length, 0);
  assert.throws(() => references.require("0".repeat(32)), /失效/);
  assert.throws(() => references.require(""), /失效/);
});

test("reference validation rejects duplicates, oversized sets and arbitrary identifiers", async t => {
  const { references, assets } = await fixture(t);
  const session = references.create();
  await assert.rejects(references.replace(session, assets.map(asset => asset.id), 0), /最多选择/);
  await assert.rejects(references.replace(session, [assets[0].id, assets[0].id], 0), /重复/);
  await assert.rejects(references.replace(session, ["/etc/passwd"], 0), /无效/);
  await assert.rejects(references.replace(session, ["0".repeat(24)], 0), /不在素材库/);
  assert.equal((await references.describe(session)).revision, 0);
});

test("changed, missing and escaping reference files block the entire read and never silently refresh consent", async t => {
  const { references, inbox, assets, root } = await fixture(t);
  const session = references.create();
  const ids = assets.slice(0, 2).map(asset => asset.id);
  await references.replace(session, ids, 0);
  const changed = await inbox.resolveAsset(ids[0]);
  await writeFile(changed.sourcePath, "replacement-image");
  assert.equal((await references.describe(session)).entries[0].status, "changed");
  await assert.rejects(references.resolve(session), /参考图 1/);
  await references.replace(session, ids.slice().reverse(), 1);
  await assert.rejects(references.resolve(session), /参考图 2/);
  const other = references.create();
  await assert.rejects(references.replace(other, [ids[0]], 0), /索引后发生变化/);
  await rm(changed.sourcePath);
  assert.equal((await references.describe(session)).entries[1].status, "missing");
  const outside = join(root, "outside.png");
  await writeFile(outside, "outside"); await symlink(outside, changed.sourcePath);
  await assert.rejects(references.resolve(session), /不可用/);
  assert.equal((await references.describe(other)).entries.length, 0);
});

test("search matches the complete library before pagination, normalizes text and respects board/sort", async t => {
  const { inbox } = await fixture(t, 36);
  const first = await inbox.getPublicPage({ sort: "title", limit: 30 });
  assert.equal(first.assets.length, 30);
  const result = await inbox.getPublicPage({ query: "插画 ３６", sort: "title" });
  assert.equal(result.total, 1); assert.equal(result.assets[0].pinId, "36");
  assert.equal(result.libraryTotal, 36);
  assert.equal((await inbox.getPublicPage({ boardId: "missing", query: "36" })).total, 0);
  assert.deepEqual(first.assets.slice(0, 3).map(asset => asset.pinId), ["1", "2", "3"]);
  const recent = await inbox.getPublicPage({ sort: "recent", limit: 30 });
  const oldest = await inbox.getPublicPage({ sort: "oldest", limit: 30 });
  assert.ok(recent.assets[0].updatedAt >= oldest.assets[0].updatedAt);
});

test("HTTP references serve original bytes, protect mutations, keep paths private and isolate server cookies", async t => {
  const { inbox, references, assets, bytes } = await fixture(t);
  const copied = [];
  const panel = await startLocalPanelServer({ inbox, references, clipboardWriter: async value => { copied.push(value); } });
  const second = await startLocalPanelServer({ inbox, references });
  t.after(async () => { await panel.close(); await second.close(); });
  const id = references.create();
  const response = await fetch(`${panel.url}?ref=${id}`);
  const html = await response.text();
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const token = html.match(/name="pinterest-panel-token" content="([^"]+)"/)[1];
  const headers = { Cookie: cookie, "X-Pinterest-Panel-Token": token, "X-Pinterest-Reference-Session": id };
  const call = (path, body, override = {}) => fetch(new URL(path, panel.url), { method: body ? "POST" : "GET", headers: { ...headers, ...(body ? { Origin: new URL(panel.url).origin, "Content-Type": "application/json" } : {}), ...override }, body: body ? JSON.stringify(body) : undefined });
  const secondCookie = (await fetch(second.url)).headers.get("set-cookie").split("=")[0];
  assert.notEqual(cookie.split("=")[0], secondCookie);
  assert.match(html, new RegExp(`content="${id}"`));
  assert.equal((await fetch(`${panel.url}?ref=${"0".repeat(32)}`)).status, 200, "expired links still show the recoverable UI");
  assert.equal((await fetch(`${panel.url}?ref=%22%3E`)).status, 400);
  assert.equal((await call("/api/references", null, { "X-Pinterest-Reference-Session": "" })).status, 410);
  assert.equal((await call("/api/references", { assetIds: [], revision: 0 }, { Origin: "https://example.com" })).status, 403);
  assert.equal((await call("/api/references", { assetIds: [], revision: 0, path: "/etc/passwd" })).status, 400);
  const ids = assets.slice(0, 2).map(asset => asset.id);
  const originals = await Promise.all(ids.map(id => inbox.resolveAsset(id)));
  const before = await Promise.all(originals.map(asset => stat(asset.sourcePath)));
  const selected = await (await call("/api/references", { assetIds: ids, revision: 0 })).json();
  assert.equal(selected.entries.length, 2);
  assert.equal(JSON.stringify(selected).includes("sourcePath"), false);
  assert.equal(JSON.stringify(selected).includes(originals[0].sourcePath), false);
  const preview = await call(`/api/previews/${ids[0]}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
  assert.equal((await fetch(new URL(`/api/previews/${ids[0]}`, panel.url))).status, 401);
  assert.equal((await call("/api/references/clipboard", { revision: 0 })).status, 409);
  const copy = await (await call("/api/references/clipboard", { revision: 1 })).json();
  assert.equal(copy.count, 2);
  assert.deepEqual(copied, [(await Promise.all(originals.map(asset => realpath(asset.sourcePath)))).join("\n")]);
  for (let index = 0; index < originals.length; index++) {
    const asset = originals[index];
    assert.deepEqual(await readFile(asset.sourcePath), bytes);
    assert.equal((await stat(asset.sourcePath)).mtimeMs, before[index].mtimeMs);
  }
  assert.equal((await call("/api/inbox?sort=invalid")).status, 400);
  assert.equal((await call(`/api/inbox?q=${"x".repeat(201)}`)).status, 400);
});
