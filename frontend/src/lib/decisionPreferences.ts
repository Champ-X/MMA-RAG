import type { DecisionConfig, DecisionSettingsResponse } from '@/types/decision'

type Models = DecisionSettingsResponse['models']

export function supportsSourceCheck(selection: Pick<DecisionConfig, 'provider' | 'model'>, models: Models) {
  const capabilities = models.find(item => item.provider === selection.provider && item.id === selection.model)?.source_actions
  return capabilities?.require.execution === 'verify' || capabilities?.forbid.execution === 'verify'
}

/** The regular settings page only enables features with a user-facing purpose. */
export function decisionPreferencesPayload(config: DecisionConfig, models: Models): DecisionConfig {
  return {
    ...config,
    intent_mode: config.intent_mode !== 'off' && supportsSourceCheck(config, models) ? 'adaptive' : 'off',
    rerank_mode: 'off',
    citation_strategy: config.citation_mode === 'shadow' ? 'batch_choice' : config.citation_strategy,
  }
}

/** Reading an old config never writes it; its active behavior must remain visible. */
export function hasLegacyDecisionOptions(config: DecisionConfig, models: Models) {
  return config.rerank_mode !== 'off' || config.intent_mode === 'force'
    || (config.intent_mode === 'adaptive' && !supportsSourceCheck(config, models))
}
