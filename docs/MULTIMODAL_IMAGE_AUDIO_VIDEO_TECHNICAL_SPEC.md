# 多模态（图片、音频、视频）全流程技术方案

本文档描述当前系统中**图片**、**音频**、**视频**三种模态从**解析处理**、**存储**到**检索**的完整技术细节，与 **[MMA_ARCHITECTURE.md](./MMA_ARCHITECTURE.md)** 中的 Ingestion / Retrieval 设计一致。

**项目侧要点（与其它「仅文本 RAG」的差异）**：

- **统一文本嵌入空间**：图片描述、音频转写+描述、视频 Shot 的视觉 caption/ASR 与文档 chunk 共用同一 Dense 模型（如 Qwen3-Embedding），便于跨模态检索与路由。
- **专用向量 + 双路/多路 RRF**：图片 `text_vec + clip_vec`；音频 `text_vec + clap_vec`（可选 sparse）；视频以 **Shot** 为主单元，`caption_dense + caption_sparse + asr_dense + asr_sparse` 四路加权 RRF，关键帧另存 `frame_vec + clip_vec` 作为可选视觉增强。
- **意图驱动权重**：One-Pass 输出 `visual_intent` / `audio_intent` / `video_intent`；音频在 `unnecessary` 时**不检索**；视频检索**每次执行**，CLIP 侧是否参与由 **`visual_intent`** 与查询构造联动，`video_intent` 主要调节 RRF 中 video 路权重（见架构文档检索节）。

---

## 一、总体架构

- **解析层**：`backend/app/modules/ingestion/parsers/factory.py` 中的 `ImageParser`、`AudioParser`、`VideoParser`，由 `ParserFactory` 按文件扩展名/内容检测后调用。
- **处理层**：`backend/app/modules/ingestion/service.py` 的 `IngestionService`，负责 VLM/CLIP、ASR/CLAP、MLLM 视频场景解析与关键帧向量化等流水线。
- **存储层**：
  - **对象存储**：MinIO，**每知识库独立 Bucket**（`kb-{sanitize(kb_id)}`），对象路径含 `images/`、`audios/`、`videos/`（视频关键帧图为 `videos/{file_id}/keyframes/...`）。
  - **向量存储**：Qdrant，集合 `image_vectors`、`audio_vectors`、`video_shot_vectors`、`video_keyframe_vectors`。
- **检索层**：`backend/app/modules/retrieval/search_engine.py` 的 `HybridSearchEngine`，Dense + Sparse + Visual + Audio + Video 多路并行，再 **RRF 融合**与下游重排。

---

## 二、图片模态

### 2.1 支持的格式与入口

- **扩展名**：`jpg`、`jpeg`、`png`、`gif`、`webp`、`bmp`、`tiff`、`tif`。
- **入口**：
  - 独立上传：用户直接上传图片文件。
  - 文档内嵌：PDF/DOCX/PPTX/Markdown 解析时提取的图片，走同一套 VLM+CLIP 流水线。

### 2.2 解析（ImageParser）

- **位置**：`backend/app/modules/ingestion/parsers/factory.py`，`ImageParser`。
- **输入**：`file_content: bytes`，`file_path: str`。
- **实现要点**：
  - 使用 PIL 打开图片，读取 `width`、`height`、`format`、`mode`。
  - 将原始字节 Base64 编码得到 `base64_content`，供后续 VLM 使用。
- **输出**：`file_type: "image"`，`width`、`height`、`format`、`mode`、`base64_content`，以及 `metadata`（如 `size_bytes`、`aspect_ratio`）。

### 2.3 处理流水线（_process_image）

- **位置**：`backend/app/modules/ingestion/service.py`，`IngestionService._process_image`。
- **步骤**：
  1. **VLM 生成图片描述**  
     - 调用 `_generate_image_caption(base64_content, ...)`。  
     - 使用 `prompt_engine.render_template("image_captioning")`，可传入 `document_caption`、`surrounding_context`（文档内图片时）。  
     - 请求格式：多模态消息，`image_url` + 文本 prompt；API 使用 `task_type="image_captioning"`（如 SiliconFlow/VLM）。  
     - 得到 `caption`，用于文本向量化与 payload 存储。
  2. **CLIP 图片向量化**  
     - 使用原始图片 bytes（或从 base64 解码）调用 `_vectorize_with_clip`。  
     - 模型：`openai/clip-vit-large-patch14`，输出 **768 维**归一化向量。  
     - 懒加载：`_load_clip_model()`，支持 GPU。
  3. **文本向量化**  
     - 对 `caption`（空则占位符）调用 `_vectorize_text`，使用 Qwen3-Embedding-8B，得到 **4096 维**向量。
  4. **写入 Qdrant**  
     - 调用 `vector_store.upsert_image_vectors(kb_id, images)`。  
     - 每个点包含：`clip_vec`（768 维）、`text_vec`（4096 维），以及 payload（见下）。

### 2.4 存储

**MinIO**

- 桶：按知识库 `kb-{kb_id}`，对象前缀 `images/`。
- 对象名：`images/{file_id}_{原始文件名}`。
- 独立上传的图片在解析前已上传；文档内提取的图片会再调用 `upload_file(..., file_type="images")` 写入 MinIO。

**Qdrant（image_vectors）**

- **多向量**：`clip_vec` 768 维（COSINE），`text_vec` 4096 维（COSINE）。
- **Payload**：`kb_id`、`file_id`、`file_path`、`caption`、`img_format`、`image_source_type`、`width`、`height`、`created_at`；文档内图片可有 `source_file_id`、`markdown_ref`。

### 2.5 检索

- **意图**：由 One-Pass 意图识别得到 `visual_intent`（`explicit_demand` / `implicit_enrichment` / `unnecessary`）。  
  - `unnecessary` 时不查图片；`explicit_demand` 或 `implicit_enrichment` 时执行 Visual 检索。
- **策略**（`HybridSearchEngine._visual_search`）：
  - 用查询文本生成 **text 嵌入**（与 text_chunks_agentic 同模型）和 **CLIP 文本向量**（768 维）。
  - 若 CLIP 可用：`vector_store.search_image_vectors_dual_rrf(text_query_vector, clip_query_vector, ...)`，即 Qdrant 的 Prefetch + Fusion RRF（text_vec 与 clip_vec 双路）。
  - 若 **CLIP** 文本向量不可用：仅 `search_image_vectors(query_vector, ...)`（单路 text_vec）。
- **与视频的交叉**：当 CLIP 双路可用时，`_visual_search` 会用同一批 **text_query_vector + clip_text_vector** 查询 `video_keyframe_vectors`，将命中的**关键帧**以「类图片」形式并入 Visual 结果（`from_video_keyframe`）。
- **显式/隐性**：`explicit_demand` 时 limit 更大、score_threshold 更低；`implicit_enrichment` 时阈值略高，机会主义召回。
- **融合**：Visual 检索结果与其他路（Dense、Sparse、Audio、Video）一起进入 `_fuse_results`，按 `visual_intent` 动态权重做 RRF（如 explicit 时 visual 权重 1.2，implicit 0.9，unnecessary 0）。

---

## 三、音频模态

### 3.1 支持的格式与入口

- **扩展名**：`mp3`、`wav`、`m4a`、`flac`、`aac`、`ogg`、`wma`、`opus`。
- **入口**：用户上传音频文件；视频若含音轨，可先提取音频再走音频流水线（见视频章节）。

### 3.2 解析（AudioParser）

- **位置**：`backend/app/modules/ingestion/parsers/factory.py`，`AudioParser`。
- **实现要点**：
  - 优先用 `soundfile` 读元数据（不解码整段），得到 `duration`、`samplerate`、`channels`、`format`、`subtype`。
  - 若失败则用 `librosa.load(..., duration=0.1)` 取短段再算时长。
  - 根据文件大小与时长估算 `bitrate`（kbps）。
- **输出**：`file_type: "audio"`，`duration`、`sample_rate`、`channels`、`format`、`bitrate`、`file_size`，以及 `metadata`。

### 3.3 处理流水线（_process_audio）

- **位置**：`backend/app/modules/ingestion/service.py`，`IngestionService._process_audio`。
- **步骤**：
  1. **ASR（音频转文本）**  
     - `_transcribe_audio(file_content, audio_format, processing_id)`。  
     - 音频 Base64 后，按 OpenRouter 多模态规范构造 `input_audio`（type + data + format）。  
     - 使用 `prompt_engine.render_template("audio_transcription")`（区分语音/音乐/混合策略）。  
     - 调用 `llm_manager.chat(..., task_type="audio_transcription")`（如 Qwen3-Omni / Gemini 等）。  
     - 得到 `transcript`。
  2. **音频描述生成**  
     - `_generate_audio_description(file_content, transcript, audio_format, processing_id)`。  
     - 若有较长 transcript，则用纯文本 prompt 让 LLM 生成“主要内容、语气情感、场景”等描述；否则返回默认描述。
  3. **文本向量化**  
     - 将 `transcript + description` 拼接后做 **密集向量**（Qwen3-Embedding-8B，4096 维）和 **稀疏向量**（BGE-M3，与 text_chunks_agentic 一致）。
  4. **CLAP 声学特征**  
     - `_extract_audio_clap_features(file_content, audio_format)`：librosa/soundfile 解码，重采样到 48kHz 单声道，用 `laion/clap-htsat-fused` 提取 **512 维**向量并归一化。  
     - 懒加载：`_load_clap_model()`。
  5. **写入 Qdrant**  
     - `vector_store.upsert_audio_vectors(kb_id, audios)`。  
     - 每个点：`text_vec`（4096）、`clap_vec`（512），以及可选的 `sparse`；payload 见下。

### 3.4 存储

**MinIO**

- 桶：同一知识库桶，对象前缀 `audios/`。
- 对象名：`audios/{file_id}_{原始文件名}`。视频提取的音频可为 `audios/{video_file_id}_audio.mp3`。

**Qdrant（audio_vectors）**

- **多向量**：`text_vec` 4096 维，`clap_vec` 512 维；可选 `sparse`（BGE-M3 稀疏）。
- **Payload**：`kb_id`、`file_id`、`file_path`、`transcript`、`description`、`duration`、`audio_format`、`sample_rate`、`channels`、`bitrate`、`source_type`、`created_at`；若来自视频则含 `source_file_id`。

### 3.5 检索

- **意图**：One-Pass 输出 `audio_intent`（`explicit_demand` / `implicit_enrichment` / `unnecessary`）。  
  - `unnecessary` 时 `_audio_search` 直接返回空。
- **策略**（`HybridSearchEngine._audio_search`）：
  - 查询文本做 **dense 向量** + **sparse 向量**（BGE-M3）。
  - 若有音频意图：尝试 `get_clap_text_vector_for_query(query)` 得到 CLAP 文本向量（512 维）。  
    - 若有 CLAP：`vector_store.search_audio_vectors_dual_rrf(text_query_vector, clap_query_vector, sparse_vector, ...)`（text_vec + clap_vec，可选 sparse，Qdrant Prefetch + Fusion RRF）。  
    - 若无 CLAP：`search_audio_vectors(query_vector, sparse_vector, ...)`（仅 text_vec 或 text+sparse）。
  - explicit/implicit 在 limit 与 score_threshold 上略有区分。
- **融合**：Audio 结果参与全局 `_fuse_results`，按 `audio_intent` 调整 audio 权重（explicit 1.2，implicit 0.9，unnecessary 0）。

---

## 四、视频模态

### 4.1 支持的格式与入口

- **扩展名**：`mp4`、`avi`、`mov`、`mkv`、`webm`、`flv`、`wmv`、`m4v`。
- **入口**：单文件流式上传与异步批量提交。多选文件通过 `POST /api/upload/batch/start` 先为全部有效文件持久化创建独立 `processing_id`，再统一启动后台解析；页面刷新后从 Redis 任务状态恢复“排队中 / 处理中 / 失败”。任务带 lease 心跳，服务异常退出后超时状态会在下次查询中转为失败而不会永久假处理中。视频 Scene–Shot 解析默认并发为 1（`VIDEO_PROCESSING_CONCURRENCY`），避免多个 Qwen Omni 长调用互相抢占。

### 4.2 解析（VideoParser）

- **位置**：`backend/app/modules/ingestion/parsers/factory.py`，`VideoParser`。
- **实现要点**：
  - 因 OpenCV 需文件路径，先将 `file_content` 写入临时文件，再用 `cv2.VideoCapture` 读取。
  - 读取：`fps`、`frame_count`、`width`、`height`、`duration = frame_count/fps`、`fourcc`/codec。
  - 音频：用 `ffprobe -select_streams a` 检测真实音轨；`ffprobe` 不可用时保守标记为无音轨。此标记用于元数据，不会阻止 Omni 直接理解视频内音频。
  - 解析结束后删除临时文件。
- **输出**：`file_type: "video"`，`duration`、`fps`、`resolution`、`width`、`height`、`frame_count`、`format`、`codec`、`has_audio`、`file_size`，以及 `metadata`。

### 4.3 Scene–Shot–ASR 处理流水线

- **位置**：`backend/app/modules/ingestion/service.py` 的 `_process_video_scene_shot`、`_parse_video_scene_shot_mllm`、`_build_video_scene_shot_points`；规范化与跨窗合并位于 `video_scene_shot.py`。
- **联合解析**：Qwen3.5-Omni 通过一次 `video_local` 调用同时读取画面和视频内音频。不会再把抽出的 MP3 作为主 ASR 来源，因而 Shot 的画面、caption 与语音都位于同一时间轴。
- **MLLM 输出契约**：`scene_shot_asr_v4`。
  - **Scene**：连续的时间/空间/核心话题段，保留约 100–220 字 `scene_summary` 作为上下文，不作为主检索点。
  - **Semantic Shot**：Scene 内的主检索单元，目标 8–22 秒、通常不超过 35 秒；模型以完整句子或完整动作/话题单元切分，不把普通物理切镜机械拆开。每个 Shot 有纯视觉 `caption`、原语言 `asr_text`、`asr_status` 与 `speech_boundary`。
  - **Key Frame**：MLLM 按 Shot 内真实视觉信息量自主选择 1～4 帧：稳定构图保留 1 帧，操作演示、前后结果或主体/构图显著变化时保留多帧；不以等间隔凑数。服务端仅用 `VIDEO_MAX_KEYFRAMES_PER_SHOT`（默认 4）和 `VIDEO_KEYFRAME_MIN_GAP_SECONDS`（默认 1 秒）做异常输出与近重复帧保护。
- **长视频**：时长超过 `min(VIDEO_LONG_THRESHOLD_SECONDS, VIDEO_CHUNK_WINDOW_SECONDS, VIDEO_MAX_CHUNK_DURATION_SECONDS)` 时，以 `min(VIDEO_CHUNK_WINDOW_SECONDS, VIDEO_MAX_CHUNK_DURATION_SECONDS)` 窗口切段并重叠 `VIDEO_CHUNK_OVERLAP_SECONDS`（默认 120 秒/15 秒）。较小窗口避免 Scene/Shot/ASR 的结构化 JSON 因内容过长被截断；下一窗口只携带最近场景与 ASR 尾部上下文；`merge_chunk_analyses` 只对真实重叠且 caption 高相似的 Shot 去重，随后重新连续化时间轴。
- **规范化与兜底**：模型 JSON 经 `normalize_video_analysis` 校正字段、时间范围、Scene/Shot 覆盖与关键帧落点；失败时生成一个可检索的单 Scene/Shot 兜底记录，而不是丢失整条视频。
- **向量化与写入**：
  1. `caption` → `caption_dense`（Qwen Embedding，4096）+ `caption_sparse`（BGE-M3）。
  2. `asr_text` → `asr_dense`（4096）+ `asr_sparse`；无语音 Shot 使用零 dense 向量且不写 ASR sparse，不把视觉文本伪造成语音命中。
  3. 关键帧描述 → `frame_vec`（4096）；帧图 → `clip_vec`（768）。帧图上传至 `videos/{file_id}/keyframes/...jpg`。
  4. 保存完整 `scene_shot_asr_v4` manifest 至 `videos/{file_id}/analysis/scene_shot_asr_v4.json`，便于审计和重建索引。
  5. 写入使用批量 upsert；重试前清除同文件已有 Shot 与关键帧，避免重复累积。

### 4.4 存储

**MinIO**

- 桶：每知识库独立 Bucket（见 `MinIOAdapter.bucket_name_for_kb`）。
- 原始视频：`videos/{file_id}_{原始文件名}`（与上传约定一致）。
- **关键帧图**：`videos/{file_id}/keyframes/...jpg`（见上）。
- **解析 manifest**：`videos/{file_id}/analysis/scene_shot_asr_v4.json`。

**Qdrant**

- **`video_shot_vectors`（主集合，每 Shot 一点）**：命名 dense 向量 `caption_dense`、`asr_dense`（均 4096）；命名 sparse 向量 `caption_sparse`、`asr_sparse`。Payload 含 Scene/Shot ID 与起止时间、`scene_summary`、`caption`、`asr_status`、`asr_text`、`speech_boundary`、子关键帧列表、原视频路径与 manifest 路径。
- **`video_keyframe_vectors`（可选视觉集合，每关键帧一点）**：`frame_vec`（4096）+ `clip_vec`（768）；Payload 反向关联 `file_id`、`scene_id`、`shot_id` 和 Shot 时间范围。

### 4.5 检索

- **Shot 四路主检索**：`vector_store.search_video_shots` 对同一查询分别查询 `caption_dense`、`caption_sparse`、`asr_dense`、`asr_sparse`，在客户端做加权 RRF（默认权重 1.0 / 0.75 / 1.0 / 0.9），结果以 **Shot** 返回并保留命中路由、Scene 上下文、画面描述和对齐 ASR。
- **可选关键帧增强**：仅当 `visual_intent != "unnecessary"` 时，`_video_search` 生成 CLIP 文本向量，并以 `frame_vec + clip_vec` RRF 查询 `video_keyframe_vectors`。命中的帧会提升其所属 Shot，或构造仍指向所属 Shot 的候选，不返回孤立帧。
- **与 Visual 的衔接**：`_visual_search` 查询关键帧视觉索引，把命中帧作为图片结果并入。
- **上下文与播放**：视频引用携带 `shot_start_time` / `shot_end_time`、ASR、Scene/Shot ID、关键帧路径。`MultiModalFormatter` 显示命中片段范围，前端可用原视频 URL 跳转到对应时段。
- **融合**：Video 路在 `_fuse_results` 中与 Dense、Sparse、Visual、Audio 一起做加权 RRF；`video_intent` 调节 **video 路权重**（显式/隐性提高；与音频「`unnecessary` 时整路不检索」不同，视频检索仍会执行，见架构文档说明）。

---

## 五、跨模态一致性要点

| 项目         | 图片           | 音频                 | 视频                     |
|--------------|----------------|----------------------|--------------------------|
| 解析器       | ImageParser    | AudioParser          | VideoParser              |
| 文本/语义向量 | Qwen3-Embedding 4096（`text_vec`） | 同左 + BGE-M3 稀疏（可选） | 每 Shot：`caption_dense` + `asr_dense`（4096）；各自有 BGE-M3 sparse |
| 专用向量     | CLIP 768（`clip_vec`） | CLAP 512（`clap_vec`） | 从属关键帧：`frame_vec` 4096 + `clip_vec` 768 |
| 多模态生成   | VLM 图注       | ASR + 描述           | Omni 联合 Scene/Shot/ASR 解析 + 截帧 CLIP |
| MinIO        | `images/`      | `audios/`            | `videos/` + 关键帧 + `analysis/scene_shot_asr_v4.json` |
| Qdrant 集合  | image_vectors  | audio_vectors        | `video_shot_vectors`（主）+ `video_keyframe_vectors`（可选） |
| 检索融合     | text + clip 双路 RRF | text + clap（+ sparse）RRF | **caption/asr 四路加权 RRF**；按视觉意图可增强关键帧 |

---

## 六、关键代码路径索引

- **解析器**：`backend/app/modules/ingestion/parsers/factory.py` — `ImageParser`、`AudioParser`、`VideoParser`，`ParserFactory.detect_file_type`。
- **上传与路由**：`backend/app/modules/ingestion/service.py` — `process_file_upload`（按 file_type 分支到 `_process_image` / `_process_audio` / `_process_video`）。
- **VLM/CLIP/ASR/CLAP**：同上 — `_generate_image_caption`、`_vectorize_with_clip`、`_transcribe_audio`、`_generate_audio_description`、`_extract_audio_clap_features`；视频：`_process_video_scene_shot`、`_parse_video_scene_shot_mllm`、`_build_video_scene_shot_points`、`video_scene_shot.py`、`_extract_frame_at_timestamp_from_path`。
- **MinIO**：`backend/app/modules/ingestion/storage/minio_adapter.py` — `upload_file`、`bucket_name_for_kb` / `get_bucket_for_kb`、关键帧 `custom_object_path`。
- **向量存储**：`backend/app/modules/ingestion/storage/vector_store.py` — `upsert_video_shot_vectors`、`upsert_video_keyframe_vectors`、`search_video_shots`、`search_video_keyframes`。
- **检索**：`backend/app/modules/retrieval/search_engine.py` — `_visual_search`（含 video 关键帧并入）、`_audio_search`、`_video_search`（Shot 四路 + 可选帧增强）；`_fuse_results` 与动态 RRF 权重。
- **意图与 Prompt**：`backend/app/core/llm/prompt.py`；`processors/intent.py`（`visual_intent` / `audio_intent` / `video_intent`）。

---

## 七、依赖与配置摘要

- **运行依赖**：PIL、librosa、soundfile、opencv-python、torch、transformers（CLIP/CLAP）、ffmpeg/ffprobe（视频分段与音轨检测）。
- **外部服务**：MinIO、Qdrant、LLM/Embedding/VLM/MLLM API（由 `llm_manager` 与 `task_type` 路由）。
- **配置**：`backend/app/core/config.py`（`VIDEO_CHUNK_*`、`VIDEO_PARSING_MAX_TOKENS`、`VIDEO_PARSING_TEMPERATURE` 等）；Qdrant 集合与向量名见 `vector_store.collections`。

以上即为当前系统对图片、音频、视频三种模态的解析、处理、存储与检索的详细技术方案。
