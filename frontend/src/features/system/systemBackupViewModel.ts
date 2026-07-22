export type BackupCreateFeedbackTone = 'error' | 'pending' | 'ready'
export type BackupLatestTone = 'attention' | 'empty' | 'verified'

export type BackupSummaryInput = {
  error?: string | null
  status: string
  verified: boolean
}

export type BackupCreateViewModelInput = {
  backupCount: number
  errorMessage?: string
  latestBackup?: BackupSummaryInput
  pending: boolean
}

export type BackupCreateViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: BackupCreateFeedbackTone
  latestDetail: string
  latestLabel: string
  latestTone: BackupLatestTone
  submitLabel: string
}

function latestPresentation(latestBackup?: BackupSummaryInput): Pick<BackupCreateViewModel, 'latestDetail' | 'latestLabel' | 'latestTone'> {
  if (!latestBackup) {
    return {
      latestDetail: 'Create a recovery point before depending on restore workflows.',
      latestLabel: 'No recovery point yet',
      latestTone: 'empty',
    }
  }

  if (latestBackup.verified) {
    return {
      latestDetail: `Latest manifest status is ${latestBackup.status}; hashes were verified and secrets were excluded.`,
      latestLabel: 'Latest manifest verified',
      latestTone: 'verified',
    }
  }

  return {
    latestDetail: latestBackup.error
      ? `Latest manifest is not verified: ${latestBackup.error}`
      : `Latest manifest status is ${latestBackup.status}; create and verify a fresh point before relying on restore.`,
    latestLabel: 'Latest manifest needs review',
    latestTone: 'attention',
  }
}

export function buildBackupCreateViewModel({
  backupCount,
  errorMessage,
  latestBackup,
  pending,
}: BackupCreateViewModelInput): BackupCreateViewModel {
  const latest = latestPresentation(latestBackup)

  if (pending) {
    return {
      ...latest,
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Recovery point creation is locked while PostgreSQL authority and object manifests are being captured and verified.',
      feedbackDetail: 'Creating a PostgreSQL authority snapshot and verifying the backup manifest hashes.',
      feedbackLabel: 'Creating recovery point',
      feedbackTone: 'pending',
      submitLabel: 'Creating...',
    }
  }

  if (errorMessage) {
    return {
      ...latest,
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: errorMessage,
      feedbackLabel: 'Recovery point was not created',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    }
  }

  if (!backupCount) {
    return {
      ...latest,
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Create a consistent PostgreSQL and object manifest. Qdrant remains derived and is rebuilt after restore.',
      feedbackLabel: 'Ready to create first recovery point',
      feedbackTone: 'ready',
      submitLabel: 'Create & verify',
    }
  }

  return {
    ...latest,
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: 'Create the next recovery point after confirming the current manifest state is visible.',
    feedbackLabel: latest.latestTone === 'verified' ? 'Ready for next recovery point' : 'Create a fresh verified recovery point',
    feedbackTone: 'ready',
    submitLabel: 'Create & verify',
  }
}
