import { describe, expect, it } from 'vitest'
import { buildSystemModelGatewayViewModel } from './systemModelGatewayViewModel'

describe('buildSystemModelGatewayViewModel', () => {
  it('summarizes verified active routes', () => {
    expect(buildSystemModelGatewayViewModel({
      status: 'ready',
      detail: {
        active_route_count: 14,
        state: 'capability_routes_verified',
      },
    })).toEqual({
      activeRouteCountLabel: '14 active routes',
      detail: 'Active model routes are verified for their declared capabilities.',
      failureLabels: [],
      label: 'Model routes verified',
      stateLabel: 'capability routes verified',
      tone: 'ready',
    })
  })

  it('surfaces local fallback with provider failure detail', () => {
    expect(buildSystemModelGatewayViewModel({
      status: 'degraded',
      detail: {
        active_route_count: 0,
        failures: [
          { deployment_id: 'pinned_setup_gateway', error_type: 'ReadTimeout' },
        ],
        fallback_model: 'extractive-local-v1',
        route: 'pinned_setup_gateway',
      },
    })).toEqual({
      activeRouteCountLabel: '0 active routes',
      detail: 'A deterministic evidence summary is available when the configured model path fails. Inspect failures before treating this as full model coverage.',
      failureLabels: ['ReadTimeout · deployment pinned setup gateway'],
      fallbackLabel: 'extractive-local-v1',
      label: 'Model fallback active',
      stateLabel: 'pinned setup gateway',
      tone: 'warning',
    })
  })

  it('distinguishes deterministic task fallback from answer generation fallback', () => {
    expect(buildSystemModelGatewayViewModel({
      status: 'degraded',
      detail: {
        active_route_count: 2,
        failures: [
          {
            deployment_id: '019f7a45-8362-79b3-9a27-8186ecad566c',
            error_type: 'ReadTimeout',
            route_id: '019f7a79-997e-7f8e-be36-14ac7249c959',
          },
        ],
        fallback_model: 'deterministic-task-local-v1',
        role: 'query_rewrite',
        state: 'task_fallback',
      },
    })).toEqual({
      activeRouteCountLabel: '2 active routes',
      detail: 'A deterministic JSON task fallback handled query rewrite task when the configured model path failed. Answer generation coverage is unchanged.',
      failureLabels: ['ReadTimeout · route 019f7a79 · deployment 019f7a45'],
      fallbackLabel: 'deterministic-task-local-v1',
      label: 'Task fallback active',
      stateLabel: 'task fallback',
      tone: 'warning',
    })
  })

  it('formats unknown task roles without raw underscore punctuation', () => {
    expect(buildSystemModelGatewayViewModel({
      status: 'degraded',
      detail: {
        fallback_model: 'deterministic-task-local-v1',
        role: 'custom_task_role',
      },
    }).detail).toBe(
      'A deterministic JSON task fallback handled custom task role when the configured model path failed. Answer generation coverage is unchanged.',
    )
  })

  it('summarizes route drift without inventing fallback coverage', () => {
    expect(buildSystemModelGatewayViewModel({
      status: 'degraded',
      detail: {
        active_route_count: 3,
        failures: [
          {
            deployment_id: '019f7a45-8362-79b3-9a27-8186ecad566c',
            error_type: 'RouteDrift',
            route_id: '019f7a79-997e-7f8e-be36-14ac7249c959',
          },
        ],
        state: 'route_drift',
      },
    })).toMatchObject({
      activeRouteCountLabel: '3 active routes',
      failureLabels: ['RouteDrift · route 019f7a79 · deployment 019f7a45'],
      label: 'Model route needs attention',
      stateLabel: 'route drift',
      tone: 'warning',
    })
  })

  it('keeps missing capability names in the summarized failure', () => {
    expect(buildSystemModelGatewayViewModel({
      status: 'degraded',
      detail: {
        active_route_count: 2,
        failures: [
          {
            deployment_id: '019f7a45-8362-79b3-9a27-8186ecad566c',
            error_type: 'CapabilityMismatch',
            missing: ['tool_calling', 'json_schema'],
            route_id: '019f7a79-997e-7f8e-be36-14ac7249c959',
          },
        ],
        state: 'route_drift',
      },
    }).failureLabels).toEqual([
      'CapabilityMismatch · route 019f7a79 · deployment 019f7a45 · missing tool_calling, json_schema',
    ])
  })
})
