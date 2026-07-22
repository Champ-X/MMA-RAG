import { describe, expect, it } from 'vitest'
import { buildQueryUnderstandingFallbackViewModel } from './queryUnderstandingViewModel'

describe('buildQueryUnderstandingFallbackViewModel', () => {
  it('summarizes deterministic task fallback without exposing raw payload first', () => {
    expect(buildQueryUnderstandingFallbackViewModel({
      intent_degradation: 'active_task_model_route_failed',
      intent_model: 'deterministic-task-local-v1',
      rewrite_degradation: 'pinned_setup_task_gateway_failed',
      rewrite_model: 'deterministic-task-local-v1',
      understanding_mode: 'model_degraded_with_deterministic_guardrails',
    })).toEqual({
      detail: 'Intent/rewrite used deterministic guardrails after the active task route failed, the configured setup task gateway failed. Retrieval stayed recoverable, but wording may be more literal.',
      label: 'Query guardrail fallback',
      modelLabel: 'deterministic-task-local-v1',
      visible: true,
    })
  })

  it('formats unknown degradation reasons without leaking enum punctuation', () => {
    expect(buildQueryUnderstandingFallbackViewModel({
      intent_degradation: 'custom_task_timeout',
      intent_model: 'deterministic-task-local-v1',
    }).detail).toContain('custom task timeout')
  })

  it('stays hidden for normal model understanding', () => {
    expect(buildQueryUnderstandingFallbackViewModel({
      intent_model: 'task/query_intent',
      rewrite_model: 'task/query_rewrite',
      understanding_mode: 'model_with_deterministic_guardrails',
    })).toMatchObject({ visible: false })
  })
})
