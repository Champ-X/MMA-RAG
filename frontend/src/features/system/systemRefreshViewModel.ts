export type SystemRefreshFeedbackTone = 'error' | 'pending' | 'ready'
export type SystemRefreshLiveMode = 'assertive' | 'polite'
export type SystemRefreshRole = 'alert' | 'status'

export type SystemRefreshViewModelInput = {
  errorMessage?: string
  healthStatus?: string
  lastRefreshLabel?: string
  pending: boolean
  tab: string
}

export type SystemRefreshViewModel = {
  ariaDisabled: boolean
  canRefresh: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: SystemRefreshFeedbackTone
  liveMode: SystemRefreshLiveMode
  role: SystemRefreshRole
  scopeLabel: string
  submitLabel: string
}

const tabScopes: Record<string, string> = {
  backups: 'control readiness and backup manifests',
  jobs: 'control readiness and durable queue records',
  settings: 'control readiness and safe runtime policy',
  status: 'control readiness and index projection',
  storage: 'control readiness and Qdrant projection',
  traces: 'control readiness and Run traces',
}

function scopeForTab(tab: string) {
  return tabScopes[tab] ?? 'control readiness and this diagnostic view'
}

function healthStatusLabel(healthStatus?: string) {
  return healthStatus ? `Control status is ${healthStatus}.` : 'Control status is not loaded yet.'
}

export function buildSystemRefreshViewModel({
  errorMessage,
  healthStatus,
  lastRefreshLabel,
  pending,
  tab,
}: SystemRefreshViewModelInput): SystemRefreshViewModel {
  const scopeLabel = scopeForTab(tab)

  if (pending) {
    return {
      ariaDisabled: true,
      canRefresh: false,
      disabledDetail: `Refresh is locked while ${scopeLabel} diagnostics are updating. Existing values remain available on screen.`,
      feedbackDetail: `Refreshing ${scopeLabel}; existing diagnostics remain visible until the request settles.`,
      feedbackLabel: 'Refreshing diagnostics',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      scopeLabel,
      submitLabel: 'Refreshing...',
    }
  }

  if (errorMessage) {
    return {
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: `${errorMessage} Existing ${scopeLabel} values remain on screen.`,
      feedbackLabel: 'Refresh failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      scopeLabel,
      submitLabel: 'Try refresh again',
    }
  }

  if (lastRefreshLabel) {
    return {
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: `${lastRefreshLabel}; refreshed ${scopeLabel}. ${healthStatusLabel(healthStatus)}`,
      feedbackLabel: 'Diagnostics refreshed',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      scopeLabel,
      submitLabel: 'Refresh again',
    }
  }

  return {
    ariaDisabled: false,
    canRefresh: true,
    feedbackDetail: `Refresh ${scopeLabel} without leaving this operating view. ${healthStatusLabel(healthStatus)}`,
    feedbackLabel: 'Refresh ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    scopeLabel,
    submitLabel: 'Refresh',
  }
}
