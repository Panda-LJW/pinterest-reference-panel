import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pluginRoot = new URL("../", import.meta.url);

test("stdio MCP lists Inbox content and safely imports one indexed image", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "pinterest-mcp-test-"));
  const inboxRoot = join(root, "PinterestInbox");
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(inboxRoot, "editorial"), { recursive: true });
  await mkdir(workspaceRoot);
  await writeFile(join(inboxRoot, "editorial", "456__signal-poster.jpg"), "image-fixture");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.bundle.js"],
    cwd: pluginRoot,
    env: { ...process.env, PINTEREST_INBOX_DIR: inboxRoot },
    stderr: "pipe"
  });
  const client = new Client({ name: "inbox-test", version: "0.2.0" });
  context.after(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });
  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "import_pinterest_reference",
    "list_pinterest_inbox",
    "render_pinterest_reference_panel"
  ]);
  assert.equal(tools.tools.find((tool) => tool.name === "list_pinterest_inbox")?.annotations?.readOnlyHint, true);
  assert.equal(tools.tools.find((tool) => tool.name === "import_pinterest_reference")?.annotations?.readOnlyHint, false);

  const rendered = await client.callTool({
    name: "render_pinterest_reference_panel",
    arguments: { workspaceRoot }
  });
  assert.equal(rendered.structuredContent.mode, "inbox");
  assert.equal(rendered.structuredContent.total, 1);
  assert.equal(rendered.structuredContent.workspace.available, true);
  assert.equal(rendered.structuredContent.workspace.token, undefined);
  assert.equal(rendered._meta.pinterestInbox.inboxPath, inboxRoot);
  assert.match(rendered._meta.pinterestInbox.workspaceToken, /^[a-zA-Z0-9_-]+$/);

  const imported = await client.callTool({
    name: "import_pinterest_reference",
    arguments: {
      assetId: rendered.structuredContent.assets[0].id,
      workspaceToken: rendered._meta.pinterestInbox.workspaceToken
    }
  });
  assert.equal(imported.structuredContent.status, "imported");
  assert.equal(imported.structuredContent.relativePath, "references/pinterest/editorial/456__signal-poster.jpg");

  const resource = await client.readResource({ uri: "ui://pinterest-reference-panel/panel.html" });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text, /Pinterest Inbox/);
});
