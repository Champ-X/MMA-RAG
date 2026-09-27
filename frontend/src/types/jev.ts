export interface JevConfig {
  intent_mode: 'off' | 'adaptive'
  rerank_mode: 'off' | 'shadow' | 'replace'
  citation_mode: 'off' | 'shadow'
  citation_strategy: 'per_unit' | 'batch_choice'
}

export interface JevSettingsResponse {
  config: JevConfig
  api_key_configured: boolean
  model: string
}
