export type CollectionCreateFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type CollectionCreateViewKind = 'dynamic' | 'manual'

export type CollectionCreateViewModelInput = {
  availableSourceCount: number
  errorMessage?: string
  name: string
  pending: boolean
  ruleValue: string
  selectedSourceCount: number
  viewKind: CollectionCreateViewKind
}

export type CollectionCreateViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: CollectionCreateFeedbackTone
  nameRequired: boolean
  ruleValueRequired: boolean
  submitLabel: string
}

export function buildCollectionCreateViewModel({
  availableSourceCount,
  errorMessage,
  name,
  pending,
  ruleValue,
  selectedSourceCount,
  viewKind,
}: CollectionCreateViewModelInput): CollectionCreateViewModel {
  const hasName = Boolean(name.trim())
  const hasRuleValue = Boolean(ruleValue.trim())
  const dynamicRuleMissing = viewKind === 'dynamic' && !hasRuleValue

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Saved view creation is locked while the identity, rule contract and membership snapshot are being saved.',
      feedbackDetail: 'Saving the view identity, rule contract and current membership snapshot.',
      feedbackLabel: 'Creating saved view',
      feedbackTone: 'pending',
      nameRequired: !hasName,
      ruleValueRequired: dynamicRuleMissing,
      submitLabel: 'Creating...',
    }
  }

  if (errorMessage) {
    const canSubmit = hasName && !dynamicRuleMissing
    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Fix the required collection name and dynamic rule before retrying.',
      feedbackDetail: errorMessage,
      feedbackLabel: 'Saved view could not be created',
      feedbackTone: 'error',
      nameRequired: !hasName,
      ruleValueRequired: dynamicRuleMissing,
      submitLabel: 'Try again',
    }
  }

  if (!hasName) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Name this saved view before creating it.',
      feedbackDetail: 'Name this saved view so future Runs can explain exactly which scope was frozen.',
      feedbackLabel: 'Collection name required',
      feedbackTone: 'blocked',
      nameRequired: true,
      ruleValueRequired: dynamicRuleMissing,
      submitLabel: 'Create saved view',
    }
  }

  if (dynamicRuleMissing) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Enter the live rule value before creating this dynamic saved view.',
      feedbackDetail: 'Enter the value that the live rule should match before saving this dynamic view.',
      feedbackLabel: 'Rule value required',
      feedbackTone: 'blocked',
      nameRequired: false,
      ruleValueRequired: true,
      submitLabel: 'Create saved view',
    }
  }

  if (viewKind === 'dynamic') {
    return {
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: `Ready to save a live rule matching "${ruleValue.trim()}"; Runs will freeze the resolved Sources at start time.`,
      feedbackLabel: 'Ready to save dynamic view',
      feedbackTone: 'ready',
      nameRequired: false,
      ruleValueRequired: false,
      submitLabel: 'Create saved view',
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: selectedSourceCount
      ? `${selectedSourceCount} of ${availableSourceCount} available material${availableSourceCount === 1 ? '' : 's'} will be curated into this view.`
      : `Ready to create an empty curated shelf; ${availableSourceCount} material${availableSourceCount === 1 ? '' : 's'} can be added later.`,
    feedbackLabel: 'Ready to save curated view',
    feedbackTone: 'ready',
    nameRequired: false,
    ruleValueRequired: false,
    submitLabel: 'Create saved view',
  }
}
