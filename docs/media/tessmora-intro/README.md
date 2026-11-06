# Tessmora 介绍视频 / Introduction videos

面向项目 README 的中英双语展示资源。两段视频均为已定版 V5 的 720p Lite 成片，直接复制，未重新剪辑、转码或修改配乐。原始 1080p 成片与制作工程保留在本地、被 Git 忽略的 `video-production/tessmora-intro/deliverables/`，不属于此目录的分发内容。

Bilingual presentation assets for the project READMEs. Both videos are exact copies of the finalized V5 720p Lite exports, with no editing, re-encoding, or soundtrack changes. Original 1080p exports and production files remain in the local, Git-ignored `video-production/tessmora-intro/deliverables/` directory.

| 语言 / Language | GitHub 附件 / Attachment | MP4 下载 / Download | 封面 / Cover | 字幕 / Subtitles |
| --- | --- | --- | --- | --- |
| 简体中文 | [中文视频](https://github.com/user-attachments/assets/ba48b505-9b1b-4fd6-9d40-441092cdf8fc) | [20.95 MiB](tessmora-intro-zh.mp4?raw=1) | [JPEG](cover-zh.jpg) | [SRT](zh.srt) |
| English | [English video](https://github.com/user-attachments/assets/b3d5a990-115f-4508-a707-b99d2acc590e) | [20.92 MiB](tessmora-intro-en.mp4?raw=1) | [JPEG](cover-en.jpg) | [SRT](en.srt) |

- **规格 / Format:** 1280 × 720, 30 fps, H.264 video + AAC audio, 275.8 seconds (4:35.8). 配乐与音效，无旁白 / Music and sound effects; no voice-over.
- **播放 / Playback:** GitHub README 将对应语言的附件裸 URL 独立放在一段中，由 GitHub 渲染为带控制栏的原生播放器。其他 Markdown 阅读器可使用保留的 MP4 下载链接，在本地播放。Each GitHub README places its matching-language attachment URL alone in a paragraph, which GitHub renders as a native video player with controls. Other Markdown readers can use the MP4 download links for local playback.
- **封面 / Covers:** 从对应的 1920 × 1080 PNG 封面转换为渐进式 JPEG，保留原尺寸、画面和文字。Converted from the matching 1920 × 1080 PNG covers to progressive JPEG, preserving dimensions, artwork, and text.
- **字幕 / Subtitles:** SRT 与原始交付文件逐字节一致；播放器可作为外部字幕载入。SRT files are unchanged copies and can be loaded as external subtitles.

## GitHub 内嵌播放 / Inline playback on GitHub

两段 GitHub 附件均直接上传原始 Lite 成片，未压缩或转码。已完整下载附件并核对 SHA-256：远端附件、此目录 MP4 与制作交付源文件三者一致；具体地址、大小和哈希见 [manifest.json](manifest.json)。

Both GitHub attachments are exact uploads of the original Lite exports, without compression or re-encoding. Full attachment downloads were verified by SHA-256 against both the MP4s in this directory and the production exports; all three copies match. The [manifest](manifest.json) records URLs, sizes, and hashes.

在对应语言 README 中使用单独一段的附件 URL，前后保留空行，例如：

Use the attachment URL as its own paragraph, with blank lines before and after it:

```markdown
https://github.com/user-attachments/assets/ba48b505-9b1b-4fd6-9d40-441092cdf8fc
```

英文版使用上表的 English 附件。仓库 `blob` / `raw` MP4 链接只产生普通链接，手写 HTML `<video>` 会被 GitHub Markdown 过滤；它们不能替代附件播放器。不要把渲染后带时效签名的媒体 URL 写入 README。

Use the English attachment from the table for the English README. Repository `blob` / `raw` MP4 URLs render as ordinary links, and GitHub Markdown removes handwritten HTML `<video>` tags. Keep the stable attachment URL in the README, rather than the temporary signed media URL produced during rendering.

## 架构预览来源 / Architecture preview provenance

README 使用的 [中文系统全景](../../diagrams/mma-rag/overview-cn.png) 与 [English overview](../../diagrams/mma-rag/overview-en.png) 从 [双语手写架构图](../../diagrams/mma-rag/README.md) 的 PNG 导出裁切，未改变原图内容。裁切保留入库、常规检索、Pi 与共享存储的系统关系；完整母版保持原样。

The overview images are pixel-preserving crops of the existing bilingual architecture exports. They show ingestion, standard retrieval, Pi, and shared storage. The full original diagrams are unchanged.

原图对应 **2026-11-05、`658b0d1`** 源码快照。完整图中的 Pi 恢复和检索通道细节早于 Durable 更新；当前行为见 [系统架构](../../MMA_ARCHITECTURE.md) 与 [Pi Durable](../../pi-agent-durable.md)。图中的 `02`–`05` 指完整画布的其他分区。

The source diagrams represent **2026-11-05, commit `658b0d1`**. Detailed Pi recovery and retrieval descriptions in the full canvas predate the Durable update; consult the [current architecture](../../MMA_ARCHITECTURE.md) and [Pi Durable guide](../../pi-agent-durable.md) for current behavior. References to `02`–`05` identify other sections of the full canvas.

## 校验与更新 / Verification and updates

[manifest.json](manifest.json) 记录仓库相对来源路径、SHA-256、字节数、视频规格和架构图裁切范围。视频与字幕的输出哈希应与来源哈希一致；MP4 的 `moov` 位于 `mdat` 前，支持渐进式加载。清单中的制作来源路径用于本地追溯，并非公共下载链接。

The manifest records repository-relative source paths, SHA-256 hashes, sizes, video metadata, and diagram crop bounds. Video and subtitle output hashes must match their source hashes. Each MP4 places `moov` before `mdat` for progressive loading. Production source paths in the manifest are local provenance records, not public download links.

2026-11-06 检查中，两语言附件均通过已登录与匿名 GitHub Markdown 渲染，生成 `<video controls>`；实际媒体响应为 `video/mp4`，HEAD 返回 200，字节范围读取返回 206。该检查确认 GitHub 渲染和媒体传输，不代表所有第三方 Markdown 阅读器都能内嵌播放。

On 2026-11-06, both attachments rendered as `<video controls>` through authenticated and anonymous GitHub Markdown requests. The media returned `video/mp4`, HTTP 200 for HEAD, and HTTP 206 for byte-range reads. These checks verify GitHub rendering and media delivery, not inline playback in every third-party Markdown reader.

替换展示资源时，同步更新清单与对应语言的 README；不要将制作缓存、完整工程或 1080p 大文件一并加入仓库。

When replacing presentation assets, update the manifest and the matching-language README. Keep production caches, full projects, and large 1080p exports outside the repository.
