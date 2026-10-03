import { useId, useState, type ReactNode } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Bot, Braces, Check, ChevronDown, ChevronLeft, ChevronRight, Code2, GitFork, Search, Send, Split } from 'lucide-react'
import { cn } from '@/lib/utils'
import { requestFlowSteps, type RequestFlowStep } from '@/data/architectureData'
import './architectureExplorers.css'

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
    <section id="request-flow" className="atlas-request-section">
      <div className="atlas-section-intro atlas-request-intro">
        <div><p className="atlas-eyebrow">REQUEST JOURNEY / 问答链路</p><h2>一次取证，或按需深研</h2></div>
        <p>Direct 进行单次检索编排，Agent 围绕证据按需补查。取证方式不同，上下文、范围约束与最终交付保持一致。</p>
      </div>

      <Tabs.Root value={mode} onValueChange={selectMode} className="architecture-request-flow atlas-request-flow" data-mode={mode}>
        <div className="atlas-flow-toolbar">
          <div><p>从问题，到带来源的回答</p><span>选择取证方式，再沿着阶段逐步阅读。</span></div>
          <Tabs.List aria-label="执行路径" className="atlas-flow-modes">
            <ModeButton mode="direct" icon={<Search size={16} />}>直接检索 <span>Direct</span></ModeButton>
            <ModeButton mode="agent" icon={<Bot size={16} />}>按需深研 <span>Agent</span></ModeButton>
          </Tabs.List>
        </div>

        {(['direct', 'agent'] as const).map((path) => (
          <Tabs.Content key={path} value={path} className="atlas-flow-panel">
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
  const activeIndex = visibleSteps.findIndex((step) => step.id === activeStep.id)
  const previousStep = visibleSteps[activeIndex - 1]
  const nextStep = visibleSteps[activeIndex + 1]
  const ActiveIcon = stepIcons[activeStep.id as keyof typeof stepIcons] ?? Braces

  return (
    <div className="architecture-request-path atlas-request-path">
      <div className="atlas-flow-rail">
        <div className="atlas-flow-rail-caption"><span>{mode === 'direct' ? '直接检索路径' : 'Agent 深研路径'}</span><span>{visibleSteps.length} 个阶段</span></div>
        <ol className="atlas-flow-steps" aria-label={`${mode === 'direct' ? 'Direct' : 'Agent'} 请求处理阶段`} role="list">
          {visibleSteps.map((step) => (
            <li key={step.id}><FlowNode step={step} active={step.id === activeStep.id} onSelect={onSelect} panelId={panelId} /></li>
          ))}
        </ol>
        <p className="atlas-flow-rail-note"><span aria-hidden="true" />共用上下文、范围与交付</p>
      </div>

      <div id={panelId} aria-labelledby={headingId} role="region" className="architecture-request-detail atlas-request-detail" data-lane={activeStep.lane}>
        <div className="atlas-flow-detail-progress" role="progressbar" aria-label="当前阅读阶段" aria-valuemin={1} aria-valuemax={visibleSteps.length} aria-valuenow={activeIndex + 1}>{visibleSteps.map((step, index) => <span key={step.id} data-status={index === activeIndex ? 'active' : index < activeIndex ? 'complete' : 'upcoming'} />)}</div>
        <div className="atlas-flow-detail-meta"><span aria-hidden="true" /><span>阶段 {String(activeIndex + 1).padStart(2, '0')}</span><i aria-hidden="true" />{activeStep.lane === 'shared' ? '共享阶段' : activeStep.lane === 'direct' ? 'Direct 取证' : 'Agent 取证'}</div>
        <div className="atlas-flow-detail-heading"><span><ActiveIcon size={23} aria-hidden="true" /></span><h3 id={headingId}>{activeStep.title}</h3></div>
        <p className="atlas-flow-description">{activeStep.description}</p>

        {activeStep.keyTechnologies?.length ? (
          <div className="atlas-flow-capabilities"><h4>这一阶段用到的能力</h4><ul className="atlas-flow-technologies" aria-label="涉及的关键能力">
            {activeStep.keyTechnologies.map((technology) => (
              <li key={technology}><Check size={14} aria-hidden="true" />{technology}</li>
            ))}
          </ul></div>
        ) : null}

        {activeStep.backendEntry ? (
          <details key={activeStep.id} className="atlas-flow-code"><summary><Code2 size={17} aria-hidden="true" /><span>查看实现入口</span><ChevronDown size={16} aria-hidden="true" /></summary><p><code>{activeStep.backendEntry}</code></p></details>
        ) : null}
        <div className="atlas-flow-detail-footer"><span>阶段 {String(activeIndex + 1).padStart(2, '0')} / {String(visibleSteps.length).padStart(2, '0')}</span><div><button type="button" disabled={!previousStep} onClick={() => previousStep && onSelect(previousStep.id)} aria-label="查看上一阶段"><ChevronLeft size={16} aria-hidden="true" />上一阶段</button><button type="button" disabled={!nextStep} onClick={() => nextStep && onSelect(nextStep.id)} aria-label="查看下一阶段">下一阶段<ChevronRight size={16} aria-hidden="true" /></button></div></div>
      </div>
    </div>
  )
}

function ModeButton({ mode, icon, children }: { mode: ExecutionMode; icon: ReactNode; children: ReactNode }) {
  return <Tabs.Trigger value={mode} className="atlas-flow-mode" data-mode={mode}><span aria-hidden="true">{icon}</span>{children}</Tabs.Trigger>
}

function FlowNode({ step, active, onSelect, panelId }: {
  step: RequestFlowStep
  active: boolean
  onSelect: (id: string) => void
  panelId: string
}) {
  const Icon = stepIcons[step.id as keyof typeof stepIcons] ?? Braces
  return (
    <button type="button" onClick={() => onSelect(step.id)} aria-pressed={active} aria-controls={panelId}
      className={cn('atlas-flow-step-button', active && 'is-active')} data-lane={step.lane}>
      <span className="atlas-flow-node"><Icon size={15} aria-hidden="true" /></span>
      <span className="atlas-flow-step-copy"><span className="atlas-flow-marker">{step.marker}</span><span className="atlas-flow-step-title">{step.title}</span></span>
      <ChevronRight size={14} className="atlas-flow-step-arrow" aria-hidden="true" />
    </button>
  )
}
