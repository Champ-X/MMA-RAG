export type DecisionProvider = 'typesafe' | 'openrouter'

export interface DecisionConfig {
  provider: DecisionProvider
  model: string
  intent_mode: 'off' | 'adaptive' | 'force'
  rerank_mode: 'off' | 'shadow' | 'replace' | 'force'
  citation_mode: 'off' | 'shadow'
  citation_strategy: 'per_unit' | 'batch_choice'
}

export interface DecisionSettingsResponse {
  config: DecisionConfig
  api_key_configured: boolean
  model: string
  providers: Array<{ id: DecisionProvider; name: string; api_key_configured: boolean }>
  models: Array<{ id: string; name: string; provider: DecisionProvider }>
}

export interface DecisionTestResponse {
  success: boolean
  requested_model: string
  model: string
  provider: DecisionProvider
  duration_s: number
  error?: string
}
