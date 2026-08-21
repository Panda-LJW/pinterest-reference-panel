import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getMockPanelData } from "./data.js";

const PANEL_URI = "ui://pinterest-reference-panel/panel.html";
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const panelHtml = readFileSync(join(moduleDirectory, "../assets/pinterest-panel.html"), "utf8");

export const server = new McpServer(
  {
    name: "pinterest-reference-panel",
    version: "0.1.0"
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

server.registerResource("pinterest-reference-panel", PANEL_URI, {}, async () => ({
  contents: [
    {
      uri: PANEL_URI,
      mimeType: "text/html;profile=mcp-app",
      text: panelHtml,
      _meta: {
        ui: {
          prefersBorder: false
        }
      }
    }
  ]
}));

server.registerTool(
  "list_mock_pinterest_content",
  {
    title: "读取 Pinterest 原型数据",
    description: "返回本地 Pins 与 Boards 假数据。此工具只读，不连接 Pinterest。",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async () => ({
    structuredContent: getMockPanelData(),
    content: [
      {
        type: "text",
        text: "已读取本地 Pinterest 原型数据：8 个 Pin，4 个图版。未访问 Pinterest。"
      }
    ]
  })
);

server.registerTool(
  "render_pinterest_reference_panel",
  {
    title: "打开 Pinterest 素材栏原型",
    description: "渲染 Pins / Boards 双列瀑布流原型，用于验证 Codex 中的组件位置与交互。",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    _meta: {
      ui: { resourceUri: PANEL_URI },
      "openai/outputTemplate": PANEL_URI,
      "openai/toolInvocation/invoking": "正在打开 Pinterest 素材栏…",
      "openai/toolInvocation/invoked": "Pinterest 素材栏已打开"
    }
  },
  async () => ({
    structuredContent: getMockPanelData(),
    content: [
      {
        type: "text",
        text: "Pinterest 素材栏原型已渲染。内容为本地假数据，不代表真实账户。"
      }
    ]
  })
);

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`[pinterest-reference-panel] ${message}\n`);
    process.exitCode = 1;
  });
}
