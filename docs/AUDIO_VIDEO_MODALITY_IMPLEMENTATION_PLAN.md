# 音频和视频模态数据处理与检索实现方案

## 一、概述

本文档基于当前系统架构，设计音频和视频模态数据的完整处理流程，包括数据输入、解析、存储、检索和回答生成等环节。

### 1.1 当前系统架构分析

**现有能力：**

- ✅ 文本模态：PDF、DOCX、PPTX、TXT、MD等文档的解析、分块、向量化、存储和检索
- ✅ 图片模态：图片的CLIP向量化、VLM描述生成、多向量存储（clip_vec + text_vec）
- ✅ 混合检索：Dense + Sparse + Visual三路融合检索
- ✅ LLM多模态支持：已集成支持音频/视频输入的模型（如Qwen3-VL、Qwen3-Omni）

**待扩展能力：**

- ❌ 音频文件的上传、解析、转文本/描述、向量化、存储和检索
- ❌ 视频文件的上传、解析、关键帧提取、描述生成、向量化、存储和检索
- ❌ 音频/视频模态的检索策略
- ❌ 音频/视频在回答生成时的引用和展示

### 1.2 设计原则

1. **复用现有架构**：参考图片模态的处理流程，保持架构一致性
2. **渐进式实现**：先实现基础功能，再优化性能
3. **多模态融合**：音频/视频与文本、图片统一检索和回答
4. **可扩展性**：设计支持未来更多模态（如3D模型、代码等）

---

## 二、数据模型设计

### 2.1 文件类型扩展

**文件类型枚举扩展：**

```python
# backend/app/modules/ingestion/parsers/factory.py
class FileType(Enum):
    # 现有类型
    PDF = "pdf"
    DOCX = "docx"
    DOC = "doc"
    PPTX = "pptx"
    TXT = "txt"
    MD = "md"
    IMAGE = "image"
    
    # 新增类型
    AUDIO = "audio"      # mp3, wav, m4a, flac, aac, ogg等
    VIDEO = "video"      # mp4, avi, mov, mkv, webm等
    UNKNOWN = "unknown"
```

**支持的文件格式：**

- **音频**：mp3, wav, m4a, flac, aac, ogg, wma, opus
- **视频**：mp4, avi, mov, mkv, webm, flv, wmv, m4v

### 2.2 Qdrant集合设计

#### 2.2.1 audio_vectors 集合

**向量配置：**

- **text_vec** (4096维)：音频转文本或描述的向量
- **audio_vec** (可选，768维)：音频特征向量（如果未来引入音频编码器）

**Payload字段：**

```python
{
    "kb_id": str,                    # 知识库ID
    "file_id": str,                  # 文件ID
    "file_path": str,                # MinIO对象路径
    "transcript": str,               # 音频转文本（ASR结果）
    "description": str,              # 音频描述（LLM生成）
    "duration": float,              # 音频时长（秒）
    "audio_format": str,             # 音频格式（mp3, wav等）
    "sample_rate": int,              # 采样率（Hz）
    "channels": int,                 # 声道数
    "bitrate": int,                  # 比特率（kbps）
    "source_type": str,              # 来源类型（standalone_file, video_extracted）
    "source_file_id": str,           # 来源文件ID（如果是视频提取的音频）
    "created_at": str                # 创建时间（ISO格式）
}
```

#### 2.2.2 video_vectors 集合

**向量配置：**

- **text_vec** (4096维)：视频描述或关键帧描述的向量
- **clip_vec** (768维)：关键帧的CLIP向量（可选，复用图片CLIP编码器）

**Payload字段：**

```python
{
    "kb_id": str,                    # 知识库ID
    "file_id": str,                  # 文件ID
    "file_path": str,                # MinIO对象路径
    "description": str,              # 视频整体描述（LLM生成）
    "duration": float,              # 视频时长（秒）
    "video_format": str,             # 视频格式（mp4, avi等）
    "resolution": str,               # 分辨率（如"1920x1080"）
    "fps": float,                    # 帧率
    "key_frames": List[Dict],        # 关键帧信息
    # key_frames结构：
    # [
    #   {
    #     "timestamp": float,         # 时间戳（秒）
    #     "frame_index": int,         # 帧索引
    #     "clip_vector": List[float], # CLIP向量（768维）
    #     "description": str          # 关键帧描述
    #   }
    # ]
    "has_audio": bool,               # 是否包含音频轨道
    "audio_file_id": str,            # 提取的音频文件ID（如果有）
    "created_at": str                # 创建时间（ISO格式）
}
```

### 2.3 MinIO存储结构

**存储路径结构（保持与现有一致）：**

```text
{bucket_name}/
  documents/
    {file_id}_{filename}
  images/
    {file_id}_{filename}
  audios/                    # 新增
    {file_id}_{filename}
  videos/                    # 新增
    {file_id}_{filename}
```

---

## 三、数据输入处理流程

### 3.1 音频文件处理流程

**参考图片处理流程，设计音频处理流程：**

```text
上传音频文件
  ↓
1. 文件解析（AudioParser）
   - 提取元数据（时长、格式、采样率等）
   - 验证文件完整性
  ↓
2. 存储到MinIO
   - 保存原始音频文件
   - 返回file_id和object_path
  ↓
3. 音频转文本（ASR）
   - 使用多模态LLM（如Qwen3-Omni）进行ASR
   - 或使用专门的ASR服务（Whisper等）
   - 生成transcript文本
  ↓
4. 音频描述生成（可选）
   - 使用多模态LLM生成音频的语义描述
   - 包含情感、场景、说话人等信息
  ↓
5. 文本向量化
   - 将transcript + description合并
   - 使用Qwen3-Embedding-8B生成4096维向量
   - 生成稀疏向量（BGE-M3）
  ↓
6. 存储到Qdrant
   - 存储到audio_vectors集合
   - 包含text_vec（密集+稀疏）
```

**关键实现点：**

1. **AudioParser** (`backend/app/modules/ingestion/parsers/audio_parser.py`)

   ```python
   class AudioParser(DocumentParser):
       async def parse(self, file_content: bytes, file_path: str, **kwargs):
           # 使用librosa或pydub提取元数据
           # 返回：format, duration, sample_rate, channels, bitrate等
   ```

2. **音频转文本** (`backend/app/modules/ingestion/service.py`)

   ```python
   async def _transcribe_audio(
       self, 
       audio_bytes: bytes, 
       audio_format: str
   ) -> Dict[str, Any]:
       # 方案1：使用多模态LLM（Qwen3-Omni）
       # 方案2：使用Whisper API
       # 返回：transcript文本和置信度
   ```

3. **音频描述生成**（可选）

   ```python
   async def _generate_audio_description(
       self,
       audio_bytes: bytes,
       transcript: str
   ) -> str:
       # 使用多模态LLM生成音频的语义描述
       # 提示词："请描述这段音频的内容、情感、场景等"
   ```

### 3.2 视频文件处理流程

**参考图片处理流程，设计视频处理流程：**

```text
上传视频文件
  ↓
1. 文件解析（VideoParser）
   - 提取元数据（时长、分辨率、帧率、编码格式等）
   - 验证文件完整性
   - 检测是否包含音频轨道
  ↓
2. 存储到MinIO
   - 保存原始视频文件
   - 返回file_id和object_path
  ↓
3. 关键帧提取
   - 按时间间隔提取关键帧（如每10秒一帧）
   - 或使用场景检测算法提取关键帧
   - 提取的帧保存为临时图片
  ↓
4. 音频提取（如果有音频轨道）
   - 提取音频轨道为独立音频文件
   - 存储到MinIO（audios/）
   - 调用音频处理流程生成transcript
  ↓
5. 关键帧描述生成
   - 对每个关键帧使用VLM生成描述
   - 复用现有的_generate_image_caption方法
  ↓
6. 视频整体描述生成
   - 使用多模态LLM（Qwen3-VL）生成视频整体描述
   - 结合关键帧描述和音频transcript
  ↓
7. 向量化
   - 关键帧CLIP向量化（复用图片CLIP编码器）
   - 视频描述文本向量化（4096维 + 稀疏向量）
  ↓
8. 存储到Qdrant
   - 存储到video_vectors集合
   - 包含text_vec和关键帧的clip_vec
```

**关键实现点：**

1. **VideoParser** (`backend/app/modules/ingestion/parsers/video_parser.py`)

   ```python
   class VideoParser(DocumentParser):
       async def parse(self, file_content: bytes, file_path: str, **kwargs):
           # 使用opencv-python或ffmpeg-python提取元数据
           # 返回：format, duration, resolution, fps, codec等
   ```

2. **关键帧提取**

   ```python
   async def _extract_key_frames(
       self,
       video_bytes: bytes,
       interval: float = 10.0  # 每10秒一帧
   ) -> List[Dict[str, Any]]:
       # 使用opencv或ffmpeg提取关键帧
       # 返回：[(timestamp, frame_bytes, frame_index), ...]
   ```

3. **视频描述生成**

   ```python
   async def _generate_video_description(
       self,
       video_bytes: bytes,
       key_frame_descriptions: List[str],
       audio_transcript: Optional[str]
   ) -> str:
       # 使用多模态LLM（Qwen3-VL）生成视频整体描述
       # 提示词：结合关键帧描述和音频transcript
   ```

### 3.3 文件上传API扩展

**扩展上传API支持音频和视频：**

```python
# backend/app/api/upload.py
@router.post("/file")
async def upload_file(...):
    allowed_types = [
        # 现有类型
        "pdf", "docx", "doc", "pptx", "txt", "md",
        "jpg", "jpeg", "png", "gif", "webp", "tiff", "tif",
        # 新增类型
        "mp3", "wav", "m4a", "flac", "aac", "ogg",  # 音频
        "mp4", "avi", "mov", "mkv", "webm", "flv"   # 视频
    ]
```

---

## 四、检索策略设计

### 4.1 音频检索策略

**检索方式：**

1. **文本检索（主要）**
   - 使用transcript和description的文本向量进行Dense检索
   - 使用BGE-M3稀疏向量进行Sparse检索
   - 与文本chunks统一检索，使用RRF融合

2. **语义检索（未来扩展）**
   - 如果引入音频编码器，可以使用audio_vec进行音频特征检索
   - 支持"找类似音调的音频"等查询

**检索流程：**

```text
用户查询："会议中提到了什么？"
  ↓
意图识别：检测到音频相关查询
  ↓
Dense检索：transcript向量匹配
  ↓
Sparse检索：关键词匹配（如"会议"、"提到"）
  ↓
RRF融合：与文本chunks统一排序
  ↓
返回音频结果 + transcript片段
```

### 4.2 视频检索策略

**检索方式：**

1. **文本检索（主要）**
   - 使用视频描述和关键帧描述的文本向量进行Dense检索
   - 使用BGE-M3稀疏向量进行Sparse检索

2. **视觉检索（辅助）**
   - 使用关键帧的CLIP向量进行视觉检索
   - 支持"找包含某个场景的视频"等查询

3. **多模态融合检索**
   - Dense（文本描述）+ Sparse（关键词）+ Visual（关键帧CLIP）
   - 使用RRF融合，权重可配置

**检索流程：**

```text
用户查询："展示产品演示的视频"
  ↓
意图识别：检测到视频相关查询 + 视觉需求
  ↓
Dense检索：视频描述向量匹配
  ↓
Sparse检索：关键词匹配（"产品"、"演示"）
  ↓
Visual检索：关键帧CLIP向量匹配（如果查询包含视觉元素）
  ↓
RRF融合：三路结果统一排序
  ↓
返回视频结果 + 关键帧预览 + 描述
```

### 4.3 HybridSearchEngine扩展

**扩展HybridSearchEngine支持音频/视频检索：**

```python
# backend/app/modules/retrieval/search_engine.py
class HybridSearchEngine:
    async def search(self, ...):
        # 现有检索：Dense + Sparse + Visual
        # 新增：Audio + Video检索
        
        # 音频检索
        audio_task = self._audio_search(...)
        
        # 视频检索
        video_task = self._video_search(...)
        
        # RRF融合所有结果
        fused_results = await self._fuse_results(
            results, 
            include_audio=True,
            include_video=True
        )
```

**检索方法：**

```python
async def _audio_search(
    self,
    query: str,
    target_kb_ids: List[str],
    limit: int = 10
) -> List[Dict[str, Any]]:
    # 1. 文本向量化查询
    # 2. 检索audio_vectors集合
    # 3. 返回音频结果（包含transcript片段）
    
async def _video_search(
    self,
    query: str,
    target_kb_ids: List[str],
    visual_query: Optional[str] = None,
    limit: int = 10
) -> List[Dict[str, Any]]:
    # 1. 文本向量化查询
    # 2. 如果visual_query存在，CLIP向量化并检索关键帧
    # 3. 检索video_vectors集合
    # 4. 返回视频结果（包含关键帧预览和描述）
```

---

## 五、回答生成适配

### 5.1 ContextBuilder扩展

**扩展ContextBuilder支持音频/视频上下文：**

```python
# backend/app/modules/generation/context_builder.py
class ContextBuilder:
    async def build_context(self, ...):
        # 处理音频结果
        audio_results = [r for r in results if r["content_type"] == "audio"]
        # 处理视频结果
        video_results = [r for r in results if r["content_type"] == "video"]
        
        # 构建音频上下文
        audio_context = await self._build_audio_context(audio_results)
        # 构建视频上下文
        video_context = await self._build_video_context(video_results)
        
        # 合并到最终上下文
        context_string = text_context + image_context + audio_context + video_context
```

**音频上下文格式：**

```text
[音频引用 #1]
文件：meeting_recording.mp3
时长：15分30秒
转写文本：
用户：今天我们要讨论产品发布计划...
AI：根据之前的讨论，我们建议...
[音频引用 #1结束]
```

**视频上下文格式：**

```text
[视频引用 #1]
文件：product_demo.mp4
时长：3分45秒
描述：产品演示视频，展示了新功能的操作流程
关键帧：
- 0:15 - 产品主界面展示
- 1:30 - 功能操作演示
- 2:45 - 结果展示
[视频引用 #1结束]
```

### 5.2 MultiModalFormatter扩展

**扩展MultiModalFormatter支持音频/视频格式化：**

```python
# backend/app/modules/generation/templates/multimodal_fmt.py
class MultiModalFormatter:
    def format_audio_reference(self, audio_ref: Dict) -> str:
        # 格式化音频引用
        
    def format_video_reference(self, video_ref: Dict) -> str:
        # 格式化视频引用
```

### 5.3 回答生成时的媒体引用

**在回答中包含音频/视频引用：**

1. **引用格式**：
   - 文本引用：`[音频 #1]`、`[视频 #1]`
   - 提供预签名URL供前端播放
   - 提供关键时间戳（如"视频中2:30处"）

2. **前端展示**：
   - 音频：音频播放器组件
   - 视频：视频播放器组件 + 关键帧预览
   - 支持跳转到指定时间戳

---

## 六、技术实现细节

### 6.1 依赖库

**新增Python依赖：**

```python
# backend/requirements.txt
# 音频处理
librosa>=0.10.0          # 音频分析和处理
pydub>=0.25.1             # 音频格式转换
soundfile>=0.12.1         # 音频文件读写

# 视频处理
opencv-python>=4.8.0      # 视频处理和关键帧提取
ffmpeg-python>=0.2.0      # FFmpeg封装（可选）
moviepy>=1.0.3            # 视频编辑和处理（可选）

# ASR（可选，如果使用Whisper）
openai-whisper>=20231117  # Whisper ASR模型
```

### 6.2 LLM多模态调用

**音频转文本（使用Qwen3-Omni）：**

```python
async def _transcribe_with_llm(
    self,
    audio_bytes: bytes,
    audio_format: str
) -> Dict[str, Any]:
    # 1. 将音频转换为base64
    audio_base64 = base64.b64encode(audio_bytes).decode()
    
    # 2. 构建多模态消息
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "请将这段音频转换为文本。"
                },
                {
                    "type": "audio",
                    "audio": f"data:audio/{audio_format};base64,{audio_base64}"
                }
            ]
        }
    ]
    
    # 3. 调用多模态LLM
    result = await self.llm_manager.chat(
        messages=messages,
        task_type="audio_transcription",  # 需要在LLMRegistry中配置
        model="aliyun_bailian:qwen3-omni-30b-a3b-captioner"
    )
    
    # 4. 提取transcript
    transcript = result.data["choices"][0]["message"]["content"]
    return {"transcript": transcript}
```

**视频描述生成（使用Qwen3-VL）：**

```python
async def _describe_video_with_llm(
    self,
    video_bytes: bytes,
    video_format: str,
    key_frame_descriptions: List[str]
) -> str:
    # 1. 将视频转换为base64（注意：视频文件较大，可能需要分块或使用URL）
    # 方案1：直接base64（小视频）
    # 方案2：先上传到MinIO，传递URL（大视频）
    
    # 2. 构建多模态消息
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": f"请描述这段视频的内容。关键帧描述：{'; '.join(key_frame_descriptions)}"
                },
                {
                    "type": "video",
                    "video": f"data:video/{video_format};base64,{video_base64}"
                    # 或使用URL：{"type": "video", "video": presigned_url}
                }
            ]
        }
    ]
    
    # 3. 调用多模态LLM
    result = await self.llm_manager.chat(
        messages=messages,
        task_type="video_description",
        model="aliyun_bailian:qwen3-vl-plus"
    )
    
    # 4. 提取描述
    description = result.data["choices"][0]["message"]["content"]
    return description
```

### 6.3 性能优化

**1. 音频处理优化：**

- 大音频文件分块处理（如每5分钟一段）
- 缓存ASR结果，避免重复处理
- 异步处理，不阻塞主流程

**2. 视频处理优化：**

- 关键帧提取使用多进程/多线程
- 视频描述生成使用流式处理（如果支持）
- 大视频文件使用URL传递而非base64

**3. 存储优化：**

- 音频/视频文件使用MinIO的压缩存储（如果支持）
- 向量存储使用批量插入
- 索引优化：为audio_vectors和video_vectors创建合适的索引

---

## 七、实施计划

### 7.1 第一阶段：基础功能（2-3周）

**目标：** 实现音频和视频的基础处理流程

**任务：**

1. ✅ 扩展FileType枚举，添加AUDIO和VIDEO类型
2. ✅ 实现AudioParser和VideoParser
3. ✅ 扩展MinIO存储，支持audio和video bucket
4. ✅ 实现音频转文本（使用多模态LLM）
5. ✅ 实现视频关键帧提取和描述生成
6. ✅ 创建audio_vectors和video_vectors集合
7. ✅ 实现音频/视频向量化和存储

### 7.2 第二阶段：检索集成（1-2周）

**目标：** 将音频/视频集成到检索流程

**任务：**

1. ✅ 扩展HybridSearchEngine，支持音频/视频检索
2. ✅ 实现音频检索方法（文本向量匹配）
3. ✅ 实现视频检索方法（文本+视觉向量匹配）
4. ✅ 扩展RRF融合，包含音频/视频结果
5. ✅ 测试检索效果和性能

### 7.3 第三阶段：回答生成适配（1周）

**目标：** 在回答生成中引用音频/视频

**任务：**

1. ✅ 扩展ContextBuilder，支持音频/视频上下文
2. ✅ 扩展MultiModalFormatter，格式化音频/视频引用
3. ✅ 前端适配：音频/视频播放器组件
4. ✅ 测试端到端流程

### 7.4 第四阶段：优化和扩展（持续）

**目标：** 性能优化和功能扩展

**任务：**

1. ⏳ 性能优化：缓存、异步处理、批量处理
2. ⏳ 功能扩展：音频特征向量、视频场景检测
3. ⏳ 用户体验：关键帧预览、时间戳跳转
4. ⏳ 监控和日志：处理时间、错误率等指标

---

## 八、风险评估与应对

### 8.1 技术风险

### 风险1：大文件处理性能

- **风险**：音频/视频文件通常较大，处理耗时
- **应对**：
  - 使用异步处理，不阻塞主流程
  - 大文件分块处理
  - 设置合理的超时和重试机制

### 风险2：LLM多模态API限制

- **风险**：多模态API可能有文件大小、时长限制
- **应对**：
  - 检查API限制，必要时预处理文件（压缩、裁剪）
  - 大文件使用URL传递而非base64
  - 提供降级方案（如仅使用ASR，不使用LLM描述）

### 风险3：存储成本

- **风险**：音频/视频文件占用大量存储空间
- **应对**：
  - 使用MinIO的压缩存储
  - 定期清理临时文件
  - 考虑使用对象存储的归档存储（如AWS Glacier）

### 8.2 业务风险

### 风险1：检索准确性

- **风险**：音频/视频检索可能不如文本检索准确
- **应对**：
  - 优化描述生成提示词
  - 结合多种检索方式（文本+视觉）
  - 提供用户反馈机制，持续优化

### 风险2：用户体验

- **风险**：音频/视频处理时间长，用户等待体验差
- **应对**：
  - 流式处理，实时反馈进度
  - 后台处理，处理完成后通知用户
  - 提供预览功能（如关键帧预览）

---

## 九、测试计划

### 9.1 单元测试

- AudioParser和VideoParser的解析测试
- 音频转文本的准确性测试
- 视频关键帧提取的完整性测试
- 向量化和存储的正确性测试

### 9.2 集成测试

- 端到端音频处理流程测试
- 端到端视频处理流程测试
- 音频/视频检索准确性测试
- 多模态融合检索测试

### 9.3 性能测试

- 大文件处理性能测试
- 并发处理能力测试
- 检索响应时间测试
- 存储空间占用测试

---

## 十、总结

本方案基于现有系统架构，参考图片模态的处理流程，设计了音频和视频模态的完整实现方案。核心要点：

1. **数据模型**：扩展FileType，新增audio_vectors和video_vectors集合
2. **处理流程**：音频转文本+描述，视频关键帧提取+描述
3. **检索策略**：文本检索为主，视觉检索为辅，多模态融合
4. **回答生成**：支持音频/视频引用和播放

实施时建议采用渐进式方式，先实现基础功能，再逐步优化和扩展。
