import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));

test("stdio MCP exposes the read-only tools and MCP Apps resource", async (context) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.bundle.js"],
    cwd: pluginRoot,
    stderr: "pipe"
  });
  const client = new Client({ name: "phase-zero-test", version: "0.1.0" });

  context.after(async () => {
    await client.close();
  });

  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["list_mock_pinterest_content", "render_pinterest_reference_panel"]
  );
  assert.equal(
    tools.tools.find((tool) => tool.name === "render_pinterest_reference_panel")?._meta?.ui?.resourceUri,
    "ui://pinterest-reference-panel/panel.html"
  );
  assert.ok(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true));

  const result = await client.callTool({
    name: "render_pinterest_reference_panel",
    arguments: {}
  });
  assert.equal(result.structuredContent.mode, "demo");
  assert.equal(result.structuredContent.pins.length, 8);
  assert.equal(result.structuredContent.boards.length, 4);

  const resource = await client.readResource({ uri: "ui://pinterest-reference-panel/panel.html" });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text, /Pinterest 素材栏/);
});
