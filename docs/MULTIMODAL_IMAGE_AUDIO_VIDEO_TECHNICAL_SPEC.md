# 多模态（图片、音频、视频）全流程技术方案

本文档描述当前系统中**图片**、**音频**、**视频**三种模态从**解析处理**、**存储**到**检索**的完整技术细节，与 **[MMAA_ARCHITECTURE.md](./MMAA_ARCHITECTURE.md)** 中的 Ingestion / Retrieval 设计一致。

**项目侧要点（与其它「仅文本 RAG」的差异）**：

- **统一文本嵌入空间**：图片描述、音频转写+描述、视频场景/帧描述与文档 chunk 共用同一 Dense 模型（如 Qwen3-Embedding），便于画像采样与跨模态路由。
- **专用向量 + 双路/多路 RRF**：图片 `text_vec + clip_vec`；音频 `text_vec + clap_vec`（可选 sparse）；视频 **`scene_vec + frame_vec + clip_vec`**（每关键帧一点，三路 Prefetch + Fusion RRF）。
- **意图驱动权重**：One-Pass 输出 `visual_intent` / `audio_intent` / `video_intent`；音频在 `unnecessary` 时**不检索**；视频检索**每次执行**，CLIP 侧是否参与由 **`visual_intent`** 与查询构造联动，`video_intent` 主要调节 RRF 中 video 路权重（见架构文档检索节）。

---

## 一、总体架构

- **解析层**：`backend/app/modules/ingestion/parsers/factory.py` 中的 `ImageParser`、`AudioParser`、`VideoParser`，由 `ParserFactory` 按文件扩展名/内容检测后调用。
- **处理层**：`backend/app/modules/ingestion/service.py` 的 `IngestionService`，负责 VLM/CLIP、ASR/CLAP、MLLM 视频场景解析与关键帧向量化等流水线。
- **存储层**：
  - **对象存储**：MinIO，**每知识库独立 Bucket**（`kb-{sanitize(kb_id)}`），对象路径含 `images/`、`audios/`、`videos/`（视频关键帧图为 `videos/{file_id}/keyframes/...`）。
  - **向量存储**：Qdrant，集合 `image_vectors`、`audio_vectors`、`video_vectors`。
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
  - 用查询文本生成 **text 嵌入**（与 text_chunks 同模型）和 **CLIP 文本向量**（768 维）。
  - 若 CLIP 可用：`vector_store.search_image_vectors_dual_rrf(text_query_vector, clip_query_vector, ...)`，即 Qdrant 的 Prefetch + Fusion RRF（text_vec 与 clip_vec 双路）。
  - 若 **CLIP** 文本向量不可用：仅 `search_image_vectors(query_vector, ...)`（单路 text_vec）。
- **与视频的交叉**：当 CLIP 双路可用时，`_visual_search` 会用同一批 **text_query_vector + clip_text_vector** 再查 `video_vectors`，将命中的**关键帧**以「类图片」形式并入 Visual 结果（`from_video_keyframe`），避免纯图库为空时丢失视频里的画面信息。
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
     - 将 `transcript + description` 拼接后做 **密集向量**（Qwen3-Embedding-8B，4096 维）和 **稀疏向量**（BGE-M3，与 text_chunks 一致）。
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
- **入口**：用户上传视频文件；处理在 `IngestionService._process_video` 中按**时长阈值**分流（默认见 `settings.video_long_threshold_seconds`，与 `video_chunk_*` 等配置）。

### 4.2 解析（VideoParser）

- **位置**：`backend/app/modules/ingestion/parsers/factory.py`，`VideoParser`。
- **实现要点**：
  - 因 OpenCV 需文件路径，先将 `file_content` 写入临时文件，再用 `cv2.VideoCapture` 读取。
  - 读取：`fps`、`frame_count`、`width`、`height`、`duration = frame_count/fps`、`fourcc`/codec。
  - 音频：OpenCV 不提供音频检测，当前用简单启发式（文件大小与帧数据量比较）设置 `has_audio`。
  - 解析结束后删除临时文件。
- **输出**：`file_type: "video"`，`duration`、`fps`、`resolution`、`width`、`height`、`frame_count`、`format`、`codec`、`has_audio`、`file_size`，以及 `metadata`。

### 4.3 处理流水线（_process_video）

- **位置**：`backend/app/modules/ingestion/service.py` — `_process_video` →（按时长）`_process_video_short` 或 `_process_video_long`。
- **长短分流**：
  - **短视频**（时长 ≤ `video_long_threshold_seconds`）：单段交给 MLLM 做场景与关键帧规划（`_parse_video_scenes_mllm`，窗口覆盖整段）。
  - **长视频**：按 `video_chunk_window_seconds` / `video_max_chunk_duration_seconds` 等分段，每段再调用 MLLM 解析；段与段之间可做场景合并（`_merge_overlapping_scenes` 等逻辑）。
- **音轨（可选）**：若 `has_audio`，先 `_extract_video_audio`：ffmpeg 抽轨上传 MinIO（如 `audios/{video_file_id}_...`），`audio_file_id` 写入后续关键帧点的 payload，便于预览与溯源。
- **关键帧点构建**（`_build_keyframe_points_from_scenes`）——与旧版「整段一个点」不同，当前实现为 **一关键帧一条 Qdrant 点**：
  1. 对每个场景的 `scene_summary` 做 Dense 嵌入 → **`scene_vec`**（4096）。
  2. 对每个关键帧的 `description` 做 Dense 嵌入 → **`frame_vec`**（4096）；嵌入失败时回退为对应 `scene_vec`。
  3. 按时间戳从视频中截帧（`_extract_frame_at_timestamp`），JPEG 上传 MinIO：`videos/{file_id}/keyframes/{segment_id}_{ts}.jpg` → **`frame_image_path`**。
  4. 对帧字节调用 `_vectorize_with_clip` → **`clip_vec`**（768，失败则为零向量）。
  5. **Payload**（节选）：`segment_id`、`scene_start_time` / `scene_end_time`、`scene_summary`、`frame_timestamp`、`frame_description`、`frame_image_path`、`duration`、`video_format`、`resolution`、`fps`、`has_audio`、`audio_file_id`（可选）。
- **写入 Qdrant**：`vector_store.upsert_video_vectors(kb_id, keyframe_points)` 批量 upsert；大视频按 `VIDEO_VECTORS_UPSERT_BATCH_SIZE` 分批，避免单次请求超过 Qdrant 体积限制。

### 4.4 存储

**MinIO**

- 桶：每知识库独立 Bucket（见 `MinIOAdapter.bucket_name_for_kb`）。
- 原始视频：`videos/{file_id}_{原始文件名}`（与上传约定一致）。
- **关键帧图**：`videos/{file_id}/keyframes/...jpg`（见上）。
- 若提取音频：另有 `audios/` 下对象。

**Qdrant（video_vectors）**

- **多向量（每关键帧一点）**：`scene_vec`（4096）、`frame_vec`（4096）、`clip_vec`（768），均为 COSINE；见 `vector_store.collections["video_vectors"]`。
- **Payload**：以 `scene_summary`、`frame_description`、`frame_image_path`、时间戳与 `segment_id` 为主，支撑检索结果展示与前端预览。

### 4.5 检索

- **`vector_store.search_video_vectors`**：对查询文本生成 **同一 Dense 向量**，在 **`scene_vec` 与 `frame_vec` 上各做 Prefetch**；若传入 `clip_vector`（CLIP 文本侧），再对 **`clip_vec` 做 Prefetch**；最后 **Fusion RRF** 融合多路（实现上为三路 prefetch + RRF，而非旧的「仅 text_vec + clip_vec」双路）。
- **`HybridSearchEngine._video_search`**：调用上述检索后，将结果格式化为 `content_type: "video"`；再按 **`(file_id, segment_id)` 分组**，每组保留 **得分最高的一帧** 作为该场景代表，避免上下文被大量相邻关键帧刷屏。
- **与 Visual 的衔接**：`_visual_search` 在 CLIP 双路可用时，会用 **同一 text + CLIP 查询向量** 检索 `video_vectors`，把关键帧 hits **并入 Visual 结果列表**（标记 `from_video_keyframe`），使「找图」类查询也能命中视频里的画面。
- **`visual_intent` 与 CLIP**：`_video_search` 仅在 `visual_intent != "unnecessary"` 时传入 `visual_query` 以生成 CLIP 向量；否则只用 Dense 向量检索 `scene_vec`/`frame_vec`（不传 `clip_vector`）。
- **融合**：Video 路在 `_fuse_results` 中与 Dense、Sparse、Visual、Audio 一起做加权 RRF；`video_intent` 调节 **video 路权重**（显式/隐性提高；与音频「`unnecessary` 时整路不检索」不同，视频检索仍会执行，见架构文档说明）。

---

## 五、跨模态一致性要点

| 项目         | 图片           | 音频                 | 视频                     |
|--------------|----------------|----------------------|--------------------------|
| 解析器       | ImageParser    | AudioParser          | VideoParser              |
| 文本/语义向量 | Qwen3-Embedding 4096（`text_vec`） | 同左 + BGE-M3 稀疏（可选） | 每帧：`scene_vec` + `frame_vec`（均为 4096，来自场景摘要与帧描述嵌入） |
| 专用向量     | CLIP 768（`clip_vec`） | CLAP 512（`clap_vec`） | CLIP 768（`clip_vec`，每关键帧） |
| 多模态生成   | VLM 图注       | ASR + 描述           | MLLM 场景/关键帧规划 + 截帧 CLIP（可选 ffmpeg 抽音轨） |
| MinIO        | `images/`      | `audios/`            | `videos/` + `videos/{file_id}/keyframes/`（+ 抽音轨时 `audios/`） |
| Qdrant 集合  | image_vectors  | audio_vectors        | video_vectors（**一关键帧一点**） |
| 检索融合     | text + clip 双路 RRF | text + clap（+ sparse）RRF | **scene + frame（+ clip）** 多路 Prefetch + RRF；Visual 检索可并入关键帧 hits |

---

## 六、关键代码路径索引

- **解析器**：`backend/app/modules/ingestion/parsers/factory.py` — `ImageParser`、`AudioParser`、`VideoParser`，`ParserFactory.detect_file_type`。
- **上传与路由**：`backend/app/modules/ingestion/service.py` — `process_file_upload`（按 file_type 分支到 `_process_image` / `_process_audio` / `_process_video`）。
- **VLM/CLIP/ASR/CLAP**：同上 — `_generate_image_caption`、`_vectorize_with_clip`、`_transcribe_audio`、`_generate_audio_description`、`_extract_audio_clap_features`；视频：`_parse_video_scenes_mllm`、`_build_keyframe_points_from_scenes`、`_extract_frame_at_timestamp`、`_extract_video_audio`、`_process_video_short` / `_process_video_long`。
- **MinIO**：`backend/app/modules/ingestion/storage/minio_adapter.py` — `upload_file`、`bucket_name_for_kb` / `get_bucket_for_kb`、关键帧 `custom_object_path`。
- **向量存储**：`backend/app/modules/ingestion/storage/vector_store.py` — `upsert_image_vectors`、`upsert_audio_vectors`、`upsert_video_vectors`；`search_video_vectors`（scene/frame/clip 三路 RRF）；集合配置见 `self.collections`。
- **检索**：`backend/app/modules/retrieval/search_engine.py` — `_visual_search`（含 video 关键帧并入）、`_audio_search`、`_video_search`；`search_image_vectors_dual_rrf`、`search_audio_vectors_dual_rrf`；`_fuse_results` 与动态 RRF 权重。
- **意图与 Prompt**：`backend/app/core/llm/prompt.py`；`processors/intent.py`（`visual_intent` / `audio_intent` / `video_intent`）。

---

## 七、依赖与配置摘要

- **运行依赖**：PIL、librosa、soundfile、opencv-python、torch、transformers（CLIP/CLAP）、ffmpeg（视频抽音轨与部分解析路径）。
- **外部服务**：MinIO、Qdrant、LLM/Embedding/VLM/MLLM API（由 `llm_manager` 与 `task_type` 路由）。
- **配置**：`backend/app/core/config.py`（含 `video_long_threshold_seconds`、`video_chunk_*` 等）；Qdrant 集合与向量名见 `vector_store.collections`。

以上即为当前系统对图片、音频、视频三种模态的解析、处理、存储与检索的详细技术方案。
