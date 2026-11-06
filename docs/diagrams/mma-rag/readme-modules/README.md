# README 模块图 / README module diagrams

三组中英文图展示当前入库、常规检索和 Pi Durable 研究路径。图中图标、箭头与文字均有原生 Excalidraw 源文件，便于随代码更新。

Three bilingual diagrams explain ingestion, standard retrieval, and Pi Durable research. The companion Excalidraw files retain native shapes, arrows, and editable text.

| 模块 / Module | 中文 | English |
| --- | --- | --- |
| 多模态入库 / Multimodal ingestion | [PNG](ingestion-zh.png) · [SVG](ingestion-zh.svg) · [源文件](ingestion-zh.excalidraw) | [PNG](ingestion-en.png) · [SVG](ingestion-en.svg) · [Source](ingestion-en.excalidraw) |
| 混合检索与引用 / Hybrid retrieval & citations | [PNG](retrieval-zh.png) · [SVG](retrieval-zh.svg) · [源文件](retrieval-zh.excalidraw) | [PNG](retrieval-en.png) · [SVG](retrieval-en.svg) · [Source](retrieval-en.excalidraw) |
| Pi Durable 研究 / Pi Durable research | [PNG](pi-durable-zh.png) · [SVG](pi-durable-zh.svg) · [源文件](pi-durable-zh.excalidraw) | [PNG](pi-durable-en.png) · [SVG](pi-durable-en.svg) · [Source](pi-durable-en.excalidraw) |

- **入库**：不同资料分别解析与编码，MinIO 保存原件及派生媒体，Qdrant 保存索引和来源位置，知识库画像异步更新。
- **检索**：根据问题意图和允许范围组织多路候选，经加权 RRF 与重排序生成答案，再通过引用回看原文或媒体区间。
- **Pi**：在允许范围内按需使用工具积累证据，由 Durable 与 SQLite 保存研究状态，并通过 `submit_answer` 提交答案。

- **Ingestion:** each format follows its own parsing and encoding path; MinIO holds originals and derived media, Qdrant holds indexes and source locations, and knowledge-base profiles update asynchronously.
- **Retrieval:** intent and scope guide candidate retrieval, followed by weighted RRF, reranking, answer generation, and source inspection.
- **Pi:** tools gather evidence within the allowed scope; Durable and SQLite preserve research state, and `submit_answer` delivers the result.

## 来源与范围 / Sources and scope

2026-11-07 对照工作树源码核对；当时 HEAD 为 `d3656cf92327cd28244a2cc8475d1fe3089d301b`。实际来源文件及 SHA-256 见 [manifest.json](manifest.json)。这是流程说明图，未作为一次新的端到端运行或性能评测记录。

Reviewed against the working-tree source on 2026-11-07, with HEAD at `d3656cf92327cd28244a2cc8475d1fe3089d301b`. [manifest.json](manifest.json) records the source files and their SHA-256 hashes. These diagrams describe implementation paths; they do not record a new end-to-end execution or performance evaluation.

- 入库图没有把 Dense、Sparse、CLIP、CLAP 画成所有文件都执行的统一管线；图片使用 CLIP 与文本向量，没有 Sparse 向量；视频以 Shot 为主要检索单元，关键帧增强所属 Shot 排序。失败处理与模型降级未逐一展开。
- 常规检索图的媒体分支按意图启用；显式范围优先于知识库画像路由。Pi 研究使用独立工具路径，不经过这里的普通画像路由和 Reranker。
- Pi 默认使用 Durable 与回答计划；图中工具由任务按需选择，循环箭头不代表固定调用次序。搜索默认采用文本混合检索；可选 native 图片 CLIP / 音频 CLAP 路径未展开，native 视频检索尚未实现。
- `steer` 用于排队或运行中的研究，澄清 `reply` 用于 `needs_input`；已完成任务不能通过普通追问直接续跑。恢复不保证外部模型请求仅执行一次，用户取消为终态；提交校验不保证结论语义正确。

The diagrams omit error branches and model fallbacks. Images use CLIP and text vectors, without Sparse encoding. Standard media routes are intent-driven, and keyframes boost their parent shots. Pi uses a separate tool path, with Durable and answer planning enabled by default. Its tools are selected as needed, not called in a fixed order. Pi search defaults to text hybrid retrieval; optional native image/audio search and the current lack of native video search are not expanded. In-flight `steer` and clarification `reply` preserve a run, but completed runs do not accept ordinary follow-up input. Recovery is not exactly-once delivery, cancellation is final, and submission checks do not prove factual correctness.

## 编辑与导出 / Editing and export

打开 `.excalidraw` 即可编辑；图标由原生图形组成，并已分组。英文采用 Excalifont，中文采用 Xiaolai，源文件使用 Excalidraw 的 `fontFamily: 5` 字体方案。编辑器需要提供相应字体。

展示版 SVG 将字形转为路径，PNG 由同一 SVG 渲染，避免中文系统字体回退；文字的可编辑版本保存在 `.excalidraw` 中。画布尺寸为 1800 × 1000，PNG 为 2700 × 1500。六张 PNG 均已逐张检查文字、留白、图标与连线顺序。

Open a `.excalidraw` file to edit its native elements; pictograms are grouped. The sources use Excalidraw font family 5, with Excalifont and Xiaolai. Display SVGs outline the glyphs for portable rendering, while editable text remains in the source files. PNGs are rendered from those SVGs. Canvas size: 1800 × 1000; PNG size: 2700 × 1500. All six PNGs were visually checked for text, spacing, icons, and flow direction.
