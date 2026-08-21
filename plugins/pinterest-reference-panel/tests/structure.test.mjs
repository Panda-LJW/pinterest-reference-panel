import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pluginRoot = new URL("../", import.meta.url);

test("manifest exposes only the local MCP server", async () => {
  const manifest = JSON.parse(await readFile(new URL(".codex-plugin/plugin.json", pluginRoot), "utf8"));
  assert.equal(manifest.name, "pinterest-reference-panel");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(manifest.interface.capabilities, ["Interactive", "Read"]);
});

test("MCP launch command points to the built local server", async () => {
  const config = JSON.parse(await readFile(new URL(".mcp.json", pluginRoot), "utf8"));
  const entry = config.mcpServers.pinterest_reference_panel;
  assert.equal(entry.command, "node");
  assert.deepEqual(entry.args, ["./dist/server.bundle.js"]);
  assert.equal(entry.cwd, ".");
});

test("widget is self-contained and declares the MCP Apps bridge", async () => {
  const html = await readFile(new URL("assets/pinterest-panel.html", pluginRoot), "utf8");
  assert.match(html, /ui\/initialize/);
  assert.match(html, /tools\/call/);
  assert.match(html, /Pins/);
  assert.match(html, /Boards/);
  assert.match(html, /class="panel-chrome"/);
  assert.match(html, /\.panel-chrome\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;[\s\S]*?z-index:\s*30;/);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//);
});
