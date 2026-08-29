# Pinterest Inbox 规格

## 产品目标

首版面向 **macOS + Chrome**。用户在 Pinterest 图版页用精简 Chrome 扩展下载静态图片；Codex 插件只读取本地 Inbox。主引用路线是在 Codex 右侧内嵌浏览器打开本机瀑布流，单击已索引素材后把其真实绝对路径写入 macOS 剪贴板，用户再按 `⌘V` 粘贴进当前对话。主路线不复制、压缩或修改素材，也不自动发送消息。

```text
Pinterest 图版
  → Chrome 扩展（单张 / 多选 / 整板自动滚动）
  → ~/Downloads/PinterestInbox/<board>/（临时区）
  → MCP 启动收取 + 运行期双目录监听
  → ~/Pictures/PinterestInbox/<board>/（长期库）
  → 127.0.0.1 动态端口的 Pins / Boards 本地网页
  → Codex 内嵌浏览器右侧打开
  → 单击已索引 Pin，服务端向剪贴板写入 canonical absolute path
  → 用户在当前对话按 ⌘V，由 Codex 直接读取长期库原文件
```

## 设计原则

1. 不接 Pinterest API，不读取或保存账号凭证、Cookie 与登录态。
2. Chrome 扩展内容脚本只匹配 `https://*.pinterest.com/*`；Chrome API 权限只包含下载所需的 `downloads`、图片处理所需的 `offscreen` 和保存用户质量偏好的 `storage`，网络 host 权限只包含 Pinterest 页面和 `pinimg.com` CDN。
3. 只处理 `pinimg.com` 的 HTTPS 静态图片；视频、HLS 和无有效图片地址的 Pin 必须跳过并计数。
4. Chrome 临时下载区默认为 `~/Downloads/PinterestInbox`，长期素材库默认为 `~/Pictures/PinterestInbox`；分别可用 `PINTEREST_INBOX_STAGING_DIR` 和 `PINTEREST_INBOX_DIR` 覆盖。Chrome Downloads API 只能设置 Downloads 下的相对路径。
5. 本地网页与 MCP 均不接受任意 URL、源文件路径或目标路径。网页点击请求只能提交匹配固定格式的已索引 `assetId`；服务端必须再次通过 `resolveAsset()` 确认真实文件仍位于长期库后，才能复制路径。
6. 本地网页不得把 `sourcePath` 返回给浏览器、不得自动发送消息、不得生成工作区副本或引用衍生件。旧 MCP 工作区导入链路仅作为可回滚备用，仍受 `workspaceToken`、固定目标目录和符号链接边界保护。
7. 不引入数据库、常驻系统服务、LaunchAgent、Native Messaging 或新的生产 npm 依赖。
8. HTTP 网页与 MCP 必须在同一进程共享唯一 `InboxService`，不得创建第二套 watcher、周期校准或 Downloads 搬运进程。

## Chrome 扩展

- 单张模式默认开启：单击 Pin 后立即加入下载队列。
- 多选模式：单击勾选多个 Pin，再一次性加入队列。
- 整板模式：保存当前位置，自动向下滚动并收集当前图版，连续五轮到达页面底部且无新增 Pin 后停止，随后恢复原滚动位置并开始下载。
- 面板提供“暂停/启用”；暂停后不再拦截 Pin 点击，清除勾选并取消当前扫描或未完成下载。
- 面板提供持久化的保存质量选项；升级到智能策略时执行一次偏好迁移，默认改为“智能轻量”：
  - 原图：保留 `originals` 的原始分辨率、字节和真实格式；
  - JPEG 高清：非透明图片以原始分辨率编码为 JPEG 90，用于需要 JPEG 兼容性的场景，不承诺小于 originals；
  - 智能轻量：WebP originals 原样保留；其他格式生成最长边不超过 2048px、JPEG 80 或透明 PNG 的候选件，禁止放大，且只有候选件严格小于源文件时才采用，否则保留源文件。
- 高清/轻量转换在 Chrome Offscreen 文档完成；处理失败必须计入失败项，不得静默回退缩略图或伪造成功。
- 文件标题按“结构化卡片标题 → 首个可见文本行 → 清理后的图片 `alt` → Pin ID”降级获取；无障碍描述前缀不得进入文件名。
- 自动滚动最多 1000 步；若页面持续无限增长，必须明确提示达到安全上限并只处理已发现项目。
- 下载串行限速 450ms；失败自动重试一次；用户可以取消扫描或尚未完成的下载。
- 每个素材必须先探测 Pinterest CDN `originals` 路径；优先服务器确认为原生 JPG/PNG 的原图，仅当 originals 仅有 WebP 时才选择 WebP 作为最高质量源。
- “原图”和“智能轻量”均不得将 WebP 转码为 JPG/PNG。只有用户明确选择“JPEG 高清”时才允许将 WebP 转为 JPEG；不得只修改扩展名，不得回退为 `236x` / `474x` / `736x` 等缩略图；无 JPG/PNG/WebP originals 时跳过并单独计数。
- 新下载文件名固定为 `PinterestInbox/<board-slug>/<safe-title>__pin-<pin-id>.<ext>`；下载请求的 `filename` 和 `downloads.onDeterminingFilename` 必须提交同一目标，防止 Chrome 回退 CDN 哈希名。使用 `overwrite` 更新同一确定性目标，不触碰 Inbox 外文件。Codex Inbox 解析器必须继续兼容旧的 `<pin-id>__<safe-title>.<ext>` 格式。

## Inbox 与缩略图

- MCP 进程启动时先收取临时区，再完整扫描长期库；随后用 `fs.watch` 同时监听两个目录，关闭时释放所有 watcher 与 timer。
- 文件事件经 250ms 去抖后立即收取；每 10 秒全量校准，并提供显式强制刷新，弥补文件系统事件遗漏。收取过程中又收到新事件时必须追加一轮，不得丢失变更。
- 忽略隐藏路径、`.crdownload`、`.tmp` 和非图片文件。
- 收取前必须确认文件体积与修改时间已稳定；保留相对图版路径，以目标临时文件 + SHA-256 校验 + 无覆盖落盘完成搬运，成功后才移除临时源文件。
- 同名同内容复用长期库副本；同名不同内容增加内容短哈希。任何校验、路径边界或落盘失败都必须保留临时源文件并暴露错误状态。
- 索引只保存在内存，记录稳定资产 ID、Pin、图版、签名和更新时间。
- macOS 使用 `/usr/bin/sips` 按需生成最长边 480px 的 JPEG 缩略图，缓存于 `~/Library/Caches/pinterest-reference-panel/thumbnails/`。
- 主引用路线只复制长期库原文件的绝对路径，不运行工作区引用压缩，不创建 `<workspace>/references/pinterest/` 副本。旧 MCP 回滚链路继续保留原有智能轻量与缓存策略，但不被本地网页调用。
- 首屏和每页最多 30 张；网页每 2 秒查询状态与版本。版本未变化时仍必须合并 watcher / transfer 状态，但不重新获取素材数组。
- 图版过滤必须由服务端按完整索引分页，不能只筛客户端已经加载的首批 30 张；Board 封面缩略图可按 `assetId` 独立读取。
- 缩略图生成前必须重新调用 `resolveAsset()` 做真实路径边界检查；源文件在扫描后被替换为 Inbox 外符号链接时，缩略图和剪贴板都必须拒绝。

## MCP 接口

### `open_pinterest_inbox_web`

- 懒启动与 MCP 同进程的本地 HTTP 网页，始终绑定 `127.0.0.1`，端口默认由系统动态分配。
- MCP 宿主启动窗口为 120 秒，为首次安全收取大批 Downloads 积压留出时间；常规空库或小库应快速就绪。
- 返回严格形如 `http://127.0.0.1:<port>/` 的 URL，供 Codex 内嵌浏览器在右侧打开。
- 重复调用复用同一网页实例，不创建第二个 Inbox 监听器。
- 如旧网页正在停止，新的打开请求必须等待旧实例完全释放后再启动，不得重叠两个 HTTP 服务。

### `get_pinterest_inbox_web_status`

- 只读返回网页运行状态、当前 URL 和 Inbox 监听摘要；关闭尚未完成时明确返回 `stopping`，不得误报 `stopped`。

### `stop_pinterest_inbox_web`

- 只关闭当前任务的 HTTP 网页；Inbox 监听、MCP 和旧内嵌面板保持可用。
- MCP 进程退出或 stdio EOF 时必须先停止 HTTP 接收请求，再释放 Inbox watcher / timer；活动 HTTP 连接最多等待 500ms 后强制断开。已经启动的 `sips` / `pbcopy` 仍由各自 15 秒 / 5 秒超时做有界收尾。

### `render_pinterest_reference_panel`

- 作为旧内嵌 MCP 面板和工作区导入回滚链路保留，不是主引用体验。
- 可选输入：`workspaceRoot`。
- 返回首屏 Pins、Boards、监听状态、公开工作区状态。
- 工作区优先尝试 MCP `roots/list`，宿主未提供时使用显式 `workspaceRoot`。
- 无法确认工作区时仍可浏览，但导入禁用。

### `list_pinterest_inbox`

- 输入：`cursor`、`limit`、`knownVersion`、`forceRescan`。
- 只读返回分页内容和索引版本；版本未变化时返回 `unchanged: true`。
- `forceRescan` 只重扫 Pictures 长期库并更新内存索引，不触发 Downloads 搬运；主网页“立即刷新”使用受同源保护的 POST 明确执行完整校准与安全收取。

### `import_pinterest_reference`

- 输入：`assetId`、`workspaceToken`。
- 只允许复制当前索引内且真实路径仍位于 Inbox 的文件。
- 相同内容复用现有文件；同名不同内容增加 8 位内容哈希后缀。
- 返回 `optimization`、`cacheReused` 和可选失败原因，使宿主能够区分轻量引用版与原文件回退。

## UI 与消息桥

- 主页面是普通同源本地网页，不依赖 `window.openai`、`uploadFile`、`setWidgetState`、`ui/message` 或 `sendFollowUpMessage`。
- 品牌栏和 Pins / Boards 标签使用 sticky 层固定在页面上方，只有下方素材区域随页面滚动；Pins 针对右侧窄栏采用响应式瀑布流。
- 页面用随机会话 Cookie 与 CSRF 头保护 API；精确校验回环来源、Host 和写请求 Origin，不提供 CORS。
- 前端请求超时必须匹配后端成本：常规 API 8 秒，首次缩略图 20 秒（高于 `sips` 15 秒上限），手动完整刷新 120 秒。
- 本地网页启停失败时，MCP 工具结果只返回固定公开错误；包含安装路径的原始诊断只写入本地 stderr。
- 单击 Pin 后只发送 `{ assetId }`。服务端通过无 shell 的 `/usr/bin/pbcopy` stdin 写入 canonical absolute path；成功提示“绝对路径已复制，回到对话按 ⌘V”。允许再次点击重复复制。
- 空 Inbox、损坏缩略图、监听降级、搬运失败、网页断线与自动重连必须显示明确且互不混淆的状态。缩略图失败不阻断路径复制。
- 旧内嵌 MCP 面板继续使用工作区导入 + 消息发送，仅作回滚备用。

## MVP 验收标准

### 自动验证

- 路径清理、Pin ID / 图版解析、权限清单、默认偏好迁移、三档质量、originals 格式选择、智能轻量 WebP 原样保留、候选体积比较、透明图 PNG 输出和下载队列。
- 初次扫描、嵌套目录、临时文件忽略、索引版本与周期校准入口。
- 启动收取、运行期新文件、同内容去重、同名冲突、SHA-256 校验、目标符号链接逃逸和失败保留源文件。
- `sips` 缩略图、失败占位、私有 `_meta`。
- HTTP 只绑定 `127.0.0.1`；错误 Host / Origin、无会话、无 CSRF、CORS 预检、超大请求体、任意 `path` / `url` 字段和未知 `assetId` 均被拒绝。
- HTTP 公开分页不包含 `sourcePath`；Board 完整分页、跨页封面、版本未变时的 watcher 状态更新和监听新增文件刷新。
- 合法复制只写入 `resolveAsset()` 返回的 canonical path，点击前后源文件大小、mtime 和内容保持不变，不创建工作区副本。
- 工作区边界、源/目标符号链接逃逸、WebP 字节保留、2048/JPEG80 衍生缓存、较大候选回退、透明 PNG、重复导入和禁止覆盖。
- MCP 工具结构、读写 annotations、UI bridge 与 sticky 顶栏。

### 人工端到端

1. 多选下载两张静态图片。
2. 对一个真实图版执行整板自动滚动下载。
3. 插件关闭期间下载图片，重新开启后由初扫补齐。
4. 调用 `open_pinterest_inbox_web`，把返回 URL 在 Codex 右侧内嵌浏览器打开；面板打开期间下载新图片，图片在数秒内从 Downloads 临时区进入 Pictures 长期库并自动出现。
5. 单击 Pin 后用 `pbpaste` 核对剪贴板内容等于 Pictures 长期库内的 canonical absolute path；图片哈希、mtime、体积不变，工作区没有新增副本。
6. 在当前对话按 `⌘V` 粘贴路径并附上正常需求，由 Codex 实际读取图片内容；此操作不占用额外自动消息轮次。
7. 停止本地网页，页面明确显示断线；Inbox 监听与旧 MCP 面板仍可用，重新打开网页后恢复。

## 非目标与未来路线

- 不做 Pinterest 全站搜索、创建/保存/修改/删除 Pin、视频下载或账号管理。
- MCP 工具本身不强制宿主布局；Codex 桌面端支持时由代理把返回 URL 打开到右侧内嵌浏览器，否则用户可手动在内嵌浏览器打开同一 URL。
- Pinterest OAuth 与官方只读 API 保留为未来备选，不进入本 MVP。
