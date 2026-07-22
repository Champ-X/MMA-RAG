export type SystemModelGatewayTone = 'ready' | 'warning'

export type SystemModelGatewayViewModel = {
  activeRouteCountLabel: string
  detail: string
  failureLabels: string[]
  fallbackLabel?: string
  label: string
  stateLabel: string
  tone: SystemModelGatewayTone
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textValue(value: unknown, fallback = 'unknown') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function routeCountLabel(value: unknown) {
  const count = numberValue(value)
  if (count == null) return 'Routes unknown'
  return `${count} active route${count === 1 ? '' : 's'}`
}

function failureSummary(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const failure = recordValue(item)
    const route = textValue(failure.route_id, '')
    const deployment = textValue(failure.deployment_id, '')
    const errorType = textValue(failure.error_type, '')
    const missing = Array.isArray(failure.missing)
      ? failure.missing.filter((capability): capability is string => typeof capability === 'string' && capability.trim().length > 0).slice(0, 3)
      : []
    if (!route && !deployment && !errorType) return []
    const parts = [errorType || 'Failure']
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

function roleLabel(value: string) {
  if (value === 'query_rewrite') return 'query rewrite task'
  if (value === 'query_intent') return 'query intent task'
  return value ? value.replaceAll('_', ' ') : 'a governed task'
}

function fallbackCopy(fallbackModel: string, role: string) {
  if (fallbackModel === 'deterministic-task-local-v1') {
    return {
      detail: `A deterministic JSON task fallback handled ${roleLabel(role)} when the configured model path failed. Answer generation coverage is unchanged.`,
      label: 'Task fallback active',
    }
  }
  return {
    detail: 'A deterministic evidence summary is available when the configured model path fails. Inspect failures before treating this as full model coverage.',
    label: 'Model fallback active',
  }
}

export function buildSystemModelGatewayViewModel(component: unknown): SystemModelGatewayViewModel {
  const health = recordValue(component)
  const status = textValue(health.status)
  const detail = recordValue(health.detail)
  const state = textValue(detail.state, textValue(detail.route, 'unreported'))
  const failures = failureSummary(detail.failures)
  const fallbackModel = textValue(detail.fallback_model, '')
  const role = textValue(detail.role, '')
  const activeRoutes = detail.active_route_count
  const tone: SystemModelGatewayTone = status === 'ready' && !fallbackModel && failures.length === 0
    ? 'ready'
    : 'warning'

  if (fallbackModel) {
    const fallback = fallbackCopy(fallbackModel, role)
    return {
      activeRouteCountLabel: routeCountLabel(activeRoutes),
      detail: fallback.detail,
      failureLabels: failures,
      fallbackLabel: fallbackModel,
      label: fallback.label,
      stateLabel: state.replaceAll('_', ' '),
      tone,
    }
  }

  if (failures.length > 0) {
    return {
      activeRouteCountLabel: routeCountLabel(activeRoutes),
      detail: 'One or more model routes are degraded. Runtime can still use verified routes that remain healthy.',
      failureLabels: failures,
      label: 'Model route needs attention',
      stateLabel: state.replaceAll('_', ' '),
      tone,
    }
  }

  return {
    activeRouteCountLabel: routeCountLabel(activeRoutes),
    detail: status === 'ready'
      ? 'Active model routes are verified for their declared capabilities.'
      : 'Model gateway readiness is not fully verified. Review the diagnostic payload.',
    failureLabels: [],
    label: status === 'ready' ? 'Model routes verified' : 'Model gateway degraded',
    stateLabel: state.replaceAll('_', ' '),
    tone,
  }
}
