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
    title: '设计原则',
    subtitle: '保留来源、共享检索、约束取证与引用回溯',
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
    subtitle: '从明确范围到筛选最终引用',
  },
  {
    id: 'modules',
    title: '模块边界',
    subtitle: '六个模块各自接收什么、交付什么',
  },
  {
    id: 'data-flow',
    title: '数据流转',
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
      '先明确这次要问什么、在哪些资料里找。Chat API 接收问题、知识库或文件范围与会话信息，按轮次和长度预算恢复历史；附件先提取摘要，再作为当前轮上下文。',
    backendEntry: 'backend/app/api/chat.py + backend/app/modules/chat/context_manager.py',
    keyTechnologies: ['FastAPI', 'Session Context', 'File Scope'],
  },
  {
    id: 'mode-routing',
    marker: '02',
    title: '判断是否需要深入取证',
    short: 'auto / direct / agent',
    lane: 'shared',
    description:
      '聚焦的问题走 Direct；需要对比、分步或综合多种材料时，可以选择 Agent。Auto 根据问题中的复杂度信号与文件范围判断路径，并在流式阶段事件中说明选择理由。',
    backendEntry: 'backend/app/modules/agent/mode_router.py::resolve_agent_mode',
    keyTechnologies: ['自动判断', '手动选择', '分流理由'],
  },
  {
    id: 'direct-retrieval',
    marker: '03A',
    title: '直接检索',
    short: 'one pass retrieval',
    lane: 'direct',
    description:
      '一次检索编排完成问题理解、查询改写与范围路由，按需检索文字、图片、音频和视频。候选先经加权 RRF 融合，再默认使用 Cross-Encoder 精排；无检索需求的 Web 闲聊可直接进入生成。',
    backendEntry: 'backend/app/modules/retrieval/service.py::RetrievalService',
    keyTechnologies: ['意图与改写', '范围路由', '多路召回', '融合精排'],
  },
  {
    id: 'agent-evidence-loop',
    marker: '03B',
    title: 'Agent 证据循环',
    short: 'plan → search → observe',
    lane: 'agent',
    description:
      '先用原问题建立证据锚点，再规划互补问题，并发调用同一个只读检索工具。证据账本跨轮去重并保留所需模态；规划器判断证据足够、没有新增结果或触及预算时停止。',
    backendEntry: 'backend/app/modules/agent/service.py::AgenticRetrievalService',
    keyTechnologies: ['原问题锚点', '只读补查', '证据去重', '预算停止'],
  },
  {
    id: 'context-citation',
    marker: '04',
    title: '整理材料，建立来源编号',
    short: 'ContextBuilder + ReferenceMap',
    lane: 'shared',
    description:
      '两条路径都交付 RetrievalResult。ContextBuilder 按模态和长度预算选择材料，用 ReferenceMap 关联编号、文件与媒体定位；流式交付时再补全文档相邻段落，便于回看上下文。',
    backendEntry: 'backend/app/modules/generation/context_builder.py',
    keyTechnologies: ['材料预算', '来源编号', '媒体定位', '相邻段落'],
  },
  {
    id: 'generation-delivery',
    marker: '05',
    title: '生成回答，收束实际引用',
    short: '候选来源 → 正文 → 最终引用',
    lane: 'shared',
    description:
      'Web 先接收候选来源，再流式显示正文。生成完成后，系统按正文实际使用的 [n] 筛选来源，以最终引用替换候选列表；没有引用时清空来源。编号筛选不等于事实核验。',
    backendEntry: 'backend/app/modules/generation/service.py + citation_selection.py',
    keyTechnologies: ['流式回答', '显式引用', '最终来源替换'],
  },
]

export const coreModules: ModuleInfo[] = [
  {
    id: 'ingestion',
    name: '素材入库',
    role: '让不同形式的资料成为可搜索、可回溯的材料。',
    color: 'green',
    receives: '上传文件、网页、目录与飞书文档',
    delivers: '保留的原文件、语义片段与多模态索引',
    highlights: [
      '上传、网页、文件夹、热点与飞书 Docx/Wiki 统一进入入库服务',
      '文档分块在解析文本上规划边界并校验完整性；Excel/CSV 使用行块、工作表摘要和列画像',
      '图片关联描述与视觉向量；音频关联转写与声学向量；视频按场景、镜头和关键帧组织',
      '原文件、关键帧与视频解析清单保存在 MinIO；文本、向量及检索元数据写入 Qdrant',
    ],
    codeRefs: [
      { label: 'Service', path: 'backend/app/modules/ingestion/service.py' },
      { label: 'Agentic Chunker', path: 'backend/app/modules/ingestion/splitters/agentic.py' },
      { label: 'Vector Store', path: 'backend/app/modules/ingestion/storage/vector_store.py' },
    ],
  },
  {
    id: 'knowledge',
    name: '知识空间',
    role: '组织资料、生成主题画像，为未指定范围的问题选择知识库。',
    color: 'blue',
    receives: '知识库内容、统计信息与用户问题',
    delivers: '知识库画像、候选范围与生命周期状态',
    highlights: [
      '管理知识库的创建、更新与删除，以及文件统计、主题画像和重建任务',
      '从文档、图片、音频和视频场景采样，经聚类生成可供路由的主题摘要',
      '指定的知识库或文件范围优先；未指定时，用问题及其改写匹配画像，选择相关知识库',
    ],
    codeRefs: [
      { label: 'Service', path: 'backend/app/modules/knowledge/service.py' },
      { label: 'Portraits', path: 'backend/app/modules/knowledge/portraits.py' },
      { label: 'Router', path: 'backend/app/modules/knowledge/router.py' },
    ],
  },
  {
    id: 'retrieval',
    name: '混合检索',
    role: '从不同模态和检索通道中，找出与当前问题相关的材料。',
    color: 'blue',
    receives: '问题、上下文与知识库 / 文件范围',
    delivers: '排序后的多模态证据与统一检索结果',
    highlights: [
      '识别问题需要哪些模态，结合会话指代生成检索关键词与多视角表达',
      '文字使用语义与稀疏召回；图片和音频补充专用向量；视频检索镜头描述与转写',
      '用加权 RRF 合并不同通道的排名，默认由 Cross-Encoder 精排，并保护所需模态的候选',
      '独立检索 API 向外部客户端提供精简的证据结构，屏蔽底层向量库字段',
    ],
    codeRefs: [
      { label: 'Service', path: 'backend/app/modules/retrieval/service.py' },
      { label: 'Search Engine', path: 'backend/app/modules/retrieval/search_engine.py' },
      { label: 'Public API', path: 'backend/app/api/retrieval.py' },
    ],
  },
  {
    id: 'agent',
    name: 'Agent 取证',
    role: '围绕已有证据补查，让复杂问题在明确预算内逐步展开。',
    color: 'orange',
    receives: '复杂问题、执行预算与只读检索工具',
    delivers: '合并后的证据池、补查记录与停止理由',
    highlights: [
      '先用原问题检索建立锚点，再由规划器决定继续补查或结束取证',
      '子查询沿用知识库 / 文件范围，轻量预处理后复用检索服务；工具仅允许只读搜索',
      '按模态与证据 ID 去重，保留原问题锚点及所需模态，避免补查挤掉关键材料',
      '默认最多 3 轮、每轮 3 条、总计 6 条补查，证据上限为 30 条；补查数不含原问题检索',
    ],
    codeRefs: [
      { label: 'Mode Router', path: 'backend/app/modules/agent/mode_router.py' },
      { label: 'Planner', path: 'backend/app/modules/agent/planner.py' },
      { label: 'Runtime', path: 'backend/app/modules/agent/service.py' },
    ],
  },
  {
    id: 'generation',
    name: '回答生成',
    role: '把检索材料组织成回答，并保留正文实际使用的来源。',
    color: 'purple',
    receives: '检索证据、历史上下文与生成约束',
    delivers: '流式回答、引用映射与最终来源列表',
    highlights: [
      '按模态、条数与长度预算选择材料，建立当前轮的来源编号',
      '引用关联原文片段、图片和媒体地址；视频可定位到镜头或场景时间范围',
      '先预载引用再流式显示正文，完成后仅保留实际引用的来源；编号匹配不替代事实核验',
    ],
    codeRefs: [
      { label: 'Service', path: 'backend/app/modules/generation/service.py' },
      { label: 'Context Builder', path: 'backend/app/modules/generation/context_builder.py' },
      { label: 'Citation Selection', path: 'backend/app/modules/generation/citation_selection.py' },
    ],
  },
  {
    id: 'llm-manager',
    name: '模型调度',
    role: '按任务选择模型，让理解、向量化、精排与生成各用所长。',
    color: 'purple',
    receives: '任务类型、提示词与模型参数',
    delivers: '统一的对话、向量与精排调用结果',
    highlights: [
      '分别配置问题理解、文档分块、图像描述、视频解析、精排和最终生成任务',
      '通过统一接口接入已配置的 SiliconFlow、OpenRouter、阿里云百炼与 DeepSeek',
      '集中管理提示词与模型路由；本地 BGE-M3、CLIP、CLAP 编码器由公共基础层复用',
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
    description: '原文件与检索索引分开保存：MinIO 留存文件及派生媒体，Qdrant 保存可检索内容。长任务可使用 Redis / Celery 调度。',
    stages: [
      { title: '接入', detail: '上传 · URL · 飞书文档 · 文件夹 · 热点' },
      { title: '解析', detail: 'ParserFactory · 媒体解析 · 内嵌素材' },
      { title: '语义单元', detail: 'Agentic Chunk · Image · Audio · Shot' },
      { title: '索引', detail: 'Dense · Sparse · CLIP · CLAP · Shot vectors' },
      { title: '保存', detail: 'MinIO 原文件 · Qdrant 内容与索引' },
    ],
  },
  {
    id: 'query',
    eyebrow: 'READ PATH',
    title: '在线问答',
    description: '先明确检索范围，再选择一次取证或按预算补查。两条路径共享生成链路，并在回答完成后收束为实际引用的来源。',
    stages: [
      { title: '范围', detail: 'Session · KB · File · Attachment' },
      { title: '分流', detail: 'Auto policy → Direct / Agent' },
      { title: '取证', detail: 'Portrait route · Hybrid retrieval · Rerank' },
      { title: '收敛', detail: 'RetrievalResult · Evidence ledger' },
      { title: '回答', detail: '材料编号 · 流式生成 · 最终引用' },
    ],
  },
]

export const techStackItems: TechStackItem[] = [
  {
    id: 'fastapi',
    name: 'FastAPI · Python 3.11+',
    category: 'backend',
    description: '接收请求、编排领域服务，并通过 SSE 交付回答。',
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
    description: '保存原文件、关键帧与视频解析清单，提供临时媒体访问地址。',
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'storage',
    description: '保存文本片段、检索元数据，以及语义、稀疏和多模态向量。',
  },
  {
    id: 'redis',
    name: 'Redis · Celery',
    category: 'infra',
    description: '管理异步任务、导入进度与任务租约；飞书会话可使用 Redis 持久化。',
  },
  {
    id: 'retrieval-models',
    name: 'Qwen Embedding · BGE-M3 · Reranker',
    category: 'model',
    description: '分别承担语义编码、稀疏召回与候选精排；语义与精排模型可按任务配置。',
  },
  {
    id: 'media-models',
    name: 'VLM · Omni · CLIP · CLAP',
    category: 'model',
    description: '理解图片、音频和视频，并建立视觉与声学检索线索。',
  },
  {
    id: 'providers',
    name: 'SiliconFlow · OpenRouter · Bailian · DeepSeek',
    category: 'model',
    description: '按配置启用供应商，由模型调度层为不同任务选择调用路径。',
  },
  {
    id: 'docker',
    name: 'Docker Compose',
    category: 'infra',
    description: '编排后端、对象存储、向量库、Redis、任务 Worker 与监控服务。',
  },
  {
    id: 'feishu',
    name: '飞书开放平台',
    category: 'integration',
    description: '可选的文档导入与聊天入口；目前复用 Direct 检索，以卡片、Post 或文本回复。',
  },
]
