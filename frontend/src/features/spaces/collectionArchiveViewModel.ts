export type CollectionArchiveFeedbackTone = 'error' | 'pending' | 'ready'

export type CollectionArchiveViewModelInput = {
  archivedName?: string
  errorMessage?: string
  pending: boolean
  targetName?: string
}

export type CollectionArchiveViewModel = {
  archiveLabel: string
  ariaDisabled: boolean
  canArchive: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: CollectionArchiveFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

export function buildCollectionArchiveViewModel({
  archivedName,
  errorMessage,
  pending,
  targetName,
}: CollectionArchiveViewModelInput): CollectionArchiveViewModel {
  const collectionLabel = targetName?.trim() || archivedName?.trim() || 'this saved view'

  if (pending) {
    return {
      archiveLabel: 'Archiving...',
      ariaDisabled: true,
      canArchive: false,
      disabledDetail: `Archive is locked while ${collectionLabel} leaves active saved views.`,
      feedbackDetail: `Archiving ${collectionLabel} from active saved views. Existing Run snapshots keep their frozen scopes and Sources remain retained.`,
      feedbackLabel: 'Archiving collection',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorMessage) {
    return {
      archiveLabel: 'Try archive again',
      ariaDisabled: false,
      canArchive: true,
      feedbackDetail: `${errorMessage} ${collectionLabel} remains active and can be retried.`,
      feedbackLabel: 'Collection archive failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (archivedName) {
    return {
      archiveLabel: 'Archive view',
      ariaDisabled: false,
      canArchive: true,
      feedbackDetail: `${archivedName} left the active collection list. Existing Run snapshots keep their frozen scopes.`,
      feedbackLabel: 'Collection archived',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  return {
    archiveLabel: 'Archive view',
    ariaDisabled: false,
    canArchive: true,
    feedbackDetail: 'Archive removes a saved view from the active collection list without deleting retained Sources or historical Run snapshots.',
    feedbackLabel: 'Collection archive ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}
