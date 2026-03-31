# MMA 多模态 RAG 知识库 架构设计文档

## 文档说明

本文档在最初方案设计基础上，已随项目多次迭代更新。以下内容以**当前实现与设计**为准，并保留部分历史设计背景供参考。更细的符合度分析见 `docs/ARCHITECTURE_COMPLIANCE_ANALYSIS.md`。

---

## 一、设计背景与目标

系统目标：构建**本地可运行、可扩展的语义路由多模态 RAG Agent**，具备：

- **可扩展知识库**：支持用户自建多主题知识库、增量更新；支持多种内容来源（本地上传、URL 下载、RSS/热点、媒体下载等）。
- **多模态数据**：支持**文档**（PDF、Word、TXT、Markdown 等）、**图片**、**音频**（mp3/wav/m4a/flac 等）、**视频**（mp4/avi/mov/mkv 等）；文档与图片已全流程打通，音频/视频在解析、ASR/CLAP/关键帧、意图与检索流水线上有完整或部分实现，详见 `docs/MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC.md`。
- **语义路由与混合检索**：根据查询自动路由至合适知识库；混合检索结合 **Dense（语义向量）、Sparse（BGE-M3 稀疏向量）、Visual（图片：CLIP + VLM 描述）、Audio（音频：CLAP + ASR/描述）、Video（视频：关键帧 CLIP + VLM + 整体描述）** 多路，并两阶段重排（RRF 粗排 + Cross-Encoder 精排）。
- **统一 LLM 管理层**：意图识别、**VLM 图注、ASR 音频转写、多模态描述**、Embedding、Reranker、最终生成等由模块化 LLM Manager 统一调度，支持多厂商 API（如 SiliconFlow、OpenRouter、阿里云百炼、DeepSeek 等）。
- **模块化与 DDD**：业务按领域划分（Ingestion / Knowledge / Retrieval / Generation），与核心设施（Core）及 API 层解耦；前端支持对话、知识库管理、思考链可视化、引用展示等。

---

## 二、数据的输入处理与存储

### 2.1 数据解析与处理

按数据类型采用差异化解析策略，由 `ParserFactory` 统一调度；扩展新格式时增加对应 Parser 即可。

#### 文档类

- **PDF**：当前以 PyMuPDF（fitz）为主；可选接入 MinerU（`mineru_client.py`）等以增强表格/版式处理。
- **DOCX/DOC**：使用 python-docx。
- **TXT / Markdown**：纯文本直接读取；Markdown 使用 markdown 库并支持结构化切分。
- **表格**：解析出的表格可转为 Markdown Table；LLM 摘要与向量化策略在设计中，部分逻辑待完善。
- **可选增强**：PaddleOCR（`paddleocr_client.py`）用于 OCR；MinerU 用于高质量 PDF 解析，见 `docs/MinerU_API文档.md`。

#### 图片类

- 使用 PIL/Pillow 解析，支持 JPG、JPEG、PNG、GIF、BMP、TIFF 等。
- 元数据：width、height、format、mode、aspect_ratio；输出含 base64 供 VLM 使用。

#### 多模态扩展（音频/视频）

- 意图层已在 One-Pass 中输出 `audio_intent`、`video_intent`（explicit_demand / implicit_enrichment / unnecessary）。
- 解析与存储的完整方案见 `docs/MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC.md`、`docs/视频模态技术方案.md` 等。

**实现方案要点：**

- **解析入口**：根据文件扩展名或内容检测由 ParserFactory 选择对应 Parser。**文档**（PDF/DOCX/TXT/Markdown 等）返回统一结构的 parse_result（如 markdown 文本、提取的图片列表、元数据）；**图片**解析输出 base64 与尺寸等供 VLM/CLIP 使用；**音频**（mp3/wav/m4a/flac 等）由 AudioParser 输出时长、采样率、格式等，供 ASR/CLAP 流水线使用；**视频**（mp4/avi/mov/mkv 等）由 VideoParser 输出时长、分辨率、帧率等，供关键帧提取与 VLM/CLIP 使用。
- **文档内图片**：PDF 或 Markdown 解析时若发现内嵌图，先提取图片字节与在原文中的占位符（markdown_ref）；每张图单独走 VLM 描述 + 上传 MinIO + CLIP 向量化 + 写入 image_vectors，同时将生成的 caption 记下，在后续分块前插回原文占位符，再对整份文档做分块与向量化，保证图文一致。
- **音频/视频**：音频走 ASR 转写 + 描述生成 + 文本向量 + CLAP 声学向量，写入 audio_vectors；视频走关键帧提取 → 关键帧 VLM 描述 → 整体描述（可选拼接音轨转写）→ 文本向量 + 关键帧 CLIP 向量，写入 video_vectors；若视频含音轨可抽轨为音频再走音频流水线。
- **多来源接入**：sources 层（URL、文件夹、Tavily 热点、媒体下载等）产出统一格式的「待处理文件」或 URL，由 Ingestion 统一执行下载（若需要）、解析、分块/多模态处理、向量化、写入；大任务通过 Celery 异步执行，进度写入 Redis 供前端轮询或 SSE 推送。

### 2.2 分块策略

- **文档**：递归语义分块（按段落/句子与长度限制）、重叠窗口（如 max_chunk_size=1000，chunk_overlap=200）；配置参数集中管理。
- **图片/音频/视频**：不做传统「分块」，而以**单条记录**为单位：图片为单张 caption + 双路向量；音频为整段转写+描述 + text_vec/clap_vec（+ 可选 sparse）；视频为整体描述 + 关键帧信息 + text_vec/关键帧 clip_vec。检索时按条返回，精排与上下文构建时按条引用。

**实现方案要点：**

- **文档分块**：入口根据解析结果类型（Markdown、纯文本等）选择策略：已有结构的按标题/段落先切大块，单块若仍超过 `max_chunk_size`（如 1000 字符）则进入递归切分；递归时优先按句号、换行等边界再切，并遵守 `min_chunk_size`（如 100 字符）避免过碎。重叠在递归完成后统一施加：对相邻 chunk 在边界处取 `chunk_overlap`（如 200 字符）的公共内容，保证上下文连贯、检索时边界信息不丢失。
- **文档内嵌图片**：先对文档解析得到的图片逐张做 VLM 描述并上传 MinIO，再将每张图的 caption 按占位符插回 Markdown 原文（如 `[图注：xxx]`），最后对这份「补全后的 Markdown」做上述分块与向量化，这样同一段文字中若含图片说明，会与周围文本一起被切进同一或相邻 chunk，便于检索与引用。
- **多模态条目不切块**：每条图片/音频/视频在向量库中对应一个 Point，其「内容」为 caption/transcript+description/视频整体描述（+ 关键帧 JSON），不再做子块切分。
- 每个**文档** chunk 写入向量库时携带 `context_window`：保存前一个与后一个 chunk 的 ID（或临时 ID），便于调试时拉取「前文/后文」做上下文透视（Small-to-Big 扩展可按需使用）。

### 2.3 向量化策略

- **文档 Chunk**：
  - **Dense**：统一文本嵌入模型（如 Qwen3-Embedding-8B）生成 4096 维向量。
  - **Sparse**：BGE-M3 稀疏编码（`core/sparse_encoder.py`），写入 Qdrant 的 `sparse` 命名向量，用于稀疏检索。详见 `docs/SPARSE_RETRIEVAL_IMPLEMENTATION.md`。
- **图片**：
  - **VLM 描述**：调用 VLM（如 Qwen3-VL-30B-A3B-Instruct）生成 caption，再对 caption 做文本向量化（与文档同模型）。
  - **CLIP**：`openai/clip-vit-large-patch14`，768 维视觉向量。
  - 同一 Point 使用 Qdrant Named Vector：`text_vec` + `clip_vec`，检索时双路 RRF 融合。
- **音频**：
  - **ASR + 描述**：音频经 ASR（如 Qwen3-Omni / 多模态 API）转写得到 transcript，再经 LLM 生成「主要内容、语气、场景」等描述；拼接后做文本向量化。
  - **CLAP**：`laion/clap-htsat-fused` 提取 512 维声学向量；可选 BGE-M3 稀疏与文档一致。
  - 同一 Point：`text_vec`（4096）+ `clap_vec`（512），可选 `sparse`；检索时 text + clap 双路 RRF，可与 sparse 融合。
- **视频**：
  - **关键帧 VLM + 整体描述**：按间隔提取关键帧，每帧 VLM 生成描述；可选抽音轨做 ASR；LLM 根据关键帧描述（+ 音频转写）生成视频整体描述。
  - **文本向量**：对整体描述（可选拼接转写）做 Dense 嵌入（4096 维）。
  - **CLIP**：对每个关键帧用 CLIP 编码得到 768 维 `clip_vec`（一关键帧一点）。
  - 同一 Point：`text_vec` + `clip_vec`；检索时双路 RRF 与 Dense/Sparse/Visual/Audio 一起融合。

**实现方案要点：**

- **文档**：每个 chunk 的文本先经 Dense 模型得到 4096 维向量，再经 BGE-M3 的 `encode_corpus` 得到稀疏表示（indices + values）；写入 Qdrant 时该 Point 同时带 `dense` 与 `sparse` 两个命名向量，检索阶段 Dense 路与 Sparse 路可独立查询再融合。BGE-M3 采用懒加载、Float16 以控制显存。
- **图片**：先调用 VLM（Prompt 中可注入文档内图时的标题、周围上下文）得到 caption；再用与文档相同的 Dense 模型对 caption 向量化得到 `text_vec`；同时用 CLIP 对原图编码得到 768 维 `clip_vec`。若 VLM 失败则用占位描述仍写入 `text_vec`，保证 Point 完整。
- **音频**：ASR 得到 transcript，LLM 生成 description，拼接后做 Dense（4096）+ 可选 BGE-M3 sparse；CLAP 对音频解码并重采样后提取 512 维 clap_vec；写入 audio_vectors 时 Point 含 text_vec、clap_vec 及可选 sparse。
- **视频**：关键帧描述 + 整体描述（+ 可选 audio_transcript）做 Dense 得到 text_vec；每个关键帧经 CLIP 得到 clip_vec（一关键帧一点）；key_frames 等元数据写入 Payload，便于上下文构建时展示关键帧与时间戳。
- **多模态统一**：Text、Image、Audio、Video 的文本侧共用同一 Embedding 模型，便于知识库画像采样时把「文档 chunk」「图片描述」「音频转写+描述」「视频描述」放在同一空间做聚类与路由。

### 2.4 存储架构

#### 对象存储（MinIO）

- 按知识库与类型组织；路径形式如 `kb_id/...`，**文档、图片、音频、视频**分目录存放（如 `documents/`、`images/`、`audios/`、`videos/`）。
- 上传、解析后写入 MinIO；对外提供 Presigned URL 供前端预览与播放（文档/图片预览，音频/视频播放）。

#### 向量与 Chunk（Qdrant）

- **text_chunks**：文档 Chunk；向量含 `dense`（4096 维）与 `sparse`（BGE-M3）；Payload 含 text_content、kb_id、file_id、file_path、file_type、context_window、metadata 等。
- **image_vectors**：图片；Named Vector：clip_vec（768 维）、text_vec（4096 维）；Payload 含 kb_id、file_id、file_path、caption、image_source_type、img_format 等。
- **audio_vectors**：音频；Named Vector：text_vec（4096 维）、clap_vec（512 维），可选 sparse；Payload 含 kb_id、file_id、file_path、transcript、description、duration、audio_format、sample_rate 等。
- **video_vectors**：视频；每关键帧一点，Named Vector：text_vec（4096 维）、clip_vec（768 维，关键帧）；Payload 含 kb_id、file_id、file_path、description、duration、key_frames（JSON）、audio_file_id（若抽音轨）等。
- **kb_portraits**：知识库画像；向量为 4096 维；Payload 含 kb_id、topic_summary、cluster_size，用于路由阶段相似度检索与加权打分；画像采样可覆盖 Text、Image、Audio、Video 的 text_vec。

#### 异步与缓存

- 长耗时导入通过 Celery + Redis 异步执行；前端可轮询或流式查看进度。热点/定时导入见 `tasks/scheduled_hot_topics.py`。

**实现方案要点：**

- **MinIO**：按知识库划分存储空间（如按 kb_id 的 bucket 或前缀），文档、图片、音频、视频分子目录（documents/images/audios/videos）；对象路径与 `file_id`、`file_path` 在向量库 Payload 中一致保存，便于生成 Presigned URL 与删除时联动；音频/视频可提供播放用 URL。
- **Qdrant**：所有检索均先按 `kb_id` 做 Pre-filter，再执行向量/稀疏检索，保证只命中目标知识库。`text_chunks` 的 Payload 中 `context_window` 存前后 chunk 的 ID，便于调试接口按 chunk_id 拉取前后文。image_vectors、audio_vectors、video_vectors 各自独立集合，检索时按意图分别查询再融合。
- **画像更新触发**：在内容增量或定时策略下触发画像重建；画像可从 Text、Image、Audio、Video 各集合的 text_vec 按比例采样，保证全模态在路由中有表征；生成完成后采用 Replace 策略：先删除该 kb_id 下全部旧画像点，再插入新生成的 portrait 点，避免历史画像残留。

---

## 三、语义路由与检索策略

### 3.1 查询预处理（One-Pass 意图识别）

在 `retrieval/processors/intent.py` 中，将**意图分类、查询改写、关键词/多视角生成、视觉/音频/视频意图**统一为一次 LLM 调用，输出结构化 JSON（IntentObject），降低延迟并保持一致性。

- **主要字段**：reasoning、intent_type（factual/comparison/analysis/coding/creative）、is_complex、**visual_intent / audio_intent / video_intent**、search_strategies（dense_query、sparse_keywords、multi_view_queries）、sub_queries。
- **visual_intent**：explicit_demand / implicit_enrichment / unnecessary，用于决定是否执行**图片**检索及权重。
- **audio_intent** / **video_intent**：与 visual 同三档，分别控制**音频**、**视频**检索是否执行及在 RRF 中的权重（explicit 提高权重、implicit 机会主义、unnecessary 不查）。
- 查询改写与多视角在 `processors/rewriter.py` 中配合使用；稀疏侧关键词可用于 BGE-M3 查询构建。

**实现方案要点：**

- **输入**：除用户当前 query 外，将最近若干轮对话历史（如最近 5 轮、每条截断长度）格式化为文本一并放入 Prompt，便于指代消解与多轮语境下的意图判断。
- **输出与校验**：LLM 返回的 JSON 需包含上述字段；若解析失败或缺少关键字段，则使用默认意图（如 factual、refined_query 为原 query、visual_intent 为 unnecessary），保证下游检索仍可执行。
- **字段用途**：`refined_query`（或 dense_query）作为语义检索的主查询与路由查询向量来源；`sparse_keywords` 与 dense_query 可拼接后送 BGE-M3 生成稀疏查询向量；`multi_view_queries` 用于 Dense 多视角检索；`visual_intent` 为 explicit_demand 时强制走 Visual 检索并提高权重，为 implicit_enrichment 时按「机会主义」策略检索（阈值略高、limit 可调），为 unnecessary 时不查图片；`audio_intent` / `video_intent` 同理控制音频、视频检索是否执行及权重。

### 3.2 知识库画像与路由

- **画像生成**（`knowledge/portraits.py`）：
  - 从 **Text、Image、Audio、Video** 各 Collection 的 text_vec 按比例采样向量，K-Means 聚类（K 由轮廓系数/肘部法则等确定），使路由能反映全模态主题分布。
  - 对每个簇取近中心若干 Chunk/条目，经 LLM 生成 topic_summary，再向量化写入 `kb_portraits`；采用 Replace 策略更新该 KB 的画像。
- **在线路由**（`knowledge/router.py`）：
  - 使用 processed_query（refined_query）的向量在 `kb_portraits` 中检索 TopN 相似节点。
  - 按 KB 聚合：Score(KB_x) = Σ (Similarity × log(ClusterSize+1))，归一化后按阈值决定单库/多库/全库。策略细节与优化方向见 `docs/ROUTING_STRATEGY_ANALYSIS.md`、`docs/KB_PORTRAIT_ROUTING_OPTIMIZATION.md`。

**实现方案要点：**

- **画像生成**：从该 KB 的 **Text、Image、Audio、Video** 各 Collection（仅用 text_vec）中按比例采样向量（如文档/图片/音频/视频按配置比例）；若总条目数小于阈值（如 5000）则全量取，否则蓄水池采样并设上下限（如 50～1000）。采样时只带 id、vector、source_type（doc/image/audio/video），不加载正文以节省内存；确定聚类中心后，再按 id 回查各 Collection 取正文。K-Means 的 K 取 `sqrt(N/2)` 并限制在配置的 `max_kb_portrait_size` 内。每个簇取距离中心最近的 5～10 个样本，将其文本以「[文档片段]」「[图片描述]」「[音频转写/描述]」「[视频描述]」等前缀拼成 content_pieces，调用 LLM 生成一条 topic_summary，再对该摘要做 Dense 向量化；将该向量与 kb_id、topic_summary、cluster_size 写入 `kb_portraits`。存储前先删除该 kb_id 下全部旧画像（Replace 策略）。
- **路由决策**：若用户已指定知识库则直接使用，不查画像。否则用 refined_query 的 Dense 向量在 `kb_portraits` 上做**全局**向量检索（不按 kb_id 过滤），取 TopN（如 30）个最相似节点。按 kb_id 聚合时，每个 KB 只取这 TopN 中属于该 KB 的、得分最高的前 K 个节点（如 5 个），对这些节点做**位置衰减加权平均**（如 w_i = α^(i-1)），得到该 KB 的得分；再对所有 KB 得分做 min-max 归一化到 [0,1]。若最高分低于阈值（如 0.08）则判定「全部偏小」，路由失败，改为全库检索；否则取第一名，若第一名与第二名的差距 ≥ 某阈值（如 0.25）则只选第一名（单库），否则取前两名（多库）。最终输出 target_kb_ids 及置信度，供检索阶段 Pre-filter 使用。

### 3.3 混合检索（HybridSearchEngine）

- **输入**：RetrievalContext（含 refined_query、target_kb_ids、search_strategies、**visual_intent、audio_intent、video_intent** 等）。
- **文本流**：
  - **Dense**：主查询 dense_query + 多视角 multi_view_queries 向量化后检索 text_chunks，内部加权融合。
  - **Sparse**：BGE-M3 对查询（或拼接关键词）生成稀疏向量，调用 `vector_store.search_text_chunks_sparse()`，与 Dense 结果一起参与融合。
- **图片流**（当 visual_intent 非 unnecessary）：
  - 查询的文本向量匹配 text_vec；CLIP 文本向量匹配 clip_vec；Qdrant Prefetch + Fusion RRF 双路融合（image_vectors）。
- **音频流**（当 audio_intent 非 unnecessary）：
  - 查询的 text 向量 + 可选 CLAP 文本向量、BGE-M3 sparse，对 audio_vectors 双路/多路 RRF；explicit/implicit 控制 limit 与阈值。
- **视频流**（当 video_intent 非 unnecessary）：
  - 查询的 text 向量 + 可选 CLIP 文本向量，对 video_vectors 做 text_vec + clip_vec 双路 RRF。
- **融合**：**Dense、Sparse、Visual、Audio、Video** 多路结果经加权 RRF 粗排（权重按各 intent 可配置），再经 Cross-Encoder 精排取 Top-K，供上下文构建使用。

**实现方案要点：**

- **Dense**：对 dense_query 向量化得到主查询向量，对 multi_view_queries 分别向量化后与主查询一起对 Text Collection 检索，多路结果在引擎内部按权重融合（同一文档被多路命中时分数叠加），再参与全局 RRF。
- **Sparse**：用 BGE-M3 对「dense_query 与 sparse_keywords 拼接」或仅 dense_query 生成查询稀疏向量，调用 Qdrant 的 sparse 向量检索接口，在 text_chunks 上按 kb_id Pre-filter 后检索，返回列表参与 RRF。
- **Visual**：仅当 visual_intent 为 explicit_demand 或 implicit_enrichment 时执行。查询侧生成两种向量：与 text_chunks 同模型的文本向量（匹配 image 的 text_vec）、CLIP 文本向量（匹配 clip_vec）。Qdrant 使用 Prefetch + Fusion 对 text_vec 与 clip_vec 双路检索并做 RRF，得到图片候选。explicit_demand 时 limit 更大、score_threshold 更低以尽量召回；implicit_enrichment 时阈值略高、机会主义召回，若无命中则返回空列表不阻塞主流程。
- **Audio**：仅当 audio_intent 非 unnecessary 时执行；查询做 text 向量 + 可选 CLAP 文本向量与 BGE-M3 sparse，对 audio_vectors 做双路/多路 RRF；explicit 时提高 audio 路权重与 limit，implicit 时机会主义。
- **Video**：仅当 video_intent 非 unnecessary 时执行；查询做 text 向量 + 可选 CLIP 文本向量，对 video_vectors 做 text_vec + clip_vec 双路 RRF，结果参与全局融合。
- **RRF**：**Dense、Sparse、Visual、Audio、Video** 多路结果按 doc/point id 去重合并后，对每条结果的「多路排名」应用加权 RRF 公式（如 score = Σ weight_t / (k + rank_t)），权重可配（如 dense=1.0、sparse=0.8、visual=1.2、audio=1.1、video=1.1），k 通常取 60。RRF 后得到粗排列表，进入精排阶段。

### 3.4 两阶段重排

- **粗排**：RRF 将多路检索结果归一化到排名空间，避免分数量纲不一致；**visual/audio/video** 权重可根据对应 intent 调节（如 explicit 时提高），必要时可对图片/音频/视频结果做配额保证，避免被纯文本结果挤掉。
- **精排**：Reranker（如 Qwen3-Reranker-8B / BGE-Reranker-v2-m3）对 (Query, Content) 对打分，按分数取最终 Top-K。Content 对**文档**为 text_content，对**图片**为 caption，对**音频**为 transcript+description，对**视频**为 description（可选含关键帧摘要）。

**实现方案要点：**

- **粗排**：在 HybridSearchEngine 内完成，输出为带 RRF 分数的合并列表；可对 visual/audio/video intent 为 explicit 时提高对应路权重，或对 implicit 时为图片/音频/视频预留最低配额，避免多模态结果被纯文本完全挤掉。
- **精排**：从粗排结果中取前若干名（如 20）作为候选，构建 (query, content) 对：**文档**用 text_content，**图片**用 caption（可加「[图片描述]:」前缀），**音频**用 transcript+description，**视频**用 description。调用 Cross-Encoder 批量打分后，将精排分数与 RRF 分数按权重（如 0.7 精排 + 0.3 RRF）合并，再按合并分数排序，取 final_top_k（如 10）条。
- **多模态保护**：当 visual_intent/audio_intent/video_intent 为 implicit_enrichment 时，最终截取 Top-K 时可对各类别采用「至少保留若干条」的配额策略，保证隐性需求下仍有相应模态的曝光。

---

## 四、LLM 上下文构建与返回内容构造

### 4.1 上下文构建（ContextBuilder）

- 接收重排后的 Top-K（**文档 Chunk + 图片 + 音频 + 视频**），建立**会话级引用映射**：序号 1,2,3... 对应 chunk_id/point_id、file_path、MinIO URL、content_type 等。
- **多模态模板**（`generation/templates/multimodal_fmt.py`）：
  - **文档**：`【材料 <index>】 (类型: 文档 | 来源: <file_name>) 内容片段： <text_content>`
  - **图片**：`【材料 <index>】 (类型: 图片 | 来源: <file_name>) [视觉描述]： <caption>`
  - **音频**：`【材料 <index>】 (类型: 音频 | 来源: <file_name>) [转写/描述]： <transcript/description>`
  - **视频**：`【材料 <index>】 (类型: 视频 | 来源: <file_name>) [描述/关键帧摘要]： <description>`
- 系统提示词（`core/llm/prompt.py`、`generation/templates/system_prompts.py`）规定引用格式（如 `[id]`）、**文档/图片/音频/视频**多模态描述方式及诚实回答原则。

**实现方案要点：**

- **引用映射**：对重排后的结果按最终分数排序，依次分配序号 1、2、3…；每条结果对应一个 ReferenceMap 条目，包含 id（序号）、**content_type（doc/image/audio/video）**、file_path、content（摘要/caption/transcript+description/视频描述）、metadata（含 score、chunk_id、kb_id 等）、以及可选的 **presigned_url / audio_url / video_url**。文档类引用保留 chunk_id，便于调试时按 point id 拉取 context_window 前后文；音频/视频引用可带播放 URL 与时长、关键帧等。
- **上下文长度控制**：设 max_context_length（如 4000 字符）、max_chunks、**max_images / max_audios / max_videos**（及 implicit 时略多的配额），按相关性顺序填入对应模板直至达限；超长时可在不破坏引用序号的前提下截断或省略部分材料，并保证 reference_map 与 prompt 中的序号一致。
- **全模态展示**：**音频**引用除文本描述外，生成 Presigned URL 供前端播放；**视频**引用可带关键帧信息或关键帧图片 URL，并将关键帧作为独立「图片」引用加入 reference_map，使模型能以 [n] 引用关键帧图；citation 的 debug_info 可区分 doc/image/audio/video 便于前端渲染。
- **系统提示词**：按意图类型（如 factual / analysis / creative）可选用不同 system prompt 模板；模板中明确要求回答中事实必须带 [id]、禁止捏造编号、**文档/图片/音频/视频**等材料需在文中点明类型，以及「未找到则诚实说明」等原则。

### 4.2 流式返回与前端展示

- **StreamManager** 通过 SSE 推送：思考链（thought）、引用元数据（citation）、消息流（message）。
- 前端：引文悬浮（CitationPopover）、图片灯箱、打字机流式展示；思考胶囊（ThinkingCapsule）展示意图、路由、检索策略等，实现“白盒化”思考。

**实现方案要点：**

- **SSE 事件类型**：`thought` 用于推送意图识别、路由、检索策略等中间状态，前端据此更新 ThinkingCapsule（如 intent_type、refined_query、target_kbs、**visual_intent、audio_intent、video_intent**、sparse_keywords 等）。`citation` 在上下文构建完成后、生成开始前发送，payload 为 reference_map 的 frontend 友好格式（id、**type：doc/image/audio/video**、file_name、content 摘要、**img_url/audio_url/video_url**、scores、debug_info 含 chunk_id 与 context_window）；前端可预加载引用卡片，并在用户悬停 [n] 时按类型展示预览/播放器。`message` 为 LLM 流式输出的 delta，前端做打字机渲染与 Markdown 解析。
- **引用与调试**：doc 类型引用在 debug_info 中带 chunk_id；若后端支持，可异步拉取该 chunk 的 context_window（prev/next 文本）并注入 citation。**音频/视频**引用通过 audio_url/video_url 与关键帧信息支持播放与时间戳跳转，供「上下文透视」与多模态调试使用。

---

## 五、模块化 LLM 管理器

- **职责**：统一封装 **chat、embed、vision、rerank** 以及 **音频转写（ASR）、多模态描述**等能力，业务层按任务类型调用，不关心具体厂商或模型实例。
- **核心位置**：`backend/app/core/llm/`。
  - **manager**：对外接口与任务路由。
  - **registry**：模型注册表与任务到模型的映射（如 **intent_recognition、image_captioning、audio_transcription、final_generation、reranking** 等）。
  - **prompt.py**：所有提示词模板字符串（含 **image_captioning、audio_transcription** 等）；**prompt_engine.py**：加载 prompt 模块并对外提供 `render_template` 等。
  - **providers**：silicon_flow、openrouter、aliyun_bailian、deepseek 等，实现统一协议（如 OpenAI 兼容），**多模态任务**（图注、ASR、视频描述）由支持多模态的模型承接。
- **其他核心组件**：
  - **sparse_encoder.py**：BGE-M3 稀疏编码，供 Ingestion 写入与 Retrieval 查询使用（文档与可选音频 sparse）。
  - **portrait_trigger.py**：知识库画像更新触发逻辑（可覆盖全模态 text_vec 采样）。
  - **keyword_extract.py**：关键词提取等，供检索与改写使用。

模型与 API 参考：SiliconFlow 等（见文档内表格与 `docs/OpenRouter&AliyunBailian LLM API.md`）；任务与模型对应关系可在 registry 中配置或扩展。

**实现方案要点：**

- **任务路由**：业务层调用时指定 `task_type`（如 **intent_recognition、image_captioning、audio_transcription、final_generation、reranking、kb_portrait_generation**）；LLM Manager 根据 registry 将任务映射到具体模型与 provider，同一任务可配置主备模型，便于后续做故障转移；**多模态任务**（图注、ASR、视频/音频描述）由支持对应模态的 API 承接。
- **统一接口**：chat（含多轮消息、temperature、**多模态输入如图片/音频**）、embed（文本列表）、rerank（query + documents）等对上层统一；底层各 provider 实现 OpenAI 兼容的请求/响应格式，Manager 负责拼装与解析。
- **提示词**：所有模板字符串集中在 `prompt.py`，由 `prompt_engine` 加载并对外提供 `render_template(template_name, **kwargs)`；各业务模块只传变量名与值，不写死 Prompt 内容；**image_captioning、audio_transcription** 等模板支持文档内图上下文、语音/音乐策略等，便于全模态迭代。
- **可观测与弹性**：每次调用可记录 task_type、model、耗时、Token 用量、成功/失败；超时或失败时可选择重试或回退到默认结果，精排/生成等关键路径可考虑备用模型切换（当前实现中部分能力可选配）。

---

## 六、前端交互设计要点

- **动态思维胶囊**：展示 intent_type、refined_query、路由结果（目标 KB、全库 fallback）、检索策略（**Dense/Sparse/Visual/Audio/Video**）。
- **多模态流式渲染**：SSE 解析 thought / citation / message；引用处按类型展示：**文档**片段、**图片**悬浮预览与灯箱、**音频/视频**内嵌播放器与关键帧。
- **知识库与画像**：知识库列表与详情；可选画像视图（主题气泡、数据比例），画像可反映**文档/图片/音频/视频**的主题分布。
- **上传与管道**：上传进度、解析/向量化/画像更新等阶段状态展示；支持**文档、图片、音频、视频**多类型上传与管道状态。
- **调试**：RAG 检查器、引用得分构成、上下文窗口前后文等（InspectorDrawer 等）；多模态引用可区分 doc/image/audio/video 的得分与来源。

前后端数据结构约定（SSE 事件、Citation 结构等）见原文档“数据结构定义”部分及前端 `architectureData`、Stream 相关实现。

**实现方案要点：**

- **ThinkingCapsule**：消费 SSE 的 `thought` 事件，将 intent_type、refined_query、sub_queries、target_kbs（含 id、name、score）、routing_method、以及 **Dense/Sparse/Visual/Audio/Video** 是否激活、sparse_keywords 等展示为可读状态或迷你图表，便于用户理解「为何选这些库、用了哪些检索路」。
- **CitationPopover**：根据消息中的 [n] 与 citation 列表匹配，悬停时展示对应条目的 file_name、content 摘要、**类型（doc/image/audio/video）**；若 backend 在 debug_info 中提供 context_window，可展示前文/后文或「展开上下文」。
- **全模态引用展示**：**文档**引用展示片段与 context_window；**图片**引用展示缩略图或 Presigned URL，点击进入灯箱；**音频**引用提供 audio_url 内嵌播放器；**视频**引用提供 video_url 播放器，并可展示关键帧与时间戳，便于与回答对照。

---

## 七、项目架构与目录结构

以下为当前工程结构，遵循 DDD 与模块化分层。

### 7.1 项目根目录

```text
MMAA-agent/
├── backend/                    # 后端 (Python / FastAPI)
│   ├── app/
│   │   ├── api/                 # 接口层
│   │   ├── core/                # 基础设施与 LLM 管理层
│   │   ├── modules/             # 业务模块
│   │   ├── tasks/               # 定时/异步任务
│   │   └── main.py
│   ├── requirements.txt
│   └── celery_app.py
├── frontend/                    # 前端 (React / TypeScript / Vite)
│   └── src/
├── minio_data/                  # MinIO 持久化（本地映射）
├── qdrant_storage/              # Qdrant 持久化（本地映射）
├── docker-compose.yml
└── backend/.env                 # 本地配置（勿提交；模板见 backend/.env.example）
```

### 7.2 后端 app 结构

```text
app/
├── api/
│   ├── chat.py                  # 对话流式接口 /api/chat/stream
│   ├── upload.py                # 文件上传
│   ├── knowledge.py             # 知识库 CRUD
│   ├── import_api.py            # 导入任务（URL/文件夹/热点等）
│   └── debug.py                 # 调试接口
├── core/
│   ├── config.py
│   ├── logger.py
│   ├── sparse_encoder.py        # BGE-M3 稀疏编码
│   ├── portrait_trigger.py      # 画像更新触发
│   ├── keyword_extract.py
│   └── llm/
│       ├── manager.py           # LLMManager
│       ├── registry.py          # 模型注册与任务路由
│       ├── prompt.py            # 提示词模板定义
│       ├── prompt_engine.py     # 模板渲染入口
│       └── providers/
│           ├── base.py
│           ├── silicon_flow.py
│           ├── openrouter.py
│           ├── aliyun_bailian.py
│           └── deepseek.py
├── modules/
│   ├── ingestion/               # 数据输入与存储
│   │   ├── service.py
│   │   ├── hot_topics_ingest.py
│   │   ├── parsers/
│   │   │   ├── factory.py       # ParserFactory
│   │   │   ├── mineru_client.py
│   │   │   └── paddleocr_client.py
│   │   ├── sources/            # 多来源接入
│   │   │   ├── base.py
│   │   │   ├── url.py
│   │   │   ├── folder.py
│   │   │   ├── tavily_hot_topics.py
│   │   │   └── media_downloader.py
│   │   └── storage/
│   │       ├── minio_adapter.py
│   │       └── vector_store.py
│   ├── knowledge/              # 知识库与画像
│   │   ├── service.py
│   │   ├── portraits.py        # 画像生成
│   │   └── router.py           # 路由决策
│   ├── retrieval/              # 检索
│   │   ├── service.py
│   │   ├── processors/
│   │   │   ├── intent.py       # One-Pass 意图
│   │   │   └── rewriter.py
│   │   ├── search_engine.py    # 混合检索
│   │   └── reranker.py
│   └── generation/             # 生成与流式
│       ├── service.py
│       ├── context_builder.py
│       ├── stream_manager.py
│       └── templates/
│           ├── system_prompts.py
│           └── multimodal_fmt.py
└── tasks/
    └── scheduled_hot_topics.py
```

### 7.3 前端 src 结构要点

```text
frontend/src/
├── components/
│   ├── chat/                    # ChatInterface, MessageBubble, ThinkingCapsule, CitationPopover 等
│   ├── knowledge/               # 知识库列表、画像、上传管道等
│   ├── architecture/            # 架构页：总览、架构图、请求流、模块卡片、数据流、技术栈等
│   ├── settings/
│   └── debug/
├── data/
│   └── architectureData.ts     # 架构页数据（总览、模块、请求流、创新点等）
├── services/                    # API 客户端、SSE 流解析等
├── store/
└── hooks/
```

---

## 八、相关文档索引

| 文档 | 说明 |
|------|------|
| ARCHITECTURE_COMPLIANCE_ANALYSIS.md | 架构实现符合度分析 |
| SPARSE_RETRIEVAL_IMPLEMENTATION.md | BGE-M3 稀疏检索实现 |
| ROUTING_STRATEGY_ANALYSIS.md | 路由策略与实现差距 |
| KB_PORTRAIT_ROUTING_OPTIMIZATION.md | 知识库画像与路由优化 |
| MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC.md | 多模态（图/音/视）技术方案 |
| MinerU_API文档.md | MinerU 解析接口 |
| 视频模态技术方案.md | 视频模态扩展方案 |

以上为当前 MMAA 架构设计及实现概要，后续迭代以代码与上述文档为准。
