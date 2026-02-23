export type ArchitectureSectionId =
  | 'overview'
  | 'system-architecture'
  | 'request-flow'
  | 'modules'
  | 'data-flow'
  | 'tech-stack'

export interface ArchitectureSection {
  id: ArchitectureSectionId
  title: string
  subtitle?: string
}

export interface RequestFlowStep {
  id: string
  title: string
  short: string
  description: string
  backendEntry?: string
  estimatedTime?: string
  keyTechnologies?: string[]
}

export interface ModuleInfo {
  id: string
  name: string
  role: string
  color: 'blue' | 'green' | 'orange' | 'purple'
  highlights: string[]
  codeRefs?: {
    label: string
    path: string
  }[]
}

export interface DataFlowStage {
  id: string
  title: string
  description: string
}

export interface TechStackItem {
  id: string
  name: string
  category: 'backend' | 'frontend' | 'storage' | 'model' | 'infra'
  description?: string
}

export const architectureSections: ArchitectureSection[] = [
  {
    id: 'overview',
    title: '项目总览',
    subtitle: 'Multi-Modal 智能路由可扩展知识库 RAG Agent',
  },
  {
    id: 'system-architecture',
    title: '整体架构图',
    subtitle: 'Browser → FastAPI → DDD 模块 → 存储层 → 外部服务',
  },
  {
    id: 'request-flow',
    title: 'RAG 请求链路',
    subtitle: '从用户提问到答案返回的端到端路径',
  },
  {
    id: 'modules',
    title: '核心模块拆分',
    subtitle: 'Ingestion / Knowledge / Retrieval / Generation / LLM Manager',
  },
  {
    id: 'data-flow',
    title: '数据流与存储',
    subtitle: '多来源接入 → MinIO → Dense+BGE-M3+CLIP 向量化 → Qdrant → 检索 → 引用映射 → 前端 Citation',
  },
  {
    id: 'tech-stack',
    title: '技术栈与非功能特性',
    subtitle: '技术选型与可观测性、安全性、扩展性',
  },
]

export const overviewStats = {
  modules: 5,
  coreApis: 5,
  modelTasks: 5,
}

export interface InnovationPoint {
  id: string
  title: string
  description: string
  impact: string
  icon: string
}

export const innovationPoints: InnovationPoint[] = [
  {
    id: 'kb-portrait',
    title: '知识库画像动态生成',
    description: 'K-Means 聚类 + LLM 主题摘要的混合方法，自动分析知识库内容特征并生成结构化画像',
    impact: '显著提升知识库选取的准确性与稳定性',
    icon: '🎯',
  },
  {
    id: 'hybrid-search',
    title: '三路融合混合检索',
    description: 'Dense（语义向量）+ Sparse（BGE-M3 稀疏向量）+ Visual（CLIP + VLM 描述）三路并行检索，经 RRF 粗排与 Cross-Encoder 精排',
    impact: '在复杂查询场景下能更稳定地召回真正相关的片段',
    icon: '🔍',
  },
  {
    id: 'two-stage-rerank',
    title: '两阶段重排优化',
    description: 'RRF 粗排 + Cross-Encoder 精排的两阶段重排机制，在保证检索效率的同时显著提升 Top-K 准确率',
    impact: 'Top-K 准确率显著提升',
    icon: '⚡',
  },
  {
    id: 'one-pass-intent',
    title: 'One-Pass 意图识别',
    description: '将意图分类、查询改写、关键词/多视角生成与 visual/audio/video 意图统一为一次 LLM 调用，输出结构化 IntentObject',
    impact: '在保证分析质量的前提下显著降低请求整体延迟，并统一控制多模态检索分支',
    icon: '🚀',
  },
  {
    id: 'multimodal-vector',
    title: '多模态向量化融合',
    description: '采用 VLM + CLIP 双路融合策略，实现文档和图像的统一向量表示，支持跨模态检索',
    impact: '跨模态检索能力',
    icon: '🖼️',
  },
  {
    id: 'visual-thinking',
    title: '可视化思考过程',
    description: '实现 AI 推理链路的实时可视化展示，包括意图识别、知识库路由、检索策略等思考步骤',
    impact: '可解释性和可调试性大幅提升',
    icon: '🧠',
  },
]

export interface PerformanceMetric {
  id: string
  label: string
  value: string
  unit: string
  improvement?: string
  description: string
}

export const performanceMetrics: PerformanceMetric[] = [
  {
    id: 'retrieval-accuracy',
    label: '检索准确率',
    value: '更高',
    unit: '准确率',
    improvement: '相较传统单一检索策略更稳定地命中高质量片段',
    description: '通过三路融合混合检索策略实现，在多知识库、多模态混合场景下表现更优',
  },
  {
    id: 'intent-latency',
    label: '意图识别延迟',
    value: '更低',
    unit: '延迟',
    improvement: '相较多轮串行调用显著缩短意图分析阶段耗时',
    description: 'One-Pass 统一处理意图分类与查询改写，减少多次往返调用',
  },
  {
    id: 'rerank-accuracy',
    label: '重排 Top-K 准确率',
    value: '显著',
    unit: '提升',
    improvement: 'vs 单一重排',
    description: 'RRF 粗排 + Cross-Encoder 精排两阶段优化',
  },
  {
    id: 'multimodal-support',
    label: '多模态支持',
    value: '完整',
    unit: '覆盖',
    improvement: '在文档与图像混合知识库中保持一致的检索体验',
    description: 'VLM + CLIP 双路融合实现统一向量表示，支持文本与图像的自然混用',
  },
]

export const overviewTags = [
  '多模态 RAG',
  '智能路由',
  'BGE-M3 稀疏检索',
  '混合检索',
  '流式思考链',
  '可视化调试',
] as const

export const requestFlowSteps: RequestFlowStep[] = [
  {
    id: 'chat-api',
    title: 'Chat API 接收请求',
    short: 'message + kb_ids + session',
    description:
      '前端通过 /api/chat/stream 将用户问题、选中的知识库 ID 与会话上下文发送到后端，建立 SSE 流式连接。',
    backendEntry: 'backend/app/api/chat.py::stream_chat',
    estimatedTime: '< 50ms',
    keyTechnologies: ['FastAPI', 'SSE', 'Session Management'],
  },
  {
    id: 'intent',
    title: 'One-Pass 意图识别',
    short: 'IntentProcessor.process',
    description:
      '将意图分类、查询改写、关键词/多视角生成与 visual_intent/audio_intent/video_intent 统一为一次 LLM 调用，输出结构化 IntentObject（refined_query、sparse_keywords、multi_view_queries 等），供检索与路由使用；解析失败时回退默认意图保证下游可执行。',
    backendEntry: 'backend/app/modules/retrieval/processors/intent.py::IntentProcessor.process',
    estimatedTime: '200-500ms',
    keyTechnologies: ['LLM', 'JSON Schema', 'One-Pass', 'Visual/Audio/Video Intent'],
  },
  {
    id: 'routing',
    title: '知识库画像路由',
    short: 'KnowledgeRouter.route_query',
    description:
      '若未指定知识库：refined_query 向量在 kb_portraits 全局 TopN 检索，按 KB 取前 K 节点做位置衰减加权平均，归一化后按阈值决定单库/多库/全库，输出 target_kb_ids 与置信度。画像由 K-Means + LLM 主题摘要生成并 Replace 更新。',
    backendEntry: 'backend/app/modules/knowledge/router.py::KnowledgeRouter.route_query',
    estimatedTime: '100-300ms',
    keyTechnologies: ['TopN Retrieval', 'Per-KB Weighted Avg', 'Normalize', 'Single/Multi/Full KB'],
  },
  {
    id: 'hybrid-search',
    title: '三路混合检索',
    short: 'Dense + Sparse (BGE-M3) + Visual',
    description:
      'HybridSearchEngine 同时发起语义向量检索、BGE-M3 稀疏向量检索和视觉特征（CLIP + VLM 描述）检索，经加权 RRF 融合后与 Cross-Encoder 精排配合，在多样化查询场景下有更好的召回质量。',
    backendEntry: 'backend/app/modules/retrieval/search_engine.py::HybridSearchEngine',
    estimatedTime: '300-800ms',
    keyTechnologies: ['Dense Vector', 'BGE-M3 Sparse', 'CLIP Visual', 'RRF Fusion'],
  },
  {
    id: 'rerank',
    title: '两阶段重排与上下文构建',
    short: 'Reranker + ContextBuilder',
    description:
      '先用 RRF 粗排，再用 Cross-Encoder 精排，选出最有价值的片段，由 ContextBuilder 组装成最终参考材料列表。两阶段重排机制在保证检索效率的同时显著提升 Top-K 准确率。',
    backendEntry: 'backend/app/modules/retrieval/reranker.py::Reranker',
    estimatedTime: '200-500ms',
    keyTechnologies: ['RRF', 'Cross-Encoder', 'ContextBuilder'],
  },
  {
    id: 'prompt',
    title: '系统提示词与多模态格式化',
    short: 'ContextBuilder + prompt.py + Formatter',
    description:
      'ContextBuilder 按重排结果生成 ReferenceMap（序号、content_type、presigned_url、chunk_id）；模板来自 core/llm/prompt.py，按意图类型选用系统提示词；MultiModalFormatter 将文档/图片/音视频按 Type A/B 插槽填入 Prompt，规定 [id] 引用与诚实回答原则。',
    backendEntry: 'backend/app/modules/generation/context_builder.py + backend/app/core/llm/prompt.py',
    estimatedTime: '< 50ms',
    keyTechnologies: ['ReferenceMap', 'Prompt Templates', 'Type A/B Slots', 'Citation [id]'],
  },
  {
    id: 'generation',
    title: 'LLM 生成与流式返回',
    short: 'LLMManager + StreamManager',
    description:
      'GenerationService 调用 LLMManager 完成最终回答生成，由 StreamManager 通过 SSE 将思考链、引用与回答内容流式推送到前端。支持多模型注册、故障转移、统计审计。',
    backendEntry: 'backend/app/modules/generation/service.py::GenerationService.stream_generate_response',
    estimatedTime: '1-5s',
    keyTechnologies: ['SSE Streaming', 'Multi-Model Routing', 'Circuit Breaker', 'Audit Logging'],
  },
]

export const coreModules: ModuleInfo[] = [
  {
    id: 'ingestion',
    name: 'Ingestion - 数据输入处理与存储',
    role: '负责文件解析、切分、多模态向量化（Dense + BGE-M3 稀疏 + VLM/CLIP），以及写入 MinIO 与 Qdrant。',
    color: 'green',
    highlights: [
      '统一入口：IngestionService 完成解析 → MinIO → 向量化 → Qdrant 全流程；支持本地上传、URL、文件夹、热点订阅等多来源接入',
      '解析器工厂：PDF（PyMuPDF，可选 MinerU）、DOCX（python-docx）、TXT/Markdown、图片（PIL）；文档内嵌图先 VLM 描述再插回原文后分块',
      '分块策略：递归语义分块（段落/句子 + max/min 长度）、重叠窗口；chunk 携带 context_window 供调试拉取前后文',
      '文档向量化：Qwen3-Embedding-8B（Dense 4096 维）+ BGE-M3 稀疏编码，双向量写入 text_chunks',
      '图片向量化：VLM 生成 caption + 同模型文本向量（text_vec）+ CLIP 视觉向量（clip_vec），Named Vector 写入 image_vectors',
      '存储：MinIOAdapter 按知识库与类型组织；VectorStore 写入 text_chunks / image_vectors / kb_portraits',
      '异步管道：Celery + Redis 处理长耗时导入，前端可轮询或流式查看进度',
    ],
    codeRefs: [
      { label: 'IngestionService', path: 'backend/app/modules/ingestion/service.py' },
      { label: 'ParserFactory', path: 'backend/app/modules/ingestion/parsers/factory.py' },
      { label: 'sources', path: 'backend/app/modules/ingestion/sources/' },
      { label: 'MinIOAdapter', path: 'backend/app/modules/ingestion/storage/minio_adapter.py' },
      { label: 'VectorStore', path: 'backend/app/modules/ingestion/storage/vector_store.py' },
    ],
  },
  {
    id: 'knowledge',
    name: 'Knowledge - 知识库管理与画像',
    role: '知识库 CRUD 与画像生成（K-Means + LLM 主题摘要），以及基于画像的 TopN 检索 + 加权路由决策。',
    color: 'blue',
    highlights: [
      '知识库 CRUD：创建、查询、更新、删除知识库，维护元数据与统计；支持用户指定知识库时跳过路由',
      '画像生成：从 Text/Image Collection 按比例采样向量（懒加载正文），K = sqrt(N/2) 限制内 K-Means 聚类',
      '主题摘要：每簇取近中心 5～10 样本，以 [文档片段]/[图片描述] 前缀拼成 content_pieces，LLM 生成 topic_summary 后向量化写入 kb_portraits',
      '画像更新：增量/全量触发；Replace 策略（先删该 KB 旧画像再插入新画像）',
      '路由决策：refined_query 向量在 kb_portraits 全局 TopN 检索；每 KB 取前 K 节点位置衰减加权平均，归一化后按阈值决定单库/多库/全库',
      '路由策略：全部得分偏低时全库检索；第一名与第二名差距 ≥ 阈值则单库，否则取前两库',
    ],
    codeRefs: [
      { label: 'KnowledgeBaseService', path: 'backend/app/modules/knowledge/service.py' },
      { label: 'PortraitGenerator', path: 'backend/app/modules/knowledge/portraits.py' },
      { label: 'KnowledgeRouter', path: 'backend/app/modules/knowledge/router.py' },
    ],
  },
  {
    id: 'retrieval',
    name: 'Retrieval - 语义路由与混合检索',
    role: 'One-Pass 意图识别（含 visual/audio/video 意图）、三路混合检索与两阶段重排，构成检索主通路。',
    color: 'blue',
    highlights: [
      'One-Pass 意图识别：意图分类、查询改写、关键词/多视角生成、visual_intent/audio_intent/video_intent 统一一次 LLM 调用，输出 IntentObject',
      '查询策略：refined_query 用于 Dense 与路由；sparse_keywords 与 dense_query 拼接送 BGE-M3 稀疏检索；multi_view_queries 用于 Dense 多视角',
      '三路混合检索：Dense（主查询 + 多视角融合）、Sparse（BGE-M3 稀疏向量）、Visual（text_vec + clip_vec 双路 RRF），按 visual_intent 决定是否走图/权重',
      '两阶段重排：加权 RRF 粗排（dense/sparse/visual 可配权重）→ Cross-Encoder 精排，精排分与 RRF 分合并取 final_top_k；implicit 时图片保护',
      'RetrievalContext：封装 target_kb_ids、search_strategies、visual_intent 等，贯穿检索与重排',
      '检索结果含各阶段耗时与命中详情，支持前端 ThinkingCapsule 与调试展示',
    ],
    codeRefs: [
      { label: 'RetrievalService', path: 'backend/app/modules/retrieval/service.py' },
      { label: 'IntentProcessor', path: 'backend/app/modules/retrieval/processors/intent.py' },
      { label: 'QueryRewriter', path: 'backend/app/modules/retrieval/processors/rewriter.py' },
      { label: 'HybridSearchEngine', path: 'backend/app/modules/retrieval/search_engine.py' },
      { label: 'Reranker', path: 'backend/app/modules/retrieval/reranker.py' },
    ],
  },
  {
    id: 'generation',
    name: 'Generation - 上下文构建与生成',
    role: '将重排结果转为引用映射与多模态 Prompt，驱动 LLM 生成，并通过 SSE 推送 thought/citation/message。',
    color: 'purple',
    highlights: [
      '上下文构建：ContextBuilder 按分数排序分配序号 1,2,3…，生成 ReferenceMap（doc/image/audio/video、presigned_url、chunk_id 等）',
      '长度控制：max_context_length、max_chunks、max_images（implicit 时略多），按相关性填入 Type A/B 模板',
      '系统提示词：按意图类型选用模板，规定 [id] 引用、多模态描述与诚实回答原则；prompt 模板集中在 core/llm/prompt.py',
      '多模态格式化：文档【材料 n】类型:文档|来源；图片【材料 n】类型:图片|视觉描述，支持音频/视频及关键帧引用',
      '流式输出：StreamManager 发送 thought（意图/路由/检索策略）、citation（引用元数据与 debug_info）、message（LLM delta）',
      '前端：ThinkingCapsule 消费 thought；CitationPopover 悬停 [n] 展示引用；支持 context_window 与灯箱/播放器',
    ],
    codeRefs: [
      { label: 'GenerationService', path: 'backend/app/modules/generation/service.py' },
      { label: 'ContextBuilder', path: 'backend/app/modules/generation/context_builder.py' },
      { label: 'MultiModalFormatter', path: 'backend/app/modules/generation/templates/multimodal_fmt.py' },
      { label: 'StreamManager', path: 'backend/app/modules/generation/stream_manager.py' },
    ],
  },
  {
    id: 'llm-manager',
    name: 'LLM Manager - 模型管理与路由',
    role: '按 task_type 路由到对应模型与 Provider，统一 chat/embed/rerank 接口，支持多厂商 API 与提示词集中管理。',
    color: 'purple',
    highlights: [
      '任务路由：intent_recognition、image_captioning、final_generation、reranking、kb_portrait_generation 等映射到具体模型与 Provider',
      '统一接口：chat（多轮消息、temperature）、embed（文本列表）、rerank（query + documents）；底层 Provider 实现 OpenAI 兼容协议',
      '多厂商 Provider：SiliconFlow、OpenRouter、阿里云百炼、DeepSeek 等，Manager 负责拼装请求与解析响应',
      '提示词：prompt.py 集中所有模板字符串，prompt_engine 提供 render_template，业务层只传变量',
      '可观测与弹性：记录 task_type、模型、耗时、Token、成功/失败；支持超时重试与可选故障转移',
      '核心设施：sparse_encoder（BGE-M3）、portrait_trigger、keyword_extract 等由 Core 层提供',
    ],
    codeRefs: [
      { label: 'LLMManager', path: 'backend/app/core/llm/manager.py' },
      { label: 'LLMRegistry', path: 'backend/app/core/llm/__init__.py' },
      { label: 'prompt.py', path: 'backend/app/core/llm/prompt.py' },
      { label: 'PromptEngine', path: 'backend/app/core/llm/prompt_engine.py' },
    ],
  },
]

export const dataFlowStages: DataFlowStage[] = [
  {
    id: 'upload',
    title: '文件与多来源接入',
    description: '本地上传通过 /api/upload 或 /file/stream；导入任务（URL、文件夹、Tavily 热点、媒体下载等）经 import_api 提交，由 Ingestion 统一执行下载与后续管道。',
  },
  {
    id: 'minio',
    title: '对象存储 MinIO',
    description: 'MinIOAdapter 按知识库与类型（文档/图片等）组织路径，写入 MinIO；对象路径与 file_id 与向量库 Payload 一致，便于 Presigned URL 与删除联动。',
  },
  {
    id: 'vectorize',
    title: '多模态向量化',
    description: '文本走 Dense（Qwen3-Embedding-8B）+ BGE-M3 稀疏编码；图片走 VLM 描述 + 文本向量化与 CLIP 视觉向量，写入 Qdrant。',
  },
  {
    id: 'qdrant',
    title: '向量与稀疏索引',
    description: 'Qdrant 存储 text_chunks（dense + sparse）、image_vectors（clip_vec + text_vec）、kb_portraits，支撑混合检索与路由。',
  },
  {
    id: 'redis-celery',
    title: 'Redis & Celery 异步管道',
    description: '长耗时导入任务通过 Celery 分发到 Worker，进度与状态缓存在 Redis，前端可轮询或流式查看。',
  },
  {
    id: 'retrieval-generation',
    title: '检索与生成',
    description: 'RetrievalService 基于向量库完成检索，GenerationService 组装上下文并调用 LLM 输出回答。',
  },
  {
    id: 'citation',
    title: '引用映射与前端展示',
    description: 'ReferenceMap 提供序号、类型、file_name、content 摘要、presigned_url（图/音视频）；SSE citation 事件带 debug_info（chunk_id、context_window）。前端 CitationPopover 悬停 [n] 展示，支持灯箱与播放器。',
  },
]

export const techStackItems: TechStackItem[] = [
  // backend - 只保留核心
  {
    id: 'fastapi',
    name: 'FastAPI',
    category: 'backend',
    description: '高性能异步 Web 框架，承载 API 与 SSE 流式接口，支持 DDD 模块化架构。',
  },
  {
    id: 'python',
    name: 'Python 3.9+',
    category: 'backend',
    description: '后端主语言，配合 DDD 领域驱动设计实现模块化开发。',
  },
  // frontend - 只保留核心
  {
    id: 'react',
    name: 'React + TypeScript + Vite',
    category: 'frontend',
    description: '现代前端技术栈，支持组件化开发、类型安全与快速构建。',
  },
  {
    id: 'tailwind',
    name: 'Tailwind CSS',
    category: 'frontend',
    description: '原子化样式方案，快速实现现代化 UI 设计与响应式布局。',
  },
  // storage - 全部保留（都是核心）
  {
    id: 'minio',
    name: 'MinIO',
    category: 'storage',
    description: '兼容 S3 的对象存储，用于存放原始文件与图片，按知识库分 bucket 管理。',
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'storage',
    description: '向量数据库，支持相似度搜索、多向量场景与稀疏索引。',
  },
  {
    id: 'redis',
    name: 'Redis',
    category: 'storage',
    description: '缓存与队列后端，支撑 Celery 异步任务与状态查询。',
  },
  // model - 全部保留（都是核心）
  {
    id: 'siliconflow',
    name: 'SiliconFlow / OpenRouter / 阿里云百炼',
    category: 'model',
    description: '多厂商 API 统一由 LLMManager 路由，按 task_type 选择模型与 Provider（OpenAI 兼容协议）。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek / Qwen 系列',
    category: 'model',
    description: '意图识别、最终生成、画像摘要等对话类任务；VLM 用于图片描述（如 Qwen3-VL）。',
  },
  {
    id: 'embedding',
    name: 'Qwen3-Embedding-8B',
    category: 'model',
    description: '文本 Dense 向量（4096 维），用于 text_chunks、image text_vec 与 kb_portraits。',
  },
  {
    id: 'bge',
    name: 'BGE-M3 / BGE-Reranker',
    category: 'model',
    description: 'BGE-M3 稀疏编码与稀疏检索；BGE-Reranker 或 Qwen3-Reranker 用于 Cross-Encoder 精排。',
  },
  {
    id: 'clip',
    name: 'CLIP (clip-vit-large-patch14)',
    category: 'model',
    description: '图片视觉向量（768 维），与 text_vec 双路写入 image_vectors，检索时 Prefetch + Fusion RRF。',
  },
  // infra - 只保留核心
  {
    id: 'docker',
    name: 'Docker & Docker Compose',
    category: 'infra',
    description: '容器化部署与本地一键启动，支持开发与生产环境一致性。',
  },
]

