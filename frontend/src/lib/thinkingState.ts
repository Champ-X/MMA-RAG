import type { ThinkingState } from '@/store/useChatStore'
import type { ThoughtPhase } from '@/types/sse'
import { mergeStageTimings } from '@/lib/stageTiming'

/** Reduce lifecycle events independently of how much partial result data is present. */
export function advanceThinking(
  previous: ThinkingState,
  phase: ThoughtPhase,
  payload: Record<string, unknown>,
): Partial<ThinkingState> {
  if (!['intent', 'routing', 'retrieval', 'generation', 'attachment'].includes(phase)) return {}
  const thoughtData = { ...previous.thoughtData, ...payload,
    stage_timings: mergeStageTimings(previous.thoughtData?.stage_timings, payload.stage_timings, phase, payload.stage_timing),
  }
  const stages = { ...previous.stages }
  const agent = thoughtData.agent_mode === true || thoughtData.intent_type === 'agentic'
    || thoughtData.agent_mode_selected === 'agent'
  const explicitStatus = payload.stage_status ?? payload.status
  let currentStage: string = phase
  const order = ['intent', 'routing', 'retrieval', 'generation'] as const
  const earlierCompletedUpdate = !agent && explicitStatus === 'completed'
    && phase !== 'attachment'
    && order.indexOf(previous.currentStage as typeof order[number]) > order.indexOf(phase)

  if (earlierCompletedUpdate) {
    // Routing can enrich the already-completed intent; don't rewind the UI.
    currentStage = previous.currentStage
  } else if (phase === 'generation') {
    thoughtData.generation_status = String(payload.status ?? 'generating')
    thoughtData.generation_message = String(payload.message ?? '')
    stages.generation = explicitStatus === 'completed' ? 'completed'
      : explicitStatus === 'failed' ? 'failed' : 'processing'
    stages.retrieval = 'completed'
    if (!agent) stages.intent = stages.routing = 'completed'
  } else if (agent) {
    currentStage = 'agent'
    stages.intent = stages.routing = stages.generation = 'idle'
    // A finished search round is followed by planning; it is not the end of the run.
    stages.retrieval = payload.agent_status === 'completed' ? 'completed' : 'processing'
  } else if (phase === 'attachment') {
    currentStage = explicitStatus === 'completed' ? 'intent' : 'attachment'
    stages.intent = 'processing'
  } else {
    const completed = explicitStatus === 'completed' || (
      !explicitStatus && !(phase === 'intent' && !payload.intent_type)
    )
    const index = order.indexOf(phase)
    for (const [i, stage] of order.entries()) {
      stages[stage] = i < index ? 'completed' : i === index
        ? explicitStatus === 'failed' ? 'failed' : completed ? 'completed' : 'processing'
        : 'idle'
    }
    if (completed) {
      const next = order[index + 1]
      currentStage = next
      stages[next] = 'processing'
      if (next === 'generation') {
        thoughtData.generation_status = 'preparing'
        thoughtData.generation_message = '正在准备生成回答…'
      }
    }
  }
  if (thoughtData.stage_timings) {
    for (const stage of ['intent', 'routing', 'retrieval', 'generation'] as const) {
      const timing = thoughtData.stage_timings[stage]
      if (timing && ['processing', 'completed', 'failed'].includes(timing.status)) {
        stages[stage] = timing.status as 'processing' | 'completed' | 'failed'
      } else if (phase === 'generation' && !agent && !timing) {
        // Greeting / no-index fast paths do not execute routing and retrieval.
        stages[stage] = 'idle'
      }
    }
  }
  return { currentStage, stages, thoughtData, currentMessage: String(payload.message ?? '') }
}
