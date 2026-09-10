# 变更日志

## 2026-09-10 — README 真实 Pinterest 场景替换

- 任务目标：根据公开展示反馈，移除上一版偏合成感的抽象演示素材，改用真实 Pinterest 公开搜索页面与真实公开 Pin 画面，让访问者能直接判断下载器和 BoardFlow 瀑布流的实际使用场景。
- 修改文件：更新 `README.md`；替换 `docs/images/boardflow-hero.png`、`boardflow-downloader.png`、`boardflow-dashboard.png`、`boardflow-boards.png` 和 `boardflow-preview.png`。`boardflow-downloader-panel.png` 继续使用当前 0.4.3 扩展的实际控制面板截图。
- 关键决策：Pinterest 场景取自公开关键词搜索结果，浏览器中加载并核对当前 0.4.3 `Pinterest BoardFlow Downloader`，只临时勾选两张公开 Pin，没有触发下载、保存、关注或其他 Pinterest 写操作。提交图遮挡账号入口，不显示用户名、邮箱、私人 Board、个人收藏或本机路径；BoardFlow 本地界面在隔离演示环境中使用同组公开 Pin 画面，不读取用户素材库。README 同时注明第三方缩略图仅用于界面说明、版权归各自权利人所有。
- 验证结果：使用 Playwright 在真实浏览器视口生成并逐张检查成品 PNG；README 图片引用、PNG 类型/尺寸、可识别文本元数据与 Git 差异检查通过。根 `npm test` 完整通过：Codex 插件 62/62、Chrome 下载器 33/33，共 95/95。
- 未解决事项：合并后仍需复核 GitHub README 的最终渲染与图片加载；截图固定保留当时的公开搜索结果，不代表 Pinterest 对相关内容的推荐或背书。
- 回滚提示：回退本条对应提交即可恢复上一组 README 展示图；不影响插件、Chrome 扩展、Pinterest 账号或本地素材库。

## 2026-09-10 — GitHub README 界面展示图

- 任务目标：为首个公开版的 README 增加更有吸引力的主视觉与功能模块截图，让访问者能快速看懂“Pinterest 下载 → 本地整理 → Board 瀑布流 → Codex 有序参考”的完整流程。
- 修改文件：更新 `README.md`；新增 `docs/images/boardflow-hero.png`、`boardflow-downloader.png`、`boardflow-downloader-panel.png`、`boardflow-dashboard.png`、`boardflow-boards.png` 和 `boardflow-preview.png`。
- 关键决策：截图使用当前生产版本的本地面板与 Chrome 扩展界面，通过本地 mock API 只注入合成的抽象视觉素材；不使用用户 Pinterest 账号、私人 Board、真实收藏、真实下载记录或本机文件路径。README 显式声明该边界，图片不内嵌可识别用户的文本元数据。
- 验证结果：用 Playwright 在 1280px 与 1600px 实际浏览器视口生成并逐张检查 6 张 PNG；尺寸与类型检查通过，README 中的图片路径均指向已存在文件，`git diff --check` 通过。根 `npm test` 完整通过：Codex 插件 62/62、Chrome 下载器 33/33，共 95/95。
- 未解决事项：需在推送后检查 GitHub README 的实际排版与图片加载；本轮不改动运行时功能或版本号。
- 回滚提示：回退 README 展示区并删除本轮 6 张 `boardflow-*.png` 即可；不影响插件、Chrome 扩展或用户素材库。

## 2026-09-09 — Pinterest BoardFlow 公开品牌更新

- 任务目标：将公开名称更新为更易理解和传播的 **Pinterest BoardFlow for Codex**，同时在仓库、Codex 插件和 Chrome 扩展中明确表达 Pinterest 下载器、Board 瀑布流看板与 Codex 视觉参考插件三项核心能力。
- 修改文件：更新根 README、SPEC、UX 方案、版本与锁文件；更新 Codex 插件清单、Skill、MCP 工具文案、两套素材面板、对应测试和构建后的运行时 bundle；更新 Chrome 扩展 manifest、面板标题、Offscreen 标题和扩展 README。仓库版本与 Codex 插件升至 0.4.1，Chrome 下载器仅因显示名称变化升至 0.4.3。
- 关键决策：公开品牌使用 `Pinterest BoardFlow for Codex`，Codex 内显示 `Pinterest BoardFlow`，Chrome 内显示 `Pinterest BoardFlow Downloader`；GitHub 仓库目标 slug 为 `pinterest-boardflow-for-codex`。为避免破坏既有安装和素材，保留内部插件 ID `pinterest-reference-panel`、MCP 工具名、代码目录、缓存路径与 `PinterestInbox` 下载/长期库目录，不迁移或重命名用户文件；旧称 `Pinterest Inbox` 继续作为插件入口兼容别名。
- 验证结果：根 `npm test` 完整通过，Codex 插件 62/62、Chrome 下载器 33/33，共 95/95；TypeScript 检查和 MCP runtime bundle 构建通过。`npm install --package-lock-only` 审计 127 个包且 0 个已知漏洞；插件清单通过 plugin-creator 校验，插件 Skill 通过 skill-creator 校验。0.4.3 未改变下载权限、队列、格式、路径或网络范围，因此沿用 0.4.2 已完成的真实 Pinterest/Chrome Downloads 行为验收，本轮不重复下载用户素材。
- 未解决事项：已加载的 Codex 任务不会热更新插件名称，完成本机重装后仍需新建任务查看新名称；已加载的 Chrome 扩展需要在 `chrome://extensions` 手动重新加载，才会从旧名称切换到 0.4.3。GitHub 仓库重命名、公开 Release 与外部 URL 验收作为本轮发布动作在合并后完成。
- 回滚提示：代码可回退到公开 `v0.4.0`；GitHub 仓库可改回旧 slug。内部 ID 与存储目录未变，回滚不涉及素材迁移或删除；发布前隐私历史 bundle 仍保留在本机忽略目录。

## 2026-08-30 — 本地右侧瀑布流与绝对路径复制

- 任务目标：绕开当前 Codex 宿主未开放 `uploadFile` / `setWidgetState`、MCP Apps UI 只能出现在对话内以及 `ui/message` 会占用一轮对话的限制，把 Pinterest Inbox 主体验改为 Codex 右侧内嵌浏览器中的本地瀑布流；用户单击图片后只复制长期库原文件的真实绝对路径，再手动粘贴进当前对话。
- 修改文件：新增 `src/local-panel-server.ts` 与 `assets/local-panel.html` / `local-panel.css` / `local-panel.js`；扩展 `src/inbox.ts`、`src/server.ts`、本地网页/MCP/Inbox/结构测试和运行时 bundle；恢复旧 `pinterest-panel.html` 的工作区导入回滚链路；同步更新插件清单、package 描述、`.gitignore`、README、SPEC 与日志索引。
- 关键决策：本地 HTTP 与 MCP 同进程复用唯一 `InboxService`，只绑定 `127.0.0.1` 动态端口；API 使用 HttpOnly/Strict 会话 Cookie、随机 CSRF 头、精确 Host/Origin、无 CORS 和安全响应头。浏览器只能提交已索引 `assetId`，服务端重新执行真实路径边界检查后用无 shell 的 `/usr/bin/pbcopy` stdin 写入 canonical path；公开响应不返回 `sourcePath`，底层文件系统错误也统一脱敏。主路线不复制、不转码、不修改素材、不自动发消息；旧 MCP 工作区导入面板仅作回滚备用。
- 稳定性收口：缩略图在前后端均限制为最多 4 路并对同素材请求去重，前端分别给常规 API 8 秒、缩略图 20 秒、手动完整刷新 120 秒超时，避免慢图误报离线；版本变化或手动刷新时清理失败/Blob 缓存，且旧 epoch 缩略图请求无论成功还是失败都不得污染新页面；快速切换 Pins、Boards 或图版时用请求 generation 与视图快照丢弃过期响应；`list_pinterest_inbox(forceRescan)` 只重扫长期库，不再隐式搬运 Downloads。MCP 启动窗口放宽到 120 秒，启停错误对工具结果使用固定脱敏文案。stdio EOF、SIGINT/SIGTERM 和重复关闭均走幂等清理，停止期间再次打开会等待旧 HTTP 服务完全释放，不会重叠两个网页实例。活动 HTTP 连接 500ms 后强制断开，已经启动的 `sips` / `pbcopy` 由各自超时有界收尾。
- 验证结果：TypeScript、bundle 构建和完整仓库 **45/45** Node 自动测试通过，包含 Linux CI 可执行的回环 Host、会话、CSRF、Origin、超大请求体、任意路径、启动错误脱敏、分页、watcher、有活动请求时的并发停止/重开、关闭回调短暂失败后重试、stdio EOF 与 SIGTERM 端口释放测试。真实 `~/Pictures/PinterestInbox` 页面读取 38 张素材，400px 窄栏 Pins/Boards、sticky 顶栏和 0 条浏览器日志通过；隔离临时库对 Board A 注入 750ms 延迟后连续切换到 Board B，最终只显示 B。真实点击两次“个人网站视觉参考”均复制同一长期库 WebP 路径，前后大小 585,196 bytes、mtime、inode 和 SHA-256 `07e5b17984ce445a9a783d829d64698e0b184ac06fc9d0544444388897f603af` 完全不变，Codex 已直接读取该文件。插件清单通过官方校验，并重装为 `0.4.0+codex.20260829183930`；运行时 bundle、MCP 配置与本地网页资产同安装缓存逐字节一致，从该缓存直接启动的隔离 smoke test 确认网页返回 200、标题正确、启动与停止工具均正常。最终用户验收在新任务中完成：从右侧瀑布流点击素材后，绝对路径成功进入剪贴板并随正常需求粘贴发送；Codex 正确读取对应 Inbox PNG，识别其构图与视觉元素，并直接以该原图完成真人化图片生成，期间没有工作区副本、二次压缩或自动消息。
- 未解决事项：本轮 MVP 验收范围内无阻塞项。输入框原生附件卡片仍受 Codex 宿主未开放文件注入接口限制，因此正式主路线保持为“点击复制绝对路径 → 用户按 `⌘V` 随需求发送”；旧 MCP 面板继续作为可回滚备用。
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

## 2026-09-06 — 复制交互与请求状态优化

- HASH：`fe280e60df85`。
- 任务目标：在梳理 README、SPEC、历史记录和当前实现后，优化已验收的本地网页引用流程，解决复制时整页重建、正文读取超时失效以及刷新误报成功的问题。
- 修改文件：`plugins/pinterest-reference-panel/assets/local-panel.js`、新增 `plugins/pinterest-reference-panel/tests/local-panel-ui.test.mjs`，以及 README、LOG、LOG-INDEX。浏览器探针、测试输出和截图保存在已忽略的 `output/playwright/`，不作为产品运行依赖。
- 关键决策：复制操作只更新目标卡片与上次成功卡片的按钮状态，并通过 `aria-busy` 表达等待；不重新渲染内容区。统一请求函数等待正文读取完成后才清理超时，覆盖 JSON 和缩略图两条链路。分页读取只有当前请求成功应用时才返回成功结果，手动刷新据此显示成功提示，失败或过期响应不覆盖已有错误。继续使用现有原生 JavaScript，不修改 SPEC、公共 API、数据格式、下载器、入库规则或生产依赖。
- 问题复现：新增 6 项行为回归测试在修改前为 2 通过、4 失败，覆盖 JSON / 图片正文卡住、正常请求计时器回收、刷新失败、刷新成功和刷新期间切换视图。修改后全部通过。真实浏览器对比旧版与新版，在 30 张首屏素材下，单次复制的内容区替换次数由 2 变为 0，保留的原卡片和图片节点由 0 变为 30；旧版键盘焦点丢失，新版保持。两版此次测得的滚动位置均为 1526px，新版没有引入滚动跳动。
- 自动验证：`npm test` 完整通过，插件 38/38、Chrome 扩展 13/13，共 51/51，包含 TypeScript 检查和 bundle 构建；`node --check plugins/pinterest-reference-panel/assets/local-panel.js`、`git diff --check` 通过，运行时 bundle 与提交版本一致。
- 实际运行验证：隔离库 36 张测试图片、2 个图版，使用真实 InboxService、HTTP 服务和 macOS 缩略图生成；浏览器检查通过待复制时连续按 Enter 只发送 1 次请求、成功标记切换、复制失败恢复、刷新失败保留错误、后续刷新恢复、分页显示 36 张、图版过滤显示 18 张。400px 与 1200px 宽度无横向溢出，400px 截图已目视检查。控制台仅出现主动注入的 2 条 HTTP 503，未观察到其他错误。
- 素材与清理：剪贴板采用测试替身，记录了 6 次服务端解析后的临时路径；未写入系统剪贴板或操作真实 PinterestInbox。检查的首屏 30 个临时源文件前后 SHA-256 一致。验证后已关闭测试浏览器及两个临时 HTTP 服务，释放唯一 watcher，并清理临时素材目录。
- 未解决事项与人工验收：已安装的 Codex 插件缓存尚未更新；README 仅将本轮标为待用户验收。使用更新后的插件在新任务中打开面板，滚动到中部，用鼠标或 Enter 复制一张图片，确认图片不闪回占位、滚动与焦点保持，再按 `⌘V` 核对引用路径。真实 Chrome 下载及系统 `pbcopy` 本轮未重新验收，它们的实现没有改动。
- 回滚提示：仅恢复本轮修改前的 `assets/local-panel.js` 并同步对应插件缓存即可回退运行行为；新增测试和文档可单独回退。不涉及素材迁移、删除或配置恢复。

## 2026-09-07 — 参考篮与素材工作台整体优化

- HASH：`f22d3fc337f5`。
- 任务目标与授权：用户要求整体优化插件使用体验，明确确认“当前任务参考篮、完整素材搜索和大图预览，保留复制路径；新增本地 HTTP／MCP 接口，原素材与现有格式保持不变”，并追加“UI 也记得一块做做”。沿用已确认的技术路线施工，没有扩展到 Pinterest 账户操作、Chrome 下载器重构或私有附件注入。
- 修改文件：新增 `src/references.ts`、`tests/references.test.mjs`、`skills/pinterest-references/SKILL.md`、`docs/UX-PLAN.md`；修改 `src/inbox.ts`、`src/local-panel-server.ts`、`src/server.ts`、`assets/local-panel.html/css/js`、插件 manifest 与运行 bundle；扩充 HTTP、MCP、UI 行为测试并更新结构断言；同步 SPEC、README 和日志。上一轮 `fe280e60df85` 的复制局部更新与正文超时修复保留，施工前未提交改动快照在 `output/ux-20260906/before/`。
- UI 与流程：原生 HTML/CSS/JavaScript 素材工作台，完整本地库搜索、图版筛选、最新/最早/标题排序；点击图片打开原图，独立按钮加入参考，卡片明确显示“复制”。预览支持方向键、Escape、保留复制按钮焦点及关闭后恢复焦点。底部参考篮提供最多 10 张有序图片、编号、移除、向前/后移动、清空与批量路径复制。系统深色、极窄单列、窄栏双列与宽窗口多列均适配；底栏按实际高度预留空间。图片节点在复制与分页时复用；缩略图近视区加载、最多 4 并发，脱离 DOM 时取消观察；原图切换/关闭会取消过期读取。
- 会话与接口：首次 `open_pinterest_inbox_web` 返回独立随机 `referenceSessionId` 和带 `?ref=` 的 URL，显式传回 ID 可续用。新增只读 `get_pinterest_reference_selection` 返回同篮有序原图路径与 revision；HTTP 选择用 revision 防止覆盖并发修改。会话依赖显式能力标识，不冒充宿主任务身份认证、不推断“最近参考篮”。内存最多 64 会话，关闭 HTTP 保留，MCP 重启失效。每个端口使用不同 Cookie 名，浏览器不接收源文件路径。
- 文件安全与兼容：选择前检查实时文件状态与索引一致；选择后保留文件 dev/ino/大小/mtime/ctime 指纹，读取时复核路径及指纹。任一图片变化或丢失都阻止整组引用，重新排序不会静默接受替换图。原图预览保持原字节，单图上限 64 MiB；更大文件仍可复制路径。共享原有唯一 InboxService，不新增 watcher、数据库、持久化格式、生产依赖；原有下载、入库、单张路径复制与旧 MCP 工作区导入保持兼容。文件状态复核不构成后续模型读文件的原子快照。
- 自动验证：`npm test` 59/59（插件 46、Chrome 扩展 13），包含 TypeScript 与 bundle 构建。新增覆盖同进程会话隔离、并发 revision、空/重复/超限/未知 ID、变更/缺失/符号链接逃逸、全库搜索规范化与分页、原图字节一致、批量 canonical 路径顺序、HTTP→MCP 同篮读取、HTTP 关闭后参考篮保留。UI 行为测试覆盖连续点击排队、冲突取消后续操作、慢搜索不能覆盖新查询；原有正文超时、刷新失败和过期响应用例继续通过。`node --check` 与 `git diff --check` 通过。
- 浏览器验证：用真实 InboxService、HTTP 与 macOS 缩略图生成，使用用户长期库图片的 36 个临时副本、2 个测试图版；不操作真实素材与系统剪贴板。选 3 张、调序、移除、清空、批量复制、原图展示、键盘翻页与焦点恢复通过。复制后保留全部 30 个卡片和图片节点；分页 30→36、图版过滤 18 张、搜索唯一目标通过。延迟旧搜索响应不覆盖新查询；注入 503 时保留 30 张现有卡片和真实错误，恢复后刷新成功；断线提示和自动重连通过，页面脚本错误 0（主动注入的网络失败除外）。235px/400px/1200px 的页面宽度分别等于视口，列数 1/2/4。两个参考会话独立编辑，跨端口打开后原页面 API 仍返回 200。截图与探针保存在 `output/ux-20260906/`，最终截图已目视复核。
- 发现与修正：浏览器验证发现预览复制时禁用按钮会丢失焦点，已用 `aria-busy` 保持焦点；窄预览信息与操作改为上下排列；复制用明确文字。初次测试失败分别来自待同步的旧接口断言、遗漏导入和测试正则语法，修正后全量通过。浏览器故障注入脚本曾使用 CLI 执行环境不可用的 `URL/setTimeout`，改为字符串匹配与可控 Promise 后重跑；该问题不属于产品运行错误。
- 安装验证：通过 plugin-creator manifest 校验和 skill-creator 技能校验（系统 Python 缺 PyYAML，使用已有 agent-reach Python 环境，未安装依赖）。确认 marketplace `personal` 指向当前仓库后，用官方缓存后缀助手更新至 `0.4.0+codex.20260906162600`，执行 `codex plugin add pinterest-reference-panel@personal`。隔离空库启动已安装缓存，7 个 MCP 工具可发现、网页返回 200、空篮错误可恢复；bundle、3 个 UI 文件和技能说明与工作区逐字节一致。
- 验证清理：最终 36 个临时素材的 SHA-256 与测试前一致；剪贴板测试替身记录 6 次复制请求，未写系统剪贴板。测试浏览器、临时 HTTP 服务及其 watcher 已关闭，临时素材目录已清理；只保留忽略目录中的探针、报告和截图。
- 未解决事项与人工验收：README 保留“待用户验收”。请在新的 Codex 任务打开 Pinterest Inbox，选 2–3 张后说“使用选中的参考图，按顺序分析”，核对实际读取的原图与顺序；重新打开同篮应保留选择，另一个任务首次打开应为空。真实 Chrome 下载与 macOS `pbcopy` 本轮未重新验收；新的原图引用不等同于输入框原生附件显示。插件进程重启后需重新选择。
- 回滚提示：以 Git 基线 `1334832` 恢复本轮涉及的源码、UI、manifest 与 bundle，并将 `output/ux-20260906/before/local-panel.js` 恢复回去保留上一轮修复；新增参考模块/技能可单独移除，更新缓存后重新安装。执行回滚前先检查期间新增的用户改动，不能整仓库 reset。无需迁移或恢复用户素材、数据格式及系统配置。

## 2026-09-07 — 插件打开入口纠偏

- HASH：`890920c2c7cd`。
- 任务目标：针对用户截图中 `@Pinterest Inbox 打开项目` 被执行为右侧打开 README 的反馈，修正插件的入口识别与完成条件。
- 事实定位：只读检查“打开 Pinterest Inbox 项目”任务的执行记录，首轮使用项目列表和文件预览，没有调用插件启动工具；第二轮先尝试 CUA 操作 Codex 自身，之后才调用 `open_in_codex` 打开浏览器。截图只证明入口误判，不证明 HTTP 服务故障。当前老任务暴露的仍是旧版 6 个工具，不能把更新缓存等同于老任务热更新。
- 修改文件：插件 `skills/pinterest-references/SKILL.md`、`.codex-plugin/plugin.json`、`src/server.ts` 及重建的 `dist/server.bundle.js`；README 增加待验收说明。施工前这 4 个文件的快照在 `output/entry-20260907/before-*`，保留上一轮未提交实现。
- 关键决策：使用统一上下文规则——已选择或提及 Pinterest Inbox 时，未指定其他对象的打开意图指向正在运行的素材面板；用户明确要源码、文档或项目管理时尊重该请求。将流程明确为先调用插件启动工具，再实际调用 `open_in_codex(target.type=browser, url=完整返回地址, placement=right)`。仅服务就绪、文件预览或返回 URL 均不能报告面板已显示；工具返回 queued 时准确报告排队。未引入工具别名、私有 UI 自动化或第二套 watcher，没有修改协议、素材或数据格式。
- 验证结果：TypeScript/bundle 构建通过；MCP 集成与生命周期 5/5；现有复制相关 HTTP、参考篮和 UI 回归 19/19（使用剪贴板替身，不能据此认定用户粘贴问题已解决）；插件和技能验证通过。缓存启动检查确认新入口说明经 MCP initialize 和工具结果实际送达，7 个工具可发现、HTTP 返回 200、源文件与安装缓存一致。
- 安装：保持版本前缀，用 plugin-creator 缓存后缀助手更新至 `0.4.0+codex.20260906164832`，从当前仓库对应的 `personal` marketplace 重装。未修改另一个正在运行任务的源码、进程或选图状态。
- 未解决事项：模型在新任务中对原始短提示 `@Pinterest Inbox 打开项目` 的路由仍需实际验收，本轮没有自动创建新任务或声称已完成该模型验收。用户随后补充“复制方面也有问题”，已询问具体操作与症状；在得到复现信息前不将现有测试通过解释为复制问题修复，也不操作用户系统剪贴板。
- 回滚提示：恢复本轮 4 个文件的 before 快照，更新缓存后重装即可回退入口说明；不需要回滚参考篮、UI、素材或系统配置。

## 2026-09-07 — 操作动效与连续交互

- HASH：`9c49fd19182e`。
- 任务目标：响应用户“加点动效吧，现在操作起来太僵硬了”，在现有素材工作台上增加有状态依据的短动效，不更换视觉体系、框架或生产依赖。
- 修改文件：`assets/local-panel.css`、`assets/local-panel.js`、插件 manifest 缓存后缀；README、LOG 与 LOG-INDEX。本轮 UI 和 manifest 的 before 快照在 `output/motion-20260907/before/`，上一轮入口纠偏、参考篮与复制逻辑保留。
- 关键决策：CSS 负责按钮按压、标签指示条、搜索聚焦、图片悬停、卡片错峰进入、帮助与遮罩过渡；原生 Web Animations API 负责确认选中后的按钮/数量轻弹、参考篮增减与调序位移、原图进入及预览开关。常用时长 120/180/220ms，关闭 130ms，卡片错峰延迟最多 108ms；动画只使用轻量位移/缩放/透明度和控件颜色，不阻塞选图或复制请求，也不提前展示操作成功。
- 连续操作：每个节点的新动画会取消旧动画；参考篮从当前可见位置计算位移，快速选图/调序可衔接。预览关闭携带独立代次，关闭途中翻图会撤销旧关闭，防止新图被误关。Escape 连按仍只完成一次关闭，保留原生对话框焦点恢复。系统减少动态效果生效时停止正在运行的 JS 动画，CSS 动画与悬停缩放也禁用，关闭不再等待退场动画。
- 自动验证：`node --check`、`git diff --check` 通过；既有 UI 行为和结构检查 14/14 通过。没有为静态视觉样式新增镜像断言；通过真实浏览器检查新增异步退场与中断行为。HTTP、MCP 和入库代码未改动，本轮未重复整个后端测试集。
- 浏览器验证：400px 下连续选 3 张后数量/顺序正确，参考篮调序捕获到正负 73px 位移，移除后剩 2 张；快速前后翻图最终停在正确图片。关闭过程中继续翻图保持面板打开，Escape 连按后关闭并恢复触发按钮焦点。复制成功时确实触发反馈动画，30 个素材卡片保持原节点。切换减少动态效果后，新增 JS 动画调用 0、运行中动画 0、卡片 CSS animation 为 none，选图/预览/关闭仍正常。235/400/1200px 均无横向溢出，页面脚本错误 0。结果在 `output/motion-20260907/browser-results.txt`，操作演示使用临时素材副本与剪贴板替身。
- 安装验证：插件 manifest 校验通过，经 cachebuster 助手与 `codex plugin add pinterest-reference-panel@personal` 更新至 `0.4.0+codex.20260906170318`；隔离空库启动安装缓存，7 个工具、HTTP 200 与入口说明正常，UI/技能/bundle 与工作区逐字节一致。
- 演示与清理：录制并导出 400×800、9.52 秒 H.264 操作演示 `output/motion-20260907/motion-demo.mp4`，实际截图及视频抽帧已检查。36 个测试副本的 SHA-256 前后一致，剪贴板替身记录 2 次操作；临时服务、watcher、浏览器和素材目录已清理，保留忽略目录中的验证报告与演示。
- 未解决事项：新任务中实际动效观感待用户确认，README 仅记录为待验收。此前用户反馈的复制故障尚未提供具体症状；本轮只添加成功反馈，不宣称修复剪贴板或粘贴问题，不写入用户系统剪贴板。旧任务已加载的插件运行时不会因缓存更新自动替换。
- 回滚提示：恢复本轮 before 的 CSS、JS 和 manifest 后更新缓存并重装即可；无服务端接口、素材或数据格式迁移。

## 2026-09-07 — 复制粘贴成功误报修复

- HASH：`61c5092cbf0c`。
- 任务目标：响应用户“很多在提示复制成功后都无法粘贴”，检查系统实际剪贴板与 UI 成功判断，完成可以复现和核对的修复。
- 修改文件：`src/local-panel-server.ts`、`assets/local-panel.js`、新增 `tests/clipboard.test.mjs`、扩展 `tests/local-panel-ui.test.mjs`、生成 bundle、manifest 缓存后缀；README、SPEC 的执行细节、LOG 与 LOG-INDEX。代码和 manifest 的修改前快照位于 `output/clipboard-20260907/before/`。原参考篮、界面动效、入口说明和未提交修改均保留。
- 根因证据：本机 `/usr/bin/pbcopy` 手册说明输入输出编码由 locale 决定。Swift/AppKit 诊断在内存保存原剪贴板所有类型后，对 ASCII、中文及 emoji 多行文本测试 `C.UTF-8`、`C`、`en_US.UTF-8`。`C` 下中文和 emoji 两例均退出 0，但 AppKit 原生文字为空、UTF-8 `pbpaste` 输出 0 字节；其余 7 例一致。证明旧实现“仅看退出码”的成功判定不足；没有据此声称用户每次失败的宿主环境都已定位。证据：`locale-probe.swift`、`locale-results.txt`。
- 关键决策：保留原有系统工具、stdin、纯文本 canonical path 和公开 API 数据形状；显式设置三个 locale 变量为 `en_US.UTF-8`。写后用 `pbpaste -Prefer txt` 读回，与预期 UTF-8 字节严格比较；总期限 5 秒，读取上限 16 KiB，超时终止本次子进程，错误统一返回不含路径或剪贴板内容的提示。不自动重试，以免再次覆盖其他应用刚复制的内容。无新生产依赖、常驻进程、素材转换或宿主输入框注入。
- UI 修复：沿用现有 pending 状态，在本页任何单张或批量复制进行中防止其他复制按钮重叠提交；新复制先清掉上一张成功对勾，失败后不会保留旧对勾；单张核对响应 status/assetId，批量核对 status/完整数量之后再提示成功。此处只是已有复制按钮的局部防重入，不变更 HTTP/MCP 并发或生命周期模型。
- 自动验证：TypeScript、bundle 构建、完整 `npm test` 共 **75/75**（插件 62、扩展 13）通过；25 项剪贴板与 UI 回归覆盖 UTF-8 参数、空/不同/截断/超大读回、写入/读取/启动失败、两个子进程超时、无效输入、重复失败清标记、异常成功响应、单张与批量互斥及完整数量核对。子进程回归使用替身，可在 CI 运行且不触碰 CI 剪贴板。`node --check`、`git diff --check` 通过。
- 真实运行验证：临时库放入 10 个含中文、空格、括号、重音字符及 emoji 路径的图片副本；真实服务以 `LC_ALL=C LANG=C LC_CTYPE=C` 启动，未注入剪贴板替身。Playwright 操作面板的复制按钮，使用键盘 `Meta+V` 粘贴到临时 textarea 并逐字核对：10/10 单张、预览复制、10 张有序批量复制及快速操作后粘贴全部通过。快速操作只有 1 个复制请求；注入 503 后旧对勾清除，10 个卡片节点保留，页面脚本错误 0（控制台唯一 HTTP 503 为主动注入）。报告：`browser-results.txt`。
- 安装与清理：已重装 `personal` 缓存 `0.4.0+codex.20260907021021`；隔离缓存 smoke 验证 7 个工具、HTTP 200、入口说明与空参考会话，bundle/三份 UI/技能文件同工作区逐字节一致。真实测试结束后 AppKit 核对最后剪贴板与预期一致，恢复测试前所有已保存剪贴板类型；未打印或落盘原剪贴板内容。10 个临时源文件 SHA-256、大小、mtime 不变；临时服务、watcher、浏览器与素材副本已关闭/清理，结果在 `browser-files.json`。Swift 仅用于忽略目录中的诊断，不进入生产插件。
- 未解决事项与人工验收：已证明上述编码故障和 UI 误报得到修复，但本轮没有操作 Codex 对话输入框；用户需要在新任务启动新版面板，复制中文标题素材，回到该任务按 `⌘V` 验收宿主接收。已有任务不会热替换旧插件。README 保持待宿主验收状态。系统剪贴板仍遵循最后一次复制覆盖前一次的正常行为，核对仅针对本次写入完成时的内容。
- 回滚提示：仅恢复本轮 before 的服务端、UI、测试和 manifest，删除本轮新增剪贴板测试，再重新构建/更新缓存即可回退；不能用整仓库重置覆盖此前的参考篮与动效修改。无需恢复素材或迁移数据。

## 2026-09-07 — 帮助说明弹层遮挡修复

- HASH：`a65f8eb1a6d6`。
- 任务目标：修复用户截图中“最新优先”控件显示在帮助说明内容上方的问题，确认帮助关闭后仍可排序。
- 修改文件：仅 `assets/local-panel.css` 的 `.help-menu` 增加明确的局部层级及原因注释，manifest 更新缓存后缀；README、LOG 与 LOG-INDEX。施工前 CSS/manifest 快照在 `output/help-overlay-20260907/before/`。没有修改 JS、复制、排序接口、参考篮或素材。
- 根因与证据边界：帮助容器虽为 relative，但没有明确 z-index，弹层会与后置的定位标签/表单控件竞争绘制顺序。Chromium 实测在 235/320/400px、普通动效及减少动态效果下，说明区域的命中采样被 `pinsTab` / `boardsTab` / 标签文字穿过；截图中表现为排序控件穿过，该具体原生控件绘制差异未在测试浏览器完全复现。before 截图目视确认标签文字与说明标题重叠。本轮修复统一提升帮助容器的局部层级，覆盖完整说明及其点击区域；不依赖短暂动画产生的层叠上下文。
- 实施：`.help-menu` 设 `z-index:1`，仍受现有 sticky 顶栏层级管理，不使用巨大的全局层级、不更换原生 select 或 details，也不增加运行依赖。
- 验证：235/320/400/620/1200px × 普通/减少动态效果共 10 组，在入场动画结束后扫描弹层内部命中目标，全部无外部控件穿透，弹层和页面均无横向溢出。400px 的前后截图均已目视检查。关闭帮助后依次选择最早/标题/最新，三个值与 API sort 参数一致且 HTTP 200；点击说明覆盖的排序控件位置不会让排序获得焦点，帮助仍可用按钮关闭。页面脚本错误 0，既有结构检查 5/5、`git diff --check` 通过。本次是局部 CSS 修复，未新增镜像样式单测或重复后端全套测试。证据位于本轮 output 目录的 `before-layers.txt`、`after-layers.txt`、`sort-results.txt`、前后 PNG。
- 安装验证：已更新本机 `personal` 插件缓存至 `0.4.0+codex.20260907030235`，缓存 smoke 确认三份 UI、bundle、技能与工作区逐字节一致，7 个 MCP 工具和 HTTP 200 正常。隔离空库服务、watcher、浏览器和临时目录已清理；本轮未操作真实素材或系统剪贴板。
- 未解决事项与人工验收：需要在新任务打开面板，点击问号，确认排序按钮不再盖住说明；关闭说明后切换“最早优先”“按标题”检查实际素材顺序。已有面板仍由旧插件进程提供静态资源，不会因重装自动刷新。README 仍标为待宿主观感验收。
- 回滚提示：恢复本轮 before CSS 和 manifest，再更新缓存重装即可；无需构建服务端或回滚上一轮剪贴板修复。

## 2026-09-07 — 下载器界面与任务反馈升级

- HASH：`ff3c71f26c09`。
- 任务目标：响应用户“把 pinterest 图片下载器也升级优化一下”，优化现有 Chrome 扩展的面板、多选、任务进度与取消反馈，保持三档质量和 Downloads→Pictures 入库路线兼容。
- 修改文件：扩展 `content.js`、`background.js`、`manifest.json`（0.3.1→0.4.0）、`tests/queue.test.mjs`、新增 `tests/content.test.mjs`，扩展 README 与根 README/SPEC/LOG/LOG-INDEX。施工前内容脚本、后台、manifest、队列测试备份位于 `output/downloader-20260907/before/`。此前 Codex 插件的所有未提交修改保留。
- UI：延续 Shadow DOM 和原生控件，面板改为 292px 的紧凑控制台；增加收起/展开、模式操作提示、三档质量的准确说明、清空选择、处理数量进度条和已保存/跳过/失败三项统计。收起后约 69.5px 高，标题仍显示任务进展；支持 320px 窄窗、深色和减少动态效果。JPEG 高清说明明确透明图输出 PNG、体积可能增大，移除旧面板对所有档位都显示“WebP 原样保留”的误导。
- 多选与反馈：收到匹配 jobId 的后台成功确认后才移除已提交选择，提交失败保留可重试；忙碌时按钮禁用且点击 Pin 有明确反馈。DOM 局部重绘时，通过按帧合并的 MutationObserver 同步 Pin ID 对应选中标记，支持重复卡片和节点复用。进度条代表已处理数量，以保存数量表示实际成功。模式、收起、暂停均保留可访问名称和状态；慢偏好读取不会覆盖用户刚选择的质量。
- 下载时序：监听注册后使用 downloads.search 查询当前终态，覆盖小图片在回调返回编号前已经完成的窗口；取消发生在 download() 返回编号前时，取得编号后继续取消。原图探测后再次检查取消，避免继续启动转换；超时先停止仍未完成的下载再处理失败。UI 收到 cancelled 但 pending 尚未归零时继续显示取消中，不提前开放新任务。依据为 Chrome 官方 downloads API 文档：https://developer.chrome.com/docs/extensions/reference/api/downloads 。生产消息形状、串行队列、限速、重试次数、Offscreen 转换、权限和持久化配置格式未改变，未引入依赖。
- 整板扫描：启动时记录页面路径，在路径变化时停止，避免混入另一页素材；仅在同一页面恢复原滚动位置。取消/异常走清理路径，安全上限提示随该批次保留，不再立刻被队列文本覆盖。
- 自动验证：基线扩展 13/13；新增 3 项后台时序与 5 项内容交互回归，扩展 21/21。完整 npm test 83/83（Codex 插件 62、下载器 21）通过，包含 TypeScript 和 bundle；最终补充恢复采集时的标题状态后，相关内容回归 5/5 与实际浏览器复查通过。node --check、git diff --check 通过。首轮新增快速完成用例中，测试替身参数被 download(options) 同名参数遮蔽，修正测试后重跑通过，未据此反复修改生产逻辑。
- 浏览器验证：本地测试图版、模拟 Chrome 消息与隔离的静态图片响应，不访问登录态 Pinterest、不调用真实 Downloads API。完成多选 2 张、重复卡片/复用节点选择同步、提交失败保留 2 张、重试确认后清零、忙碌不重复提交、收起后继续显示完成数、清空、取消等待终态、暂停恢复原页面点击、质量说明、扫描切页停止以及完整收集 8 张同板图片。320/400/1200px 面板无内部横向溢出，减少动态效果 animation 为 none，页面脚本错误 0。最终暂停→启用标题恢复就绪，进度数值为 1/2。测试最初尝试点击浮动面板下面的卡片被正常遮挡；调整为可见卡片后完整通过，未强行穿透真实界面。证据为 `browser-results.txt`、`final-results.txt`；浅色多选、下载中、收起与深色截图均保留，浅色和深色已目视检查。
- 部署状态：升级的是当前仓库中已解压扩展的源文件，不是 Codex 插件缓存。用户需到 chrome://extensions 重新加载 Pinterest Inbox Downloader，再刷新 Pinterest 页面。未代用户重新加载 Chrome 扩展或发起真实 Pin 下载，README 仍标为待真实网页验收。
- 未解决事项与人工验收：重新加载后验证单张、两张多选与取消，核对 originals 格式和文件名；真实 Pinterest DOM 与 Chrome Offscreen/Downloads 的宿主链路需现场验收。队列继续采用现有内存模型，扩展进程重启后的任务恢复不属于本轮，不引入持久任务或新协议。取消可能需要等待正在进行的原图探测/转换收尾，界面会保留取消中。
- 清理与回滚：本轮浏览器和临时 HTTP 测试服务在验证后关闭，未写入或修改用户素材与系统剪贴板。可恢复 before 中的 content/background/manifest 与队列测试，移除本轮新增内容测试并重新加载 Chrome 扩展；不需要恢复图片、修改 Codex 插件或迁移质量设置。

## 2026-09-07 — 下载器加载后消失修复

- HASH：`c24030edf35a`。
- 任务目标：修复用户反馈的扩展在页面加载初期可见、Pinterest 正式图版出现后消失的问题。
- 现场证据：通过 CUA 只读检查当前登录态 Pinterest 首页，document.readyState 为 complete，但下载器根节点、选中样式和 html 上采集状态属性均不存在；页面应用根为 `__PWS_ROOT__`，body 无 transform/filter/contain 干扰。由代码可确认旧版只向 html 直接追加面板和样式，MutationObserver 只观察当时的 body 并同步勾选，节点被移除后不会恢复。未捕获 Pinterest 移除节点的具体调用栈，因此不将具体框架内部行为表述为已证实。
- 修改文件：扩展 `content.js`、`manifest.json`（0.4.0→0.4.1）、`tests/content.test.mjs`，扩展 README、根 README/SPEC/LOG/LOG-INDEX。施工前这三个源码文件已备份至 `output/playwright/downloader-mount-20260907/before/`；保留之前所有未提交变更。
- 修复：面板挂到 body 中且位于 Pinterest 应用根之外，选中样式放入 head；沿用一个 MutationObserver，改为观察稳定的 document，兼顾 body/html 替换。仅在挂载位置或采集属性不符时修正，复用原 root/Shadow DOM/闭包，不重新执行初始化，不新增定时轮询、权限、依赖、存储格式或消息协议。恢复时保留多选、收起/暂停和原任务进度，普通页面变化不会重复追加节点。
- 自动验证：新增 3 项恢复回归在旧版上均失败，原有 5 项内容测试通过，证据为 `baseline.txt`；修复后全部下载器测试 24/24（内容 8、队列 9、shared 7）通过，`node --check` 与 `git diff --check` 通过。本轮只改下载器挂载，不重复构建或运行无改动的 Codex 插件测试。
- 浏览器验证：真实 Chrome 中打开本地模拟图版，Chrome 消息/下载为测试替身，远程图片由 CSP 阻止加载。旧版明确复现移除面板后不恢复；修复版 14 项检查通过，覆盖面板与样式被删、body/html 整体替换、保留选择与折叠、暂停仍按网页原行为点击、原任务继续接收进度、只提交一次、卡片复用勾选同步、连续 12 次移除后仍只有一个可见面板。最后通过 CUA 实际点击收起按钮，确认恢复后的控件可操作。夹具、服务与证据保留在 `output/playwright/downloader-mount-20260907/`。
- 部署与未解决事项：尝试打开 `chrome://extensions/` 时被浏览器 URL 安全策略拒绝；未改用其他通道绕过。已写入仓库 0.4.1 源码，但尚未代用户重新加载现有扩展，更新后的登录态 Pinterest 加载需用户验收。结束当前下载后，在管理页重新加载 Pinterest Inbox Downloader、确认版本 0.4.1，再刷新 Pinterest；等图片完全出现、滚动及切换图版，确认面板不消失。完整页面刷新和扩展重启不保留本页选择/内存任务，不属于本次同文档恢复能力。
- 清理与回滚：临时测试页及回环 HTTP 服务已关闭，未发起真实下载、修改用户素材或剪贴板；当前用户 Pinterest 页保留。需要回滚时只恢复本轮 before 中 content.js、manifest.json、content.test.mjs 到各自原位置，再重新加载扩展；无需修改后台、Codex 插件缓存或迁移数据。README 仍明确待用户验收。

## 2026-09-07 — 单张连续下载队列

- HASH：`500737b28e92`。
- 任务目标：响应用户在第一张下载中继续点击第二、第三张、让它们按顺序下载的明确需求。
- 根因与方案：现有 background.js 已有全局串行 queue，能够处理多个不同 jobId，下载仍串行并保留 450ms 间隔和一次重试；阻拦来自 content.js 的 currentJobId 忙碌判断及只接收一个任务进度。只调整本地面板的任务跟踪：连续点击各提交一个原有格式的独立任务，将这一组已提交任务汇总展示。不新增第二个待下载执行队列，不改变后台并发/生命周期、公共消息形状、质量策略、存储、权限或生产依赖。
- 修改文件：扩展 content.js、manifest.json（0.4.1→0.4.2）、tests/content.test.mjs、tests/queue.test.mjs，扩展 README、根 README/SPEC/LOG/LOG-INDEX。四个施工前源码/测试文件备份至 `output/playwright/downloader-queue-20260907/before/`；此前其他改动保留。
- 行为：单张模式下载期间继续点图可入后台队列，同一图版/Pin 在加入确认前或仍待处理时去重。总量与成功/跳过/失败合并展示，第一项完成不会清空整组，新增任务相应扩大进度分母，全部收尾才恢复模式/质量/整板按钮。多选批次仍在成功确认后清空。一个加入请求失败只影响该项，其他任务继续并保留失败提示。取消与暂停覆盖当前面板的全部未完成任务；待加入确认的任务在确认后补发取消，取消期间不允许再入队。使用单调待处理量避免迟到的加入/取消响应使进度回退。面板重绘恢复继续复用整组状态。
- 自动验证：现有 8 项内容回归通过；新增 7 项内容用例覆盖三次立即提交、聚合进度、重复点击、单项提交失败隔离、整组取消/等待当前下载、暂停时迟到确认补取消、旧响应不回退、重绘保留。后台新增 2 项测试，验证第一张未完成时提交第二/第三个任务确实仍串行、整组取消会移除后续等待项。全部扩展 33/33（内容 15、队列 11、shared 7）通过；node --check 与 git diff --check 通过。本轮未改 Codex 插件或后台生产代码，未重复其构建/测试。
- 浏览器验证：真实 Chrome 的本地页面运行实际 content.js + background.js；仅替换 Chrome Downloads、消息宿主和原图探测响应，并通过 CSP 阻止远程图片/网络。通过 CUA 实际连续点击三张，DOM 证据显示三项已提交、只启动第一项；依次触发模拟完成，第二、第三项按序启动，面板从 0/3 到 3/3，已保存计数为 3。重复点击第二项未新增请求；中途移除面板后进度保留。新建三项后取消，只有首项启动，后续未开始。切换多选后两张仍作为一次批量请求提交、成功确认清空勾选，并可整组取消。证据、夹具、服务保存在 `output/playwright/downloader-queue-20260907/`。这些是宿主替身验证，不代表真实网络或文件下载验收。
- 部署与未解决事项：本地源码已是 0.4.2；沿用此前已确认的浏览器安全限制，不再尝试或绕过 Chrome 扩展管理页。用户须结束现有下载、手动重新加载 Pinterest Inbox Downloader 并确认版本 0.4.2，再刷新 Pinterest。人工验收为迅速连续点三张、重复点其中一张、查看三项顺序完成，再加入几张并取消以检查等待项不启动。当前仍为内存队列：刷新页面会丢失该页面对旧任务的跟踪，已加入后台的任务可能继续；扩展重启不提供恢复。本轮不引入持久任务。
- 清理与回滚：测试页和回环 HTTP 服务已关闭；没有真实下载、用户图片/剪贴板写入，也未改动现有 Pinterest 页面。可恢复 before 中四个文件到原位置并重新加载扩展，保留 0.4.1 面板修复，不需后台或数据迁移。README 将新能力标为待用户真实网页验收。

## 2026-09-09 — 首个公开版本阻断项清理与真实验收

- HASH：`1bf455fdecda`。
- 任务目标：解决 2026-09-07 发布审计中的依赖漏洞、下载器 0.4.2 真实网页验收、Codex 参考篮宿主验收、中文路径复制验收和版本/文档状态不一致，形成可公开的 `v0.4.0` 候选版本。
- 依赖安全：执行 `npm audit fix --package-lock-only`，只更新锁文件中的间接依赖：`fast-uri` 3.1.5→3.1.7、`qs` 6.15.3→6.16.0、`hono` 4.13.3→4.13.7；未新增直接依赖、权限、接口或运行机制。随后 `npm ci` 成功，`npm audit` 与 `npm audit --omit=dev` 均报告 0 个已知漏洞。
- 真实 Chrome 验收：`chrome://extensions` 确认 Pinterest Inbox Downloader 0.4.2 已启用。在用户现有登录态 Pinterest 页面恢复采集并使用真实 Chrome Downloads：连续点击 3 张不同 Pin 且立即重复点击其中一张，最终 3/3 保存、0 跳过、0 失败，重复项没有形成第 4 个任务；随后多选 6 张并立即取消，最终 0 保存、6 跳过、0 失败。结束时扩展恢复为单张模式和暂停状态。
- 本地文件副作用：正式队列验证预期新增 3 个文件；此前为定位点击入口进行的 20 次点击在稍后形成延迟下载，因此本轮 14:55:18–14:57:39 共新增 23 个不同 Pin ID 的文件，均位于 `~/Pictures/PinterestInbox/unsorted/`，没有覆盖旧文件。未擅自删除这些用户素材；如需清理，可按该时间段和 Pin ID 清单做单独、可确认的删除。
- 真实 Codex 宿主验收：调用 `open_pinterest_inbox_web` 创建独立 `referenceSessionId`。宿主的右侧打开请求返回 queued，因此改用 Codex 提供的可见内嵌浏览器入口打开同一回环 URL；页面显示完整素材工作台。选择 3 张后，`get_pinterest_reference_selection` 用同一会话返回相同顺序的 3 个 canonical 原文件，随后逐张打开原图确认内容可读。点击批量复制后，系统剪贴板的 3 行 UTF-8 文本与工具返回路径逐字节相等，包含中文文件名；最后清空本轮参考篮。
- 版本与文档：仓库工作区版本从 0.1.0 对齐到 Codex 插件主版本 0.4.0；Chrome 下载器继续使用独立版本 0.4.2。README、扩展 README、SPEC 和 UX 方案从“待验收”更新为 2026-09-09 的实测结论，并明确宿主固定右侧布局不可由 MCP 强制、可见内嵌浏览器是兼容入口。
- 自动验证：Codex 插件 62/62、下载器 33/33，合计 95/95；TypeScript 检查与 esbuild bundle 成功。最终提交前仍需再次执行干净安装、完整测试、两种依赖审计、bundle 一致性、差异格式与敏感信息检查；GitHub CI 与公开可访问性在推送后验证。
- 回滚：锁文件可恢复到本节所列三个旧版本；工作区版本可恢复为 0.1.0；文档状态可按本节前的 Git 版本恢复。代码、公共接口、存储格式和用户旧素材没有迁移。23 个本轮下载文件属于用户素材，未经明确授权不纳入自动回滚。
