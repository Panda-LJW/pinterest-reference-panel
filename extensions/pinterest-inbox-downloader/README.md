# Pinterest Inbox Downloader

面向 macOS + Chrome 的精简 Manifest V3 扩展。它只在 Pinterest 页面上收集静态图片，并通过 Chrome Downloads API 写入：

```text
~/Downloads/PinterestInbox/<board-slug>/<safe-title>__pin-<pin-id>.<ext>
```

## 本地加载

1. 打开 `chrome://extensions`；
2. 开启“开发者模式”；
3. 点击“加载已解压的扩展程序”；
4. 选择本目录。

扩展进入 Pinterest 页面后显示小型操作面板：

- 暂停/启用：暂停后 Pin 恢复 Pinterest 原本点击行为，并取消当前采集任务；
- 保存质量：原图、JPEG 高清或智能轻量；选择会保存在 Chrome 本地配置中；升级到 0.3.1 时会一次性迁移到默认智能轻量；
- 单张模式：单击 Pin，立即加入下载队列；
- 多选模式：勾选多个 Pin 后批量下载；
- 整板下载：自动滚动当前图版，收集完成后批量下载；
- 取消：停止尚未完成的任务。

每张图先探测 Pinterest CDN `originals` 原图：优先原生 JPG/PNG，如果原图只有 WebP 则以 WebP 作为最高质量源。扩展不伪改后缀，也不回退到低分辨率缩略图。

质量选项：

- 原图：保留 originals 的原始分辨率、字节和格式；
- JPEG 高清：非透明素材使用原始分辨率 JPEG 90，用于兼容性，不承诺比 originals 更小；
- 智能轻量（默认）：WebP 原样保存；其他格式生成最长边 2048px、JPEG80 或透明 PNG 的候选件，只有候选件严格更小时才采用；
- 透明素材：JPEG 高清输出 PNG；智能轻量只有在透明 PNG 候选件更小时才采用。

高清和轻量使用 Chrome Offscreen 图片处理页面，不读取 Pinterest Cookie。图片处理失败会明确计入失败，不会偷偷改用页面缩略图。
文件名使用“标题在前、Pin ID 在后”，方便浏览并保持稳定去重，例如 `Modern Pink Dinosaur__pin-123456.jpg`。
标题优先读取 Pinterest 卡片的结构化标题节点，不把图片 `alt` 中的“其中包括图片”等无障碍描述写入文件名。
为避免 Chrome 退回 CDN 哈希名，扩展同时在下载请求和最终文件名确定事件中提交相同目标名。

视频 Pin、HLS、无有效 `pinimg.com` 地址或无可用 originals 原图的项目会被跳过。每个失败下载会自动重试一次；相同 Pin 使用确定性文件名和 `overwrite`，不会写入 `PinterestInbox` 以外的位置。
