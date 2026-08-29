# Pinterest Inbox for Codex

一个面向 **macOS + Chrome** 的本地参考素材工作流：Chrome 扩展把 Pinterest 静态图片下载到 `PinterestInbox`，Codex 插件在本机回环地址提供 Pins / Boards 瀑布流；点击素材即可复制长期库原文件的真实绝对路径，再粘贴到当前对话供 Codex 引用。

当前状态：**0.4.0 MVP 已验收**。真实登录态下的 Chrome originals 下载、本机存量迁移和右侧本地瀑布流均已确认；用户已在新 Codex 任务中完成“点击图片 → `⌘V` 粘贴绝对路径 → 连同正常需求发送”，Codex 成功读取该 Inbox 原图并将其用于图片生成。

## 已实现能力

- Chrome 单张、多选和整板自动滚动下载，面板内可暂停/启用采集；
- 只下载 Pinterest CDN `originals` 原图；优先原生 JPG/PNG，仅原图只有 WebP 时保留 WebP，不转码、不改假后缀、不回退缩略图；
- 以 `<标题>__pin-<Pin ID>.<格式>` 保存原图，同时保持可读性、去重与旧版文件兼容；
- Chrome 固定写入 `~/Downloads/PinterestInbox/<board>/` 临时区，Codex 插件校验后自动收取到 `~/Pictures/PinterestInbox/<board>/` 长期库；
- 静态图片过滤、串行限速、取消、失败重试一次和结果统计；
- MCP 启动完整扫描、运行期监听、10 秒周期校准与手动刷新；
- 收取时保留图版结构，SHA-256 校验成功后才清理临时副本；同名同内容去重，同名不同内容增加短哈希且不覆盖；
- `sips` 生成 480px JPEG 缩略图并独立缓存；
- 旧 MCP Pins / Boards 窄栏瀑布流与固定顶部栏；
- 旧 MCP 面板可把 Pin 安全复制到 `references/pinterest/<board>/` 并发送相对路径，作为回滚备用。

## 0.4.0 已验收能力

- 扩展面板提供“原图 / JPEG 高清 / 智能轻量”并记住用户选择；旧版本首次升级会迁移到默认“智能轻量”；
- 智能轻量遇到 WebP originals 直接保留原字节；其他格式只有在 2048px/JPEG80 或透明 PNG 候选件确实更小时才采用；
- `open_pinterest_inbox_web` 在当前 MCP 进程内懒启动仅绑定 `127.0.0.1` 动态端口的本地网页，并可在 Codex 右侧内嵌浏览器打开；
- 本地网页与 MCP 共用唯一 Inbox watcher；Pins / Boards 完整分页，监听状态和新素材自动刷新；
- 单击 Pin 只提交已索引 `assetId`，服务端重新确认路径边界后用 `pbcopy` 写入 canonical absolute path；不复制、不压缩、不修改素材，也不自动发送消息；
- 停止网页只释放 HTTP 服务，Inbox 监听和旧 MCP 回滚面板继续可用。

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

插件更新后需要开启一个新的 Codex 任务，新的 MCP 工具才会加载。主路线是调用 `open_pinterest_inbox_web`，再把它返回的 `http://127.0.0.1:<动态端口>/` 打开到 Codex 内嵌浏览器右侧；点击图片后回到对话按 `⌘V`。旧 `render_pinterest_reference_panel` 继续保留为工作区导入回滚方案。

## 本地目录

```text
~/Downloads/PinterestInbox/                       # Chrome 临时下载区
~/Pictures/PinterestInbox/                        # 唯一长期素材库
~/Library/Caches/pinterest-reference-panel/       # 可安全清理的缩略图与引用衍生缓存
<workspace>/references/pinterest/<board>/         # 仅旧 MCP 回滚链路使用
```

可在启动 MCP 时通过 `PINTEREST_INBOX_DIR` 覆盖长期素材库，通过 `PINTEREST_INBOX_STAGING_DIR` 覆盖临时下载区。Chrome 扩展仍受 Downloads API 限制，只能下载到浏览器 Downloads 根目录下的相对路径。

## 本地开发与测试

```bash
npm ci
npm run check
npm test
```

测试覆盖 Inbox 扫描与监听、缩略图路径复核、本地 HTTP 回环/会话/Origin 边界、剪贴板解析、Boards 完整分页、MCP 并发停止/重开与 EOF/SIGTERM 生命周期、旧工作区边界、UI 过期请求防护、扩展路径清理和下载队列。真实 Downloads 写入、Pictures 长期库存取、右侧点击复制和新任务手动粘贴读取链路均已按 [SPEC.md](SPEC.md) 完成人工端到端验收。

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
- MCP 与本地网页不接受任意 URL 或任意写入路径；
- 本地网页只绑定 `127.0.0.1`，默认使用动态端口，不提供 CORS；
- MCP 工具本身不强制宿主布局；Codex 桌面端支持时由代理把本地 URL 打开到右侧内嵌浏览器。

## 声明

这是一个非官方实验项目，与 Pinterest 无隶属或背书关系。请确认你有权下载和使用相应素材。
