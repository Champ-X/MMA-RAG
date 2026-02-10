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
    subtitle: '文件 → MinIO → Qdrant → 检索 → 引用映射 → 前端 Citation',
  },
  {
    id: 'tech-stack',
    title: '技术栈与非功能特性',
    subtitle: '技术选型与可观测性、安全性、扩展性',
  },
]

export const overviewStats = {
  modules: 5,
  coreApis: 4,
  modelTasks: 4,
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
    description: 'Dense（语义向量）+ Sparse（BGE-M3稀疏向量）+ Visual（CLIP视觉特征）三路并行检索与RRF融合',
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
    description: '将意图分类、查询改写、关键词提取等任务统一为一次 LLM 调用，输出结构化 JSON',
    impact: '在保证分析质量的前提下显著降低请求整体延迟',
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
    short: 'IntentProcessor.one_pass_intent',
    description:
      'RetrievalService 调用 IntentProcessor，将意图分类、查询改写、关键词提取统一为一次 LLM 调用，输出结构化 JSON，相比多轮调用整体延迟显著更低。',
    backendEntry: 'backend/app/modules/retrieval/processors/intent.py::IntentProcessor.process',
    estimatedTime: '200-500ms',
    keyTechnologies: ['LLM', 'JSON Schema', 'One-Pass Processing'],
  },
  {
    id: 'routing',
    title: '知识库画像路由',
    short: 'KnowledgeRouter.route_query',
    description:
      '基于知识库画像与路由算法，对候选知识库进行加权打分，选择 Top-K 目标知识库，并输出带置信度的路由结果。通过 K-Means 聚类 + LLM 主题摘要生成画像，在复杂多知识库场景中能够更稳定地命中合适的知识库。',
    backendEntry: 'backend/app/modules/knowledge/router.py::KnowledgeRouter.route_query',
    estimatedTime: '100-300ms',
    keyTechnologies: ['K-Means', 'LLM Summary', 'Weighted Scoring'],
  },
  {
    id: 'hybrid-search',
    title: '三路混合检索',
    short: 'Dense + Sparse + Visual',
    description:
      'HybridSearchEngine 同时发起语义向量检索、稀疏向量检索和视觉特征检索，并通过 RRF 等策略融合结果，相比传统单一检索方式在多样化查询场景下有更好的召回质量。',
    backendEntry: 'backend/app/modules/retrieval/search_engine.py::HybridSearchEngine',
    estimatedTime: '300-800ms',
    keyTechnologies: ['Dense Vector', 'Sparse Vector (BGE-M3)', 'CLIP Visual', 'RRF Fusion'],
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
    short: 'SystemPromptManager + Formatter',
    description:
      'SystemPromptManager 根据意图类型选择合适的系统提示词，多模态 Formatter 负责将文本与图片引用映射到统一 Prompt 格式。支持文档/图片 Type A/B 插槽设计，动态引用映射。',
    backendEntry: 'backend/app/modules/generation/templates/system_prompts.py::SystemPromptManager',
    estimatedTime: '< 50ms',
    keyTechnologies: ['Template Engine', 'Multi-Modal Formatting', 'Citation Mapping'],
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
    role: '负责文件解析、切分、多模态向量化，以及写入 MinIO 与 Qdrant。',
    color: 'green',
    highlights: [
      '统一入口：IngestionService.process_file_upload 作为唯一写入入口，完成解析 → MinIO → 向量化 → Qdrant 全流程',
      '多模态解析器工厂：支持 PDF（PyMuPDF）、文本（Markdown/Plain）、图片（PIL/OpenCV）的差异化解析策略',
      '智能文档切分：基于语义边界与长度限制的 Chunking，保留上下文连贯性',
      '多模态向量化：文本走 BGE Embedding，图片走 VLM + CLIP 双路融合，生成统一向量表示',
      '存储适配器：MinIOAdapter 负责对象存储（按知识库分 bucket），VectorStore 负责向量与稀疏索引写入 Qdrant',
      '可扩展内容来源层：支持本地文件上传、URL 下载、RSS 订阅等多种内容来源，统一接入处理管道',
      '异步任务支持：大文件导入通过 Celery 异步处理，前端可流式查看进度',
    ],
    codeRefs: [
      { label: 'IngestionService', path: 'backend/app/modules/ingestion/service.py' },
      { label: 'ParserFactory', path: 'backend/app/modules/ingestion/parsers/factory.py' },
      { label: 'MinIOAdapter', path: 'backend/app/modules/ingestion/storage/minio_adapter.py' },
      { label: 'VectorStore', path: 'backend/app/modules/ingestion/storage/vector_store.py' },
    ],
  },
  {
    id: 'knowledge',
    name: 'Knowledge - 知识库管理与画像',
    role: '围绕知识库生命周期进行管理，并基于内容生成结构化画像，支撑智能路由。',
    color: 'blue',
    highlights: [
      '知识库 CRUD：支持创建、查询、更新、删除知识库，维护知识库元数据与统计信息',
      '画像生成算法：PortraitGenerator 使用 K-Means 聚类分析知识库向量分布，结合 LLM 主题摘要生成结构化画像',
      '画像存储结构：包含主题关键词、向量中心点、覆盖领域、内容类型分布等维度',
      '动态路由决策：KnowledgeRouter 基于查询向量与画像向量相似度，加权投票选择 Top-K 目标知识库',
      '画像更新机制：支持增量更新与全量重构，当知识库内容变化时自动触发画像刷新',
      '路由策略配置：支持加权路由、全库搜索、手动锁定等多种路由策略，适应不同场景需求',
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
    role: '从意图识别到混合检索与重排，构成查询前处理与检索主通路。',
    color: 'blue',
    highlights: [
      'One-Pass 意图识别：IntentProcessor 将意图分类、查询改写、关键词提取统一为一次 LLM 调用，输出结构化 IntentObject（包含 intent_type、refined_query、keywords 等）',
      '查询改写策略：QueryRewriter 支持 SPLADE 稀疏检索优化与 Multi-view 查询重构，提升检索召回率',
      '三路混合检索：HybridSearchEngine 同时发起 Dense（语义向量）、Sparse（BGE-M3 稀疏向量）、Visual（CLIP 视觉特征）检索，通过 RRF 融合结果',
      '两阶段重排：先用 RRF 对多路检索结果粗排，再用 Cross-Encoder 对 Top-K 候选精排，选出最有价值的片段',
      '检索上下文构建：RetrievalContext 封装查询意图、目标知识库、检索策略等上下文信息，贯穿整个检索流程',
      '调试信息输出：RetrievalResult 包含详细的检索统计、各阶段耗时、命中片段详情等，支持前端可视化展示',
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
    role: '将检索结果拼装成可控的上下文，并驱动 LLM 给出带引用的最终回答。',
    color: 'purple',
    highlights: [
      '多模态上下文构建：ContextBuilder 支持文本片段与图片引用的混合组装，按相关性排序并控制总长度',
      '动态引用映射：将内部 UUID 映射为数字 ID 与可读信息（文件名、页码等），便于前端展示与用户点击',
      '系统提示词管理：SystemPromptManager 根据意图类型（factual/analytical/creative）选择合适的系统提示词模板',
      '多模态格式化：MultiModalFormatter 支持文档/图片 Type A/B 插槽设计，将引用信息嵌入到 Prompt 中',
      '流式生成：StreamManager 通过 SSE 实时推送思考链（thought）、引用（citation）、回答内容（message）到前端',
      '思考链可视化：GenerationService 在生成过程中输出意图识别、知识库路由、检索策略等阶段信息，映射到前端 ThinkingCapsule',
    ],
    codeRefs: [
      { label: 'GenerationService', path: 'backend/app/modules/generation/service.py' },
      { label: 'ContextBuilder', path: 'backend/app/modules/generation/context_builder.py' },
      { label: 'SystemPromptManager', path: 'backend/app/modules/generation/templates/system_prompts.py' },
      { label: 'StreamManager', path: 'backend/app/modules/generation/stream_manager.py' },
    ],
  },
  {
    id: 'llm-manager',
    name: 'LLM Manager - 模型管理与路由',
    role: '统一管理多家模型服务、不同任务类型与熔断重试策略。',
    color: 'purple',
    highlights: [
      '统一协议接口：LLMManager 抽象出统一的 chat/embedding/vision 接口，兼容 SiliconFlow、OpenAI、DeepSeek 等多厂商 API',
      '模型注册表：LLMRegistry 按任务类型（intent_recognition、final_generation、reranking 等）注册与路由不同模型',
      '智能路由策略：根据任务类型、模型可用性、负载情况自动选择最合适的模型，支持故障转移',
      '熔断与重试：内置 Circuit Breaker 机制，当模型服务异常时自动熔断，支持指数退避重试策略',
      '审计与统计：记录每次调用的 Token 使用量、响应时间、成功/失败状态，支持后续分析与优化',
      'Prompt 引擎：PromptEngine 支持模板渲染、变量替换、多轮对话历史格式化等功能',
    ],
    codeRefs: [
      { label: 'LLMManager', path: 'backend/app/core/llm/manager.py' },
      { label: 'LLMRegistry', path: 'backend/app/core/llm/registry.py' },
      { label: 'PromptEngine', path: 'backend/app/core/llm/prompt_engine.py' },
    ],
  },
]

export const dataFlowStages: DataFlowStage[] = [
  {
    id: 'upload',
    title: '文件上传',
    description: '前端通过 UploadPipeline 将本地文件上传到 /api/upload/file 或 /file/stream 接口。',
  },
  {
    id: 'minio',
    title: '对象存储 MinIO',
    description: 'IngestionService 调用 MinIOAdapter 将原始文件写入 MinIO，不同知识库映射到不同 bucket。',
  },
  {
    id: 'vectorize',
    title: '多模态向量化',
    description: '解析后的文本与图片分别走 Embedding / VLM / CLIP 等管道，生成统一向量表示。',
  },
  {
    id: 'qdrant',
    title: '向量与稀疏索引',
    description: '向量写入 Qdrant，配合稀疏向量与元数据索引，构建跨模态检索底座。',
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
    description: '后端将内部 UUID 映射为数字 ID 与可读信息，前端通过 Citation 组件展示可点击引用。',
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
    name: 'SiliconFlow API',
    category: 'model',
    description: '统一模型接入平台，支持多家模型服务与多任务类型路由。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek / Qwen 系列',
    category: 'model',
    description: '用于意图识别与最终回答生成的主力大语言模型。',
  },
  {
    id: 'bge',
    name: 'BGE 系列向量模型',
    category: 'model',
    description: '用于文本向量化（Embedding）与 Cross-Encoder 重排任务。',
  },
  // infra - 只保留核心
  {
    id: 'docker',
    name: 'Docker & Docker Compose',
    category: 'infra',
    description: '容器化部署与本地一键启动，支持开发与生产环境一致性。',
  },
]

