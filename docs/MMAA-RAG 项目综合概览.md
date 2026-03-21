现在我已经对整个项目有了全面的了解，以下是详细的架构总结：

---

## MMAA-RAG 项目综合概览

**项目全称**：Multi-Modal RAG Agent（多模态智能路由知识库RAG系统）

---

## 1. 整体目录结构

```
/home/champ/MMAA-RAG/
├── backend/                    # FastAPI 后端
│   ├── app/
│   │   ├── main.py             # FastAPI 应用入口
│   │   ├── api/                # API 路由层
│   │   ├── core/               # 核心配置、LLM管理、稀疏编码
│   │   ├── modules/            # 业务模块（摄入/检索/生成/知识库）
│   │   ├── tasks/              # Celery 定时任务
│   │   └── workers/            # 异步工作进程
│   ├── celery_app.py
│   └── requirements.txt
├── frontend/                   # React + TypeScript 前端
│   ├── src/
│   │   ├── components/         # UI组件（chat/knowledge/架构图/调试器）
│   │   ├── pages/              # 页面（设置/架构可视化）
│   │   ├── services/           # API客户端、SSE流
│   │   ├── store/              # Zustand状态管理
│   │   └── types/              # 类型定义
│   └── package.json
├── docker-compose.yml          # 容器化部署
├── start-dev.sh / start-dev-no-docker.sh
├── qdrant_storage/             # Qdrant 向量数据库本地持久化
├── minio_data/                 # MinIO 对象存储数据
├── static/                     # 静态文件
└── tests/                      # 测试套件
```

---

## 2. 后端架构

### FastAPI 应用入口（`app/main.py`）

注册了 5 个路由前缀：

| 路由前缀 | 模块 | 功能 |
|---|---|---|
| `/api/chat` | `chat.py` | 对话、流式SSE、引用URL、会话管理 |
| `/api/knowledge` | `knowledge.py` | 知识库CRUD、文件预览、画像生成 |
| `/api/upload` | `upload.py` | 文件上传（单文件/批量/流式进度） |
| `/api/debug` | `debug.py` | 调试接口 |
| `/api/import` | `import_api.py` | 从URL/搜索/本地文件夹/热点导入 |

### API 端点详情

**聊天模块（`/api/chat`）：**
- `POST /message` — 非流式问答
- `GET /stream` — **SSE 流式问答**（主要接口），逐阶段推送思考过程（意图→路由→检索→生成）
- `POST /reference-audio-url` / `reference-video-url` / `reference-image-url` — 按需生成 MinIO 预签名媒体 URL
- `GET /history` — 会话历史
- `POST /session` — 创建会话
- `GET /models` — 获取可用模型配置

**知识库模块（`/api/knowledge`）：**
- `GET /` / `POST /` / `PUT /{kb_id}` / `DELETE /{kb_id}` — 知识库 CRUD
- `GET /{kb_id}/files` — 文件列表
- `GET /{kb_id}/files/{file_id}/stream` — 文件流式预览（支持PDF直接渲染，PPTX/DOCX自动转PDF缓存）
- `GET /{kb_id}/files/{file_id}/preview` — 文件分块预览
- `DELETE /{kb_id}/files/{file_id}` — 删除文件
- `GET /{kb_id}/portrait` — 知识库主题画像（聚类）
- `POST /{kb_id}/portrait/regenerate` — 重新生成画像

**导入模块（`/api/import`）：**
- `POST /url` / `/url/start` — URL 导入（同步/异步+轮询）
- `POST /search` / `GET /search/stream` — 从 Google Images / Pixabay / Internet Archive 搜索图片导入
- `POST /folder` / `GET /folder/stream` — 本地文件夹批量导入（白名单控制）
- `POST /hot-topics` / `/hot-topics/start` — Tavily 热点/新闻导入（同步/异步）

### 核心业务模块（`app/modules/`）

**摄入模块（`ingestion/`）：**
- `service.py` — `IngestionService` 单例：统一协调"解析→存储→向量化→写入Qdrant"全流程
- `parsers/factory.py` — 解析器工厂（PDF/DOCX/PPTX/图片/音频/视频）
- `parsers/mineru_client.py` — MinerU API/本地模型解析PDF（支持公式、图表）
- `parsers/paddleocr_client.py` — PaddleOCR 备选解析器
- `storage/minio_adapter.py` — MinIO 对象存储适配器（预签名URL、bucket管理）
- `storage/vector_store.py` — Qdrant 向量存储接口
- `sources/` — 数据来源：URL爬取、媒体下载器、文件夹、Tavily热点

**检索模块（`retrieval/`）：**
- `service.py` — `RetrievalService`：完整检索流程 = 意图识别 → 知识库路由 → 混合检索 → 两阶段重排，支持同步与**流式（AsyncGenerator）**
- `processors/intent.py` — One-Pass 意图识别（识别 factual/visual/audio/video 意图）
- `processors/rewriter.py` — 查询改写与多视角扩展
- `search_engine.py` — **`HybridSearchEngine`**：Dense（语义向量）+ Sparse（BGE-M3稀疏）+ Visual（CLIP）+ Audio（CLAP）+ Video 的五路融合检索，使用 RRF 算法融合排序
- `reranker.py` — 两阶段重排（粗排+精排）

**生成模块（`generation/`）：**
- `service.py` — `GenerationService`：基于检索结果生成流式答案
- `context_builder.py` — 上下文构建（文本chunks + 图片描述 + 音频转录 + 视频关键帧）
- `stream_manager.py` — 流式事件管理
- `templates/system_prompts.py` — 系统Prompt模板
- `templates/multimodal_fmt.py` — 多模态上下文格式化

**知识库模块（`knowledge/`）：**
- `service.py` — `KnowledgeBaseService`：知识库元数据管理（存储于 MinIO），文件列表、统计
- `router.py` — `KnowledgeRouter`：智能路由，决定把查询发给哪些知识库
- `portraits.py` — `PortraitGenerator`：基于 LLM 对知识库内容做主题聚类/画像

### 核心工具（`core/`）

- `config.py` — `Settings`（Pydantic BaseSettings），管理所有环境变量
- `llm/manager.py` — `LLMManager`：统一LLM调用接口，支持多provider路由与故障转移
- `llm/providers/` — LLM Provider实现：SiliconFlow、DeepSeek、OpenRouter、阿里云百炼
- `sparse_encoder.py` — BGE-M3 稀疏向量编码器（单例）
- `keyword_extract.py` — 关键词提取（用于画像展示）
- `portrait_trigger.py` — 画像自动触发逻辑
- `logger.py` — 日志配置（loguru）

---

## 3. 前端架构

**技术栈**：React 18 + TypeScript + Vite + TailwindCSS + Zustand + Radix UI

### 页面与路由（`AppLayout.tsx` 管理4个视图）

| 路径 | 视图 | 功能 |
|---|---|---|
| `/` | `ChatInterface` | 对话主界面 |
| `/knowledge` | `KnowledgeList` | 知识库管理 |
| `/architecture` | `ArchitecturePage` | 系统架构可视化 |
| `/settings` | `SettingsPage` | 模型配置设置 |

> 4个视图常驻挂载、按路径显隐，**避免切换路由时中断流式SSE请求**。

### 核心组件（`components/`）

**聊天相关（`chat/`）：**
- `ChatInterface.tsx` — 主对话界面，调用SSE流
- `MessageBubble.tsx` — 消息气泡（支持Markdown、数学公式、代码高亮）
- `ThinkingCapsule.tsx` — 思考链展示（意图→路由→检索→生成的可折叠展示）
- `CitationPopover.tsx` / `InlineCitation.tsx` — 引用弹窗与行内引用标注
- `ChatConfigPanel.tsx` / `KnowledgeBaseConfigPanel.tsx` / `ModelConfigPanel.tsx` — 对话配置面板
- `ConversationTabs.tsx` — 多会话标签页
- `VendorModelSelect.tsx` — 多provider模型选择器

**知识库相关（`knowledge/`）：**
- `KnowledgeList.tsx` — 知识库列表（上传、预览、删除、画像）
- `UploadPipeline.tsx` — 上传管道UI（流式进度展示）
- `PortraitGraph.tsx` — D3.js 知识库主题画像可视化

**架构图（`architecture/`）：**
- `ArchitectureDiagram.tsx` / `DataFlowDiagram.tsx` — 系统架构与数据流可视化
- `TechStackSection.tsx` / `PerformanceMetrics.tsx` / `InnovationSection.tsx` — 技术栈与性能展示

**调试（`debug/`）：**
- `InspectorDrawer.tsx` — 调试抽屉，展示检索结果、引用详情

### 服务层（`services/`）

- `api_client.ts` — Axios 封装（请求去重、错误处理），对应全部后端API
- `sse_stream.ts` — SSE 流式消费（处理 connected/thought/message/citation/complete/error 事件）

### 状态管理（`store/`，Zustand）

- `useChatStore.ts` — 会话列表、消息、活跃会话
- `useKnowledgeStore.ts` — 知识库列表、文件状态
- `useConfigStore.ts` — 模型配置、知识库选择
- `useToastStore.ts` — 全局通知

---

## 4. 外部集成点

| 集成项 | 用途 |
|---|---|
| **SiliconFlow API** | 主LLM（Chat、Embedding、Vision、Reranker），必填 |
| **DeepSeek API** | 可选，深度推理模型 |
| **OpenRouter API** | 可选，聚合多种模型 |
| **阿里云百炼（DashScope）** | 可选，含视频上传 MultiModal 能力 |
| **MinIO** | 本地/自托管对象存储（文件原始内容、图片、音视频） |
| **Qdrant** | 向量数据库（文本/图像/音频/视频多路向量集合） |
| **Redis + Celery** | 异步任务队列（定时热点导入、画像生成） |
| **BGE-M3 (FlagEmbedding)** | 本地稀疏向量编码器 |
| **CLIP (transformers)** | 本地图像-文本跨模态向量化 |
| **CLAP (transformers)** | 本地音频-文本跨模态向量化 |
| **MinerU API/本地模型** | 高质量PDF解析（公式、表格、图表） |
| **PaddleOCR API** | PDF解析备选 |
| **Tavily API** | 热点新闻搜索与内容提取（导入知识库） |
| **SerpAPI** | Google Images 图片搜索导入 |
| **Pixabay API** | 图片搜索导入 |
| **Internet Archive** | 开放图片搜索导入 |
| **LibreOffice** | DOCX/PPTX 转 PDF 预览 |
| **FFmpeg** | 长视频分段处理 |

---

## 5. 主要功能

这是一个**企业级多模态知识库问答系统**，核心流程如下：

1. **多模态知识入库**：支持 PDF、Word、PPT、Markdown、图片（含AI描述）、音频（转录+CLAP向量）、视频（场景划分+关键帧描述+视频向量）等，通过 MinIO 存原文、Qdrant 存多路向量。

2. **智能检索管线**：用户提问经过"One-Pass意图识别（识别视觉/音频/视频需求）→ 知识库智能路由 → Dense+Sparse+CLIP+CLAP+Video 五路混合检索 → RRF融合 → 两阶段重排"。

3. **流式多模态生成**：基于检索结果构建多模态上下文（文本chunks + 图片 + 音频 + 视频关键帧），通过SSE逐阶段向前端推送思考过程（可视化"思维链"），最终流式输出带引用的答案。

4. **知识库管理**：支持文件预览（PDF内嵌、PPTX/DOCX转PDF缓存）、知识库主题画像（LLM聚类分析 + D3.js可视化）、多渠道批量导入。

5. **多provider LLM路由**：统一接口支持SiliconFlow / DeepSeek / OpenRouter / 阿里云百炼，支持故障自动转移。