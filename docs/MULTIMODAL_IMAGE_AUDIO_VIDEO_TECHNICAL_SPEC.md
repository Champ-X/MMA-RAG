# 多模态（图片、音频、视频）全流程技术方案

本文档描述当前系统中**图片**、**音频**、**视频**三种模态从**解析处理**、**存储**到**检索**的完整技术细节。

---

## 一、总体架构

- **解析层**：`backend/app/modules/ingestion/parsers/factory.py` 中的 `ImageParser`、`AudioParser`、`VideoParser`，由 `ParserFactory` 按文件扩展名/内容检测后调用。
- **处理层**：`backend/app/modules/ingestion/service.py` 的 `IngestionService`，负责 VLM/CLIP/ASR/CLAP/关键帧等流水线。
- **存储层**：
  - **对象存储**：MinIO，按知识库分桶，目录前缀 `images/`、`audios/`、`videos/`。
  - **向量存储**：Qdrant，集合 `image_vectors`、`audio_vectors`、`video_vectors`。
- **检索层**：`backend/app/modules/retrieval/search_engine.py` 的 `HybridSearchEngine`，与 Dense/Sparse 一起做 RRF 融合。

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
  - 若 CLAP 不可用：仅 `search_image_vectors(query_vector, ...)`（单路 text_vec）。
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
- **入口**：用户上传视频文件。

### 4.2 解析（VideoParser）

- **位置**：`backend/app/modules/ingestion/parsers/factory.py`，`VideoParser`。
- **实现要点**：
  - 因 OpenCV 需文件路径，先将 `file_content` 写入临时文件，再用 `cv2.VideoCapture` 读取。
  - 读取：`fps`、`frame_count`、`width`、`height`、`duration = frame_count/fps`、`fourcc`/codec。
  - 音频：OpenCV 不提供音频检测，当前用简单启发式（文件大小与帧数据量比较）设置 `has_audio`。
  - 解析结束后删除临时文件。
- **输出**：`file_type: "video"`，`duration`、`fps`、`resolution`、`width`、`height`、`frame_count`、`format`、`codec`、`has_audio`、`file_size`，以及 `metadata`。

### 4.3 处理流水线（_process_video）

- **位置**：`backend/app/modules/ingestion/service.py`，`IngestionService._process_video`。
- **步骤**：
  1. **关键帧提取**  
     - `_extract_key_frames(file_content, processing_id, interval=10.0)`。  
     - 视频写入临时文件，OpenCV 按帧读取；每隔 `interval` 秒（默认 10 秒）取一帧，转 RGB → JPEG → base64。  
     - 每帧保存：`timestamp`、`frame_index`、`base64_content`、`image_bytes`、`width`、`height`，`description` 先空后填。
  2. **关键帧描述**  
     - 对每一帧调用 `_generate_image_caption(frame["base64_content"], ..., image_format="jpg")`，与图片流水线共用 VLM，将返回的 `caption` 写入 `frame["description"]`。
  3. **音频提取（若 has_audio）**  
     - `_extract_video_audio(video_bytes, video_file_id, kb_id, processing_id)`：ffmpeg 抽轨为 mp3，上传到 MinIO（`audios/{video_file_id}_audio.mp3`），再对抽出的音频做 `_transcribe_audio`，得到 `audio_file_id` 与 `audio_transcript`。
  4. **视频整体描述**  
     - `_generate_video_description(video_bytes, key_frame_descriptions, audio_transcript, video_format, processing_id)`：将前若干关键帧描述与音频转写拼成 prompt，LLM 生成一段整体描述。
  5. **向量化**  
     - 视频描述（可选拼接音频转写）做 **text 嵌入**（4096 维）。  
     - 对每个关键帧用 `_vectorize_with_clip` 得到 **clip_vec**（768 维）；当前写入 Qdrant 时仅用**第一帧的 clip_vec** 作为该视频点的 `clip_vec`（见 vector_store.upsert_video_vectors）。
  6. **写入 Qdrant**  
     - `vector_store.upsert_video_vectors(kb_id, videos)`。  
     - 每个点：`text_vec`、`clip_vec`（首帧 CLIP 或零向量）；payload 中含 `key_frames` 的 JSON 序列化及可选 `audio_file_id`。

### 4.4 存储

**MinIO**

- 桶：同一知识库桶，对象前缀 `videos/`。
- 对象名：`videos/{file_id}_{原始文件名}`。  
- 若提取音频，另有 `audios/{video_file_id}_audio.mp3`。

**Qdrant（video_vectors）**

- **多向量**：`text_vec` 4096 维，`clip_vec` 768 维（首帧 CLIP 或零向量）。
- **Payload**：`kb_id`、`file_id`、`file_path`、`description`、`duration`、`video_format`、`resolution`、`fps`、`has_audio`、`key_frames`（JSON 字符串）、`audio_file_id`（可选）、`created_at`。

### 4.5 检索

- **策略**（`HybridSearchEngine._video_search`）：
  - 查询文本做 **text 向量**（4096 维）。  
  - 若存在视觉意图（即传入 `visual_query`），再生成 **CLIP 文本向量**（768 维）。
  - `vector_store.search_video_vectors(query_vector, clip_vector, target_kb_ids, limit)`：  
    - 若提供 `clip_vector`：Prefetch 双路（text_vec + clip_vec）+ Fusion RRF。  
    - 否则：仅用 text_vec 查询。
- **融合**：Video 结果参与全局 RRF，权重固定（如 1.1），与 Dense、Sparse、Visual、Audio 一起在 `_fuse_results` 中按 rank 做 RRF。

---

## 五、跨模态一致性要点

| 项目         | 图片           | 音频                 | 视频                     |
|--------------|----------------|----------------------|--------------------------|
| 解析器       | ImageParser    | AudioParser          | VideoParser              |
| 文本/语义向量 | Qwen3-Embedding 4096 维 | 同左 + BGE-M3 稀疏   | 同左（仅 dense）         |
| 专用向量     | CLIP 768 维    | CLAP 512 维          | CLIP 768 维（首帧）      |
| 多模态生成   | VLM 图注       | ASR + 描述           | 关键帧 VLM + 整体描述 + 可选 ASR |
| MinIO 前缀   | images/        | audios/              | videos/（+ audios/ 若抽音轨） |
| Qdrant 集合  | image_vectors  | audio_vectors        | video_vectors             |
| 检索双路     | text_vec + clip_vec RRF | text_vec + clap_vec RRF（+ sparse） | text_vec + clip_vec RRF  |

---

## 六、关键代码路径索引

- **解析器**：`backend/app/modules/ingestion/parsers/factory.py` — `ImageParser`、`AudioParser`、`VideoParser`，`ParserFactory.detect_file_type`。
- **上传与路由**：`backend/app/modules/ingestion/service.py` — `process_file_upload`（按 file_type 分支到 `_process_image` / `_process_audio` / `_process_video`）。
- **VLM/CLIP/ASR/CLAP**：同上文件 — `_generate_image_caption`、`_vectorize_with_clip`、`_transcribe_audio`、`_generate_audio_description`、`_extract_audio_clap_features`；视频：`_extract_key_frames`、`_extract_video_audio`、`_generate_video_description`。
- **MinIO**：`backend/app/modules/ingestion/storage/minio_adapter.py` — `upload_file`、`get_bucket_for_kb`、对象名规则。
- **向量存储**：`backend/app/modules/ingestion/storage/vector_store.py` — `upsert_image_vectors`、`upsert_audio_vectors`、`upsert_video_vectors`；集合配置见 `self.collections`（image_vectors、audio_vectors、video_vectors）。
- **检索**：`backend/app/modules/retrieval/search_engine.py` — `_visual_search`、`_audio_search`、`_video_search`；`vector_store.search_image_vectors_dual_rrf`、`search_audio_vectors_dual_rrf`、`search_video_vectors`；`_fuse_results` 与 RRF 权重。
- **意图与 Prompt**：`backend/app/core/llm/prompt.py` — 视觉/音频意图说明；`image_captioning`、`audio_transcription` 等模板。

---

## 七、依赖与配置摘要

- **运行依赖**：PIL、librosa、soundfile、opencv-python、torch、transformers（CLIP/CLAP）、ffmpeg（视频抽音轨）。
- **外部服务**：MinIO（对象存储）、Qdrant（向量库）、LLM/Embedding/VLM API（如 OpenRouter、SiliconFlow 等，由 `llm_manager` 与 `task_type` 路由）。
- **配置**：各模型与 API 的 endpoint、key、task_type 等见 `app.core.config` 与 LLM 模块配置；MinIO 桶名、Qdrant 集合名见上文及 `vector_store.collections`。

以上即为当前系统对图片、音频、视频三种模态的解析、处理、存储与检索的详细技术方案。
