# 变更日志

## 2026-08-30 — 本地右侧瀑布流与绝对路径复制

- 任务目标：绕开当前 Codex 宿主未开放 `uploadFile` / `setWidgetState`、MCP Apps UI 只能出现在对话内以及 `ui/message` 会占用一轮对话的限制，把 Pinterest Inbox 主体验改为 Codex 右侧内嵌浏览器中的本地瀑布流；用户单击图片后只复制长期库原文件的真实绝对路径，再手动粘贴进当前对话。
- 修改文件：新增 `src/local-panel-server.ts` 与 `assets/local-panel.html` / `local-panel.css` / `local-panel.js`；扩展 `src/inbox.ts`、`src/server.ts`、本地网页/MCP/Inbox/结构测试和运行时 bundle；恢复旧 `pinterest-panel.html` 的工作区导入回滚链路；同步更新插件清单、package 描述、`.gitignore`、README、SPEC 与日志索引。
- 关键决策：本地 HTTP 与 MCP 同进程复用唯一 `InboxService`，只绑定 `127.0.0.1` 动态端口；API 使用 HttpOnly/Strict 会话 Cookie、随机 CSRF 头、精确 Host/Origin、无 CORS 和安全响应头。浏览器只能提交已索引 `assetId`，服务端重新执行真实路径边界检查后用无 shell 的 `/usr/bin/pbcopy` stdin 写入 canonical path；公开响应不返回 `sourcePath`，底层文件系统错误也统一脱敏。主路线不复制、不转码、不修改素材、不自动发消息；旧 MCP 工作区导入面板仅作回滚备用。
- 稳定性收口：缩略图在前后端均限制为最多 4 路并对同素材请求去重，前端分别给常规 API 8 秒、缩略图 20 秒、手动完整刷新 120 秒超时，避免慢图误报离线；版本变化或手动刷新时清理失败/Blob 缓存，且旧 epoch 缩略图请求无论成功还是失败都不得污染新页面；快速切换 Pins、Boards 或图版时用请求 generation 与视图快照丢弃过期响应；`list_pinterest_inbox(forceRescan)` 只重扫长期库，不再隐式搬运 Downloads。MCP 启动窗口放宽到 120 秒，启停错误对工具结果使用固定脱敏文案。stdio EOF、SIGINT/SIGTERM 和重复关闭均走幂等清理，停止期间再次打开会等待旧 HTTP 服务完全释放，不会重叠两个网页实例。活动 HTTP 连接 500ms 后强制断开，已经启动的 `sips` / `pbcopy` 由各自超时有界收尾。
- 验证结果：TypeScript、bundle 构建和完整仓库 **45/45** Node 自动测试通过，包含 Linux CI 可执行的回环 Host、会话、CSRF、Origin、超大请求体、任意路径、启动错误脱敏、分页、watcher、有活动请求时的并发停止/重开、关闭回调短暂失败后重试、stdio EOF 与 SIGTERM 端口释放测试。真实 `~/Pictures/PinterestInbox` 页面读取 38 张素材，400px 窄栏 Pins/Boards、sticky 顶栏和 0 条浏览器日志通过；隔离临时库对 Board A 注入 750ms 延迟后连续切换到 Board B，最终只显示 B。真实点击两次“个人网站视觉参考”均复制同一长期库 WebP 路径，前后大小 585,196 bytes、mtime、inode 和 SHA-256 `07e5b17984ce445a9a783d829d64698e0b184ac06fc9d0544444388897f603af` 完全不变，Codex 已直接读取该文件。插件清单通过官方校验，并重装为 `0.4.0+codex.20260829183930`；运行时 bundle、MCP 配置与本地网页资产同安装缓存逐字节一致，从该缓存直接启动的隔离 smoke test 确认网页返回 200、标题正确、启动与停止工具均正常。
- 未解决事项：更新后的已安装插件必须在一个新 Codex 任务中加载；仍需用户亲自完成最后一次“右侧点击图片 → 回到输入框按 `⌘V` → 连同正常需求发送”的交互验收。验收前 README 继续标为候选版，不把能力写成正式完成。
- 回滚提示：停止 `open_pinterest_inbox_web` 或回退本轮功能提交即可恢复旧 MCP 工作区导入面板；Chrome 下载、Downloads→Pictures 搬运、长期库图片和既有工作区文件均不会被删除。缩略图缓存可独立清理。

## 2026-08-25 — Codex 点击即引用附件探针

- 任务目标：验证用户单击 Inbox 图片后，能否不复制到工作区、不二次压缩、不发送后续提示词，直接通过 Codex 插件文件接口把图片加入当前任务的后续输入状态，并观察宿主是否显示原生输入框附件缩略图。
- 修改文件：MCP `src/server.ts`、面板 `assets/pinterest-panel.html`、自包含运行时 bundle、MCP 与结构测试；正式 `SPEC.md` 和 `README.md` 暂不改写，等待真实宿主验收后再决定产品路线。
- 关键决策：新增仅 UI 可见的只读 `prepare_pinterest_attachment` 探针工具，只允许读取当前 Inbox 索引中的安全图片，按原文件字节和真实 MIME 返回 UI 私有 Base64，既不调用工作区导入器也不调用图片转码器；面板把原字节构造成 `File`，依次调用 `window.openai.uploadFile` 与 `window.openai.setWidgetState({ imageIds })`。旧的 `ui/message` / `sendFollowUpMessage` 点击链路已从探针面板移除，因此探针不会代用户发送消息或占用一轮对话。
- 验证结果：TypeScript 检查、MCP bundle 构建和完整仓库 33/33 Node 自动测试通过；MCP 测试确认探针返回字节与 Inbox 源文件完全一致、未泄露源路径，结构测试确认面板包含 `uploadFile` / `setWidgetState` / `imageIds` 且不再包含消息发送桥；插件清单在一次性 PyYAML 虚拟环境中验证通过。
- 未解决事项：OpenAI 公开接口只承诺 `imageIds` 在后续轮次对模型可见，没有承诺一定生成输入框附件缩略图；程序构造的 `File` 是否被当前 Codex 桌面宿主接受也必须在重装后的新任务中实测。本轮是兼容性探针，不代表正式产品能力已验收。
- 回滚提示：回退本轮探针代码并重装上一缓存版本即可恢复“复制工作区后发送相对路径”的旧链路；Pinterest Inbox 与既有工作区素材均不会被修改或删除。

## 2026-08-25 — Downloads 暂存区与 Pictures 长期库

- 任务目标：避免用户定期清理 Downloads 时误删 Pinterest 素材，将 Chrome 受限下载目录降为临时区，并把 `~/Pictures/PinterestInbox` 建立为唯一长期素材库。
- 修改文件：MCP `src/inbox.ts`、`src/server.ts`、自包含运行时 bundle、面板 UI、Inbox/MCP 测试、插件版本、README、SPEC、package lock 与日志索引。
- 关键决策：不改动稳定的 Chrome Downloads 链路；MCP 启动时收取积压文件，运行时同时监听临时区与长期库。搬运采用稳定文件判断、目标临时副本、SHA-256 验证、无覆盖落盘与成功后清理源文件；同名不同内容保留哈希后缀副本。
- 验证结果：TypeScript 检查与 MCP bundle 构建通过；33/33 Node 自动测试通过，其中新增启动迁移、去重、同名冲突、运行期收取、目标目录和目标文件符号链接逃逸防护。真实迁移 13 张、5,464,597 bytes，Pictures 内逐文件 SHA-256 全部一致，Downloads 可索引图片归零，失败为 0；真实目录 watcher 将一张重复样本在 609ms 内识别并去重，长期库数量与哈希未变。插件清单验证通过，并已重装为 `0.4.0+codex.20260825004846`；安装缓存 MCP 实测读取 13 张、watching、0 失败。
- 未解决事项：重装插件后需新建 Codex 任务验收面板自动刷新、真实新 Pin 下载收取和点击引用。
- 回滚提示：可回退功能提交并重装旧插件；已收取素材保留在 Pictures，需要旧版时可通过 `PINTEREST_INBOX_DIR` 显式指向该长期库，不会自动搬回 Downloads。

## 2026-08-24 — 智能轻量默认与 WebP 原样保留

- 任务目标：修复同分辨率 WebP 转成 JPEG80 后质量下降但体积反而增大的问题，并把默认保存策略改为真正以体积收益为条件的智能轻量。
- 现场证据：同一 Pin 的 originals WebP 为 1360×2048、585,196 bytes；轻量 JPEG80 仍为 1360×2048，却增至 804,583 bytes，说明机械转码不等于轻量化。
- 修改文件：Chrome 扩展质量配置、Offscreen 处理、队列、面板、manifest 与测试；Codex 插件工作区引用准备、运行时 bundle、版本与测试；同步更新 README、SPEC、package lock 和日志索引。
- 关键决策：默认档位改为“智能轻量”并对旧质量设置执行一次版本化迁移；WebP originals 在下载与 Codex 引用两端都原样保留，不进入编码器；其他格式生成 2048px/JPEG80 或透明 PNG 候选件，只有候选件严格小于源文件时才采用。“JPEG 高清”作为显式兼容选项保留，不承诺减小体积。
- 验证结果：TypeScript 检查、MCP bundle 构建和 27/27 Node 自动测试通过，覆盖默认迁移、WebP 绕过转换、候选体积比较和 Codex 较大衍生回退。真实 Inbox WebP 经 Codex 导入后仍为 585,196 bytes，SHA-256 一致，格式与文件名保持 WebP。插件清单验证通过，并已重装为 `0.3.1+codex.20260824152052`。
- 未解决事项：Chrome 0.3.1 仍需重新加载后执行真实智能轻量下载；Pinterest Inbox 的长期存储位置尚未确认，在位置、Chrome 下载限制和迁移方案确认前不开始下一阶段文件夹监测应用。
- 回滚提示：回退本轮提交并重新加载扩展/插件即可恢复 0.3.0 行为；现有 Inbox 文件不会被自动迁移或删除。

## 2026-08-24 — 三档保存质量与轻量引用版

- 任务目标：在 originals 质量优先的基础上加入可选保存质量，并让 Codex 引用默认使用更适合模型上传的轻量副本。
- 修改文件：Chrome 扩展 `shared.js`、`background.js`、`content.js`、manifest、新增 Offscreen 图片处理页与扩展测试；Codex 插件 `workspace.ts`、`server.ts`、运行时 bundle、版本与工作区测试；同步更新 README、SPEC、package lock 和日志索引。
- 关键决策：扩展默认“高清”，提供原图/高清/轻量三档并用 `chrome.storage.local` 记忆；所有档位先获取 Pinterest CDN originals，原图档保留原字节，高质量档使用全分辨率 JPEG90，轻量档使用最长边 2048px/JPEG80；高清/轻量检测透明通道并输出 PNG。Codex 导入单独从 Inbox 当前资产生成最长边 2048px/JPEG80 引用版，透明素材保持 PNG，缓存位于 `~/Library/Caches/pinterest-reference-panel/references/`，不修改 Inbox。
- 稳定性与安全：Chrome 转换在最小权限 Offscreen 文档完成，转换失败明确计数；临时 Blob URL 下载结束即释放并有超时兜底。Codex 的 `sips` 不可用或处理失败时原样导入并返回 `fallback` 原因，工作区令牌、路径边界、符号链接防逃逸和禁止覆盖保持不变。
- 验证结果：TypeScript 检查、MCP bundle 构建和 24/24 Node 自动测试通过；新增质量配置、Offscreen 输出格式、队列转换及失败可见性、2048/JPEG80 缓存复用和透明 PNG 测试。真实 macOS 样本由 2,737,537 bytes、1587×2245 的无透明 PNG 生成 818,655 bytes、1447×2048 的 JPEG80，源文件未修改。插件清单在临时 PyYAML 虚拟环境验证通过，并已重装为 `0.3.0+codex.20260824145639`。
- 未解决事项：Chrome 0.3.0 仍需在用户浏览器重新加载后，分别对原图/高清/轻量执行真实下载，确认 Offscreen Blob 下载与透明图行为；Codex 插件需新建任务后验收单击引用、缓存复用和对话路径发送。验收前 README 继续标记为候选版。
- 回滚提示：回退本轮提交并重新加载 Chrome 扩展/Codex 插件即可；Inbox 与已导入素材不会被自动删除，新引用缓存可单独清理。

## 2026-08-24 — Pin 结构化标题优先

- 任务目标：移除扩展下载文件名中的“其中包括图片”无障碍描述前缀。
- 现场证据：真实 Pinterest 卡片的 `img.alt` 为“其中包括图片：…”，而同一卡片的 `data-test-id="pinrep-footer-organic-title"` 与 `h2` 包含干净 Pin 标题。
- 修改文件：Chrome 扩展 `content.js`、`shared.js`、manifest、扩展测试、README、根 README、SPEC 和日志索引。
- 关键决策：优先使用结构化标题，其次使用卡片可见文本，最后才使用经清理的 `alt`；不改变 originals URL、格式或图像字节。
- 验证结果：TypeScript 检查、MCP bundle 构建和 19/19 Node 测试通过；新增无障碍前缀清理、空标题降级和标题节点优先顺序验证。
- 附加调研：样本 originals PNG 为 1587×2245、2,737,537 bytes、无 alpha；网页 JPEG 为 736×1041、189,606 bytes。无损 PNG 重压缩仅减少约 0.2%；无损 WebP 测试为 1,933,198 bytes 且像素差异为 0，但属于格式转换，未经用户确认不进入产品链路。
- 未解决事项：Chrome 需手动重新加载 0.2.3 后验收干净文件名；若需要优化原图存储体积，必须先确认是否允许保留 originals 的同时生成可选衍生格式。
- 回滚提示：回退本轮提交并重新加载扩展即可；已下载的原图不会被自动重命名或删除。

## 2026-08-24 — Chrome 最终文件名强制

- 任务目标：修复真实 Chrome 中 originals 下载成功但文件名退回 CDN 哈希的问题。
- 现场证据：Chrome Profile 1 下载记录 ID 722 的 `by_ext_id` 为本扩展 `flcdkjjbmnngmaiclolggammkdgnhidm`，URL 为 `i.pinimg.com/originals/...jpg`，但最终 `target_path` 是 Downloads 根目录下的哈希文件名；同时确认加载路径指向当前仓库扩展。
- 修改文件：`background.js`、Chrome 扩展 manifest、队列测试、扩展 README、根 README、SPEC 和日志索引。
- 关键决策：保留 `downloads.download({ filename })` 并新增 `downloads.onDeterminingFilename`二次强制；只处理 `byExtensionId === chrome.runtime.id` 的本扩展下载，不改写其他网页或扩展的文件名。
- 验证结果：TypeScript 检查、MCP bundle 构建和 19/19 Node 测试通过；队列测试确认初始 filename 与最终 suggest filename 一致，重试和多格式队列均被覆盖。
- 未解决事项：必须在 Chrome 手动重新加载 0.2.2 并刷新 Pinterest 页面后，再执行一次真实下载验收。
- 回滚提示：回退本轮提交并重新加载扩展即可；已下载文件不会被自动删除。

## 2026-08-24 — 原图文件名改为标题优先

- 任务目标：让 originals 原图保留网页 Pin 标题，便于在 Finder 和 Codex Inbox 中识别素材。
- 修改文件：Chrome 扩展 `shared.js`、`manifest.json`与扩展测试；Codex 插件 `src/inbox.ts`、运行时 bundle、版本与解析测试；同步更新 README、SPEC 和日志索引。
- 关键决策：新文件统一命名为 `<safe-title>__pin-<pin-id>.<verified-extension>`；显式 `pin-` 标记避免新旧格式歧义。Inbox 解析器同时支持新格式和旧的 `<pin-id>__<safe-title>.<ext>`，不要求迁移现有素材。
- 验证结果：TypeScript 检查与 MCP bundle 构建通过；19/19 Node 自动测试通过，包括新命名、旧命名兼容、originals 格式选择和工作区导入。
- 未解决事项：Chrome 扩展需手动重新加载；更新后的 Codex 解析器需在重新安装插件并新建任务后生效；真实 Pin 标题与原图字节一致性仍需用户验收。
- 回滚提示：回退本轮提交并重新加载扩展/插件即可；新旧命名素材都不会被自动删除。

## 2026-08-24 — 采集开关与 originals 原图优先

- 任务目标：根据真实 Chrome 下载验收结果，增加面板内暂停/启用控制，并将素材策略改为“original 质量优先”。
- 修改文件：`extensions/pinterest-inbox-downloader/manifest.json`、`shared.js`、`background.js`、`content.js`、扩展测试与 README；同步更新根 `README.md`、`SPEC.md`和日志索引。
- 关键决策：只探测并下载 Pinterest CDN `originals` 资产；原生 JPG/PNG 优先，它们均不存在而 originals WebP 存在时保留 WebP；以 HTTP `Content-Type` 决定真实后缀，不转码、不改假后缀、不回退低分辨率缩略图。暂停时恢复 Pinterest 原点击行为，清除勾选并取消当前任务。
- 验证结果：TypeScript 检查与 MCP bundle 构建通过；19/19 Node 自动测试通过，覆盖 originals-only URL、MIME 后缀、原生 WebP 保留、无 originals 跳过、队列重试和暂停控件结构。
- 未解决事项：更新后的 Chrome 扩展需由用户在 `chrome://extensions` 手动点击“重新加载”，再以同一 Pin 验收下载文件的尺寸、MIME 与后缀；整板到 Codex 导入仍未完成端到端验收。
- 回滚提示：回退本轮扩展提交并在 Chrome 重新加载即可；现有 Inbox 素材不会被自动删除。

## 2026-08-24 — Pinterest Inbox MVP 候选版

- 任务目标：将 Phase 0 假数据原型升级为 macOS + Chrome 可运行的本地素材闭环，覆盖单张、多选、整板下载、Inbox 监听、Codex 浏览和工作区安全导入。
- 修改文件：新增 `extensions/pinterest-inbox-downloader/`；新增 MCP `src/inbox.ts`、`src/workspace.ts` 与对应测试；重写 `src/server.ts` 和 `assets/pinterest-panel.html`；删除假数据模块；更新插件清单、包脚本、运行时 bundle、README 与 SPEC。
- 关键决策：不接 Pinterest API 或账号凭证；Chrome 权限限定为 `downloads` 和 Pinterest 页面；下载固定进入 `Downloads/PinterestInbox`；缩略图与随机工作区令牌只进入 UI 私有 `_meta`；MCP 导入只接受已索引资产，目标固定在工作区 `references/pinterest` 内；不新增生产依赖或常驻系统服务。
- 验证结果：TypeScript 与 bundle 构建通过；15/15 Node 自动测试通过；真实 macOS `sips` 缩略图通过；380px 面板浏览器实测通过，页面滚动 604px 后 sticky 顶栏仍为 `top=0`，单击 Pin 后进入“✓ 已加入当前任务”；隔离的 Chrome for Testing 已在真实 Pinterest 首页成功加载 Manifest V3 扩展并注入单张/多选/整板控制面板，未触发实际下载。
- 未解决事项：尚未在用户登录态执行真实多选与整板下载；Codex 宿主是否提供 `roots/list`、`ui/message` 是否在当前桌面版本成功以及最终图片读取仍需新任务内人工验收；MVP 在验收前仅标记为候选版。
- 回滚提示：禁用或卸载 Chrome 扩展、禁用 Codex 插件，或回退本分支提交即可；Inbox、已导入素材和缩略图缓存不会被程序自动删除，缓存可单独清理。

## 2026-08-22 — 建立 Private GitHub 主仓库

- 任务目标：创建以当前插件为核心的 Private GitHub 仓库，并建立可持续版本迭代与开发流程。
- 远程仓库：`https://github.com/Panda-LJW/pinterest-reference-panel`，可见性为 Private。
- 修改文件：根 README 与 LICENSE、`.github/workflows/ci.yml`、`.gitignore`、精选预览图及版本日志。
- 关键决策：`main` 保持可安装状态，后续功能使用 `codex/*` 分支和 Pull Request；提交自包含运行时 bundle，排除依赖、Playwright 临时文件和原始测试截图。
- 验证结果：首次推送前 4/4 自动测试通过，npm audit 为 0 漏洞，插件清单验证通过；远程 CI 待首次 push 后确认。
- 未解决事项：Pinterest OAuth、真实账户数据和下载仍不在 Phase 0 范围内。
- 回滚提示：本地可移除 `origin`；远程仓库可在 GitHub 设置中归档或删除，删除前应先保留本地克隆。

## 2026-08-22 — 顶部导航与内容滚动分层

- 任务目标：将 Pinterest 品牌栏和 Pins / Boards 标签栏固定在组件最上层，下方素材滚动时顶部保持不动。
- 修改文件：`assets/pinterest-panel.html`、结构测试与 `SPEC.md`。
- 关键决策：使用 `position: sticky` 保留正常文档占位，避免固定定位遮住首排 Pin；移除会阻断 sticky 的外层 `overflow: hidden`；顶部层使用不透明背景、分隔线、轻阴影和 `z-index: 30`。
- 验证结果：4/4 自动测试通过；380 × 700 浏览器实测中，页面由 `scrollY=0` 滚动至 `456` 后顶部仍为 `top=0`，第一张 Pin 从 `187px` 移至 `-269px`；控制台 0 错误。
- 未解决事项：用户当前打开的本地预览页需要刷新后查看更新效果；Codex 新任务仍需重新加载更新后的插件缓存。
- 回滚提示：恢复原始 header/nav 层级和 `.shell` 内边距、overflow 即可回到随页面滚动的行为。

## 2026-08-22 — Phase 0 本地 UI 原型

- 任务目标：验证 Pinterest 素材抽屉能否作为 MCP Apps UI 在当前 Codex 桌面端渲染，并观察宿主实际放置位置。
- 修改文件：插件清单、本地 marketplace、MCP 服务、假数据、单文件 UI、测试与项目文档。
- 关键决策：使用本地 stdio MCP；仅暴露两个只读工具；UI 使用内嵌 HTML/CSS/JS，不引入前端框架；不接 Pinterest 账号。
- 验证结果：TypeScript 类型检查通过；4/4 自动测试通过；npm audit 为 0 漏洞；MCP stdio 往返、工具调用和 UI 资源读取通过；380px 双列与 235px 单列浏览器渲染通过且控制台 0 错误；插件清单验证通过；安装后缓存 smoke test 通过。
- 体积处理：初次安装缓存包含开发依赖（49 MB）；改为单文件运行时 bundle 和仓库级 workspace 后，重装缓存降至 780 KB，且不含 `node_modules`。
- 未解决事项：Codex 是否将组件显示在右侧区域，需要在当前宿主版本中人工确认。
- 回滚提示：移除 `pinterest-reference-panel@personal`，删除本地 marketplace 注册，再删除本仓库新增文件即可。
