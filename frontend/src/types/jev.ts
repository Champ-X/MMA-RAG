export interface JevConfig {
  intent_mode: 'off' | 'adaptive' | 'force'
  rerank_mode: 'off' | 'shadow' | 'replace' | 'force'
  citation_mode: 'off' | 'shadow'
  citation_strategy: 'per_unit' | 'batch_choice'
}

export interface JevSettingsResponse {
  config: JevConfig
  api_key_configured: boolean
  model: string
}
