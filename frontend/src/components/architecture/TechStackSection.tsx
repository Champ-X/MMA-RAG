import { Boxes, ChevronDown, Info, Network, RadioTower, UploadCloud } from 'lucide-react'
import './architectureSections.css'

const runtimeLayers = [
  {
    id: 'query', title: '问答主路径', label: '在线读取', icon: RadioTower,
    description: '处理一次提问所需的主要职责。',
    components: [
      { role: '交互与编排', name: 'React · TypeScript / FastAPI · Python', detail: '接收范围与问题，编排领域服务，以流式响应交付回答。' },
      { role: '检索与精排', name: 'Qdrant / Embedding · Sparse · Reranker', detail: '按需求选择召回通道，再对候选证据融合排序。' },
      { role: '上下文与生成', name: 'ContextBuilder / LLMManager', detail: '建立来源映射，按任务选择模型；MinIO 提供媒体访问。' },
    ],
  },
  {
    id: 'processing', title: '素材处理', label: '写入与更新', icon: UploadCloud,
    description: '将不同素材变成可重复检索的产物。',
    components: [
      { role: '解析与理解', name: 'ParserFactory / VLM · Omni · CLIP · CLAP', detail: '按素材类型启用解析与模型能力，将对象存入 MinIO、索引写入 Qdrant。' },
      { role: '异步任务', name: 'Redis / Celery', detail: '按配置提供任务队列、结果状态与长任务处理。', optional: true },
    ],
  },
  {
    id: 'extension', title: '部署与接入', label: '按需启用', icon: Network,
    description: '根据运行环境与入口扩展。',
    components: [
      { role: '服务部署', name: 'Docker Compose', detail: '编排应用、对象存储、向量库及可选 Worker。' },
      { role: '飞书接入', name: '飞书开放平台', detail: '支持文档导入与聊天入口；当前飞书问答采用 Direct 路径。', optional: true },
    ],
  },
] as const

const knownBoundaries = [
  { title: '可追溯与事实核验', detail: '最终引用按正文出现的编号筛选，并映射已有来源；这属于引用结构校验，不代表系统已逐条验证答案事实。' },
  { title: '会话与统计持久化', detail: 'Web Chat 会话与检索统计仍保存在进程内；多实例或进程重启后的连续性，需要补齐持久化。' },
  { title: '用户鉴权与跨域', detail: '应用 API 尚无内置用户鉴权，开发配置允许任意 CORS 来源；面向公网部署前需要单独配置访问控制。' },
  { title: 'Agent 可调用的工具', detail: '当前只开放只读知识检索工具，未提供写操作、审批流程、MCP 工具接入或代码执行沙箱。' },
] as const

export function TechStackSection() {
  return (
    <section id="tech-stack" className="atlas-stack-section scroll-mt-24">
      <div className="atlas-section-intro">
        <div><p className="atlas-section-kicker">运行时与边界 <span aria-hidden="true">/</span> Runtime</p><h2>看清依赖，也看清取舍</h2></div>
        <p>组件按实际职责参与协作。检索通道、媒体模型和扩展服务按任务启用，每次提问并不会调用所有能力。</p>
      </div>

      <div className="atlas-runtime-map">
        <div className="atlas-runtime-caption"><span><Boxes size={17} aria-hidden="true" />运行时职责图</span><span>核心服务 · 素材处理 · 可选扩展</span></div>
        {runtimeLayers.map((layer) => {
          const Icon = layer.icon
          return <div className="atlas-runtime-layer" data-layer={layer.id} key={layer.id}>
            <div className="atlas-runtime-layer-label"><Icon size={24} strokeWidth={1.5} aria-hidden="true" /><p>{layer.label}</p><h3>{layer.title}</h3><span>{layer.description}</span></div>
            <dl className="atlas-runtime-components">{layer.components.map((component) => <div key={component.role}><dt>{component.role}{'optional' in component && component.optional ? <span>可选</span> : null}</dt><dd><strong>{component.name}</strong><p>{component.detail}</p></dd></div>)}</dl>
          </div>
        })}
      </div>

      <details className="atlas-boundaries">
        <summary><span className="atlas-boundaries-icon"><Info size={20} strokeWidth={1.6} aria-hidden="true" /></span><span>当前实现边界<small>明确哪些已经实现，哪些仍需补齐</small></span><span className="atlas-boundaries-count">{knownBoundaries.length} 项说明</span><ChevronDown size={19} className="atlas-boundaries-chevron" aria-hidden="true" /></summary>
        <dl>{knownBoundaries.map((item) => <div key={item.title}><dt><span />{item.title}</dt><dd>{item.detail}</dd></div>)}</dl>
      </details>
    </section>
  )
}
