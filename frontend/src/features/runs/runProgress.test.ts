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

    expect(progress.headline).toBe('Evidence retrieved')
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

    expect(progress.headline).toBe('Partial result preserved')
    expect(progress.stages.find((stage) => stage.id === 'deliver')).toMatchObject({ state: 'attention' })
    expect(progress.stages.find((stage) => stage.id === 'deliver')?.detail).toContain('evidence, events and checkpoint trail')
  })

  it('distinguishes capability recovery partials from evidence insufficiency', () => {
    const capabilityProgress = buildRunProgress(
      [event('query.understood')],
      'quick',
      'partial',
      true,
      'capability_unavailable',
    )
    const evidenceProgress = buildRunProgress(
      [event('query.understood'), event('retrieval.completed')],
      'quick',
      'partial',
      true,
      'evidence_insufficient',
    )

    expect(capabilityProgress.headline).toBe('Capability recovery required')
    expect(evidenceProgress.headline).toBe('Evidence was insufficient')
    expect(capabilityProgress.stages.find((stage) => stage.id === 'deliver')?.detail).toBe(
      'A required capability stopped the run; recovery guidance and any completed checkpoints were preserved.',
    )
    expect(evidenceProgress.stages.find((stage) => stage.id === 'deliver')?.detail).toBe(
      'A partial result was preserved because the frozen scope did not contain enough supporting evidence.',
    )
  })
})
