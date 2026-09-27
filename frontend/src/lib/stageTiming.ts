import type { StageTiming, StageTimings, ThoughtPhase } from '@/types/sse'

const phases: ThoughtPhase[] = ['intent', 'routing', 'retrieval', 'generation', 'attachment']

function isTiming(value: unknown): value is StageTiming {
  if (!value || typeof value !== 'object') return false
  const timing = value as StageTiming
  return Number.isFinite(timing.started_at) && Number.isFinite(timing.duration_ms)
    && timing.duration_ms >= 0
    && ['processing', 'completed', 'failed', 'cancelled', 'skipped'].includes(timing.status)
}

/** Partial thought events must not erase durations from earlier stages. */
export function mergeStageTimings(
  previous: StageTimings | undefined,
  incoming: unknown,
  phase?: ThoughtPhase,
  single?: unknown,
  receivedAt = performance.now(),
): StageTimings | undefined {
  const next = { ...previous }
  const snapshot = incoming && typeof incoming === 'object' ? incoming as StageTimings : {}
  for (const key of phases) {
    const value = key === phase && isTiming(single) ? single : snapshot[key]
    if (!isTiming(value)) continue
    next[key] = { ...value, _received_at: receivedAt }
  }
  return Object.keys(next).length ? next : undefined
}

export function stageElapsedMs(timing: StageTiming, live: boolean, now = performance.now()): number {
  // Never restart a clock when loading a historical or interrupted conversation.
  const delta = live && timing.status === 'processing' && timing._received_at != null
    ? Math.max(0, now - timing._received_at) : 0
  return timing.duration_ms + delta
}

export function freezeStageTimings(
  timings: StageTimings | undefined,
  status: 'failed' | 'cancelled',
  now = performance.now(),
): StageTimings | undefined {
  if (!timings) return undefined
  return Object.fromEntries(Object.entries(timings).map(([key, timing]) => [key,
    timing.status === 'processing'
      ? { ...timing, duration_ms: stageElapsedMs(timing, true, now), status, _received_at: undefined, _local_snapshot: true }
      : timing,
  ]))
}

export function formatStageDuration(milliseconds: number): string {
  if (milliseconds < 100) return `${Math.round(milliseconds)}ms`
  return `${(milliseconds / 1000).toFixed(1)}s`
}
