# Pinterest Inbox 规格

## 产品目标

首版面向 **macOS + Chrome**。用户在 Pinterest 图版页用精简 Chrome 扩展下载静态图片；Codex 插件只读取本地 Inbox，并把明确选择的素材安全复制到当前工作区供任务引用。

```text
Pinterest 图版
  → Chrome 扩展（单张 / 多选 / 整板自动滚动）
  → ~/Downloads/PinterestInbox/<board>/
  → MCP 启动扫描 + 运行期监听
  → Codex Pins / Boards 瀑布流
  → <workspace>/references/pinterest/<board>/
  → 当前任务收到相对路径
```

## 设计原则

1. 不接 Pinterest API，不读取或保存账号凭证、Cookie 与登录态。
2. Chrome 扩展内容脚本只匹配 `https://*.pinterest.com/*`；Chrome API 权限只包含下载所需的 `downloads`、图片处理所需的 `offscreen` 和保存用户质量偏好的 `storage`，网络 host 权限只包含 Pinterest 页面和 `pinimg.com` CDN。
3. 只处理 `pinimg.com` 的 HTTPS 静态图片；视频、HLS 和无有效图片地址的 Pin 必须跳过并计数。
4. Inbox 默认固定为 `~/Downloads/PinterestInbox`，可用 `PINTEREST_INBOX_DIR` 覆盖；Chrome Downloads API 只能设置 Downloads 下的相对路径。
5. MCP 不接受任意 URL、源文件路径或目标路径。导入只能使用已索引 `assetId` 和进程内随机 `workspaceToken`。
6. 导入目标固定为 `<workspace>/references/pinterest/<board>/`，不覆盖现有不同内容，不允许符号链接越过工作区边界。
7. 不引入数据库、常驻系统服务、LaunchAgent、Native Messaging 或新的生产 npm 依赖。

## Chrome 扩展

- 单张模式默认开启：单击 Pin 后立即加入下载队列。
- 多选模式：单击勾选多个 Pin，再一次性加入队列。
- 整板模式：保存当前位置，自动向下滚动并收集当前图版，连续五轮到达页面底部且无新增 Pin 后停止，随后恢复原滚动位置并开始下载。
- 面板提供“暂停/启用”；暂停后不再拦截 Pin 点击，清除勾选并取消当前扫描或未完成下载。
- 面板提供持久化的保存质量选项，默认“高清”：
  - 原图：保留 `originals` 的原始分辨率、字节和真实格式；
  - 高清：非透明图片以原始分辨率编码为 JPEG 90；
  - 轻量：非透明图片最长边不超过 2048px，编码为 JPEG 80，禁止放大；
  - 高清/轻量遇到透明 PNG 或透明 WebP 时输出 PNG；轻量模式只缩小最长边，不丢失透明通道。
- 高清/轻量转换在 Chrome Offscreen 文档完成；处理失败必须计入失败项，不得静默回退缩略图或伪造成功。
- 文件标题按“结构化卡片标题 → 首个可见文本行 → 清理后的图片 `alt` → Pin ID”降级获取；无障碍描述前缀不得进入文件名。
- 自动滚动最多 1000 步；若页面持续无限增长，必须明确提示达到安全上限并只处理已发现项目。
- 下载串行限速 450ms；失败自动重试一次；用户可以取消扫描或尚未完成的下载。
- 每个素材必须先探测 Pinterest CDN `originals` 路径；优先服务器确认为原生 JPG/PNG 的原图，仅当 originals 仅有 WebP 时才选择 WebP 作为最高质量源。
- “原图”模式不得将 WebP 转码为 JPG/PNG。只有用户明确选择“高清”或“轻量”时才允许从 originals 源转码；不得只修改扩展名，不得回退为 `236x` / `474x` / `736x` 等缩略图；无 JPG/PNG/WebP originals 时跳过并单独计数。
- 新下载文件名固定为 `PinterestInbox/<board-slug>/<safe-title>__pin-<pin-id>.<ext>`；下载请求的 `filename` 和 `downloads.onDeterminingFilename` 必须提交同一目标，防止 Chrome 回退 CDN 哈希名。使用 `overwrite` 更新同一确定性目标，不触碰 Inbox 外文件。Codex Inbox 解析器必须继续兼容旧的 `<pin-id>__<safe-title>.<ext>` 格式。

## Inbox 与缩略图

- MCP 进程启动时完整扫描，随后使用 `fs.watch`；关闭时释放 watcher 与 timer。
- 每 10 秒全量校准，并提供显式强制刷新，弥补文件系统事件遗漏。
- 忽略隐藏路径、`.crdownload`、`.tmp` 和非图片文件。
- 索引只保存在内存，记录稳定资产 ID、Pin、图版、签名和更新时间。
- macOS 使用 `/usr/bin/sips` 按需生成最长边 480px 的 JPEG 缩略图，缓存于 `~/Library/Caches/pinterest-reference-panel/thumbnails/`。
- 工作区导入默认生成适合模型引用的衍生版本：非透明图片最长边不超过 2048px、JPEG 80；透明图片保持 PNG，必要时只缩小最长边。已经符合条件的 JPEG/PNG 直接复用，不重复压缩。
- 引用衍生版本始终从当前 Inbox 的最高质量资产生成，缓存于 `~/Library/Caches/pinterest-reference-panel/references/`；不得从此前的压缩副本继续转码。`sips` 不可用或处理失败时允许原样导入以保留功能，但必须返回 `fallback` 状态与具体原因。
- 首屏和每页最多 30 张；UI 每 2 秒只查询版本，版本未变化时不重新获取素材。
- 缩略图和 `workspaceToken` 只放在工具结果私有 `_meta.pinterestInbox` 中，不进入模型可见 `structuredContent`。

## MCP 接口

### `render_pinterest_reference_panel`

- 可选输入：`workspaceRoot`。
- 返回首屏 Pins、Boards、监听状态、公开工作区状态。
- 工作区优先尝试 MCP `roots/list`，宿主未提供时使用显式 `workspaceRoot`。
- 无法确认工作区时仍可浏览，但导入禁用。

### `list_pinterest_inbox`

- 输入：`cursor`、`limit`、`knownVersion`、`forceRescan`。
- 只读返回分页内容和索引版本；版本未变化时返回 `unchanged: true`。

### `import_pinterest_reference`

- 输入：`assetId`、`workspaceToken`。
- 只允许复制当前索引内且真实路径仍位于 Inbox 的文件。
- 相同内容复用现有文件；同名不同内容增加 8 位内容哈希后缀。
- 返回 `optimization`、`cacheReused` 和可选失败原因，使宿主能够区分轻量引用版与原文件回退。

## UI 与消息桥

- 品牌栏和 Pins / Boards 标签使用 sticky 层固定在页面上方，只有下方素材区域随页面滚动。
- Pins 使用窄栏双列瀑布流；Boards 仅代表本地 Inbox 的一级图版目录。
- 单击 Pin 后阻止重复操作，成功复制后通过标准 `ui/message` 发送相对路径；兼容回退到 `window.openai.sendFollowUpMessage`。
- 消息发送失败时保留已导入文件，卡片提供重试且不重复复制。
- 空 Inbox、损坏缩略图、监听降级和工作区不可用必须显示明确状态。

## MVP 验收标准

### 自动验证

- 路径清理、Pin ID / 图版解析、权限清单、三档质量、originals 格式选择、原图模式 WebP 保留、透明图 PNG 输出和下载队列。
- 初次扫描、嵌套目录、临时文件忽略、索引版本与周期校准入口。
- `sips` 缩略图、失败占位、私有 `_meta`。
- 工作区边界、源/目标符号链接逃逸、2048/JPEG80 衍生缓存、透明 PNG、重复导入和禁止覆盖。
- MCP 工具结构、读写 annotations、UI bridge 与 sticky 顶栏。

### 人工端到端

1. 多选下载两张静态图片。
2. 对一个真实图版执行整板自动滚动下载。
3. 插件关闭期间下载图片，重新开启后由初扫补齐。
4. 面板打开期间下载新图片，图片自动出现。
5. 单击 Pin 后工作区出现文件、任务收到相对路径，并由 Codex 实际读取图片。

## 非目标与未来路线

- 不做 Pinterest 全站搜索、创建/保存/修改/删除 Pin、视频下载或账号管理。
- 不承诺插件能强制指定 Codex 右侧停靠位置；位置由宿主决定。
- Pinterest OAuth 与官方只读 API 保留为未来备选，不进入本 MVP。
