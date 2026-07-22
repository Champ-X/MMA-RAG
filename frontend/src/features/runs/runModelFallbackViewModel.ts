export type RunModelFallbackTone = 'blocked' | 'fallback'

export type RunModelFallbackViewModel = {
  detail: string
  failures: string[]
  label: string
  modelLabel: string
  role: 'alert' | 'status'
  tone: RunModelFallbackTone
  visible: boolean
}

const hiddenFallback: RunModelFallbackViewModel = {
  detail: '',
  failures: [],
  label: '',
  modelLabel: '',
  role: 'status',
  tone: 'fallback',
  visible: false,
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function failureSummary(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const failure = recordValue(item)
    const route = textValue(failure.route_id)
    const deployment = textValue(failure.deployment_id)
    const errorType = textValue(failure.error_type)
    const missing = Array.isArray(failure.missing)
      ? failure.missing.filter((capability): capability is string => typeof capability === 'string' && capability.trim().length > 0).slice(0, 3)
      : []
    if (!route && !deployment && !errorType) return []
    const parts = [errorType ?? 'Failure']
    if (route) parts.push(`route ${route.slice(0, 8)}`)
    if (deployment) {
      parts.push(deployment === 'pinned_setup_gateway'
        ? 'deployment pinned setup gateway'
        : `deployment ${deployment.slice(0, 8)}`)
    }
    if (missing.length > 0) parts.push(`missing ${missing.join(', ')}`)
    return parts.join(' · ')
  }).slice(0, 3)
}

export function buildRunModelFallbackViewModel(result: Record<string, unknown> | null): RunModelFallbackViewModel {
  if (!result) return hiddenFallback
  if (Object.keys(recordValue(result.recovery)).length) return hiddenFallback

  const model = recordValue(result.model)
  const metadata = recordValue(model.metadata)
  const reason = textValue(metadata.degradation_reason)
  if (reason === 'active_model_route_failed') {
    const actualModel = textValue(model.actual_model) ?? 'fallback model'
    const failedRoute = textValue(metadata.failed_route_id)
    return {
      detail: `The active model route did not complete, so Nexus used a deterministic evidence summary instead of dropping the turn.${failedRoute ? ` Failed route: ${failedRoute.slice(0, 8)}.` : ''}`,
      failures: failureSummary(metadata.failures),
      label: 'Model route fallback used',
      modelLabel: actualModel,
      role: 'status',
      tone: 'fallback',
      visible: true,
    }
  }

  if (reason === 'question_override_model_failed') {
    const actualModel = textValue(model.actual_model) ?? 'fallback model'
    return {
      detail: 'The selected answer model did not complete, so Nexus used a deterministic evidence summary instead of dropping the turn.',
      failures: failureSummary(metadata.failures),
      label: 'Selected model fallback used',
      modelLabel: actualModel,
      role: 'status',
      tone: 'fallback',
      visible: true,
    }
  }

  if (reason === 'pinned_setup_gateway_failed') {
    const actualModel = textValue(model.actual_model) ?? 'fallback model'
    return {
      detail: 'The configured setup gateway did not complete, so Nexus used a deterministic evidence summary instead of dropping the turn.',
      failures: failureSummary(metadata.failures),
      label: 'Configured gateway fallback used',
      modelLabel: actualModel,
      role: 'status',
      tone: 'fallback',
      visible: true,
    }
  }

  const error = recordValue(result.error)
  if (textValue(error.code) === 'CAPABILITY_UNAVAILABLE') {
    const details = recordValue(error.details)
    const failedRoute = textValue(details.route_id)
    return {
      detail: `${textValue(error.message) ?? 'The required capability was unavailable.'} Evidence and trace were preserved, but this historical turn was created before local evidence fallback could finish the answer.${failedRoute ? ` Failed route: ${failedRoute.slice(0, 8)}.` : ''}`,
      failures: failureSummary(details.failures),
      label: 'Capability unavailable',
      modelLabel: 'No answer model completed',
      role: 'alert',
      tone: 'blocked',
      visible: true,
    }
  }

  return hiddenFallback
}
