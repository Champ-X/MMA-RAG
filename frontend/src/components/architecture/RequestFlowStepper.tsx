import { useId, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
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

  const selectMode = (nextMode: string) => {
    if (nextMode !== 'direct' && nextMode !== 'agent') return
    setMode(nextMode)
    setActiveId(nextMode === 'direct' ? 'direct-retrieval' : 'agent-evidence-loop')
  }

  return (
    <section id="request-flow" className="scroll-mt-24">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-end lg:gap-12">
        <div className="max-w-2xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[#2f7f93] dark:text-[#7fc2cf]">Request journey</p>
          <h2 className="architecture-display mt-3 text-2xl font-semibold leading-tight tracking-[-0.025em] text-[#102d42] [text-wrap:balance] dark:text-[#edf6f3] sm:text-3xl">
            一次取证，或按需深研
          </h2>
        </div>
        <p className="max-w-2xl text-sm leading-7 text-[#5a7075] dark:text-[#a7bcbd]">
          Direct 一次完成检索，Agent 在预算内补查。两条路径始终复用会话上下文、范围约束、引用映射与最终交付。
        </p>
      </div>

      <Tabs.Root
        value={mode}
        onValueChange={selectMode}
        className="architecture-request-flow mt-8 overflow-hidden rounded-2xl border border-[#b9ccc6] bg-white/45 dark:border-[#2b4d58] dark:bg-[#0b222c]"
      >
        <div className="flex flex-col gap-4 border-b border-[#c5d5cf] p-4 dark:border-[#294a56] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-sm font-semibold text-[#17384a] dark:text-[#e5efec]">选择取证策略</p>
            <p className="mt-1 text-xs leading-5 text-[#61777a] dark:text-[#9ab1b2]">点击阶段，查看具体职责与代码入口</p>
          </div>
          <Tabs.List aria-label="执行路径" className="grid w-full grid-cols-2 gap-1 rounded-xl bg-[#edf2ed] p-1 dark:bg-[#071a24] sm:w-auto">
            <ModeButton mode="direct" icon={<Search className="h-4 w-4" />}>
              Direct <span className="hidden sm:inline">· 直接检索</span>
            </ModeButton>
            <ModeButton mode="agent" icon={<Bot className="h-4 w-4" />}>
              Agent <span className="hidden sm:inline">· 深度取证</span>
            </ModeButton>
          </Tabs.List>
        </div>

        {(['direct', 'agent'] as const).map((path) => (
          <Tabs.Content
            key={path}
            value={path}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f7f93]"
          >
            <RequestPath mode={path} activeId={activeId} onSelect={setActiveId} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </section>
  )
}

function RequestPath({ mode, activeId, onSelect }: { mode: ExecutionMode; activeId: string; onSelect: (id: string) => void }) {
  const panelId = useId()
  const headingId = useId()
  const branchId = mode === 'direct' ? 'direct-retrieval' : 'agent-evidence-loop'
  const visibleSteps = requestFlowSteps.filter((step) =>
    ['request-context', 'mode-routing', branchId, 'context-citation', 'generation-delivery'].includes(step.id)
  )
  const activeStep = visibleSteps.find((step) => step.id === activeId) ?? visibleSteps[2]

  return (
    <div className="architecture-request-path grid lg:grid-cols-[19rem_minmax(0,1fr)]">
      <div className="relative border-b border-[#c5d5cf] bg-[#edf2ed]/50 p-3 dark:border-[#294a56] dark:bg-white/[0.018] sm:p-5 lg:border-b-0 lg:border-r">
        <div className="absolute bottom-11 left-[2.1rem] top-11 w-px bg-[#bdcfca] dark:bg-[#31525e] sm:left-[2.6rem]" aria-hidden="true" />
        <ol className="relative space-y-1" aria-label={`${mode === 'direct' ? 'Direct' : 'Agent'} 请求处理阶段`} role="list">
          {visibleSteps.map((step) => (
            <li key={step.id}>
              <FlowNode step={step} active={step.id === activeStep.id} mode={mode} onSelect={onSelect} panelId={panelId} />
            </li>
          ))}
        </ol>
      </div>

      <div id={panelId} aria-labelledby={headingId} role="region" className="architecture-request-detail min-w-0 p-5 sm:p-7 lg:p-8">
        <div className="flex items-center gap-2 text-xs font-medium text-[#61777a] dark:text-[#9ab1b2]">
          <span className={cn('h-2 w-2 rounded-full', activeStep.lane === 'agent' ? 'bg-[#765c95]' : activeStep.lane === 'direct' ? 'bg-[#2f7f93]' : 'bg-[#5f8e72]')} aria-hidden="true" />
          <span className="font-mono">{activeStep.marker}</span>
          <span aria-hidden="true">/</span>
          {activeStep.lane === 'shared' ? '共享阶段' : activeStep.lane === 'direct' ? 'Direct 取证' : 'Agent 取证'}
        </div>
        <h3 id={headingId} className="mt-4 text-2xl font-semibold tracking-[-0.025em] text-[#102d42] dark:text-[#edf6f3]">
          {activeStep.title}
        </h3>
        <p className="mt-4 max-w-3xl text-sm leading-8 text-[#526b72] dark:text-[#abc0c1]">{activeStep.description}</p>

        {activeStep.keyTechnologies?.length ? (
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-3" aria-label="涉及的关键能力" role="list">
            {activeStep.keyTechnologies.map((technology) => (
              <li key={technology} className="flex items-center gap-2 text-xs font-medium leading-5 text-[#435f65] dark:text-[#b5c7c7]">
                <Check className="h-3.5 w-3.5 shrink-0 text-[#5f8e72] dark:text-[#8fc09f]" aria-hidden="true" />
                {technology}
              </li>
            ))}
          </ul>
        ) : null}

        {activeStep.backendEntry ? (
          <div className="mt-7 border-t border-[#c5d5cf] pt-5 dark:border-[#294a56]">
            <h4 className="text-xs font-semibold text-[#526b70] dark:text-[#a9bfc0]">代码入口</h4>
            <p className="mt-2 break-words font-mono text-xs leading-6 text-[#526b70] dark:text-[#b2c5c5]">{activeStep.backendEntry}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ModeButton({ mode, icon, children }: { mode: ExecutionMode; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Tabs.Trigger
      value={mode}
      className={cn(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-[#61777a] transition-colors hover:text-[#17384a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f7f93] data-[state=active]:text-white dark:text-[#90aaac] dark:hover:text-white',
        mode === 'agent'
          ? 'data-[state=active]:bg-[#765c95]'
          : 'data-[state=active]:bg-[#102d42] dark:data-[state=active]:bg-[#dcebe7] dark:data-[state=active]:text-[#102d42]'
      )}
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </Tabs.Trigger>
  )
}

function FlowNode({ step, active, mode, onSelect, panelId }: {
  step: RequestFlowStep
  active: boolean
  mode: ExecutionMode
  onSelect: (id: string) => void
  panelId: string
}) {
  const Icon = stepIcons[step.id as keyof typeof stepIcons] ?? Braces
  const isAgentBranch = mode === 'agent' && step.lane === 'agent'

  return (
    <button
      type="button"
      onClick={() => onSelect(step.id)}
      aria-pressed={active}
      aria-controls={panelId}
      className={cn(
        'group relative flex min-h-[4.5rem] w-full items-center gap-3 rounded-xl py-2 pl-2 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f7f93]',
        active
          ? isAgentBranch
            ? 'bg-[#eee9f2] dark:bg-[#765c95]/15'
            : 'bg-[#e2efed] dark:bg-[#2f7f93]/15'
          : 'hover:bg-white/60 dark:hover:bg-white/[0.04]'
      )}
    >
      <span className={cn(
        'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] border-[#edf2ed] transition-colors dark:border-[#0b222c]',
        active ? isAgentBranch ? 'bg-[#765c95] text-white' : 'bg-[#2f7f93] text-white' : 'bg-[#cad8d3] text-[#526d72] dark:bg-[#294a56] dark:text-[#a8bdbd]'
      )}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="font-mono text-xs leading-5 text-[#61777a] dark:text-[#9ab1b2]">{step.marker}</span>
        <span className="mt-0.5 block text-sm font-medium leading-6 text-[#18394a] dark:text-[#e2eeea]">{step.title}</span>
      </span>
    </button>
  )
}
