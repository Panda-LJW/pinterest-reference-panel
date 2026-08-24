import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

test("generates and reuses a 2048 JPEG 80 reference derivative", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-derivative-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const source = join(root, "large-source.png");
  const processor = join(root, "fake-sips.sh");
  const cache = join(root, "cache");
  await mkdir(workspace);
  await writeFile(source, "large-png-source");
  await writeFile(processor, `#!/bin/sh
if [ "$1" = "-g" ]; then
  printf 'pixelWidth: 4096\\npixelHeight: 3072\\nhasAlpha: no\\n'
  exit 0
fi
previous=''
for argument in "$@"; do
  if [ "$previous" = "--out" ]; then output="$argument"; fi
  previous="$argument"
done
printf 'jpeg-2048-q80' > "$output"
`);
  await chmod(processor, 0o755);
  const registry = new WorkspaceRegistry({ derivativeCacheRoot: cache, imageProcessorPath: processor, platform: "darwin" });
  const state = await registry.register(workspace);

  const first = await registry.importAsset(asset(source, { extension: ".png" }), state.token);
  assert.equal(first.relativePath, "references/pinterest/character-study/large-source.jpg");
  assert.equal(first.optimization, "generated");
  assert.equal(first.cacheReused, false);
  assert.equal(await readFile(join(workspace, first.relativePath), "utf8"), "jpeg-2048-q80");

  const second = await registry.importAsset(asset(source, { extension: ".png" }), state.token);
  assert.equal(second.reused, true);
  assert.equal(second.cacheReused, true);
});

test("keeps transparency by generating a PNG derivative", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-alpha-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const source = join(root, "alpha-source.webp");
  const processor = join(root, "fake-sips-alpha.sh");
  await mkdir(workspace);
  await writeFile(source, "alpha-webp-source");
  await writeFile(processor, `#!/bin/sh
if [ "$1" = "-g" ]; then
  printf 'pixelWidth: 3000\\npixelHeight: 2000\\nhasAlpha: yes\\n'
  exit 0
fi
previous=''
for argument in "$@"; do
  if [ "$previous" = "--out" ]; then output="$argument"; fi
  previous="$argument"
done
printf 'transparent-png-2048' > "$output"
`);
  await chmod(processor, 0o755);
  const registry = new WorkspaceRegistry({ derivativeCacheRoot: join(root, "cache"), imageProcessorPath: processor, platform: "darwin" });
  const state = await registry.register(workspace);

  const imported = await registry.importAsset(asset(source, { extension: ".webp" }), state.token);
  assert.equal(imported.relativePath, "references/pinterest/character-study/alpha-source.png");
  assert.equal(imported.optimization, "generated");
  assert.equal(await readFile(join(workspace, imported.relativePath), "utf8"), "transparent-png-2048");
});
