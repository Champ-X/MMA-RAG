# README 模块图 / README module diagrams

三组图记录 2026-11-07 工作树中的入库、检索和 Pi 研究流程。每张图都有中英文版和可编辑的 Excalidraw 源文件。

These diagrams show ingestion, retrieval, and Pi research in the November 7, 2026 working tree. Each comes with Chinese and English artwork and an editable Excalidraw source.

| 模块 / Module | 中文 | English |
| --- | --- | --- |
| 多模态入库 / Multimodal ingestion | [PNG](ingestion-zh.png) · [SVG](ingestion-zh.svg) · [源文件](ingestion-zh.excalidraw) | [PNG](ingestion-en.png) · [SVG](ingestion-en.svg) · [Source](ingestion-en.excalidraw) |
| 混合检索与引用 / Hybrid retrieval & citations | [PNG](retrieval-zh.png) · [SVG](retrieval-zh.svg) · [源文件](retrieval-zh.excalidraw) | [PNG](retrieval-en.png) · [SVG](retrieval-en.svg) · [Source](retrieval-en.excalidraw) |
| Pi Durable 研究 / Pi Durable research | [PNG](pi-durable-zh.png) · [SVG](pi-durable-zh.svg) · [源文件](pi-durable-zh.excalidraw) | [PNG](pi-durable-en.png) · [SVG](pi-durable-en.svg) · [Source](pi-durable-en.excalidraw) |

## 来源与范围 / Sources and scope

绘图时 HEAD 为 `d3656cf92327cd28244a2cc8475d1fe3089d301b`。清单记录当时工作树中参考文件的 SHA-256，当前流程见系统架构文档。[清单](manifest.json) · [系统架构](../../../MMA_ARCHITECTURE.md)

HEAD was `d3656cf92327cd28244a2cc8475d1fe3089d301b` when the diagrams were drawn. The manifest records hashes of the working-tree sources consulted at the time. The architecture guide describes the current implementation. [Manifest](manifest.json) · [Architecture](../../../MMA_ARCHITECTURE.md)

| 模块 / Module | 读图说明 | Reading the diagram |
| --- | --- | --- |
| 入库 / Ingestion | MinIO 保存原件和派生物，Qdrant 保存索引和来源位置。图片使用文本与 CLIP 向量，视频关键帧从属于镜头。画像异步更新。 | MinIO holds originals and derived files. Qdrant holds indexes and source locations. Images use text and CLIP vectors. Video keyframes belong to their shots. Knowledge-base profiles update asynchronously. |
| 检索 / Retrieval | 显式范围优先于画像路由。媒体通道可用 RRF，全局也计算融合排名。常规重排器读取各通道的候选，合并、去重后选出供生成器使用的证据。 | Explicit scopes take precedence over profile routing. Media channels can use RRF, and search also computes a global fusion ranking. The standard reranker merges and deduplicates each channel’s candidates and selects evidence for generation. |
| Pi | Pi 在授权范围内自行选择工具，默认使用 Durable 和回答计划，通过 `submit_answer` 交付。搜索默认使用文本混合检索，也支持可选的原生图片与音频召回。原生视频检索尚未接入。 | Pi chooses tools within the allowed scope. It uses Durable and answer planning by default, then delivers via `submit_answer`. Search defaults to hybrid text retrieval with optional native image and audio retrieval. Native video retrieval is unavailable. |

排队或运行中可用 `steer` 补充要求，`needs_input` 时用 `reply` 回复。已完成的任务不再接收这些输入。取消是终态，恢复中断的外部模型请求可能再次计费。宿主可校验引用身份，读者仍需核对来源是否支持结论。[Pi Durable](../../../pi-agent-durable.md)

Use `steer` for queued or running work and `reply` for a run waiting in `needs_input`. Completed runs accept neither input. Cancellation is final. Retrying an interrupted model request may incur another charge. The host checks citation identity. Readers can open the source to assess whether it supports a claim. [Pi Durable](../../../pi-agent-durable.md)

## 编辑与导出 / Editing and export

打开 `.excalidraw` 即可编辑；图标由原生图形组成，并已分组。英文采用 Excalifont，中文采用 Xiaolai，源文件使用 Excalidraw 的 `fontFamily: 5` 字体方案。编辑器需要提供相应字体。

展示版 SVG 将字形转为路径，PNG 由同一 SVG 渲染，避免中文系统字体回退；文字的可编辑版本保存在 `.excalidraw` 中。画布尺寸为 1800 × 1000，PNG 为 2700 × 1500。六张 PNG 均已逐张检查文字、留白、图标与连线顺序。

Open a `.excalidraw` file to edit its native elements; pictograms are grouped. The sources use Excalidraw font family 5, with Excalifont and Xiaolai. Display SVGs outline the glyphs for portable rendering, while editable text remains in the source files. PNGs are rendered from those SVGs. Canvas size: 1800 × 1000; PNG size: 2700 × 1500. All six PNGs were visually checked for text, spacing, icons, and flow direction.
