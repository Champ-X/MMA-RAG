export type CollectionMembershipFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type CollectionMembershipViewModelInput = {
  collectionName?: string
  currentSourceIds: string[]
  draftSourceIds: string[]
  errorMessage?: string
  pending: boolean
  savedName?: string
  savedSourceCount?: number
}

export type CollectionMembershipViewModel = {
  ariaDisabled: boolean
  canSave: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: CollectionMembershipFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  saveLabel: string
  visible: boolean
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function diffSets(currentSourceIds: string[], draftSourceIds: string[]) {
  const current = new Set(unique(currentSourceIds))
  const draft = new Set(unique(draftSourceIds))
  const added = Array.from(draft).filter((id) => !current.has(id)).length
  const removed = Array.from(current).filter((id) => !draft.has(id)).length
  return {
    added,
    changed: added > 0 || removed > 0,
    draftCount: draft.size,
    removed,
  }
}

function materialLabel(count: number) {
  return `${count} material${count === 1 ? '' : 's'}`
}

function collectionLabel(value: string | undefined) {
  return value?.trim() || 'this curated view'
}

export function buildCollectionMembershipViewModel({
  collectionName,
  currentSourceIds,
  draftSourceIds,
  errorMessage,
  pending,
  savedName,
  savedSourceCount,
}: CollectionMembershipViewModelInput): CollectionMembershipViewModel {
  const label = collectionLabel(collectionName)
  const diff = diffSets(currentSourceIds, draftSourceIds)
  const deltaCopy = `${diff.added} added, ${diff.removed} removed`

  if (pending) {
    return {
      ariaDisabled: true,
      canSave: false,
      disabledDetail: `Membership save is locked while ${label} is being updated.`,
      feedbackDetail: `Saving ${materialLabel(diff.draftCount)} for ${label}. Future Runs will freeze this revised membership; existing Run snapshots stay unchanged.`,
      feedbackLabel: 'Saving membership',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      saveLabel: 'Saving...',
      visible: true,
    }
  }

  if (errorMessage) {
    const canSave = diff.changed
    return {
      ariaDisabled: !canSave,
      canSave,
      disabledDetail: canSave ? undefined : 'Change the curated membership before retrying this save.',
      feedbackDetail: `${errorMessage} ${label} still uses its previous membership until this save succeeds.`,
      feedbackLabel: 'Membership was not saved',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      saveLabel: 'Try save again',
      visible: true,
    }
  }

  if (savedName && !diff.changed) {
    return {
      ariaDisabled: true,
      canSave: false,
      disabledDetail: 'Membership already matches the saved collection.',
      feedbackDetail: `${savedName} now resolves to ${materialLabel(savedSourceCount ?? diff.draftCount)}. Existing Run snapshots were not rewritten.`,
      feedbackLabel: 'Membership saved',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      saveLabel: diff.changed ? 'Save membership' : 'Membership saved',
      visible: true,
    }
  }

  if (!diff.changed) {
    return {
      ariaDisabled: true,
      canSave: false,
      disabledDetail: `${label} membership is unchanged.`,
      feedbackDetail: `${label} membership is unchanged. Future Runs will keep freezing the current ${materialLabel(diff.draftCount)}.`,
      feedbackLabel: 'Membership unchanged',
      feedbackTone: 'blocked',
      liveMode: 'polite',
      role: 'status',
      saveLabel: 'Saved',
      visible: false,
    }
  }

  return {
    ariaDisabled: false,
    canSave: true,
    feedbackDetail: `Ready to save ${materialLabel(diff.draftCount)} for ${label}: ${deltaCopy}. Future Runs freeze the revised view; existing snapshots stay unchanged.`,
    feedbackLabel: 'Membership change ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    saveLabel: 'Save membership',
    visible: true,
  }
}
