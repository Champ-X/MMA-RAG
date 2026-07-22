import { describe, expect, it } from 'vitest'
import { buildRunScopeSummaryViewModel } from './runScopeSummaryViewModel'

describe('buildRunScopeSummaryViewModel', () => {
  it('labels explicit selected deployments as answer models', () => {
    expect(buildRunScopeSummaryViewModel({
      selected_model_deployment_id: 'model-1',
    })).toEqual({
      modelDetail: 'Explicit verified answer deployment',
      modelLabel: 'Selected answer model',
    })
  })

  it('labels default routing as an answer route rather than a task route', () => {
    expect(buildRunScopeSummaryViewModel({
      selected_model_deployment_id: null,
    })).toEqual({
      modelDetail: 'Uses the active answer model route, with local evidence fallback if generation is unavailable',
      modelLabel: 'Active answer route',
    })
  })
})
