import { ShieldAlert } from 'lucide-react'
import { techStackItems } from '@/data/architectureData'

const categoryLabels: Record<(typeof techStackItems)[number]['category'], string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  storage: 'Storage',
  model: 'Models',
  infra: 'Infrastructure',
  integration: 'Optional integrations',
}

const knownBoundaries = [
  'Chat session 与检索统计仍保存在进程内，多实例部署前需要迁移到 Redis 或数据库。',
  '应用 API 当前没有内置用户鉴权，开发配置允许任意 CORS 来源，不能直接暴露到公网。',
  'Agent 自动工具当前只有只读 multimodal_knowledge_search，尚无写工具、审批、MCP 或沙箱。',
  '飞书聊天当前走直接检索路径，三态 Agent 模式由 Web Chat API 与 mma-rag ask 提供。',
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
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950 [text-wrap:balance] dark:text-white sm:text-3xl">
          技术选型与当前边界
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
          这里记录运行中的基础设施和明确限制，避免把可选集成或未来规划误写成已完成能力。
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_24px_70px_-60px_rgba(15,23,42,0.5)] dark:border-slate-800 dark:bg-slate-950">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(([category, items], index) => (
            <section
              key={category}
              className={`p-5 sm:p-6 ${
                index > 0 ? 'border-t border-slate-200/80 dark:border-slate-800 sm:border-t-0' : ''
              } ${index % 2 === 1 ? 'sm:border-l' : ''} ${index >= 2 ? 'sm:border-t lg:border-t-0' : ''} ${
                index % 3 !== 0 ? 'lg:border-l' : 'lg:border-l-0'
              } border-slate-200/80 dark:border-slate-800`}
            >
              <h3 className="font-mono text-[10px] font-semibold tracking-[0.12em] text-teal-700 dark:text-teal-300">
                {categoryLabels[category as keyof typeof categoryLabels]}
              </h3>
              <dl className="mt-4 space-y-4">
                {items.map((item) => (
                  <div key={item.id}>
                    <dt className="text-xs font-semibold text-slate-900 dark:text-slate-100">{item.name}</dt>
                    {item.description ? (
                      <dd className="mt-1 text-[10px] leading-5 text-slate-500 dark:text-slate-400">{item.description}</dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>

      <aside className="mt-5 rounded-2xl border border-orange-200/90 bg-orange-50/60 p-5 dark:border-orange-900/70 dark:bg-orange-950/15 sm:p-6">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-orange-700 dark:text-orange-300" />
          <h3 className="text-sm font-semibold text-slate-950 dark:text-white">部署前必须知道</h3>
        </div>
        <ul className="mt-4 grid gap-x-8 gap-y-3 text-xs leading-6 text-slate-600 dark:text-slate-300 sm:grid-cols-2">
          {knownBoundaries.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </aside>
    </section>
  )
}
