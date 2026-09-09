# Pinterest Inbox for Codex

一个面向 **macOS + Chrome** 的本地参考素材工作流：Chrome 扩展把 Pinterest 静态图片下载到 `PinterestInbox`，Codex 插件在本机回环地址提供 Pins / Boards 瀑布流；点击素材即可复制长期库原文件的真实绝对路径，再粘贴到当前对话供 Codex 引用。

当前状态：**首个公开版本 0.4.0 已完成发布验收**。仓库与 Codex 插件版本为 `0.4.0`，随附的 Chrome 下载器独立版本为 `0.4.2`。

2026-09-09 已在真实登录态 Pinterest、Chrome 0.4.2 扩展和 Codex 可见内嵌浏览器中完成端到端检查：连续点击 3 张不同图片并立即重复点击其中一张，最终只保存 3 张；多选 6 张后立即取消，最终保存 0 张、跳过 6 张；在 Codex 素材栏选择 3 张后，同一 `referenceSessionId` 经 MCP 返回相同顺序的原文件，Codex 已实际读取三张原图。批量复制的三条路径与系统剪贴板逐字节一致，包含中文文件名。自动测试共 95/95 通过，生产依赖与完整依赖审计均为 0 个已知漏洞。

使用方法：在加载插件的新任务中说“打开 Pinterest Inbox”，点击图片预览，用 ＋ 选择 2–3 张；回到该任务说“使用选中的参考图，按顺序分析”。Codex 会读取该任务的有序原图列表，再实际查看原图。重新打开同一参考篮应复用原会话，另一个任务会创建空篮；插件进程重启后需要重新选图。主流程的设计与边界见 [SPEC](SPEC.md) 和 [UX 方案](docs/UX-PLAN.md)，验证与变更证据见 [LOG](LOG.md)。

素材工作台支持完整素材库搜索、图版筛选、三种排序、原图预览、系统深色、键盘翻图、最多 10 张的有序参考篮，以及单张/批量路径复制。宿主是否固定显示在右侧由 Codex 布局能力决定；若自动打开请求只进入排队状态，可在 Codex 的可见内嵌浏览器中打开工具返回的本地 URL。

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

**下载器 0.4.2 已通过真实 Pinterest 验收：**单张模式支持在下载时连续点击其他图片，追加到现有后台队列并按序处理；同一未完成图片去重，进度汇总整组，取消覆盖全部未完成项。保留 0.4.1 面板重绘恢复及原有三档质量、文件名和入库流程。下载器自动测试 33/33 及真实 Chrome Downloads 链路均已验证；详见[下载器说明](extensions/pinterest-inbox-downloader/README.md)。

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

插件更新后需要开启一个新的 Codex 任务，新的 MCP 工具才会加载。主路线是调用 `open_pinterest_inbox_web`，保存返回的 `referenceSessionId`，把带 `?ref=<id>` 的 URL 打开到 Codex 可见内嵌浏览器。用户选图并提出需求后，调用 `get_pinterest_reference_selection` 读取同一参考篮。复制路径后按 `⌘V` 的备用方式继续可用。旧 `render_pinterest_reference_panel` 继续保留为工作区导入回滚方案。

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

测试覆盖 Inbox 扫描与监听、缩略图路径复核、本地 HTTP 回环/会话/Origin 边界、剪贴板解析、Boards 完整分页、MCP 并发停止/重开与 EOF/SIGTERM 生命周期、旧工作区边界、UI 过期请求防护、扩展路径清理和下载队列。真实 Downloads 写入、Pictures 长期库存取、中文路径复制、参考篮会话到 MCP 原文件读取均已完成人工端到端验收，详见 [SPEC.md](SPEC.md)。

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
