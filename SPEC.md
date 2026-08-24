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
2. Chrome 扩展只匹配 `https://*.pinterest.com/*`，生产权限只包含 `downloads`。
3. 只处理 `pinimg.com` 的 HTTPS 静态图片；视频、HLS 和无有效图片地址的 Pin 必须跳过并计数。
4. Inbox 默认固定为 `~/Downloads/PinterestInbox`，可用 `PINTEREST_INBOX_DIR` 覆盖；Chrome Downloads API 只能设置 Downloads 下的相对路径。
5. MCP 不接受任意 URL、源文件路径或目标路径。导入只能使用已索引 `assetId` 和进程内随机 `workspaceToken`。
6. 导入目标固定为 `<workspace>/references/pinterest/<board>/`，不覆盖现有不同内容，不允许符号链接越过工作区边界。
7. 不引入数据库、常驻系统服务、LaunchAgent、Native Messaging 或新的生产 npm 依赖。

## Chrome 扩展

- 单张模式默认开启：单击 Pin 后立即加入下载队列。
- 多选模式：单击勾选多个 Pin，再一次性加入队列。
- 整板模式：保存当前位置，自动向下滚动并收集当前图版，连续五轮到达页面底部且无新增 Pin 后停止，随后恢复原滚动位置并开始下载。
- 自动滚动最多 1000 步；若页面持续无限增长，必须明确提示达到安全上限并只处理已发现项目。
- 下载串行限速 450ms；失败自动重试一次；用户可以取消扫描或尚未完成的下载。
- 文件名固定为 `PinterestInbox/<board-slug>/<pin-id>__<safe-title>.<ext>`，使用 `overwrite` 更新同一确定性目标，不触碰 Inbox 外文件。

## Inbox 与缩略图

- MCP 进程启动时完整扫描，随后使用 `fs.watch`；关闭时释放 watcher 与 timer。
- 每 10 秒全量校准，并提供显式强制刷新，弥补文件系统事件遗漏。
- 忽略隐藏路径、`.crdownload`、`.tmp` 和非图片文件。
- 索引只保存在内存，记录稳定资产 ID、Pin、图版、签名和更新时间。
- macOS 使用 `/usr/bin/sips` 按需生成最长边 480px 的 JPEG 缩略图，缓存于 `~/Library/Caches/pinterest-reference-panel/thumbnails/`。
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

## UI 与消息桥

- 品牌栏和 Pins / Boards 标签使用 sticky 层固定在页面上方，只有下方素材区域随页面滚动。
- Pins 使用窄栏双列瀑布流；Boards 仅代表本地 Inbox 的一级图版目录。
- 单击 Pin 后阻止重复操作，成功复制后通过标准 `ui/message` 发送相对路径；兼容回退到 `window.openai.sendFollowUpMessage`。
- 消息发送失败时保留已导入文件，卡片提供重试且不重复复制。
- 空 Inbox、损坏缩略图、监听降级和工作区不可用必须显示明确状态。

## MVP 验收标准

### 自动验证

- 路径清理、Pin ID / 图版解析、权限清单和下载队列。
- 初次扫描、嵌套目录、临时文件忽略、索引版本与周期校准入口。
- `sips` 缩略图、失败占位、私有 `_meta`。
- 工作区边界、源/目标符号链接逃逸、重复导入和禁止覆盖。
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
