import { Check, GitFork, LockKeyhole, Search } from 'lucide-react'
import { overviewStats, overviewTags } from '@/data/architectureData'

const invariants = [
  'KB / File 范围在所有子查询中原样透传',
  'Agent 只调用只读多模态检索工具',
  '两条路径输出同一种 RetrievalResult',
  '轮数、查询数与证据池都有硬预算',
]

export function OverviewSection() {
  return (
    <section id="overview" className="scroll-mt-24">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:items-start">
        <div>
          <h2 className="max-w-3xl text-2xl font-semibold tracking-[-0.035em] text-slate-950 [text-wrap:balance] dark:text-white sm:text-3xl">
            Agent 增加取证深度，证据边界保持不变
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
            文档、图片、音频与视频进入各自适合的解析和向量空间，在线统一由 RetrievalService 汇合。Direct 调用一次，Agent 规划互补子查询并在预算内反复取证。
          </p>

          <div className="mt-8 grid overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-slate-800 dark:bg-slate-950 md:grid-cols-2">
            <PathSummary
              icon={<Search className="h-4 w-4" />}
              title="Direct"
              subtitle="一次检索，低额外开销"
              description="One-Pass 意图、画像路由、混合召回、RRF 与精排一次完成。"
            />
            <PathSummary
              icon={<GitFork className="h-4 w-4" />}
              title="Agent"
              subtitle="多轮取证，有界收敛"
              description="Planner 生成子查询，Evidence Ledger 去重并决定补查或停止。"
              bordered
            />
          </div>

          <div className="mt-6 text-xs leading-6 text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200">共享能力：</span>{' '}
            {overviewTags.join(' / ')}
          </div>
        </div>

        <aside className="rounded-2xl border border-teal-200/80 bg-teal-50/65 p-5 dark:border-teal-900/70 dark:bg-teal-950/20 sm:p-6">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-teal-700 dark:text-teal-300" />
            <h3 className="text-sm font-semibold text-slate-950 dark:text-white">不可破坏的系统约束</h3>
          </div>
          <ul className="mt-5 space-y-4">
            {invariants.map((item) => (
              <li key={item} className="flex gap-3 text-xs leading-6 text-slate-600 dark:text-slate-300">
                <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white text-teal-700 shadow-sm ring-1 ring-teal-200/80 dark:bg-slate-900 dark:text-teal-300 dark:ring-teal-900">
                  <Check className="h-3 w-3" />
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <dl className="mt-10 grid grid-cols-2 gap-5 border-y border-slate-200/80 py-5 dark:border-slate-800 sm:grid-cols-4">
        <Metric label="核心模块" value={overviewStats.modules} />
        <Metric label="执行路径" value={overviewStats.executionModes} />
        <Metric label="证据模态" value={overviewStats.modalities} />
        <Metric label="运行时服务" value={overviewStats.runtimeServices} />
      </dl>
    </section>
  )
}

function PathSummary({
  icon,
  title,
  subtitle,
  description,
  bordered = false,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  description: string
  bordered?: boolean
}) {
  return (
    <div className={bordered ? 'border-t border-slate-200/80 p-5 dark:border-slate-800 md:border-l md:border-t-0' : 'p-5'}>
      <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300">
        {icon}
        <span className="font-mono text-[10px] font-semibold tracking-[0.12em]">{title}</span>
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-950 dark:text-white">{subtitle}</h3>
      <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-950 dark:text-slate-100">{value}</dd>
    </div>
  )
}
