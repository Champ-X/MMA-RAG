export type ModelRouteCapability = 'chat' | 'embedding' | 'reranker' | 'vision' | 'audio' | 'video'

export interface ModelRouteSelection {
  provider: string
  model: string
  capability: ModelRouteCapability
}

export interface ModelRouteTestResponse extends ModelRouteSelection {
  success: boolean
  duration_ms: number
  error_code?: string
  message: string
  details?: string
}

export interface ModelRouteTestState {
  status: 'queued' | 'running' | 'done'
  result?: ModelRouteTestResponse
}

export interface ModelRouteTestSnapshot {
  routes: Readonly<Record<string, ModelRouteTestState>>
  lastResult: ModelRouteTestResponse | null
  batch: null | {
    total: number
    completed: number
    succeeded: number
    failed: number
    cancelled: number
    running: number
    queued: number
    stopped: boolean
  }
}
