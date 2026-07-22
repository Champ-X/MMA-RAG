export type QueryUnderstandingFallbackViewModel = {
  detail: string
  label: string
  modelLabel: string
  visible: boolean
}

const hiddenFallback: QueryUnderstandingFallbackViewModel = {
  detail: '',
  label: '',
  modelLabel: '',
  visible: false,
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function reasonLabel(value: string) {
  if (value === 'active_task_model_route_failed') return 'the active task route failed'
  if (value === 'pinned_setup_task_gateway_failed') return 'the configured setup task gateway failed'
  if (value === 'task_override_model_failed') return 'the selected task model failed'
  if (value === 'deterministic_task_fallback') return 'the task model path was unavailable'
  return value.replaceAll('_', ' ')
}

export function buildQueryUnderstandingFallbackViewModel(understanding: unknown): QueryUnderstandingFallbackViewModel {
  const value = recordValue(understanding)
  const intentDegradation = textValue(value.intent_degradation)
  const rewriteDegradation = textValue(value.rewrite_degradation)
  const degraded = [intentDegradation, rewriteDegradation].filter(isPresent)
  if (degraded.length === 0) return hiddenFallback

  const intentModel = textValue(value.intent_model)
  const rewriteModel = textValue(value.rewrite_model)
  const models = [intentModel, rewriteModel].filter(isPresent)
  const reasons = Array.from(new Set(degraded.map(reasonLabel)))
  return {
    detail: `Intent/rewrite used deterministic guardrails after ${reasons.join(', ')}. Retrieval stayed recoverable, but wording may be more literal.`,
    label: 'Query guardrail fallback',
    modelLabel: Array.from(new Set(models)).join(' · ') || 'deterministic guardrails',
    visible: true,
  }
}
