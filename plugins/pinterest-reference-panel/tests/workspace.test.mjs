import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkspaceRegistry } from "../dist/server.bundle.js";

function asset(sourcePath, overrides = {}) {
  return {
    id: "asset-1",
    pinId: "123",
    boardId: "character-study",
    boardTitle: "Character Study",
    title: "Red Dress",
    extension: ".jpg",
    size: 7,
    updatedAt: new Date().toISOString(),
    sourcePath,
    sourceRelativePath: "character-study/123__red-dress.jpg",
    signature: "signature",
    ...overrides
  };
}

test("imports an indexed asset without overwriting existing workspace content", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-workspace-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const source = join(root, "123__red-dress.jpg");
  await mkdir(workspace);
  await writeFile(source, "image-a");
  const registry = new WorkspaceRegistry();
  const state = await registry.register(workspace);
  assert.equal(state.available, true);

  const first = await registry.importAsset(asset(source), state.token);
  assert.equal(first.relativePath, "references/pinterest/character-study/123__red-dress.jpg");
  assert.equal(await readFile(join(workspace, first.relativePath), "utf8"), "image-a");
  const second = await registry.importAsset(asset(source), state.token);
  assert.equal(second.reused, true);

  await writeFile(source, "image-b");
  const third = await registry.importAsset(asset(source), state.token);
  assert.match(third.relativePath, /123__red-dress-[a-f0-9]{8}\.jpg$/);
  assert.equal(await readFile(join(workspace, first.relativePath), "utf8"), "image-a");
});

test("rejects a references directory symlink that escapes the workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-symlink-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  const source = join(root, "123__red-dress.jpg");
  await mkdir(workspace);
  await mkdir(outside);
  await symlink(outside, join(workspace, "references"));
  await writeFile(source, "image-a");
  const registry = new WorkspaceRegistry();
  const state = await registry.register(workspace);
  await assert.rejects(() => registry.importAsset(asset(source), state.token), /root directory|outside|outside of the root|\u6839目录之外/);
});
