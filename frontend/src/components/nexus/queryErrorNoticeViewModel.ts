export type QueryErrorNoticeInput = {
  error: unknown
  hasData: boolean
  label: string
  required?: boolean
}

export type QueryErrorNoticeViewModel = {
  actionLabel: string
  detail: string
  label: string
  role: 'alert' | 'status'
  tone: 'blocking' | 'inline'
  visible: boolean
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'The request failed before Nexus received a usable response.'
}

export function buildQueryErrorNoticeViewModel(
  inputs: QueryErrorNoticeInput[],
): QueryErrorNoticeViewModel {
  const failed = inputs.find((input) => Boolean(input.error))
  if (!failed) {
    return {
      actionLabel: 'Retry',
      detail: '',
      label: '',
      role: 'status',
      tone: 'inline',
      visible: false,
    }
  }

  const hasAnyData = inputs.some((input) => input.hasData)
  const hasRequiredMissingData = inputs.some((input) => Boolean(input.error) && input.required && !input.hasData)
  const missingLabels = inputs
    .filter((input) => Boolean(input.error) && !input.hasData)
    .map((input) => input.label)
  const detail = `${failed.label}: ${errorMessage(failed.error)}`

  if (!hasAnyData || hasRequiredMissingData) {
    const failedLabels = missingLabels.length
      ? missingLabels
      : inputs.filter((input) => Boolean(input.error)).map((input) => input.label)
    return {
      actionLabel: 'Retry control plane',
      detail,
      label: failedLabels.length
        ? `Nexus could not load ${failedLabels.join(', ')}.`
        : 'Nexus could not load the control plane.',
      role: 'alert',
      tone: 'blocking',
      visible: true,
    }
  }

  return {
    actionLabel: 'Retry refresh',
    detail,
    label: missingLabels.length
      ? `Some workspace data could not refresh: ${missingLabels.join(', ')}.`
      : 'The latest workspace refresh failed, but cached data is still visible.',
    role: 'status',
    tone: 'inline',
    visible: true,
  }
}
