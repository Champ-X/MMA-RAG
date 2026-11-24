# Tessmora 介绍视频 / Introduction videos

面向项目 README 的中英双语展示资源。两段视频均为已定版 V5 的 720p Lite 成片，直接复制，未重新剪辑、转码或修改配乐。清单记录了原始交付目录 `video-production/tessmora-intro/deliverables/`。1080p 成片与制作工程由制作者本地管理。

Bilingual presentation assets for the project READMEs. Both videos are exact copies of the finalized V5 720p Lite exports, with no editing, re-encoding, or soundtrack changes. The manifest records `video-production/tessmora-intro/deliverables/` as the original delivery directory. The producers manage the 1080p exports and production files locally.

| 语言 / Language | 在线播放 / Watch with subtitles | MP4 下载 / Download | 封面 / Cover | 字幕 / Subtitles |
| --- | --- | --- | --- | --- |
| 简体中文 | [观看中文版](https://xiangqingping.com/zh/works/tessmora#tessmora-intro) | [20.95 MiB](tessmora-intro-zh.mp4?raw=1) | [JPEG](cover-zh.jpg) | [SRT](zh.srt) |
| English | [Watch in English](https://xiangqingping.com/works/tessmora#tessmora-intro) | [20.92 MiB](tessmora-intro-en.mp4?raw=1) | [JPEG](cover-en.jpg) | [SRT](en.srt) |

- **规格 / Format:** 1280 × 720, 30 fps, H.264 video + AAC audio, 275.8 seconds (4:35.8). 配乐与音效，无旁白 / Music and sound effects; no voice-over.
- **封面 / Covers:** 从对应的 1920 × 1080 PNG 封面转换为渐进式 JPEG，保留原尺寸、画面和文字。Converted from the matching 1920 × 1080 PNG covers to progressive JPEG, preserving dimensions, artwork, and text.
- **字幕 / Subtitles:** SRT 与原始交付文件逐字节一致；播放器可作为外部字幕载入。SRT files are unchanged copies and can be loaded as external subtitles.

## GitHub 内嵌播放 / Inline playback on GitHub

首页用 `<details open>` 默认展开演示区。将对应语言的 `github_attachment.url` 单独放一段，前后留空行，GitHub 会生成带控制栏的播放器。需要字幕时可打开上表中的播放页，离线观看可下载 MP4 并载入同语言的 SRT。附件地址和文件哈希见[媒体清单](manifest.json)。

Each README uses `<details open>` to show the demo by default. Place the matching `github_attachment.url` in its own paragraph with a blank line on either side so GitHub renders the video player. For captions, open the project page linked above. For offline playback, download the MP4 and load the matching SRT file. The [manifest](manifest.json) records attachment URLs and file hashes.

## 架构预览来源 / Architecture preview provenance

中英文首页分别展示[中文系统全景](../../diagrams/mma-rag/overview-cn.png)与 [English overview](../../diagrams/mma-rag/overview-en.png)。两张图均裁自[双语手写架构图](../../diagrams/mma-rag/README.md)的 PNG 导出，展示入库、常规检索、Pi 与共享存储的关系。

Each README displays its language’s overview, cropped from the bilingual architecture exports. The diagrams show ingestion, standard retrieval, Pi, and shared storage.

原图对应 **2026-11-05、`658b0d1`** 源码快照。完整图中的 Pi 恢复和检索通道细节早于 Durable 更新；当前行为见 [系统架构](../../MMA_ARCHITECTURE.md) 与 [Pi Durable](../../pi-agent-durable.md)。图中的 `02`–`05` 指完整画布的其他分区。

The source diagrams represent **2026-11-05, commit `658b0d1`**. Detailed Pi recovery and retrieval descriptions in the full canvas predate the Durable update; consult the [current architecture](../../MMA_ARCHITECTURE.md) and [Pi Durable guide](../../pi-agent-durable.md) for current behavior. References to `02`–`05` identify other sections of the full canvas.

## 校验与更新 / Verification and updates

[manifest.json](manifest.json) 记录仓库相对来源路径、SHA-256、字节数、视频规格和架构图裁切范围。视频与字幕的输出哈希应与来源哈希一致；MP4 的 `moov` 位于 `mdat` 前，支持渐进式加载。清单中的制作来源路径用于本地追溯，并非公共下载链接。

The manifest records repository-relative source paths, SHA-256 hashes, sizes, video metadata, and diagram crop bounds. Video and subtitle output hashes must match their source hashes. Each MP4 places `moov` before `mdat` for progressive loading. Production source paths in the manifest are local provenance records, not public download links.

2026-11-06 下载两份 GitHub 附件后，核对了附件、仓库 MP4 和制作源文件的 SHA-256，三者一致。2026-11-24 匿名复查时，直接访问两个附件地址均返回 HTTP 404。两份 GitHub README 里的播放器都能读取视频，字节范围请求均返回 HTTP 206。

On 2026-11-06, full downloads of both GitHub attachments matched the SHA-256 hashes of the repository MP4s and production exports. On 2026-11-24, opening either attachment URL directly while signed out returned HTTP 404. Both rendered GitHub README players served the video with HTTP 206 for byte-range requests.

替换展示资源时，同步更新清单与对应语言的 README；不要将制作缓存、完整工程或 1080p 大文件一并加入仓库。

When replacing presentation assets, update the manifest and the matching-language README. Keep production caches, full projects, and large 1080p exports outside the repository.
