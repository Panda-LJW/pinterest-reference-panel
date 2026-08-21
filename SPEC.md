# Pinterest 素材栏规格

## 目标

在 Codex 中提供一个轻量、只读的 Pinterest 素材抽屉，使用户可以查看自己的图版与 Pin，并在后续阶段将明确选择的图片安全下载到当前工作区引用。

## Phase 0 验收标准

1. 插件可被本地 Codex marketplace 发现和安装。
2. `render_pinterest_reference_panel` 能返回 `text/html;profile=mcp-app` UI 资源。
3. 界面在窄容器中显示 Pins / Boards 标签和双列瀑布流；品牌栏与标签栏固定在内容上层，滚动素材时保持不动。
4. 刷新、图版筛选、Pin 选择在假数据上可交互。
5. 不发起 Pinterest 网络请求，不读取登录态，不写入工作区图片。
6. 记录宿主实际采用的展示位置；不把“固定右栏”当成已由插件控制的能力。

## 稳定边界

- 数据操作最小权限：只读 Boards 与 Pins。
- 无全站搜索，无 Pinterest 写操作。
- 下载必须是显式单项操作，且只能写入配置后的工作区根目录内。
- 不接受任意 URL 或任意绝对输出路径。
- Pinterest API、OAuth 与真实下载不属于 Phase 0。

## 后续阶段入口

- Phase 1：接入 Pinterest OAuth 与官方只读 API。
- Phase 2：在政策边界确认后实现工作区安全下载。
