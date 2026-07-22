import { ArrowRight, Check, FileUp, FolderKanban, MessageSquare, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { readBrowserStorageItem, writeBrowserStorageItem } from '@/lib/browserStorage'
import { getOnboardingProgress, type OnboardingStepId } from './onboarding'

const dismissalKey = 'nexus-first-answer-guide-dismissed-v1'

const steps: Array<{
  id: OnboardingStepId
  title: string
  term: string
  body: string
  icon: typeof FolderKanban
}> = [
  {
    id: 'space',
    title: 'Create a focused Space',
    term: 'Space · 知识空间',
    body: 'A purpose-led boundary that decides which knowledge a question may use.',
    icon: FolderKanban,
  },
  {
    id: 'source',
    title: 'Add original materials',
    term: 'Source · 原始材料',
    body: 'Upload a file or connect a live source. Nexus keeps the original before parsing it.',
    icon: FileUp,
  },
  {
    id: 'run',
    title: 'Ask and inspect citations',
    term: 'Run · 可恢复任务',
    body: 'Your scope and citations are frozen for the turn, so the result stays reproducible.',
    icon: MessageSquare,
  },
]

type GettingStartedProps = {
  spaceCount: number
  sourceCount: number
  citedRunCount: number
  firstSpaceId?: string
  forced: boolean
}

export function GettingStarted({ spaceCount, sourceCount, citedRunCount, firstSpaceId, forced }: GettingStartedProps) {
  const navigate = useNavigate()
  const progress = getOnboardingProgress(spaceCount, sourceCount, citedRunCount)
  const dismissed = readBrowserStorageItem('local', dismissalKey) === '1'
  if (!forced && (dismissed || progress.complete)) return null

  const targetByStep: Record<OnboardingStepId, string> = {
    space: '/spaces',
    source: firstSpaceId ? `/spaces/${firstSpaceId}/sources` : '/spaces',
    run: firstSpaceId ? `/research/new?space=${firstSpaceId}` : '/research/new',
  }
  const current = steps.find((step) => step.id === progress.currentStep)
  const dismiss = () => {
    writeBrowserStorageItem('local', dismissalKey, '1')
    navigate('/', { replace: true })
  }

  return <section className={`getting-started${progress.complete ? ' is-complete' : ''}`} aria-labelledby="getting-started-title">
    <header>
      <div><p className="eyebrow">First cited answer · 首次有引用回答</p><h2 id="getting-started-title">{progress.complete ? 'You have completed the evidence workflow.' : 'Start with three product concepts, not the architecture.'}</h2><p>{progress.complete ? 'Your knowledge, task and result are now recoverable. Reopen this guide or the concept guide at any time.' : 'Nexus reveals advanced controls only after the core path is clear. You can skip this guide and reopen it from the sidebar.'}</p></div>
      <div className="guide-progress"><strong>{progress.completedCount}/3</strong><span><i style={{ width: `${progress.completedCount / 3 * 100}%` }} /></span><small>{progress.complete ? 'workflow complete' : 'steps ready'}</small></div>
      <button type="button" className="icon-button" aria-label="Dismiss getting started guide" onClick={dismiss}><X /></button>
    </header>
    <div className="getting-started-steps">{steps.map((step, index) => {
      const Icon = step.icon
      const complete = index < progress.completedCount
      const currentStep = step.id === progress.currentStep
      return <article key={step.id} className={`${complete ? 'complete' : ''}${currentStep ? ' current' : ''}`}>
        <div className="guide-step-head"><span>{complete ? <Check /> : String(index + 1).padStart(2, '0')}</span><em>{complete ? 'Done' : currentStep ? 'Next' : 'Later'}</em></div>
        <Icon className="guide-step-icon" />
        <h3>{step.title}</h3>
        <dfn>{step.term}</dfn>
        <p>{step.body}</p>
        {(complete || currentStep || progress.complete) ? <Link to={targetByStep[step.id]}>{complete || progress.complete ? 'Review' : 'Do this now'}<ArrowRight /></Link> : <span className="guide-locked">Available after the prior step</span>}
      </article>
    })}</div>
    {!progress.complete && current && <footer><span><strong>Next:</strong> {current.title}</span><Link className="button primary" to={targetByStep[current.id]}>{current.id === 'space' ? 'Create first Space' : current.id === 'source' ? 'Add materials' : 'Ask first question'}<ArrowRight /></Link></footer>}
  </section>
}
