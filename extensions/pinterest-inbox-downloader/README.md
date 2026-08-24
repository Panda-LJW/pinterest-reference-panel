# Pinterest Inbox Downloader

面向 macOS + Chrome 的精简 Manifest V3 扩展。它只在 Pinterest 页面上收集静态图片，并通过 Chrome Downloads API 写入：

```text
~/Downloads/PinterestInbox/<board-slug>/<pin-id>__<safe-title>.<ext>
```

## 本地加载

1. 打开 `chrome://extensions`；
2. 开启“开发者模式”；
3. 点击“加载已解压的扩展程序”；
4. 选择本目录。

扩展进入 Pinterest 页面后显示小型操作面板：

- 暂停/启用：暂停后 Pin 恢复 Pinterest 原本点击行为，并取消当前采集任务；
- 单张模式：单击 Pin，立即加入下载队列；
- 多选模式：勾选多个 Pin 后批量下载；
- 整板下载：自动滚动当前图版，收集完成后批量下载；
- 取消：停止尚未完成的任务。

每张图先探测 Pinterest CDN `originals` 原图：优先原生 JPG/PNG，如果原图只有 WebP 则原样保留 WebP。扩展不转码、不伪改后缀，也不回退到低分辨率缩略图。

视频 Pin、HLS、无有效 `pinimg.com` 地址或无可用 originals 原图的项目会被跳过。每个失败下载会自动重试一次；相同 Pin 使用确定性文件名和 `overwrite`，不会写入 `PinterestInbox` 以外的位置。
