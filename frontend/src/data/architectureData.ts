export type ArchitectureSectionId =
  | 'overview'
  | 'innovations'
  | 'performance'
  | 'system-architecture'
  | 'external-integrations'
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
  category: 'backend' | 'frontend' | 'storage' | 'model' | 'infra' | 'integration'
  description?: string
}

export const architectureSections: ArchitectureSection[] = [
  {
    id: 'overview',
    title: '项目总览',
    subtitle: 'Multi-Modal 智能路由可扩展知识库 RAG Agent',
  },
  {
    id: 'innovations',
    title: '核心创新点',
    subtitle: '路由、全模态检索、One-Pass、可解释性等',
  },
  {
    id: 'performance',
    title: '设计目标与能力',
    subtitle: '检索、延迟、重排与多模态覆盖（架构取向，非压测数值）',
  },
  {
    id: 'system-architecture',
    title: '整体架构图',
    subtitle: 'Web SSE / 可选飞书 → FastAPI → DDD → 存储与模型',
  },
  {
    id: 'external-integrations',
    title: '飞书与外部集成',
    subtitle: '可选部署：长连接、卡片与主 RAG 管道复用',
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
    subtitle: '接入 → MinIO → 向量化 → Qdrant → 检索生成 → Web（可选飞书）',
  },
  {
    id: 'tech-stack',
    title: '技术栈与非功能特性',
    subtitle: '技术选型与可观测性、安全性、扩展性',
  },
]

export const overviewStats = {
  /** DDD 业务域 + LLM Manager（Core） */
  modules: 5,
  /** MinIO / Qdrant / Redis */
  storageLayers: 3,
}

export interface InnovationPoint {
  id: string
  title: string
  description: string
  impact: string
}

export const innovationPoints: InnovationPoint[] = [
  {
    id: 'kb-portrait',
    title: '知识库画像动态生成',
    description: 'K-Means 聚类 + LLM 主题摘要的混合方法，自动分析知识库内容特征并生成结构化画像',
    impact: '显著提升知识库选取的准确性与稳定性',
  },
  {
    id: 'hybrid-search',
    title: '多路融合混合检索',
    description:
      '主干为 Dense + BGE-M3 稀疏 + Visual（图片 text_vec + clip_vec；Visual 检索可并入 video 关键帧）；audio_intent 非 unnecessary 时 Audio（CLAP + ASR/描述）；Video 为 scene_vec + frame_vec + clip_vec 多路检索；经加权 RRF 粗排与 Cross-Encoder 精排',
    impact: '在复杂查询与多模态知识库场景下更稳定地召回文档/图片/音频/视频相关片段',
  },
  {
    id: 'two-stage-rerank',
    title: '两阶段重排优化',
    description: 'RRF 粗排 + Cross-Encoder 精排的两阶段重排机制，在保证检索效率的同时显著提升 Top-K 准确率',
    impact: 'Top-K 准确率显著提升',
  },
  {
    id: 'one-pass-intent',
    title: 'One-Pass 意图识别',
    description: '将意图分类、查询改写、关键词/多视角生成与 visual/audio/video 意图统一为一次 LLM 调用，输出结构化 IntentObject',
    impact: '在保证分析质量的前提下显著降低请求整体延迟，并统一控制多模态检索分支',
  },
  {
    id: 'multimodal-vector',
    title: '全模态向量化融合',
    description: '文档 Dense + BGE-M3 稀疏；图片 VLM + CLIP 双路；音频 ASR/描述 + CLAP 双路（+ 可选稀疏）；视频每关键帧 scene_vec + frame_vec + clip_vec（MLLM 场景/帧规划）。文本侧统一 Embedding，支持文档/图片/音频/视频跨模态检索与路由',
    impact: '文档、图片、音频、视频统一表征与跨模态检索',
  },
  {
    id: 'visual-thinking',
    title: '可视化思考过程',
    description: '实现 AI 推理链路的实时可视化展示，包括意图识别、知识库路由、检索策略等思考步骤',
    impact: '可解释性和可调试性大幅提升',
  },
  {
    id: 'feishu-delivery',
    title: '飞书 IM 原生送达（可选）',
    description:
      '启用飞书集成时：长连接接收 IM 事件，与 Web 共用同一套 DDD 检索与生成管道；支持卡片 2.0（Markdown / 图片 / OPUS 音频混排）、Post 与多消息回退，可选 CardKit 流式更新正文',
    impact: '企业 IM 与 Web 端共用同一套多模态 RAG 与探活接口',
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
    label: '混合检索',
    value: '多路',
    unit: '融合',
    improvement: 'Dense + BGE-M3 稀疏为主干；Visual 为 CLIP + VLM；Audio/Video 按意图分支参与',
    description:
      '三路（Dense / Sparse / Visual）为检索主轴；音频、视频在意图与数据就绪时并入 RRF 与精排。',
  },
  {
    id: 'intent-latency',
    label: '意图阶段',
    value: '单次',
    unit: 'LLM 调用',
    improvement: '输出结构化 IntentObject，减少串行往返',
    description: '意图分类、查询改写、关键词与 multi_view_queries、visual/audio/video 意图在同一次调用中结构化输出，失败时回退默认意图。',
  },
  {
    id: 'rerank-accuracy',
    label: '两阶段重排',
    value: 'RRF',
    unit: '+ CE',
    improvement: '粗排融合多路候选，Cross-Encoder 精排与加权合并',
    description: '先加权 RRF 合并 Dense/Sparse/Visual 等候选，再对 (query, content) 进行 Cross-Encoder 精排。',
  },
  {
    id: 'multimodal-support',
    label: '多模态链路',
    value: '端到端',
    unit: '可追溯',
    improvement: '接入、向量库、检索、引用与 SSE 思考链同一套管道',
    description:
      '文档分块 + 图片/音视频条目不切块；引用含 chunk_id、context_window；前端 ThinkingCapsule / CitationPopover 展示 SSE 推送的 thought、citation 载荷。',
  },
]

export const overviewTags = [
  '多模态 RAG',
  '知识库画像路由',
  'BGE-M3 稀疏检索',
  'Dense + Sparse + Visual',
  'RRF + Cross-Encoder',
  'SSE 思考链',
  '引用与调试',
  '可选飞书集成',
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
    title: '多路混合检索',
    short: 'Dense + Sparse + Visual（+ Audio / Video）',
    description:
      'HybridSearchEngine：Dense + Sparse 为文档主轴；图片为 text_vec + clip_vec 双路；visual_intent 下 Visual 检索可并入 video 关键帧；audio_intent 非 unnecessary 时检索 audio_vectors；video_vectors 为 scene/frame/clip 三路（video 路权重受 video_intent 调节）。多路加权 RRF 粗排后再 Cross-Encoder 精排。',
    backendEntry: 'backend/app/modules/retrieval/search_engine.py::HybridSearchEngine',
    estimatedTime: '300-800ms',
    keyTechnologies: ['Dense', 'BGE-M3 Sparse', 'CLIP Visual', 'CLAP Audio', 'Video', 'RRF Fusion'],
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
    role: '负责文件解析、切分与全模态向量化（文档 Dense+BGE-M3；图片 VLM+CLIP；音频 ASR+CLAP；视频每关键帧 scene_vec+frame_vec+clip_vec），以及写入 MinIO 与 Qdrant。',
    color: 'green',
    highlights: [
      '统一入口：IngestionService 完成解析 → MinIO → 向量化 → Qdrant 全流程；支持本地上传、URL、文件夹、热点订阅等多来源接入',
      '解析器工厂：PDF 优先 MinerU（API/本地 2.5）→ PaddleOCR-VL-1.5 → PyMuPDF 兜底；DOCX/PPTX 优先 MinerU 再 python-docx / python-pptx；TXT/Markdown；图片（PIL）；音频（soundfile/librosa）；视频（OpenCV）。文档内嵌图先 VLM 再插回原文后分块；音频以文件为条，视频以关键帧为条',
      '分块策略：文档递归语义分块 + 重叠窗口，chunk 携带 context_window；图片/音频各一点；视频每关键帧一点（含场景/帧描述与 CLIP）',
      '文档向量化：Qwen3-Embedding-8B（Dense 4096 维）+ BGE-M3 稀疏，写入 text_chunks',
      '图片向量化：VLM caption + text_vec + CLIP clip_vec（768 维），写入 image_vectors',
      '音频向量化：ASR 转写 + LLM 描述 + text_vec + CLAP clap_vec（512 维，可选 sparse），写入 audio_vectors',
      '视频向量化：MLLM 场景/关键帧规划 → 每帧 scene_vec + frame_vec + clip_vec，写入 video_vectors（一关键帧一点）',
      '存储：MinIO 按知识库与类型分目录（documents/images/audios/videos）；VectorStore 写入 text_chunks / image_vectors / audio_vectors / video_vectors / kb_portraits',
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
    role: '知识库 CRUD 与画像生成（K-Means + LLM 主题摘要），以及基于画像的 TopN 检索 + 加权路由决策；画像可覆盖文档/图片/音频/视频全模态。',
    color: 'blue',
    highlights: [
      '知识库 CRUD：创建、查询、更新、删除知识库，维护元数据与统计；支持用户指定知识库时跳过路由',
      '画像生成：从 Text、Image、Audio、Video 按比例采样向量（文档 dense、图/音 text_vec、视频 frame_vec；懒加载正文），K = sqrt(N/2) 限制内 K-Means 聚类',
      '主题摘要：每簇取近中心若干样本，以 [文档片段]/[图片描述]/[音频转写描述]/[视频帧描述] 等前缀拼成 content_pieces，LLM 生成 topic_summary 后向量化写入 kb_portraits',
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
    role: 'One-Pass 意图识别（含 visual/audio/video 意图）、多路混合检索（Dense/Sparse/Visual/Audio/Video）与两阶段重排，构成检索主通路。',
    color: 'blue',
    highlights: [
      'One-Pass 意图识别：意图分类、查询改写、关键词/多视角生成、visual_intent/audio_intent/video_intent 统一一次 LLM 调用，输出 IntentObject',
      '查询策略：refined_query 用于 Dense 与路由；sparse_keywords 与 dense_query 拼接送 BGE-M3 稀疏检索；multi_view_queries 用于 Dense 多视角',
      '多路混合检索：Dense（主查询 + 多视角）、Sparse（BGE-M3）、Visual（图片双路 RRF，可并入视频关键帧）、Audio（audio_intent 非 unnecessary 时 text + CLAP + 可选 sparse）、Video（scene_vec + frame_vec + clip_vec 三路 RRF；audio 与 video 的 intent/权重策略见架构文档）',
      '两阶段重排：加权 RRF 粗排（dense/sparse/visual/audio/video 可配）→ Cross-Encoder 精排，精排分与 RRF 分合并取 final_top_k；implicit 时对图片/音频/视频做配额保护',
      'RetrievalContext：封装 target_kb_ids、search_strategies、visual_intent、audio_intent、video_intent 等，贯穿检索与重排',
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
    role: '将重排结果转为引用映射与全模态 Prompt（文档/图片/音频/视频），驱动 LLM 生成，并通过 SSE 推送 thought/citation/message。',
    color: 'purple',
    highlights: [
      '上下文构建：ContextBuilder 按分数排序分配序号 1,2,3…，生成 ReferenceMap（content_type: doc/image/audio/video、presigned_url/audio_url/video_url、chunk_id、关键帧等）',
      '长度控制：max_context_length、max_chunks、max_images、max_audios、max_videos（implicit 时略多），按相关性填入各模态模板',
      '系统提示词：按意图类型选用模板，规定 [id] 引用、文档/图片/音频/视频多模态描述与诚实回答原则；prompt 模板集中在 core/llm/prompt.py',
      '全模态格式化：文档【材料 n】类型:文档|来源；图片【材料 n】类型:图片|视觉描述；音频【材料 n】类型:音频|转写/描述；视频【材料 n】类型:视频|描述/关键帧',
      '流式输出：StreamManager 发送 thought（意图/路由/检索策略含 visual/audio/video）、citation（引用元数据与 debug_info）、message（LLM delta）',
      '前端：ThinkingCapsule 展示 visual/audio/video intent；CitationPopover 按类型展示文档片段/图片灯箱/音频视频播放器与关键帧',
      '飞书侧：同一生成结果可经 feishu_rag_card_v2 等模块格式化为卡片 / Post / 文件回复；与 Web 共用 ReferenceMap 与多模态引用语义',
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
    role: '按 task_type 路由到对应模型与 Provider，统一 chat/embed/rerank 及多模态任务（图注、ASR、音频/视频描述）接口，支持多厂商 API 与提示词集中管理。',
    color: 'purple',
    highlights: [
      '任务路由：intent_recognition、image_captioning、audio_transcription、final_generation、reranking、kb_portrait_generation 等映射到具体模型与 Provider',
      '统一接口：chat（多轮消息、temperature、多模态输入如图/音）、embed（文本列表）、rerank（query + documents）；多模态任务由支持图/音的 API 承接',
      '多厂商 Provider：SiliconFlow、OpenRouter、阿里云百炼、DeepSeek 等，Manager 负责拼装请求与解析响应',
      '提示词：prompt.py 集中所有模板（含 image_captioning、audio_transcription 等），prompt_engine 提供 render_template，业务层只传变量',
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
    description: 'MinIOAdapter 按知识库与类型组织路径（documents/images/audios/videos），写入 MinIO；对象路径与 file_id 与向量库 Payload 一致，便于 Presigned URL 与删除联动，音视频可提供播放 URL。',
  },
  {
    id: 'vectorize',
    title: '全模态向量化',
    description: '文档：Dense（Qwen3-Embedding-8B）+ BGE-M3 稀疏；图片：VLM 描述 + text_vec + CLIP；音频：ASR + 描述 + text_vec + CLAP（可选 sparse）；视频：每关键帧 scene_vec + frame_vec + clip_vec（MLLM 场景/帧规划 + 截帧 CLIP）。统一写入 Qdrant 对应集合。',
  },
  {
    id: 'qdrant',
    title: '向量与稀疏索引',
    description: 'Qdrant 存储 text_chunks（dense + sparse）、image_vectors（clip_vec + text_vec）、audio_vectors（text_vec + clap_vec，可选 sparse）、video_vectors（scene_vec + frame_vec + clip_vec，一关键帧一点）、kb_portraits，支撑多路混合检索与路由。',
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
    description: 'ReferenceMap 提供序号、content_type（doc/image/audio/video）、file_name、content 摘要、img_url/audio_url/video_url；SSE citation 带 debug_info（chunk_id、context_window）。前端 CitationPopover 按类型展示：文档片段、图片灯箱、音频/视频播放器与关键帧。',
  },
  {
    id: 'channels',
    title: '多端输出（Web / 可选飞书）',
    description:
      'Web 通过 SSE 流式推送思考链、引用与正文。若启用飞书集成，则经 WSS 事件驱动同一套检索与生成，再经开放平台 API 发送卡片、Post 或分条消息（大图/音频可上传后引用 file_key）。',
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
    description: '兼容 S3 的对象存储，用于存放原始文件（文档、图片、音频、视频），按知识库与类型分目录（documents/images/audios/videos）管理。',
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
    description: '意图识别、最终生成、画像摘要等对话类任务；VLM 用于图片/关键帧描述（如 Qwen3-VL）；多模态 API 用于 ASR 音频转写与音频/视频描述。',
  },
  {
    id: 'embedding',
    name: 'Qwen3-Embedding-8B',
    category: 'model',
    description: '文本 Dense 向量（4096 维），用于 text_chunks、image/audio 的 text_vec、video 的 scene_vec/frame_vec、kb_portraits 等。',
  },
  {
    id: 'bge',
    name: 'BGE-M3 / BGE-Reranker',
    category: 'model',
    description: 'BGE-M3 稀疏编码与稀疏检索（文档与可选音频）；BGE-Reranker 或 Qwen3-Reranker 用于 Cross-Encoder 精排。',
  },
  {
    id: 'clip',
    name: 'CLIP (clip-vit-large-patch14)',
    category: 'model',
    description: '图片与视频关键帧视觉向量（768 维）：image 与 text_vec 双路；video 与 scene_vec/frame_vec 一起做三路 Prefetch + Fusion RRF。',
  },
  {
    id: 'clap',
    name: 'CLAP (laion/clap-htsat-fused)',
    category: 'model',
    description: '音频声学向量（512 维），与 text_vec 双路写入 audio_vectors，检索时与文本/稀疏一起参与 RRF。',
  },
  // infra - 只保留核心
  {
    id: 'docker',
    name: 'Docker & Docker Compose',
    category: 'infra',
    description: '容器化部署与本地一键启动，支持开发与生产环境一致性。',
  },
  {
    id: 'feishu-lark',
    name: '飞书开放平台（Lark / lark-oapi）',
    category: 'integration',
    description:
      '长连接接收 im.message.receive_v1 等事件；租户 token、消息/卡片/文件上传 API；可选 CardKit 创建卡片与流式 patch；探活见 backend/app/api/feishu.py::/ws-status。',
  },
]

