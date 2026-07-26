import { useMemo, useState } from 'react'
import { ArrowRight, Bot, Braces, GitFork, Search, Send, Split } from 'lucide-react'
import { cn } from '@/lib/utils'
import { requestFlowSteps, type RequestFlowStep } from '@/data/architectureData'

type ExecutionMode = 'direct' | 'agent'

const stepIcons = {
  'request-context': Braces,
  'mode-routing': Split,
  'direct-retrieval': Search,
  'agent-evidence-loop': Bot,
  'context-citation': GitFork,
  'generation-delivery': Send,
} as const

export function RequestFlowStepper() {
  const [mode, setMode] = useState<ExecutionMode>('direct')
  const [activeId, setActiveId] = useState('direct-retrieval')

  const visibleSteps = useMemo(() => {
    const branchId = mode === 'direct' ? 'direct-retrieval' : 'agent-evidence-loop'
    return requestFlowSteps.filter((step) =>
      ['request-context', 'mode-routing', branchId, 'context-citation', 'generation-delivery'].includes(step.id)
    )
  }, [mode])

  const activeStep = requestFlowSteps.find((step) => step.id === activeId) ?? visibleSteps[2]

  const selectMode = (nextMode: ExecutionMode) => {
    setMode(nextMode)
    setActiveId(nextMode === 'direct' ? 'direct-retrieval' : 'agent-evidence-loop')
  }

  return (
    <section id="request-flow" className="scroll-mt-24">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950 [text-wrap:balance] dark:text-white sm:text-3xl">
            一处分流，两条取证路径
          </h2>
          <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
            切换执行模式，观察共享阶段和分支阶段如何重新组合。点击任一节点可查看实现入口。
          </p>
        </div>

        <div
          role="tablist"
          aria-label="执行路径"
          className="inline-flex w-fit rounded-xl bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/80 dark:bg-slate-900 dark:ring-slate-800"
        >
          <ModeButton mode="direct" current={mode} onSelect={selectMode} icon={<Search className="h-3.5 w-3.5" />}>
            Direct
          </ModeButton>
          <ModeButton mode="agent" current={mode} onSelect={selectMode} icon={<Bot className="h-3.5 w-3.5" />}>
            Agent
          </ModeButton>
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_24px_70px_-60px_rgba(15,23,42,0.55)] dark:border-slate-800 dark:bg-slate-950">
        <div className="p-4 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-stretch">
            {visibleSteps.map((step, index) => (
              <div key={step.id} className="contents">
                <FlowNode
                  step={step}
                  active={step.id === activeStep.id}
                  mode={mode}
                  onSelect={setActiveId}
                />
                {index < visibleSteps.length - 1 ? (
                  <div className="flex h-8 items-center justify-center text-slate-300 dark:text-slate-700 lg:h-auto lg:w-9 lg:shrink-0">
                    <ArrowRight className="h-4 w-4 rotate-90 lg:rotate-0" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div
          key={activeStep.id}
          className="animate-in fade-in border-t border-slate-200/80 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-900/40 sm:p-6"
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-950 dark:text-white">{activeStep.title}</h3>
                <span className="font-mono text-[9px] font-semibold text-teal-700 dark:text-teal-300">
                  {activeStep.lane}
                </span>
              </div>
              <p className="mt-3 text-xs leading-6 text-slate-600 dark:text-slate-300">{activeStep.description}</p>
            </div>

            <dl className="space-y-4">
              {activeStep.keyTechnologies?.length ? (
                <div>
                  <dt className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">关键技术</dt>
                  <dd className="mt-1.5 text-xs leading-6 text-slate-700 dark:text-slate-300">
                    {activeStep.keyTechnologies.join(' / ')}
                  </dd>
                </div>
              ) : null}
              {activeStep.backendEntry ? (
                <div>
                  <dt className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">后端入口</dt>
                  <dd className="mt-1.5 overflow-x-auto font-mono text-[10px] leading-5 text-slate-700 dark:text-slate-300">
                    {activeStep.backendEntry}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </div>
    </section>
  )
}

function ModeButton({
  mode,
  current,
  onSelect,
  icon,
  children,
}: {
  mode: ExecutionMode
  current: ExecutionMode
  onSelect: (mode: ExecutionMode) => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const selected = mode === current
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(mode)}
      className={cn(
        'inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70',
        selected
          ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-white'
          : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function FlowNode({
  step,
  active,
  mode,
  onSelect,
}: {
  step: RequestFlowStep
  active: boolean
  mode: ExecutionMode
  onSelect: (id: string) => void
}) {
  const Icon = stepIcons[step.id as keyof typeof stepIcons] ?? Braces
  const isBranch = step.lane === 'direct' || step.lane === 'agent'

  return (
    <button
      type="button"
      onClick={() => onSelect(step.id)}
      aria-pressed={active}
      className={cn(
        'group flex min-h-[86px] min-w-0 flex-1 items-center gap-3 rounded-xl border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70',
        active
          ? 'border-teal-300 bg-teal-50/75 shadow-sm dark:border-teal-800 dark:bg-teal-950/30'
          : 'border-slate-200/90 bg-white hover:border-teal-200 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-teal-900 dark:hover:bg-slate-900/70',
        isBranch && mode === 'agent' && 'border-violet-200 dark:border-violet-900'
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          active
            ? 'bg-white text-teal-700 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-900 dark:text-teal-300 dark:ring-slate-700'
            : 'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400'
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold leading-5 text-slate-900 dark:text-slate-100">{step.title}</span>
        <span className="mt-0.5 block truncate font-mono text-[9px] text-slate-400 dark:text-slate-500">{step.short}</span>
      </span>
    </button>
  )
}
