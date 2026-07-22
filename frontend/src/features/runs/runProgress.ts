import type { DurableRunEvent } from '@/api/nexus'

export type ProgressState = 'complete' | 'active' | 'waiting' | 'attention'

export type RunProgressStage = {
  id: string
  label: string
  detail: string
  state: ProgressState
}

export type RunProgress = {
  completedChannels: number
  degraded: boolean
  degradationReasons: string[]
  headline: string
  retrievalPasses: number
  stages: RunProgressStage[]
  totalChannels: number
}

const terminal = new Set(['completed', 'failed', 'partial', 'cancelled'])

function progressHeadline(status: string, stopReason: string | null | undefined, current?: RunProgressStage): string {
  if (status === 'completed') return 'Answer delivered and evidence preserved'
  if (status === 'failed') return 'Run stopped before delivery'
  if (status === 'cancelled') return 'Run cancelled; completed work preserved'
  if (status === 'paused') return 'Paused safely at a checkpoint'
  if (status === 'partial') {
    if (stopReason === 'capability_unavailable') return 'Capability recovery required'
    if (stopReason === 'evidence_insufficient') return 'Evidence was insufficient'
    return 'Partial result preserved'
  }
  return current?.label ?? 'Recovering progress'
}

export function buildRunProgress(
  events: DurableRunEvent[],
  kind: string,
  status: string,
  hasResult: boolean,
  stopReason?: string | null,
): RunProgress {
  const understood = events.some((event) => event.event_type === 'query.understood')
  const planned = events.some((event) => event.event_type === 'research.plan.created')
  const retrievalEvents = events.filter((event) => event.event_type === 'retrieval.completed')
  const lastRetrieval = retrievalEvents[retrievalEvents.length - 1]
  const channels = Array.isArray(lastRetrieval?.public_payload.channels)
    ? lastRetrieval.public_payload.channels as Array<{ status?: unknown }>
    : []
  const degraded = retrievalEvents.some((event) => event.public_payload.degraded === true)
  const degradationReasons = Array.from(new Set(retrievalEvents.flatMap((event) => (
    Array.isArray(event.public_payload.degradation_reasons)
      ? event.public_payload.degradation_reasons.map(String)
      : []
  ))))
  const milestones = [
    { id: 'scope', label: 'Scope secured', detail: 'Spaces, sources and model choice are frozen for this turn.', done: true },
    { id: 'understand', label: 'Question understood', detail: 'Intent and retrieval wording are prepared.', done: understood },
    ...(kind === 'research' ? [{ id: 'plan', label: 'Research planned', detail: 'The question is divided into bounded evidence passes.', done: planned }] : []),
    { id: 'retrieve', label: 'Evidence retrieved', detail: retrievalEvents.length ? `${retrievalEvents.length} evidence pass${retrievalEvents.length === 1 ? '' : 'es'} recorded.` : 'Searching the frozen evidence scope.', done: retrievalEvents.length > 0 },
    { id: 'verify', label: 'Claims checked', detail: hasResult ? 'The result includes an explicit verification outcome.' : 'Checking whether the evidence supports a reliable answer.', done: hasResult },
    { id: 'deliver', label: 'Result delivered', detail: status === 'completed' ? 'The answer and citation ledger are durable.' : 'Preparing a durable answer or partial result.', done: status === 'completed' },
  ]
  const firstPending = milestones.findIndex((milestone) => !milestone.done)
  const stages = milestones.map((milestone, index): RunProgressStage => {
    if (milestone.done) return { ...milestone, state: 'complete' }
    if (terminal.has(status) || status === 'paused') {
      return { ...milestone, state: index === firstPending ? 'attention' : 'waiting' }
    }
    return { ...milestone, state: index === firstPending ? 'active' : 'waiting' }
  })
  if (status === 'partial') {
    const delivery = stages.find((stage) => stage.id === 'deliver')
    if (delivery) {
      delivery.state = 'attention'
      if (stopReason === 'capability_unavailable') {
        delivery.detail = 'A required capability stopped the run; recovery guidance and any completed checkpoints were preserved.'
      } else if (stopReason === 'evidence_insufficient') {
        delivery.detail = 'A partial result was preserved because the frozen scope did not contain enough supporting evidence.'
      } else {
        delivery.detail = 'A partial result was preserved with its evidence, events and checkpoint trail.'
      }
    }
  } else if (status === 'failed') {
    const pending = stages[firstPending]
    if (pending) pending.detail = 'Execution stopped here. Open details for the recorded failure.'
  } else if (status === 'cancelled') {
    const pending = stages[firstPending]
    if (pending) pending.detail = 'The run was cancelled; completed work remains preserved.'
  } else if (status === 'paused') {
    const pending = stages[firstPending]
    if (pending) pending.detail = 'Paused safely. Resume to continue from the last checkpoint.'
  }
  const current = stages.find((stage) => stage.state === 'active' || stage.state === 'attention')

  return {
    completedChannels: channels.filter((channel) => channel.status === 'completed').length,
    degraded,
    degradationReasons,
    headline: progressHeadline(status, stopReason, current),
    retrievalPasses: retrievalEvents.length,
    stages,
    totalChannels: channels.length,
  }
}
