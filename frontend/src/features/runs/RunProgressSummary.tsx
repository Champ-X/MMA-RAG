import { AlertTriangle, Check, CircleDashed, Loader2, ShieldCheck } from 'lucide-react'
import type { DurableRunEvent, Run } from '@/api/nexus'
import { buildRunProgress, type ProgressState } from './runProgress'

const statusCopy: Record<string, string> = {
  completed: 'Answer delivered and evidence preserved',
  partial: 'Partial result preserved for review',
  failed: 'Run stopped before delivery',
  cancelled: 'Run cancelled; completed work preserved',
  paused: 'Paused safely at a checkpoint',
}

function StageIcon({ state }: { state: ProgressState }) {
  if (state === 'complete') return <Check />
  if (state === 'active') return <Loader2 className="spin" />
  if (state === 'attention') return <AlertTriangle />
  return <CircleDashed />
}

export function RunProgressSummary({ run, events }: { run: Run; events: DurableRunEvent[] }) {
  const progress = buildRunProgress(events, run.kind, run.status, Boolean(run.result))
  const current = progress.stages.find((stage) => stage.state === 'active' || stage.state === 'attention')
  const headline = statusCopy[run.status] ?? current?.label ?? 'Recovering progress'
  return (
    <section className="run-progress-summary" aria-label="Run progress">
      <header><p className="eyebrow"><ShieldCheck />Evidence process</p><strong>{headline}</strong><small>{current?.detail ?? 'Every completed stage is durable and safe to revisit.'}</small></header>
      <ol>
        {progress.stages.map((stage) => <li className={stage.state} key={stage.id}><span><StageIcon state={stage.state} /></span><p><strong>{stage.label}</strong><small>{stage.detail}</small></p></li>)}
      </ol>
      {progress.totalChannels > 0 && <p className={`retrieval-health${progress.degraded ? ' degraded' : ''}`}><span>{progress.completedChannels}/{progress.totalChannels} retrieval channels completed</span>{progress.degraded && <strong>Reduced capability</strong>}</p>}
      {progress.degraded && <div className="run-degradation"><AlertTriangle /><span><strong>Search used a fallback</strong><small>{progress.degradationReasons.join(' · ') || 'One or more retrieval channels were unavailable.'}</small></span></div>}
    </section>
  )
}
