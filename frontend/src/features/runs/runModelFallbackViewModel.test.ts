import { describe, expect, it } from 'vitest'
import { buildRunModelFallbackViewModel } from './runModelFallbackViewModel'

describe('buildRunModelFallbackViewModel', () => {
  it('explains active model route fallback without exposing raw metadata first', () => {
    expect(buildRunModelFallbackViewModel({
      model: {
        actual_model: 'extractive-local-v1',
        metadata: {
          degradation_reason: 'active_model_route_failed',
          failed_route_id: '019f7a79-997e-7f8e-be36-14ac7249c959',
          failures: [
            {
              deployment_id: '019f7a45-8362-79b3-9a27-8186ecad566c',
              error_type: 'ReadTimeout',
              route_id: '019f7a79-997e-7f8e-be36-14ac7249c959',
            },
          ],
        },
      },
    })).toMatchObject({
      detail: 'The active model route did not complete, so Nexus used a deterministic evidence summary instead of dropping the turn. Failed route: 019f7a79.',
      failures: ['ReadTimeout · route 019f7a79 · deployment 019f7a45'],
      label: 'Model route fallback used',
      modelLabel: 'extractive-local-v1',
      role: 'status',
      tone: 'fallback',
      visible: true,
    })
  })

  it('explains selected model fallback separately from active routes', () => {
    expect(buildRunModelFallbackViewModel({
      model: {
        actual_model: 'extractive-local-v1',
        metadata: {
          degradation_reason: 'question_override_model_failed',
          failed_route_id: 'question_override',
          failures: [
            {
              deployment_id: '019f7a45-8362-79b3-9a27-8186ecad566c',
              error_type: 'ReadTimeout',
            },
          ],
        },
      },
    })).toMatchObject({
      detail: 'The selected answer model did not complete, so Nexus used a deterministic evidence summary instead of dropping the turn.',
      failures: ['ReadTimeout · deployment 019f7a45'],
      label: 'Selected model fallback used',
      modelLabel: 'extractive-local-v1',
      role: 'status',
      tone: 'fallback',
      visible: true,
    })
  })

  it('explains pinned setup gateway fallback separately from active routes', () => {
    expect(buildRunModelFallbackViewModel({
      model: {
        actual_model: 'extractive-local-v1',
        metadata: {
          degradation_reason: 'pinned_setup_gateway_failed',
          failures: [
            {
              deployment_id: 'pinned_setup_gateway',
              error_type: 'ReadTimeout',
            },
          ],
        },
      },
    })).toMatchObject({
      detail: 'The configured setup gateway did not complete, so Nexus used a deterministic evidence summary instead of dropping the turn.',
      failures: ['ReadTimeout · deployment pinned setup gateway'],
      label: 'Configured gateway fallback used',
      modelLabel: 'extractive-local-v1',
      role: 'status',
      tone: 'fallback',
      visible: true,
    })
  })

  it('keeps legacy capability unavailable runs actionable', () => {
    expect(buildRunModelFallbackViewModel({
      error: {
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'Every deployment in the active Model Route failed',
        details: {
          route_id: '019f7a79-997e-7f8e-be36-14ac7249c959',
          failures: [
            {
              deployment_id: '019f7a45-8362-79b3-9a27-8186ecad566c',
              error_type: 'ReadTimeout',
            },
          ],
        },
      },
      partial: true,
    })).toMatchObject({
      failures: ['ReadTimeout · deployment 019f7a45'],
      label: 'Capability unavailable',
      modelLabel: 'No answer model completed',
      role: 'alert',
      tone: 'blocked',
      visible: true,
    })
  })

  it('defers structured recovery packets to the recovery notice', () => {
    expect(buildRunModelFallbackViewModel({
      error: {
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'Synthesis provider disabled',
      },
      partial: true,
      recovery: {
        checkpoint_available: true,
        evidence_count: 1,
        phase: 'retrieved',
      },
    })).toMatchObject({
      visible: false,
    })
  })

  it('stays hidden for normal completed results', () => {
    expect(buildRunModelFallbackViewModel({
      model: { actual_model: 'Pro/model', metadata: { protocol: 'openai_compatible' } },
    })).toMatchObject({
      visible: false,
    })
  })

  it('keeps missing capability names in fallback failure summaries', () => {
    expect(buildRunModelFallbackViewModel({
      model: {
        actual_model: 'extractive-local-v1',
        metadata: {
          degradation_reason: 'active_model_route_failed',
          failed_route_id: '019f7a79-997e-7f8e-be36-14ac7249c959',
          failures: [
            {
              deployment_id: '019f7a45-8362-79b3-9a27-8186ecad566c',
              error_type: 'CapabilityMismatch',
              missing: ['tool_calling', 'json_schema'],
              route_id: '019f7a79-997e-7f8e-be36-14ac7249c959',
            },
          ],
        },
      },
    }).failures).toEqual([
      'CapabilityMismatch · route 019f7a79 · deployment 019f7a45 · missing tool_calling, json_schema',
    ])
  })
})
