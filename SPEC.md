# Pinterest BoardFlow for Codex 规格

## 产品目标

公开产品名为 **Pinterest BoardFlow for Codex**，定位为“Pinterest 下载器 · Board 瀑布流看板 · Codex 视觉参考插件”。首版面向 **macOS + Chrome**。用户在 Pinterest 图版页用精简 Chrome 扩展下载静态图片；Codex 插件只读取本地 Inbox。经用户于 2026-09-06 确认，主引用路线升级为当前任务参考篮：在 Codex 可见内嵌浏览器中查找、预览并选择最多 10 张有序素材，用户在原任务中描述需求，Codex 通过显式参考会话 ID 读取这组原文件。单张与批量复制路径继续可用。主路线不复制、压缩或修改素材，也不自动发送消息。该路线于 2026-09-09 完成真实 Chrome 与 Codex 宿主验收。为兼容既有安装，技术 ID、MCP 工具名与 `PinterestInbox` 存储目录不随公开品牌重命名。

```text
Pinterest 图版
  → Chrome 扩展（单张 / 多选 / 整板自动滚动）
  → ~/Downloads/PinterestInbox/<board>/（临时区）
  → MCP 启动收取 + 运行期双目录监听
  → ~/Pictures/PinterestInbox/<board>/（长期库）
  → 127.0.0.1 动态端口的 Pins / Boards 本地网页
  → Codex 内嵌浏览器右侧打开
  → 全库搜索 / 原图预览 / 当前任务参考篮（有序 1–10 张）
  → 用户在原任务描述需求，MCP 按 referenceSessionId 返回原文件
  → Codex 实际读取原图后进行分析或生成
  ↳ 备用：复制单张或整组路径，再手动 ⌘V
```

## 设计原则

1. 不接 Pinterest API，不读取或保存账号凭证、Cookie 与登录态。
2. Chrome 扩展内容脚本只匹配 `https://*.pinterest.com/*`；Chrome API 权限只包含下载所需的 `downloads`、图片处理所需的 `offscreen` 和保存用户质量偏好的 `storage`，网络 host 权限只包含 Pinterest 页面和 `pinimg.com` CDN。
3. 只处理 `pinimg.com` 的 HTTPS 静态图片；视频、HLS 和无有效图片地址的 Pin 必须跳过并计数。
4. Chrome 临时下载区默认为 `~/Downloads/PinterestInbox`，长期素材库默认为 `~/Pictures/PinterestInbox`；分别可用 `PINTEREST_INBOX_STAGING_DIR` 和 `PINTEREST_INBOX_DIR` 覆盖。Chrome Downloads API 只能设置 Downloads 下的相对路径。
5. 本地网页与 MCP 均不接受任意 URL、源文件路径或目标路径。网页素材操作只提交匹配固定格式的已索引 `assetId` 或有序 ID 列表；服务端必须再次通过 `resolveAsset()` 确认真实文件仍位于长期库后，才能预览、选择或复制路径。
6. 本地网页不得把 `sourcePath` 返回给浏览器、不得自动发送消息、不得生成工作区副本或引用衍生件。旧 MCP 工作区导入链路仅作为可回滚备用，仍受 `workspaceToken`、固定目标目录和符号链接边界保护。
7. 不引入数据库、常驻系统服务、LaunchAgent、Native Messaging 或新的生产 npm 依赖。
8. HTTP 网页与 MCP 必须在同一进程共享唯一 `InboxService`，不得创建第二套 watcher、周期校准或 Downloads 搬运进程。

## Chrome 扩展

- 单张模式默认开启：单击 Pin 后立即加入下载队列；下载过程中继续点其他 Pin 可直接追加，后台仍按点击顺序串行处理。相同图版/Pin 在提交或下载未结束前去重，不拦截 Cmd/Ctrl 修饰点击。
- 多选模式：单击勾选多个 Pin，再一次性加入队列。
- 下载器面板支持收起/展开、窄窗口、深色和 reduced-motion；收起仅折叠界面，不暂停采集。处理进度与已保存、跳过、失败分别展示，不以“处理完成”代替成功数量。
- 同一文档的页面重绘、body/html 容器替换或面板节点移除后，应恢复同一面板与选中样式，保留选择、收起/暂停状态和当前任务；不得重复注册点击或进度监听、重复提交下载。完整网页刷新和扩展重启不属于此恢复范围。
- 多选只有在后台确认接收后才清除；提交失败保留勾选。网页重绘或复用卡片时按 Pin ID 同步选中标记。面板汇总当前这一组下载的总量、待处理、保存、跳过和失败，所有已提交任务收尾后才结束。单项提交失败不丢失其他任务；模式切换、多选提交与整板扫描在下载时保持禁用。
- 整板模式：保存当前位置，自动向下滚动并收集当前图版，连续五轮到达页面底部且无新增 Pin 后停止，随后恢复原滚动位置并开始下载。
- 面板提供“暂停/启用”；暂停后不再拦截 Pin 点击，清除勾选并取消当前扫描或未完成下载。
- 取消下载队列及暂停覆盖本面板整组尚未完成的任务；尚未收到加入确认的任务在确认后继续取消，收尾前不接受新图片。迟到的加入/取消响应不得覆盖更新的下载进度。复用现有后台队列和消息形状，不新增持久队列或恢复协议。
- 面板提供持久化的保存质量选项；升级到智能策略时执行一次偏好迁移，默认改为“智能轻量”：
  - 原图：保留 `originals` 的原始分辨率、字节和真实格式；
  - JPEG 高清：非透明图片以原始分辨率编码为 JPEG 90，用于需要 JPEG 兼容性的场景，不承诺小于 originals；
  - 智能轻量：WebP originals 原样保留；其他格式生成最长边不超过 2048px、JPEG 80 或透明 PNG 的候选件，禁止放大，且只有候选件严格小于源文件时才采用，否则保留源文件。
- 高清/轻量转换在 Chrome Offscreen 文档完成；处理失败必须计入失败项，不得静默回退缩略图或伪造成功。
- 文件标题按“结构化卡片标题 → 首个可见文本行 → 清理后的图片 `alt` → Pin ID”降级获取；无障碍描述前缀不得进入文件名。
- 自动滚动最多 1000 步；若页面持续无限增长，必须明确提示达到安全上限并只处理已发现项目。
- 下载串行限速 450ms；失败自动重试一次；用户可以取消扫描或尚未完成的下载。
- 下载状态监听注册后查询当前状态，覆盖快速完成的时序窗口；取消若发生在 Chrome 返回下载编号前，编号返回后仍需取消该项。前端以 pending 归零确认取消收尾。整板扫描期间路径切换应停止扫描，且不恢复其他页面的滚动位置。
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
- 主引用路线由显式会话工具提供长期库原文件路径，路径复制为备用，不运行工作区引用压缩，不创建 `<workspace>/references/pinterest/` 副本。旧 MCP 回滚链路继续保留原有智能轻量与缓存策略，但不被本地网页调用。
- 首屏和每页最多 30 张；网页每 2 秒查询状态与版本。版本未变化时仍必须合并 watcher / transfer 状态，但不重新获取素材数组。
- 图版过滤必须由服务端按完整索引分页，不能只筛客户端已经加载的首批 30 张；Board 封面缩略图可按 `assetId` 独立读取。
- 缩略图生成前必须重新调用 `resolveAsset()` 做真实路径边界检查；源文件在扫描后被替换为 Inbox 外符号链接时，缩略图和剪贴板都必须拒绝。

## MCP 接口

### `open_pinterest_inbox_web`

- 懒启动与 MCP 同进程的本地 HTTP 网页，始终绑定 `127.0.0.1`，端口默认由系统动态分配。
- MCP 宿主启动窗口为 120 秒，为首次安全收取大批 Downloads 积压留出时间；常规空库或小库应快速就绪。
- 可选输入 `referenceSessionId`。不传时创建独立空参考篮，返回 `referenceSessionId` 与 `http://127.0.0.1:<port>/?ref=<id>`；传入时复用该会话。URL 供 Codex 内嵌浏览器在右侧打开。
- 重复调用复用同一网页实例，不创建第二个 Inbox 监听器。
- 如旧网页正在停止，新的打开请求必须等待旧实例完全释放后再启动，不得重叠两个 HTTP 服务。

### `get_pinterest_reference_selection`

- 必填 `referenceSessionId`，可选 `expectedRevision`；只读返回有序文件编号、标题、canonical absolute path 和 revision。
- 每次首次打开独立创建 128 位随机会话 ID，禁止根据最后打开的面板、进程或工作区推断任务。MCP 无可信任务身份 API，因此这是显式会话隔离，不宣称宿主身份认证；代理只续用本任务工具返回的 ID。
- 参考篮在 MCP 内存中保存，最多 64 个会话；停止 HTTP 不清空，MCP 重启失效。无新存储格式或数据迁移。
- 最多 10 张，禁止重复 ID。修改需 revision 一致；并发冲突不覆盖。
- 加入前检查实时文件大小、mtime 与索引一致；选中时记录 dev、ino、大小、mtime、ctime 指纹，读取时复核真实路径与指纹。任何选中项丢失或变化都阻止整组读取，调整顺序不会自动接受新文件。此检查覆盖常规替换，不是外部写入者与后续模型读文件之间的原子快照。
- 工具只提供原文件路径，代理必须实际查看原图后再分析或生成；不把标题或缩略图当原图，也不注入原生输入框附件。

### `get_pinterest_inbox_web_status`

- 只读返回网页运行状态、当前 URL 和 Inbox 监听摘要；关闭尚未完成时明确返回 `stopping`，不得误报 `stopped`。

### `stop_pinterest_inbox_web`

- 只关闭当前任务的 HTTP 网页；Inbox 监听、MCP 和旧内嵌面板保持可用。
- MCP 进程退出或 stdio EOF 时必须先停止 HTTP 接收请求，再释放 Inbox watcher / timer；活动 HTTP 连接最多等待 500ms 后强制断开。已经启动的 `sips` 由 15 秒超时收尾；剪贴板写入及读回核对共用 5 秒期限。

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
- 点击图片打开原图预览，独立 ＋ 按钮加入参考，卡片与预览提供复制路径。复制由无 shell 的 `/usr/bin/pbcopy` stdin 写入 canonical absolute path；批量复制按篮内顺序换行。允许重复复制。`pbcopy` 与读回核对的 `pbpaste` 均固定 UTF-8 环境，只有读回字节完全一致才确认成功；失败不泄露剪贴板内容、不自动重试。同页复制进行中避免其他复制按钮重叠写入，新的复制开始时清除旧成功标记。
- 搜索覆盖完整服务端索引的标题、图版和 Pin ID，采用 NFKC 规范化、多关键词匹配；排序支持最新、最早、标题，再进行每页 30 张分页。
- `GET /api/references`、`POST /api/references`、`POST /api/references/clipboard` 显式携带参考会话头；写入携带 revision。浏览器响应不暴露原文件路径。
- `GET /api/previews/<assetId>` 读取经过路径复核的原文件，保持原字节；单次原图预览限制 64 MiB，超过时解释原因，参考选择与路径复制仍可用。
- Cookie 名带本机端口，避免不同 MCP 服务在同一浏览器互相覆盖会话。
- UI 包含响应式图片/图版布局、加载/空/错误状态、系统深色模式与 reduced-motion；预览支持方向键和 Escape，关闭后还原焦点。参考篮支持编号、移除、调整顺序、清空与批量复制；为固定底栏预留实际高度。
- 缩略图接近视区时加载，最多 4 个并发；复制/选中更新局部状态，分页复用已有卡片。搜索和分页用请求代次防止旧响应覆盖新视图。
- 空 Inbox、损坏缩略图、监听降级、搬运失败、网页断线与自动重连必须显示明确且互不混淆的状态。缩略图失败不阻断路径复制。
- 旧内嵌 MCP 面板继续使用工作区导入 + 消息发送，仅作回滚备用。

## 验收标准（保留 MVP 覆盖，包含已确认的新体验）

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
5. 点击卡片“复制路径”后用 `pbpaste` 核对剪贴板内容等于 Pictures 长期库内的 canonical absolute path；图片哈希、mtime、体积不变，工作区没有新增副本。
6. 在当前对话按 `⌘V` 粘贴路径并附上正常需求，由 Codex 实际读取图片内容；此操作不占用额外自动消息轮次。
7. 停止本地网页，页面明确显示断线；Inbox 监听与旧 MCP 面板仍可用，重新打开网页后恢复。

### 参考篮与 UI 验收

- 自动：独立会话、同篮并发 revision、空/重复/超限/失效会话、丢失/替换/符号链接逃逸、全库搜索、原图字节一致、HTTP 选择到 MCP 原文件列表、旧 API 与生命周期兼容。
- 浏览器：400px 与宽窗口无横向溢出；预览原图和键盘关闭；连续选图、排序移除、批量复制；快速搜索切换、分页、图版筛选、断线恢复；两个参考会话和两个端口不串状态。
- 真实 Codex 宿主：2026-09-09 在可见内嵌浏览器中打开独立空篮，选择 3 张后得到有序编号；同一 `referenceSessionId` 经 MCP 返回完全一致的 3 个原文件，Codex 已逐张读取原图。批量复制结果与系统剪贴板逐字节一致，包含中文文件名。独立会话与重开保留继续由自动回归覆盖。

## 非目标与未来路线

- 不做 Pinterest 全站搜索、创建/保存/修改/删除 Pin、视频下载或账号管理。
- MCP 工具本身不强制宿主布局；Codex 桌面端支持时由代理把返回 URL 打开到右侧内嵌浏览器，否则用户可手动在内嵌浏览器打开同一 URL。
- Pinterest OAuth 与官方只读 API 保留为未来备选，不进入本 MVP。
