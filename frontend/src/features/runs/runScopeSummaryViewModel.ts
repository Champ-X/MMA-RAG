import type { Run } from '@/api/nexus'

export type RunScopeSummaryViewModel = {
  modelDetail: string
  modelLabel: string
}

export function buildRunScopeSummaryViewModel(run: Pick<Run, 'selected_model_deployment_id'>): RunScopeSummaryViewModel {
  if (run.selected_model_deployment_id) {
    return {
      modelDetail: 'Explicit verified answer deployment',
      modelLabel: 'Selected answer model',
    }
  }
  return {
    modelDetail: 'Uses the active answer model route, with local evidence fallback if generation is unavailable',
    modelLabel: 'Active answer route',
  }
}
