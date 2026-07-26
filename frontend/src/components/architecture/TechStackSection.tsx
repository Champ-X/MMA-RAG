import { Box, Boxes, Braces, CloudCog, Database, MonitorSmartphone, ShieldAlert } from 'lucide-react'
import { techStackItems } from '@/data/architectureData'

const categoryMeta: Record<(typeof techStackItems)[number]['category'], { label: string; icon: typeof Box }> = {
  backend: { label: 'Backend', icon: Braces },
  frontend: { label: 'Frontend', icon: MonitorSmartphone },
  storage: { label: 'Storage', icon: Database },
  model: { label: 'Models', icon: Boxes },
  infra: { label: 'Infrastructure', icon: CloudCog },
  integration: { label: 'Optional integration', icon: Box },
}

const knownBoundaries = [
  {
    title: '状态仍需外置',
    detail: 'Chat session 与检索统计仍保存在进程内，多实例部署前需要迁移到 Redis 或数据库。',
  },
  {
    title: '公网暴露前需要鉴权',
    detail: '应用 API 当前没有内置用户鉴权，开发配置允许任意 CORS 来源。',
  },
  {
    title: 'Agent 工具保持只读',
    detail: '当前只有 multimodal_knowledge_search，尚无写工具、审批、MCP 或执行沙箱。',
  },
  {
    title: '飞书保持 Direct',
    detail: '三态 Agent 模式由 Web Chat API 与 mma-rag ask 提供；飞书聊天当前走直接检索。',
  },
]

export function TechStackSection() {
  const groups = Object.entries(
    techStackItems.reduce<Record<string, typeof techStackItems>>((acc, item) => {
      ;(acc[item.category] ||= []).push(item)
      return acc
    }, {})
  )

  return (
    <section id="tech-stack" className="scroll-mt-24">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(28rem,1.22fr)] lg:items-end lg:gap-14">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f7f93] dark:text-[#7fc2cf]">Runtime boundary</p>
          <h2 className="architecture-display mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-[#102d42] [text-wrap:balance] dark:text-[#edf6f3] sm:text-[2.55rem]">
            <span className="sm:hidden">运行时组件，<br />服务于证据边界，<br />而不是反过来</span>
            <span className="hidden sm:inline">运行时组件服务于证据边界，而不是反过来</span>
          </h2>
        </div>
        <p className="max-w-2xl text-sm leading-7 text-[#5a7075] dark:text-[#a7bcbd] sm:text-[15px] lg:justify-self-end">
          下列组件是当前实现快照：哪些服务位于请求主路径、哪些只是可选控制面、哪些能力尚未开放，都会明确标出，避免把“已接入”误读为“在线问答强依赖”。
        </p>
      </div>

      <div className="mt-9 grid gap-5 xl:grid-cols-[minmax(0,1.28fr)_minmax(22rem,0.72fr)]">
        <div className="grid overflow-hidden rounded-[28px] border border-[#b9ccc6] bg-[#edf2ed] dark:border-[#2b4d58] dark:bg-[#0b222c] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2">
          {groups.map(([category, items], index) => {
            const meta = categoryMeta[category as keyof typeof categoryMeta]
            const Icon = meta.icon
            return (
              <section
                key={category}
                className={`min-h-[12rem] p-5 sm:p-6 ${index > 0 ? 'border-t border-[#c8d7d1] dark:border-[#294a56] sm:border-t-0' : ''} ${index % 2 === 1 ? 'sm:border-l' : ''} ${index >= 2 ? 'sm:border-t' : ''} ${index % 3 !== 0 ? 'lg:border-l' : 'lg:border-l-0'} ${index >= 3 ? 'lg:border-t' : ''} ${index % 2 === 1 ? 'xl:border-l' : 'xl:border-l-0'} ${index >= 2 ? 'xl:border-t' : 'xl:border-t-0'} border-[#c8d7d1] dark:border-[#294a56]`}
              >
                <div className="flex items-center gap-2 text-[#2f7f93] dark:text-[#7fc2cf]">
                  <Icon className="h-4 w-4" />
                  <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">{meta.label}</h3>
                </div>
                <dl className="mt-5 space-y-4">
                  {items.map((item) => (
                    <div key={item.id}>
                      <dt className="text-[13px] font-semibold text-[#17384a] dark:text-[#e4efeb]">{item.name}</dt>
                      {item.description ? (
                        <dd className="mt-1.5 text-xs leading-5 text-[#6a7f82] dark:text-[#99b0b2]">{item.description}</dd>
                      ) : null}
                    </div>
                  ))}
                </dl>
              </section>
            )
          })}
        </div>

        <aside className="overflow-hidden rounded-[28px] border border-[#d9aa8d] bg-[#f3dfd1] dark:border-[#744a36] dark:bg-[#2a1b18]">
          <div className="border-b border-[#dfb499] p-5 dark:border-[#5f3e30] sm:p-6">
            <div className="flex items-center gap-2 text-[#c45f36] dark:text-[#eea47f]">
              <ShieldAlert className="h-4 w-4" />
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">Before production</p>
            </div>
            <h3 className="architecture-display mt-3 text-2xl font-semibold text-[#5a3021] dark:text-[#f5ded1]">部署前必须知道</h3>
            <p className="mt-2 text-xs leading-6 text-[#89614f] dark:text-[#c29e8c]">这些是当前实现边界，不是未来路线图。</p>
          </div>
          <ol>
            {knownBoundaries.map((item, index) => (
              <li key={item.title} className={index > 0 ? 'border-t border-[#dfb499] p-5 dark:border-[#5f3e30]' : 'p-5'}>
                <div className="flex gap-3">
                  <span className="font-mono text-[10px] font-semibold text-[#c45f36] dark:text-[#eea47f]">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h4 className="text-[13px] font-semibold text-[#5a3021] dark:text-[#f5ded1]">{item.title}</h4>
                    <p className="mt-1.5 text-xs leading-6 text-[#89614f] dark:text-[#c29e8c]">{item.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  )
}
