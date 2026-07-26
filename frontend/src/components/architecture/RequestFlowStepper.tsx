import { useState } from 'react'
import { Bot, Braces, Check, GitFork, Search, Send, Split } from 'lucide-react'
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

  const branchId = mode === 'direct' ? 'direct-retrieval' : 'agent-evidence-loop'
  const visibleSteps = requestFlowSteps.filter((step) =>
    ['request-context', 'mode-routing', branchId, 'context-citation', 'generation-delivery'].includes(step.id)
  )

  const activeStep = requestFlowSteps.find((step) => step.id === activeId) ?? visibleSteps[2]

  const selectMode = (nextMode: ExecutionMode) => {
    setMode(nextMode)
    setActiveId(nextMode === 'direct' ? 'direct-retrieval' : 'agent-evidence-loop')
  }

  return (
    <section id="request-flow" className="scroll-mt-24">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(28rem,1.15fr)] lg:items-end lg:gap-14">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f7f93] dark:text-[#7fc2cf]">Request journey</p>
          <h2 className="architecture-display mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-[#102d42] [text-wrap:balance] dark:text-[#edf6f3] sm:text-[2.55rem]">
            一处分流，两种推理深度
          </h2>
        </div>
        <div className="lg:justify-self-end">
          <p className="max-w-xl text-sm leading-7 text-[#5a7075] dark:text-[#a7bcbd] sm:text-[15px]">
            切换路径，观察只有第三阶段发生变化。上下文恢复、引用映射与答案交付始终复用同一份合同。
          </p>
        </div>
      </div>

      <div className="mt-9 overflow-hidden rounded-[28px] border border-[#b9ccc6] bg-[#edf2ed] shadow-[0_34px_90px_-64px_rgba(16,45,66,0.72)] dark:border-[#2b4d58] dark:bg-[#0b222c]">
        <div className="flex flex-col gap-4 border-b border-[#c5d5cf] p-4 dark:border-[#294a56] sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#718587] dark:text-[#89a5a7]">Choose execution policy</p>
            <p className="mt-1 text-[13px] font-semibold text-[#17384a] dark:text-[#e5efec]">同一个问题入口，不同的取证预算</p>
          </div>
          <div
            role="tablist"
            aria-label="执行路径"
            className="grid w-full grid-cols-2 rounded-full border border-[#bfd0ca] bg-[#e4ebe6] p-1 dark:border-[#31525e] dark:bg-[#071a24] sm:w-auto"
          >
            <ModeButton mode="direct" current={mode} onSelect={selectMode} icon={<Search className="h-3.5 w-3.5" />}>
              Direct <span className="hidden sm:inline">· 快速回答</span>
            </ModeButton>
            <ModeButton mode="agent" current={mode} onSelect={selectMode} icon={<Bot className="h-3.5 w-3.5" />}>
              Agent <span className="hidden sm:inline">· 深度取证</span>
            </ModeButton>
          </div>
        </div>

        <div className="grid lg:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="relative border-b border-[#c5d5cf] p-4 dark:border-[#294a56] sm:p-6 lg:border-b-0 lg:border-r">
            <div className="absolute bottom-10 left-[2.42rem] top-10 w-px bg-[#bdcfca] dark:bg-[#31525e] sm:left-[3.42rem]" aria-hidden />
            <ol className="relative space-y-2" aria-label={`${mode === 'direct' ? 'Direct' : 'Agent'} 请求处理阶段`}>
              {visibleSteps.map((step) => (
                <li key={step.id}>
                  <FlowNode
                    step={step}
                    active={step.id === activeStep.id}
                    mode={mode}
                    onSelect={setActiveId}
                  />
                </li>
              ))}
            </ol>
          </div>

          <div
            id="request-flow-panel"
            role="tabpanel"
            key={activeStep.id}
            className="animate-in fade-in relative min-h-[32rem] overflow-hidden bg-white/35 p-5 dark:bg-white/[0.018] sm:p-8 lg:p-10"
          >
            <div className="architecture-orbit !-right-20 !-top-20" aria-hidden />
            <div className="relative flex h-full flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn(
                  'rounded-full border px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]',
                  activeStep.lane === 'agent'
                    ? 'border-[#c7b7d3] bg-[#eee8f2] text-[#765c95] dark:border-[#5d4971] dark:bg-[#765c95]/10 dark:text-[#c6b1d9]'
                    : activeStep.lane === 'direct'
                      ? 'border-[#9ec2cc] bg-[#e5f0f2] text-[#2f7f93] dark:border-[#345d67] dark:bg-[#2f7f93]/10 dark:text-[#84c5cf]'
                      : 'border-[#b7cbbb] bg-[#e8f0e8] text-[#5f8e72] dark:border-[#3d624d] dark:bg-[#5f8e72]/10 dark:text-[#91c3a1]'
                )}>
                  {activeStep.marker} · {activeStep.lane}
                </span>
              </div>

              <h3 className="architecture-display mt-6 text-3xl font-semibold tracking-[-0.035em] text-[#102d42] dark:text-[#edf6f3] sm:text-4xl">
                {activeStep.title}
              </h3>
              <p className="mt-5 max-w-3xl text-sm leading-8 text-[#526b72] dark:text-[#abc0c1]">{activeStep.description}</p>

              {activeStep.keyTechnologies?.length ? (
                <div className="mt-8">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#738789] dark:text-[#8ba5a7]">What happens here</p>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {activeStep.keyTechnologies.map((technology) => (
                      <li key={technology} className="flex items-center gap-2 rounded-xl border border-[#c9d7d2] bg-white/55 px-3.5 py-3 text-xs font-medium text-[#435f65] dark:border-[#2b4c57] dark:bg-white/[0.035] dark:text-[#b5c7c7]">
                        <Check className="h-3.5 w-3.5 shrink-0 text-[#5f8e72] dark:text-[#8fc09f]" />
                        {technology}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {activeStep.backendEntry ? (
                <div className="mt-auto pt-9">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#738789] dark:text-[#8ba5a7]">Implementation entry</p>
                  <div className="mt-3 overflow-x-auto rounded-2xl bg-[#102d42] px-4 py-4 font-mono text-[11px] leading-6 text-[#cce0dc] shadow-[inset_0_1px_rgba(255,255,255,0.08)]">
                    {activeStep.backendEntry}
                  </div>
                </div>
              ) : null}
            </div>
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
      aria-controls="request-flow-panel"
      onClick={() => onSelect(mode)}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93]/70',
        selected
          ? mode === 'agent'
            ? 'bg-[#765c95] text-white shadow-sm'
            : 'bg-[#102d42] text-white shadow-sm dark:bg-[#dcebe7] dark:text-[#102d42]'
          : 'text-[#61777a] hover:text-[#17384a] dark:text-[#90aaac] dark:hover:text-white'
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
  const branchColor = mode === 'agent' && step.lane === 'agent'

  return (
    <button
      type="button"
      onClick={() => onSelect(step.id)}
      aria-pressed={active}
      className={cn(
        'group relative flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border border-transparent py-2 pl-2 pr-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93]/70',
        active
          ? branchColor
            ? 'border-[#c8b9d4] bg-[#eee9f2] shadow-sm dark:border-[#5d4971] dark:bg-[#765c95]/12'
            : 'border-[#9fc0c3] bg-[#e2efed] shadow-sm dark:border-[#35606a] dark:bg-[#2f7f93]/12'
          : 'hover:border-[#c7d5d0] hover:bg-white/45 dark:hover:border-[#2c4d58] dark:hover:bg-white/[0.03]'
      )}
    >
      <span
        className={cn(
          'relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-4 border-[#edf2ed] transition-colors dark:border-[#0b222c]',
          active
            ? branchColor
              ? 'bg-[#765c95] text-white'
              : 'bg-[#2f7f93] text-white'
            : 'bg-[#cad8d3] text-[#526d72] group-hover:bg-[#b8cbc5] dark:bg-[#294a56] dark:text-[#a8bdbd]'
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#7b8e90] dark:text-[#839ea0]">{step.marker} · {step.short}</span>
        <span className="mt-1.5 block text-[13px] font-semibold leading-5 text-[#18394a] dark:text-[#e2eeea]">{step.title}</span>
      </span>
    </button>
  )
}
