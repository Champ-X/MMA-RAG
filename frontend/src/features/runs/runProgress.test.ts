import { describe, expect, it } from 'vitest'
import type { DurableRunEvent } from '@/api/nexus'
import { buildRunProgress } from './runProgress'

const event = (event_type: string, public_payload: Record<string, unknown> = {}): DurableRunEvent => ({
  event_id: `event-${event_type}`,
  stream_id: 'run-1',
  sequence: 1,
  event_type,
  occurred_at: '2026-07-20T08:00:00Z',
  producer: 'worker',
  trace_id: 'trace-1',
  schema_version: 1,
  public_payload,
  artifact_refs: [],
  supersedes: null,
})

describe('run progress', () => {
  it('keeps quick runs compact and marks the first pending stage active', () => {
    const progress = buildRunProgress([event('query.understood')], 'quick', 'running', false)

    expect(progress.stages.map((stage) => stage.id)).toEqual(['scope', 'understand', 'retrieve', 'verify', 'deliver'])
    expect(progress.stages.find((stage) => stage.id === 'retrieve')?.state).toBe('active')
  })

  it('summarizes retrieval channel health and degradation', () => {
    const progress = buildRunProgress([
      event('query.understood'),
      event('retrieval.completed', {
        degraded: true,
        degradation_reasons: ['reranker unavailable'],
        channels: [{ status: 'completed' }, { status: 'failed' }],
      }),
    ], 'quick', 'running', false)

    expect(progress).toMatchObject({ retrievalPasses: 1, completedChannels: 1, totalChannels: 2, degraded: true })
    expect(progress.degradationReasons).toEqual(['reranker unavailable'])
  })

  it('explains that a partial result was preserved', () => {
    const progress = buildRunProgress([event('query.understood'), event('retrieval.completed')], 'research', 'partial', true)

    expect(progress.stages.find((stage) => stage.id === 'deliver')).toMatchObject({ state: 'attention' })
    expect(progress.stages.find((stage) => stage.id === 'deliver')?.detail).toContain('partial result')
  })
})
