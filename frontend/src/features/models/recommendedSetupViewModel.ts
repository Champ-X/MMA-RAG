import type { ModelSetup } from '@/api/nexus'

export type RecommendedSetupFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type RecommendedSetupViewModelInput = Pick<
  ModelSetup,
  'configurable_role_count' | 'discovered_model_count' | 'enabled_model_count' | 'provider_count' | 'ready_role_count' | 'status' | 'total_role_count'
> & {
  busy: boolean
  errorMessage?: string
}

export type RecommendedSetupActionViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  detail: string
  disabledDetail?: string
  label: string
  visible: boolean
}

export type RecommendedSetupViewModel = {
  applyAction: RecommendedSetupActionViewModel
  connectAction: RecommendedSetupActionViewModel
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: RecommendedSetupFeedbackTone
  setupComplete: boolean
  verifyAction: RecommendedSetupActionViewModel
}

const hiddenAction = {
  ariaDisabled: true,
  canSubmit: false,
  detail: '',
  label: '',
  visible: false,
} satisfies RecommendedSetupActionViewModel

export function buildRecommendedSetupViewModel({
  busy,
  configurable_role_count,
  discovered_model_count,
  enabled_model_count,
  errorMessage,
  provider_count,
  ready_role_count,
  status,
  total_role_count,
}: RecommendedSetupViewModelInput): RecommendedSetupViewModel {
  const needsProvider = provider_count === 0
  const needsVerification = discovered_model_count > enabled_model_count
  const canApplyRoutes = configurable_role_count > 0
  const setupComplete = status === 'ready'

  const connectAction = needsProvider
    ? {
      ariaDisabled: false,
      canSubmit: true,
      detail: 'Connect a credential-backed Provider before Nexus can verify models or assign task routes.',
      label: 'Connect Provider',
      visible: true,
    }
    : hiddenAction
  const verifyAction = needsVerification
    ? {
      ariaDisabled: busy,
      canSubmit: !busy,
      detail: `${discovered_model_count - enabled_model_count} discovered deployment${discovered_model_count - enabled_model_count === 1 ? '' : 's'} still need capability probes.`,
      disabledDetail: busy ? 'Capability verification is locked while the current model gateway operation preserves Providers and active routes.' : undefined,
      label: busy ? 'Verifying...' : 'Verify configured defaults',
      visible: true,
    }
    : hiddenAction
  const applyAction = canApplyRoutes
    ? {
      ariaDisabled: busy,
      canSubmit: !busy,
      detail: `${configurable_role_count} missing task route${configurable_role_count === 1 ? '' : 's'} can be completed without replacing active custom routes.`,
      disabledDetail: busy ? 'Route completion is locked while the current model gateway operation preserves existing active routes.' : undefined,
      label: busy ? 'Completing routes...' : `Complete ${configurable_role_count} missing routes`,
      visible: true,
    }
    : hiddenAction

  if (busy) {
    return {
      applyAction,
      connectAction,
      feedbackDetail: 'Nexus is verifying capabilities or applying recommended task routes. Existing active routes stay preserved.',
      feedbackLabel: 'Model setup is working',
      feedbackTone: 'pending',
      setupComplete,
      verifyAction,
    }
  }

  if (errorMessage) {
    return {
      applyAction,
      connectAction,
      feedbackDetail: errorMessage,
      feedbackLabel: 'Recommended setup could not finish',
      feedbackTone: 'error',
      setupComplete,
      verifyAction,
    }
  }

  if (needsProvider) {
    return {
      applyAction,
      connectAction,
      feedbackDetail: connectAction.detail,
      feedbackLabel: 'Provider required',
      feedbackTone: 'blocked',
      setupComplete: false,
      verifyAction,
    }
  }

  if (setupComplete && needsVerification) {
    return {
      applyAction,
      connectAction,
      feedbackDetail: `${ready_role_count}/${total_role_count} governed task roles are explicit. You can optionally verify ${discovered_model_count - enabled_model_count} additional discovered deployment${discovered_model_count - enabled_model_count === 1 ? '' : 's'} for future routing choices.`,
      feedbackLabel: 'Recommended routes are complete',
      feedbackTone: 'ready',
      setupComplete: true,
      verifyAction,
    }
  }

  if (needsVerification) {
    return {
      applyAction,
      connectAction,
      feedbackDetail: verifyAction.detail,
      feedbackLabel: 'Capability verification required',
      feedbackTone: 'ready',
      setupComplete: false,
      verifyAction,
    }
  }

  if (canApplyRoutes) {
    return {
      applyAction,
      connectAction,
      feedbackDetail: applyAction.detail,
      feedbackLabel: 'Task routes can be completed',
      feedbackTone: 'ready',
      setupComplete: false,
      verifyAction,
    }
  }

  if (setupComplete) {
    return {
      applyAction,
      connectAction,
      feedbackDetail: `All ${ready_role_count} governed task role${ready_role_count === 1 ? '' : 's'} have explicit verified routes.`,
      feedbackLabel: 'Recommended setup complete',
      feedbackTone: 'ready',
      setupComplete: true,
      verifyAction,
    }
  }

  return {
    applyAction,
    connectAction,
    feedbackDetail: `${ready_role_count}/${total_role_count} task roles are explicit. Add only the capabilities where managed remote models are required.`,
    feedbackLabel: 'Fallbacks remain visible',
    feedbackTone: 'ready',
    setupComplete: false,
    verifyAction,
  }
}
