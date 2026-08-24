# Pinterest Inbox for Codex

一个面向 **macOS + Chrome** 的本地参考素材工作流：Chrome 扩展把 Pinterest 静态图片下载到 `PinterestInbox`，Codex 插件以 Pins / Boards 瀑布流浏览，并把选中素材安全导入当前工作区。

当前状态：**0.3.1 MVP 候选版**。真实登录态下的 Chrome originals 下载已确认；智能轻量、Codex 引用版和“整板下载 → Codex 导入 → 当前任务读取”仍需完成真实端到端验收。

## 已实现能力

- Chrome 单张、多选和整板自动滚动下载，面板内可暂停/启用采集；
- 只下载 Pinterest CDN `originals` 原图；优先原生 JPG/PNG，仅原图只有 WebP 时保留 WebP，不转码、不改假后缀、不回退缩略图；
- 以 `<标题>__pin-<Pin ID>.<格式>` 保存原图，同时保持可读性、去重与旧版文件兼容；
- 固定写入 `~/Downloads/PinterestInbox/<board>/`；
- 静态图片过滤、串行限速、取消、失败重试一次和结果统计；
- MCP 启动完整扫描、运行期监听、10 秒周期校准与手动刷新；
- `sips` 生成 480px JPEG 缩略图并独立缓存；
- Pins / Boards 窄栏瀑布流与固定顶部栏；
- 单击 Pin 安全复制到 `references/pinterest/<board>/`；
- 导入后自动发送工作区相对路径，消息失败可重试而不重复复制。

## 0.3.1 待人工验收

- 扩展面板提供“原图 / JPEG 高清 / 智能轻量”并记住用户选择；旧版本首次升级会迁移到默认“智能轻量”；
- 智能轻量遇到 WebP originals 直接保留原字节；其他格式只有在 2048px/JPEG80 或透明 PNG 候选件确实更小时才采用；
- Codex 单击引用采用同一规则：WebP 直接引用，其他格式只使用真正更小的衍生件，缓存不反向修改 Inbox。

## 安装 Chrome 扩展

1. 在 Chrome 打开 `chrome://extensions`；
2. 开启“开发者模式”；
3. 点击“加载已解压的扩展程序”；
4. 选择 `extensions/pinterest-inbox-downloader/`。

打开 Pinterest 后，右上方会出现 Pinterest Inbox 控制面板。默认“单张模式”会拦截普通 Pin 单击并下载，默认保存质量是“智能轻量”；需要正常打开 Pin 时，点击面板上的“暂停”即可。多选与整板模式会显示成功、跳过、无 originals 原图、图片处理失败和待处理数量。

## 安装 Codex 插件

```bash
git clone https://github.com/Panda-LJW/pinterest-reference-panel.git
cd pinterest-reference-panel
npm ci
npm test
codex plugin marketplace add "$PWD"
codex plugin add pinterest-reference-panel@personal
```

插件更新后需要开启一个新的 Codex 任务，新的 MCP 工具和 UI 才会加载。打开面板时应把当前工作区绝对路径传给 `render_pinterest_reference_panel`；如果 Codex 宿主提供单一 MCP root，插件也会优先自动识别。

## 本地目录

```text
~/Downloads/PinterestInbox/                       # 原始下载素材
~/Library/Caches/pinterest-reference-panel/       # 可安全清理的缩略图与引用衍生缓存
<workspace>/references/pinterest/<board>/         # 明确点击后导入的任务素材
```

可在启动 MCP 时通过 `PINTEREST_INBOX_DIR` 覆盖 Inbox。Chrome 扩展仍受 Downloads API 限制，只能下载到浏览器 Downloads 根目录下的相对路径。

## 本地开发与测试

```bash
npm ci
npm run check
npm test
```

测试覆盖 Inbox 扫描与监听、缩略图、工作区边界、MCP 往返、UI 结构、扩展路径清理和下载队列。涉及 Pinterest 登录态、真实 Downloads 写入和 Codex 宿主消息的最终链路需要按 [SPEC.md](SPEC.md) 的人工端到端步骤验收。

## 仓库结构

- `extensions/pinterest-inbox-downloader/`：Manifest V3 Chrome 下载扩展；
- `plugins/pinterest-reference-panel/`：Codex 插件、MCP 服务、UI、测试和运行时 bundle；
- `.agents/plugins/marketplace.json`：仓库内 Codex marketplace；
- `SPEC.md`：稳定边界、接口和验收标准；
- `LOG.md` / `LOG-INDEX.md`：施工决策、验证和回滚记录。

## 边界

- 不接 Pinterest API，不读取或保存账号凭证；
- 不搜索全站内容，不创建、保存、修改或删除 Pin；
- 不下载视频；
- MCP 不接受任意 URL 或任意写入路径；
- 插件无法强制决定 Codex 的右侧停靠位置。

## 声明

这是一个非官方实验项目，与 Pinterest 无隶属或背书关系。请确认你有权下载和使用相应素材。
