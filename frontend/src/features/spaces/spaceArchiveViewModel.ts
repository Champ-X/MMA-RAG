export type SpaceArchiveFeedbackTone = 'error' | 'pending' | 'ready'

export type SpaceArchiveViewModelInput = {
  archivedName?: string
  errorMessage?: string
  pending: boolean
  targetName?: string
}

export type SpaceArchiveViewModel = {
  archiveLabel: string
  ariaDisabled: boolean
  canArchive: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: SpaceArchiveFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

export function buildSpaceArchiveViewModel({
  archivedName,
  errorMessage,
  pending,
  targetName,
}: SpaceArchiveViewModelInput): SpaceArchiveViewModel {
  const spaceLabel = targetName?.trim() || archivedName?.trim() || 'this Space'

  if (pending) {
    return {
      archiveLabel: 'Archiving...',
      ariaDisabled: true,
      canArchive: false,
      disabledDetail: `Archive is locked while ${spaceLabel} is leaving routing and navigation.`,
      feedbackDetail: `Archiving ${spaceLabel} from routing and navigation. Sources remain globally retained and existing Run snapshots stay readable.`,
      feedbackLabel: 'Archiving Space',
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
      feedbackDetail: `${errorMessage} ${spaceLabel} remains active and can be retried.`,
      feedbackLabel: 'Space archive failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (archivedName) {
    return {
      archiveLabel: 'Archive Space',
      ariaDisabled: false,
      canArchive: true,
      feedbackDetail: `${archivedName} left routing and navigation. Sources remain globally retained for other Spaces and historical Runs.`,
      feedbackLabel: 'Space archived',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  return {
    archiveLabel: 'Archive Space',
    ariaDisabled: false,
    canArchive: true,
    feedbackDetail: 'Archive removes a Space from routing and navigation without deleting retained Sources or historical Run snapshots.',
    feedbackLabel: 'Space archive ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}
