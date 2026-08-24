# 变更日志

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
