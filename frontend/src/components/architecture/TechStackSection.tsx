import { Box, Boxes, Braces, CloudCog, Database, Info, MonitorSmartphone } from 'lucide-react'
import { techStackItems } from '@/data/architectureData'
import './architectureSections.css'

const categoryMeta: Record<(typeof techStackItems)[number]['category'], { label: string; icon: typeof Box }> = {
  backend: { label: 'Backend / 后端', icon: Braces },
  frontend: { label: 'Frontend / 前端', icon: MonitorSmartphone },
  storage: { label: 'Storage / 存储', icon: Database },
  model: { label: 'Models / 模型', icon: Boxes },
  infra: { label: 'Infrastructure / 基础设施', icon: CloudCog },
  integration: { label: 'Integration / 可选集成', icon: Box },
}

const knownBoundaries = [
  { title: '会话与统计', detail: 'Chat session 与检索统计仍保存在进程内，多实例部署前需要迁移到 Redis 或数据库。' },
  { title: '鉴权与跨域', detail: '应用 API 尚无内置用户鉴权，开发配置允许任意 CORS 来源，公网部署前需要补齐。' },
  { title: 'Agent 工具范围', detail: '当前只有只读的 multimodal_knowledge_search，尚无写工具、审批、MCP 或执行沙箱。' },
  { title: '飞书检索路径', detail: '三态 Agent 模式由 Web Chat API 与 mma-rag ask 提供；飞书聊天当前走 Direct。' },
]

const groups = Object.entries(
  techStackItems.reduce<Record<string, typeof techStackItems>>((acc, item) => {
    ;(acc[item.category] ||= []).push(item)
    return acc
  }, {})
)

export function TechStackSection() {
  return (
    <section id="tech-stack" className="atlas-stack-section scroll-mt-24">
      <div className="atlas-section-intro">
        <div>
          <p className="atlas-section-kicker">Runtime / 运行时组件</p>
          <h2>组件各就其位，能力边界清晰</h2>
        </div>
        <p>当前实现中的请求主路径、存储、模型与可选服务。组件已接入，并不意味着每次在线问答都依赖它。</p>
      </div>

      <div className="atlas-stack-groups">
        {groups.map(([category, items]) => {
          const meta = categoryMeta[category as keyof typeof categoryMeta]
          const Icon = meta.icon
          return (
            <section key={category} className="atlas-stack-group">
              <h3><Icon size={17} aria-hidden="true" />{meta.label}</h3>
              <dl>
                {items.map((item) => (
                  <div key={item.id}><dt>{item.name}</dt>{item.description ? <dd>{item.description}</dd> : null}</div>
                ))}
              </dl>
            </section>
          )
        })}
      </div>

      <aside className="atlas-boundaries" aria-labelledby="atlas-boundaries-title">
        <div className="atlas-boundaries-intro">
          <h3 id="atlas-boundaries-title"><Info size={17} aria-hidden="true" />当前实现边界</h3>
          <p>部署前需了解的限制，基于当前实现。</p>
        </div>
        <dl>
          {knownBoundaries.map((item) => <div key={item.title}><dt>{item.title}</dt><dd>{item.detail}</dd></div>)}
        </dl>
      </aside>
    </section>
  )
}
