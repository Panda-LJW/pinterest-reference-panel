# 变更日志

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
