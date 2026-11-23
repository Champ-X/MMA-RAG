# 图片、音频与视频的入库和检索

入库先保存原文件，再建立可以搜索和引用的记录。图片通常对应一条图片记录，独立音频对应一条音频记录。视频按有起止时间的语义镜头（Shot）检索，一段视频可以返回多个镜头。本文描述常规检索，Pi 读取同一批来源时使用自己的工具。[系统架构](MMA_ARCHITECTURE.md) · [Pi 工具](PI_AGENT_MODE.md)

## 上传与解析

| 类型 | 文件上传接口接受的扩展名 | 解析内容 |
| --- | --- | --- |
| 图片 | jpg、jpeg、png、gif、webp、tiff、tif | Pillow 读取宽高、格式和颜色模式。文档解析器提取的内嵌图片也可进入图片索引。 |
| 音频 | mp3、wav、m4a、flac、aac、ogg、wma、opus | 读取时长、采样率、声道数等元数据，再提取转写、声音描述和声学特征。 |
| 视频 | mp4、avi、mov、mkv、webm、flv、wmv、m4v | 优先用 ffprobe 读取时长、帧率、编解码器和音轨。探测失败时尝试 OpenCV，此时 `has_audio=false` 只说明没有探测到音轨。 |

上传处理器校验声明的文件类型。例如，解析器能识别 BMP，直接上传接口允许的图片类型见上表。聊天输入框另外限制附件的格式、大小和时长。[上传接口](../backend/app/api/upload.py) · [解析器](../backend/app/modules/ingestion/parsers/factory.py) · [聊天附件](chat-inline-references.md)

## 图片与独立音频

图片描述模型接收图片和可用的上下文。文档中的图可以附带图注、相邻段落和父文件 ID，便于从命中结果回到原文。入库服务将描述编码为文本向量，将图片编码为 CLIP 向量。

音频使用 `audio_transcription` 模型路由。提示词 `audio_transcription_with_description` 在一次请求中索取 `transcript` 和 `description`。缺少描述时才尝试用转写补全。失败时转写可能含占位提示。索引对转写与描述的合并文本生成稠密向量及可用的稀疏向量，对声音本身提取 CLAP 特征。CLAP 提取失败时可写入 512 维零向量，这类记录仍可通过文本查到。[入库处理](../backend/app/modules/ingestion/service.py)

## 视频与时间定位

1. 视频解析模型同时读取画面和视频内的声音。每个场景（Scene）有摘要，每个镜头保留时间段、画面描述 `caption`、原语言转写 `asr_text` 和语音状态 `asr_status`。视频内的语音随镜头索引，独立上传音频才走上述音频流程。
2. 默认超过 120 秒的视频使用 120 秒窗口，相邻窗口重叠 15 秒。窗口长度由 `VIDEO_CHUNK_WINDOW_SECONDS` 和 `VIDEO_MAX_CHUNK_DURATION_SECONDS` 中的较小值决定，下限为 30 秒。切段阈值还受 `VIDEO_LONG_THRESHOLD_SECONDS` 限制。模型按顺序读取各窗，后续窗口带上最近一次成功解析的上下文。FFmpeg 可以同时准备下一段。
3. 服务端把时间换算到原视频时间轴，合并重叠片段并校正镜头区间。任一窗口最终失败，本次解析报告失败区间并在写入检索向量之前停止。模型拒绝内容时立即停止后续窗口。
4. 模型根据画面变化选择关键帧。默认每个镜头最多 4 帧、每段视频最多 192 帧，同一镜头的近邻帧受 1 秒最小间隔限制。关键帧记录保存所属镜头和原视频位置。引用返回镜头的起止时间，便于定位和播放。

分段、合并和帧预算分别见[窗口准备](../backend/app/modules/ingestion/video_segments.py)、[镜头规范化](../backend/app/modules/ingestion/video_scene_shot.py)和[配置默认值](../backend/app/core/config.py)。

## 存储契约

MinIO 按知识库分桶。独立上传的原件使用 `images/`、`audios/` 或 `videos/` 前缀，默认对象名为 `{file_id}_{原始文件名}`。视频派生文件存入 `videos/{file_id}/keyframes/`，完整解析结果写入 `videos/{file_id}/analysis/scene_shot_asr_v4.json`。[对象路径](../backend/app/modules/ingestion/storage/minio_adapter.py)

| Qdrant 集合 | 命名向量及维数 | 可用于定位的内容 |
| --- | --- | --- |
| `image_vectors` | `text_vec` 4096、`clip_vec` 768 | 文件 ID、对象路径、图注。内嵌图片可带父文件 ID。 |
| `audio_vectors` | `text_vec` 4096、`clap_vec` 512、可选 `sparse` | 文件 ID、转写、描述、时长、采样率和声道数。 |
| `video_shot_vectors` | `caption_dense` 和 `asr_dense` 各 4096，另有 `caption_sparse`、`asr_sparse` | 场景和镜头 ID、起止时间、画面描述、语音及解析文件路径。无语音时 ASR 稠密向量为零，省略对应稀疏向量。 |
| `video_keyframe_vectors` | `frame_vec` 4096、`clip_vec` 768 | 帧时间、帧图路径、父镜头和原视频。 |

表中维数来自集合定义。更换编码模型时，需同时核对向量空间、维数和既有索引，必要时重新向量化。[集合、写入与查询实现](../backend/app/modules/ingestion/storage/vector_store.py)

## 常规问答怎样取回媒体

检索先应用知识库和文件范围。图片、音频、视频分支按各自的意图启用。图片可融合图注文本和 CLIP，音频可融合文本、CLAP 和可用的稀疏向量。查询侧缺少专用编码器时使用文本路径。视频分别查询镜头画面和转写的稠密、稀疏索引，以加权倒数排名融合（RRF）汇总。需要视觉信息时，关键帧命中可以补充或提升父镜头。

混合搜索返回按通道分组的候选 `raw_results`，也计算跨通道的 `fused_results`。常规重排器读取前者，合并、去重和筛选候选，再将排名结果交给生成器。排查某条引用为什么出现时，应检查相应通道、重排结果和最终上下文。[混合搜索](../backend/app/modules/retrieval/search_engine.py) · [重排入口](../backend/app/modules/retrieval/service.py) · [重排器](../backend/app/modules/retrieval/reranker.py)
