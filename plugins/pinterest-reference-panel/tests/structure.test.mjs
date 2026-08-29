import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pluginRoot = new URL("../", import.meta.url);

test("manifest exposes the local MCP server and its narrow read/write scope", async () => {
  const manifest = JSON.parse(await readFile(new URL(".codex-plugin/plugin.json", pluginRoot), "utf8"));
  assert.equal(manifest.name, "pinterest-reference-panel");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(manifest.interface.capabilities, ["Interactive", "Read", "Write"]);
});

test("MCP launch command points to the built local server", async () => {
  const config = JSON.parse(await readFile(new URL(".mcp.json", pluginRoot), "utf8"));
  const entry = config.mcpServers.pinterest_reference_panel;
  assert.equal(entry.command, "node");
  assert.deepEqual(entry.args, ["./dist/server.bundle.js"]);
  assert.equal(entry.cwd, ".");
  assert.equal(entry.startup_timeout_sec, 120);
});

test("local panel lifecycle retains a failed handle and serializes stop before reopen", async () => {
  const source = await readFile(new URL("src/server.ts", pluginRoot), "utf8");
  assert.match(source, /if \(localPanelStop\) await localPanelStop;\s*if \(localPanel\) return localPanel;/);
  assert.match(
    source,
    /const handle = localPanel \?\? \(localPanelStart \? await localPanelStart : null\);[\s\S]*?await handle\.close\(\);\s*if \(localPanel === handle\) localPanel = null;/
  );
  assert.match(source, /\)\(\)\.finally\(\(\) => \{ localPanelStop = null; \}\);/);
});

test("widget is self-contained and declares the MCP Apps bridge", async () => {
  const html = await readFile(new URL("assets/pinterest-panel.html", pluginRoot), "utf8");
  assert.match(html, /ui\/initialize/);
  assert.match(html, /tools\/call/);
  assert.match(html, /ui\/message/);
  assert.match(html, /sendFollowUpMessage/);
  assert.doesNotMatch(html, /uploadFile/);
  assert.doesNotMatch(html, /setWidgetState/);
  assert.match(html, /window\.parent === window/);
  assert.match(html, /import_pinterest_reference/);
  assert.match(html, /list_pinterest_inbox/);
  assert.match(html, /stagingPath/);
  assert.match(html, /transfer\?\.failed/);
  assert.match(html, /Pins/);
  assert.match(html, /Boards/);
  assert.match(html, /class="panel-chrome"/);
  assert.match(html, /\.panel-chrome\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;[\s\S]*?z-index:\s*30;/);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//);
});

test("local browser panel is independent from the MCP Apps bridge", async () => {
  const html = await readFile(new URL("assets/local-panel.html", pluginRoot), "utf8");
  const javascript = await readFile(new URL("assets/local-panel.js", pluginRoot), "utf8");
  const css = await readFile(new URL("assets/local-panel.css", pluginRoot), "utf8");
  const combined = `${html}\n${javascript}`;
  assert.match(html, /__PINTEREST_PANEL_TOKEN__/);
  assert.match(javascript, /\/api\/clipboard/);
  assert.match(javascript, /body:\s*\{\s*assetId:\s*asset\.id\s*\}/);
  assert.doesNotMatch(combined, /window\.openai|ui\/initialize|tools\/call|postMessage|sendFollowUpMessage/);
  assert.doesNotMatch(javascript, /sourcePath|workspaceRoot|relativePath/);
  assert.match(javascript, /thumbnailActive\s*>=\s*4/);
  assert.match(javascript, /THUMBNAIL_TIMEOUT_MS\s*=\s*20_000/);
  assert.match(javascript, /REFRESH_TIMEOUT_MS\s*=\s*120_000/);
  assert.match(
    javascript,
    /catch \(error\) \{\s*if \(epoch !== state\.thumbnailEpoch\) throw new Error\("thumbnail-generation-changed"\);\s*throw error;\s*\}/
  );
  assert.match(javascript, /page\.version\s*!==\s*state\.version/);
  assert.match(javascript, /clearThumbnailCache\(\)/);
  assert.match(javascript, /pageGeneration/);
  assert.match(javascript, /requestedBoardId\s*===\s*state\.boardId/);
  assert.match(javascript, /requestedTab\s*===\s*state\.tab/);
  assert.doesNotMatch(javascript, /if\s*\(state\.pageLoading\)\s*return/);
  assert.doesNotMatch(javascript, /pageRequestCount/);
  assert.match(
    javascript,
    /const isCurrentRequest = \(\) =>[\s\S]*?const result = await api\([\s\S]*?if \(!isCurrentRequest\(\)\) return;[\s\S]*?const page = result\.page;/
  );
  assert.match(javascript, /catch \(error\) \{\s*if \(!isCurrentRequest\(\)\) return;/);
  assert.match(
    javascript,
    /finally \{\s*if \(isCurrentRequest\(\)\) \{[\s\S]*?state\.pageLoading = false;[\s\S]*?renderContent\(\);\s*\}\s*\}/
  );
  assert.match(
    javascript,
    /elements\.boardsTab\.addEventListener\("click", \(\) => \{\s*state\.tab = "boards";\s*state\.boardId = null;\s*state\.boardTitle = null;\s*void loadPage\(\{ reset: true \}\);\s*\}\);/
  );
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /min-height:\s*100dvh/);
  assert.match(html, /Pins/);
  assert.match(html, /Boards/);
});
