export type SpaceCreateFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type SpaceCreateViewModelInput = {
  errorMessage?: string
  name: string
  pending: boolean
  policyLabel: string
}

export type SpaceCreateViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: SpaceCreateFeedbackTone
  nameRequired: boolean
  submitLabel: string
}

export function buildSpaceCreateViewModel({
  errorMessage,
  name,
  pending,
  policyLabel,
}: SpaceCreateViewModelInput): SpaceCreateViewModel {
  const hasName = Boolean(name.trim())

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Space creation is locked while the routing contract is being created.',
      feedbackDetail: 'Creating the Space contract and preparing it for routing.',
      feedbackLabel: 'Creating Space',
      feedbackTone: 'pending',
      nameRequired: !hasName,
      submitLabel: 'Creating...',
    }
  }

  if (errorMessage) {
    const canSubmit = hasName
    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Name the Space before retrying creation.',
      feedbackDetail: errorMessage,
      feedbackLabel: 'Space could not be created',
      feedbackTone: 'error',
      nameRequired: !hasName,
      submitLabel: 'Try again',
    }
  }

  if (!hasName) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Name the Space before creating the routing scope.',
      feedbackDetail: 'Name the Space so future Runs and evidence scopes remain legible.',
      feedbackLabel: 'Space name required',
      feedbackTone: 'blocked',
      nameRequired: true,
      submitLabel: 'Create Space',
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: `${policyLabel} will become the visible routing and execution contract for this Space.`,
    feedbackLabel: 'Ready to create',
    feedbackTone: 'ready',
    nameRequired: false,
    submitLabel: 'Create Space',
  }
}
