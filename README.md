# Pinterest 素材栏 for Codex

这是一个处于 Phase 0 的本地 Codex 插件原型：用 MCP Apps UI 模拟只读的 Pinterest `Pins / Boards` 素材抽屉，验证它在 Codex 桌面端中的实际渲染位置和窄栏体验。

当前状态：**代码、构建、浏览器窄栏渲染与本地安装已验证；尚待用户在新 Codex 任务中确认宿主实际展示位置。**

![Pinterest 素材栏预览](docs/images/preview.png)

## 当前能力

- 双列瀑布流 Pin 浏览；
- Pins / Boards 标签切换；
- 固定在内容上层的品牌栏与标签栏；
- 图版筛选、Pin 选择和模拟引用交互；
- MCP Apps 标准 UI 资源与本地 stdio MCP 服务；
- 全程使用本地假数据，不连接 Pinterest。

## 明确边界

- 不登录 Pinterest；
- 不搜索全站内容；
- 不创建、保存、修改或删除 Pin；
- 不下载真实图片；
- 插件不能通过公开 API 强制指定右侧停靠，位置由 Codex 宿主决定。

## 本地开发

```bash
npm ci
npm test
```

## 安装到 Codex

克隆仓库并完成构建：

```bash
git clone https://github.com/Panda-LJW/pinterest-reference-panel.git
cd pinterest-reference-panel
npm ci
npm run build
```

注册仓库内 marketplace 并安装插件：

```bash
codex plugin marketplace add "$PWD"
codex plugin add pinterest-reference-panel@personal
```

插件更新后需要开启一个新的 Codex 任务，才能加载新的 MCP 工具和 UI 资源。

## 仓库结构

- `plugins/pinterest-reference-panel/`：插件清单、MCP 服务、UI、测试与运行时 bundle；
- `.agents/plugins/marketplace.json`：本地 marketplace 清单；
- `SPEC.md`：稳定边界与验收标准；
- `LOG.md` / `LOG-INDEX.md`：变更决策、验证与回滚记录。

## 开发与版本策略

- `main` 保持可安装、可运行；
- 功能开发使用 `codex/*` 分支并通过 Pull Request 合并；
- 插件语义版本记录功能阶段，Codex cachebuster 仅用于本地重装；
- 每次代码或配置修改同步更新 `LOG.md` 与 `LOG-INDEX.md`。

## 声明

这是一个非官方实验项目，与 Pinterest 无隶属或背书关系。当前原型只使用本地假数据。
