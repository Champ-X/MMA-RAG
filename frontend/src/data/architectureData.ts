export type ArchitectureSectionId =
  | 'overview'
  | 'flow-lab'
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
  marker: string
  title: string
  short: string
  description: string
  lane: 'shared' | 'direct' | 'agent'
  backendEntry?: string
  keyTechnologies?: string[]
}

export interface ModuleInfo {
  id: string
  name: string
  role: string
  color: 'blue' | 'green' | 'orange' | 'purple'
  receives: string
  delivers: string
  highlights: string[]
  codeRefs?: {
    label: string
    path: string
  }[]
}

export interface DataFlowLane {
  id: 'ingestion' | 'query'
  eyebrow: string
  title: string
  description: string
  stages: {
    title: string
    detail: string
  }[]
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
    title: '系统契约',
    subtitle: '边界、原则与两种执行路径',
  },
  {
    id: 'flow-lab',
    title: '交互演示',
    subtitle: '逐步观看多模态解析与检索链路',
  },
  {
    id: 'system-architecture',
    title: '整体架构',
    subtitle: '接入、领域层、数据面与模型面',
  },
  {
    id: 'request-flow',
    title: '问答链路',
    subtitle: '直接检索与 Agent 深研如何汇合',
  },
  {
    id: 'modules',
    title: '模块边界',
    subtitle: '六个核心模块及代码入口',
  },
  {
    id: 'data-flow',
    title: '双向数据流',
    subtitle: '离线入库与在线问答共用数据面',
  },
  {
    id: 'tech-stack',
    title: '运行时与边界',
    subtitle: '技术选型、可选集成与已知约束',
  },
]

export const overviewStats = {
  modules: 6,
  runtimeServices: 3,
  modalities: 4,
  executionModes: 2,
}

export const overviewTags = [
  'Agentic Chunking',
  'KB 画像路由',
  'Dense + Sparse + Visual',
  'Audio / Video',
  'RRF + Cross-Encoder',
  'Evidence Ledger',
  'SSE + Citation',
] as const

export const requestFlowSteps: RequestFlowStep[] = [
  {
    id: 'request-context',
    marker: '01',
    title: '接收请求与恢复上下文',
    short: 'message + scope + session',
    lane: 'shared',
    description:
      'Chat API 接收问题、知识库或文件范围、会话 ID 与附件。后端按完整轮次、消息数和字符预算选取历史，同一份上下文继续参与检索与生成。',
    backendEntry: 'backend/app/api/chat.py + backend/app/modules/chat/context_manager.py',
    keyTechnologies: ['FastAPI', 'Session Context', 'File Scope'],
  },
  {
    id: 'mode-routing',
    marker: '02',
    title: '选择执行路径',
    short: 'auto / direct / agent',
    lane: 'shared',
    description:
      '直接模式固定走一次检索；Agent 模式固定进入有界循环；自动模式根据对比、分步、跨模态、多文件与问题约束等确定性信号选择路径，并把理由写入思考事件。',
    backendEntry: 'backend/app/modules/agent/mode_router.py::resolve_agent_mode',
    keyTechnologies: ['Explainable Policy', 'Backward Compatibility'],
  },
  {
    id: 'direct-retrieval',
    marker: '03A',
    title: '直接检索',
    short: 'one pass retrieval',
    lane: 'direct',
    description:
      '一次 RetrievalService 调用完成 One-Pass 意图、知识库画像路由、Dense / Sparse / Visual / Audio / Video 召回、加权 RRF 与 Cross-Encoder 精排。',
    backendEntry: 'backend/app/modules/retrieval/service.py::RetrievalService',
    keyTechnologies: ['One-Pass Intent', 'KB Routing', 'Hybrid Retrieval', 'Rerank'],
  },
  {
    id: 'agent-evidence-loop',
    marker: '03B',
    title: 'Agent 证据循环',
    short: 'plan → search → observe',
    lane: 'agent',
    description:
      'Planner 生成互补子查询并并发调用同一个只读多模态检索工具；证据账本跨轮去重、记录重复命中与最佳名次，在证据充分、无新增证据或预算耗尽时停止。',
    backendEntry: 'backend/app/modules/agent/service.py::AgenticRetrievalService',
    keyTechnologies: ['Planner', 'Read-only Tool', 'Evidence Ledger', 'Hard Budgets'],
  },
  {
    id: 'context-citation',
    marker: '04',
    title: '构建材料与引用映射',
    short: 'ContextBuilder + ReferenceMap',
    lane: 'shared',
    description:
      '两条路径都输出标准 RetrievalResult。ContextBuilder 按模态与长度预算组装材料，并建立编号、来源、媒体 URL、时间范围和 context_window 等引用信息。',
    backendEntry: 'backend/app/modules/generation/context_builder.py',
    keyTechnologies: ['Multimodal Context', 'ReferenceMap', 'Budgeting'],
  },
  {
    id: 'generation-delivery',
    marker: '05',
    title: '生成与送达',
    short: 'citation → message → done',
    lane: 'shared',
    description:
      'GenerationService 调用 LLMManager 生成带 [n] 引用的回答；Web 通过 SSE 依次接收思考摘要、引用、正文和完成事件。飞书当前复用直接检索与生成链路，以卡片、Post 或文本送达。',
    backendEntry: 'backend/app/modules/generation/service.py + stream_manager.py',
    keyTechnologies: ['LLM Routing', 'SSE', 'Typed Citations', 'Feishu Adapter'],
  },
]

export const coreModules: ModuleInfo[] = [
  {
    id: 'ingestion',
    name: 'Ingestion',
    role: '把异构来源变成可追溯、可检索的结构化内容。',
    color: 'green',
    receives: '文件、URL、目录、热点与飞书内容',
    delivers: '原始对象、语义单元与多模态索引',
    highlights: [
      '本地上传、URL、文件夹、热点与飞书 Docx/Wiki 统一进入 IngestionService',
      '普通文档使用无损 Agentic Chunker；Excel/CSV 保留行块、Sheet 摘要与列画像专用策略',
      '图片使用 VLM + CLIP，音频使用 ASR + CLAP，视频以 Scene → Shot → Key Frame 建模',
      '原始对象与解析产物写入 MinIO，命名向量与稀疏索引写入 Qdrant',
    ],
    codeRefs: [
      { label: 'Service', path: 'backend/app/modules/ingestion/service.py' },
      { label: 'Agentic Chunker', path: 'backend/app/modules/ingestion/splitters/agentic.py' },
      { label: 'Vector Store', path: 'backend/app/modules/ingestion/storage/vector_store.py' },
    ],
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    role: '管理知识库生命周期，并在未指定范围时做跨库语义路由。',
    color: 'blue',
    receives: '知识库内容、统计信息与用户问题',
    delivers: '知识库画像、候选范围与生命周期状态',
    highlights: [
      '知识库 CRUD、文件统计、画像生成与重建',
      '从文档、图片、音频和视频 Shot 采样，K-Means 聚类后生成主题摘要',
      'refined_query 与多视角查询分别召回画像，再按原始分数差决定单库、多库或全库',
    ],
    codeRefs: [
      { label: 'Service', path: 'backend/app/modules/knowledge/service.py' },
      { label: 'Portraits', path: 'backend/app/modules/knowledge/portraits.py' },
      { label: 'Router', path: 'backend/app/modules/knowledge/router.py' },
    ],
  },
  {
    id: 'retrieval',
    name: 'Retrieval',
    role: '把问题转成检索策略，并融合文档、图片、音频与视频证据。',
    color: 'blue',
    receives: '问题、会话上下文与 KB / File 范围',
    delivers: '统一 RetrievalResult 与排序后的多模态证据',
    highlights: [
      'One-Pass 输出查询改写、关键词、多视角查询与三类模态意图',
      '文档 Dense + BGE-M3 Sparse；图片 text_vec + CLIP；音频 text_vec + CLAP；视频 Shot caption/ASR 四路',
      '加权 RRF 解决跨通道分数不可比，Cross-Encoder 对统一候选精排',
      '公开 /api/v1/retrieval/search 返回紧凑证据合同，不暴露内部 Qdrant payload',
    ],
    codeRefs: [
      { label: 'Service', path: 'backend/app/modules/retrieval/service.py' },
      { label: 'Search Engine', path: 'backend/app/modules/retrieval/search_engine.py' },
      { label: 'Public API', path: 'backend/app/api/retrieval.py' },
    ],
  },
  {
    id: 'agent',
    name: 'Agent Runtime',
    role: '在原检索器之上执行有界、只读、可降级的深研循环。',
    color: 'orange',
    receives: '复杂问题、执行预算与只读检索工具',
    delivers: '去重、收敛且带停止理由的证据池',
    highlights: [
      '三态入口：自动、直接检索、Agent 深研',
      'Planner 每轮产生 search / final 决策，子查询并发调用现有多模态检索',
      'Evidence Ledger 按 content_type + point_id 去重并对重复命中做有限增益',
      '默认最多 3 轮、每轮 3 条查询、总计 6 条查询、保留 30 条证据',
    ],
    codeRefs: [
      { label: 'Mode Router', path: 'backend/app/modules/agent/mode_router.py' },
      { label: 'Planner', path: 'backend/app/modules/agent/planner.py' },
      { label: 'Runtime', path: 'backend/app/modules/agent/service.py' },
    ],
  },
  {
    id: 'generation',
    name: 'Generation',
    role: '把异构证据变成有预算、有编号、可播放的生成上下文。',
    color: 'purple',
    receives: 'RetrievalResult、历史上下文与生成约束',
    delivers: 'ReferenceMap、带引用回答与 SSE 事件',
    highlights: [
      'ContextBuilder 按文档、图片、音频、视频分别控制条数与总长度',
      'ReferenceMap 统一引用编号、来源、媒体 URL、时间范围与调试元数据',
      'StreamManager 输出 thought / citation / message 等事件供 Web 白盒化展示',
    ],
    codeRefs: [
      { label: 'Service', path: 'backend/app/modules/generation/service.py' },
      { label: 'Context Builder', path: 'backend/app/modules/generation/context_builder.py' },
      { label: 'Stream Manager', path: 'backend/app/modules/generation/stream_manager.py' },
    ],
  },
  {
    id: 'llm-manager',
    name: 'LLM Manager',
    role: '按任务语义路由模型与 Provider，隔离业务代码和厂商协议。',
    color: 'purple',
    receives: 'task_type、提示词与标准化模型参数',
    delivers: '与供应商无关的 Chat / Embed / Rerank 结果',
    highlights: [
      'intent_recognition、document_chunking、image_captioning、video_parsing、reranking、final_generation 等任务映射',
      '统一 chat / embed / rerank 接口，支持 SiliconFlow、OpenRouter、阿里云百炼与 DeepSeek',
      '提示词集中管理；本地 BGE-M3、CLIP、CLAP 等编码设施由 Core 复用',
    ],
    codeRefs: [
      { label: 'Manager', path: 'backend/app/core/llm/manager.py' },
      { label: 'Registry', path: 'backend/app/core/llm/__init__.py' },
      { label: 'Prompts', path: 'backend/app/core/llm/prompt.py' },
    ],
  },
]

export const dataFlowLanes: DataFlowLane[] = [
  {
    id: 'ingestion',
    eyebrow: 'WRITE PATH',
    title: '离线入库',
    description: '文件和外部来源先被固化与理解，再写入对象层和检索层；Redis / Celery 承担长任务的控制面。',
    stages: [
      { title: '接入', detail: '上传 · URL · 飞书文档 · 文件夹 · 热点' },
      { title: '解析', detail: 'ParserFactory · 媒体解析 · 内嵌素材' },
      { title: '语义单元', detail: 'Agentic Chunk · Image · Audio · Shot' },
      { title: '索引', detail: 'Dense · Sparse · CLIP · CLAP · Shot vectors' },
      { title: '落盘', detail: 'MinIO objects + Qdrant collections' },
    ],
  },
  {
    id: 'query',
    eyebrow: 'READ PATH',
    title: '在线问答',
    description: '问题只读访问索引；直接路径一次完成，Agent 路径重复调用同一检索器，最终汇入同一引用与生成合同。',
    stages: [
      { title: '范围', detail: 'Session · KB · File · Attachment' },
      { title: '分流', detail: 'Auto policy → Direct / Agent' },
      { title: '取证', detail: 'Portrait route · Hybrid retrieval · Rerank' },
      { title: '收敛', detail: 'RetrievalResult · Evidence ledger' },
      { title: '送达', detail: 'ReferenceMap · LLM · Web SSE / 飞书直达' },
    ],
  },
]

export const techStackItems: TechStackItem[] = [
  {
    id: 'fastapi',
    name: 'FastAPI · Python 3.11+',
    category: 'backend',
    description: 'HTTP、SSE、领域编排与可选飞书运行时。',
  },
  {
    id: 'react',
    name: 'React · TypeScript · Vite',
    category: 'frontend',
    description: '聊天、知识库、设置、架构导读与引用交互。',
  },
  {
    id: 'minio',
    name: 'MinIO',
    category: 'storage',
    description: '原始文件、关键帧、解析 manifest 与预签名媒体 URL。',
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'storage',
    description: 'Dense、Sparse 与多命名向量集合。',
  },
  {
    id: 'redis',
    name: 'Redis · Celery',
    category: 'infra',
    description: '可选 Celery broker/result backend、导入状态、租约与飞书会话。',
  },
  {
    id: 'retrieval-models',
    name: 'Qwen Embedding · BGE-M3 · Reranker',
    category: 'model',
    description: '文本语义、稀疏召回与候选精排。',
  },
  {
    id: 'media-models',
    name: 'VLM · Omni · CLIP · CLAP',
    category: 'model',
    description: '图片、音频与视频理解及专用向量。',
  },
  {
    id: 'providers',
    name: 'SiliconFlow · OpenRouter · Bailian · DeepSeek',
    category: 'model',
    description: '由 LLMManager 按 task_type 选择 Provider。',
  },
  {
    id: 'docker',
    name: 'Docker Compose',
    category: 'infra',
    description: '编排后端、MinIO、Qdrant、Redis 与可选 Worker。',
  },
  {
    id: 'feishu',
    name: '飞书开放平台',
    category: 'integration',
    description: '可选 WSS、Docx/Wiki 导入、卡片与 Post；当前聊天走直接检索路径。',
  },
]
