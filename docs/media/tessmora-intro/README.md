# Tessmora 介绍视频 / Introduction videos

面向项目 README 的中英双语展示资源。两段视频均为已定版 V5 的 720p Lite 成片，直接复制，未重新剪辑、转码或修改配乐。原始 1080p 成片与制作工程保留在本地、被 Git 忽略的 `video-production/tessmora-intro/deliverables/`，不属于此目录的分发内容。

Bilingual presentation assets for the project READMEs. Both videos are exact copies of the finalized V5 720p Lite exports, with no editing, re-encoding, or soundtrack changes. Original 1080p exports and production files remain in the local, Git-ignored `video-production/tessmora-intro/deliverables/` directory.

| 语言 / Language | 视频 / Video | 封面 / Cover | 字幕 / Subtitles |
| --- | --- | --- | --- |
| 简体中文 | [MP4 · 20.95 MiB](tessmora-intro-zh.mp4) | [JPEG](cover-zh.jpg) | [SRT](zh.srt) |
| English | [MP4 · 20.92 MiB](tessmora-intro-en.mp4) | [JPEG](cover-en.jpg) | [SRT](en.srt) |

- **规格 / Format:** 1280 × 720, 30 fps, H.264 video + AAC audio, 275.8 seconds (4:35.8). 配乐与音效，无旁白 / Music and sound effects; no voice-over.
- **播放 / Playback:** README 使用可点击封面与 MP4 链接。不同 Markdown 查看器的播放行为不同，可下载后用本地播放器打开。Videos are linked through clickable posters; playback depends on the Markdown viewer, and files can also be downloaded for local playback.
- **封面 / Covers:** 从对应的 1920 × 1080 PNG 封面转换为渐进式 JPEG，保留原尺寸、画面和文字。Converted from the matching 1920 × 1080 PNG covers to progressive JPEG, preserving dimensions, artwork, and text.
- **字幕 / Subtitles:** SRT 与原始交付文件逐字节一致；播放器可作为外部字幕载入。SRT files are unchanged copies and can be loaded as external subtitles.

## 架构预览来源 / Architecture preview provenance

README 使用的 [中文系统全景](../../diagrams/mma-rag/overview-cn.png) 与 [English overview](../../diagrams/mma-rag/overview-en.png) 从 [双语手写架构图](../../diagrams/mma-rag/README.md) 的 PNG 导出裁切，未改变原图内容。裁切保留入库、常规检索、Pi 与共享存储的系统关系；完整母版保持原样。

The overview images are pixel-preserving crops of the existing bilingual architecture exports. They show ingestion, standard retrieval, Pi, and shared storage. The full original diagrams are unchanged.

原图对应 **2026-11-05、`658b0d1`** 源码快照。完整图中的 Pi 恢复和检索通道细节早于 Durable 更新；当前行为见 [系统架构](../../MMA_ARCHITECTURE.md) 与 [Pi Durable](../../pi-agent-durable.md)。图中的 `02`–`05` 指完整画布的其他分区。

The source diagrams represent **2026-11-05, commit `658b0d1`**. Detailed Pi recovery and retrieval descriptions in the full canvas predate the Durable update; consult the [current architecture](../../MMA_ARCHITECTURE.md) and [Pi Durable guide](../../pi-agent-durable.md) for current behavior. References to `02`–`05` identify other sections of the full canvas.

## 校验与更新 / Verification and updates

[manifest.json](manifest.json) 记录仓库相对来源路径、SHA-256、字节数、视频规格和架构图裁切范围。视频与字幕的输出哈希应与来源哈希一致；MP4 的 `moov` 位于 `mdat` 前，支持渐进式加载。清单中的制作来源路径用于本地追溯，并非公共下载链接。

The manifest records repository-relative source paths, SHA-256 hashes, sizes, video metadata, and diagram crop bounds. Video and subtitle output hashes must match their source hashes. Each MP4 places `moov` before `mdat` for progressive loading. Production source paths in the manifest are local provenance records, not public download links.

替换展示资源时，同步更新清单与对应语言的 README；不要将制作缓存、完整工程或 1080p 大文件一并加入仓库。

When replacing presentation assets, update the manifest and the matching-language README. Keep production caches, full projects, and large 1080p exports outside the repository.
