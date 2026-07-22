import { describe, expect, it } from 'vitest'
import { buildBackupCreateViewModel } from './systemBackupViewModel'

describe('buildBackupCreateViewModel', () => {
  it('guides first recovery point creation', () => {
    expect(buildBackupCreateViewModel({
      backupCount: 0,
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackLabel: 'Ready to create first recovery point',
      feedbackTone: 'ready',
      latestLabel: 'No recovery point yet',
      latestTone: 'empty',
      submitLabel: 'Create & verify',
    })
  })

  it('summarizes a verified latest manifest', () => {
    expect(buildBackupCreateViewModel({
      backupCount: 2,
      latestBackup: { status: 'completed', verified: true },
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackLabel: 'Ready for next recovery point',
      latestDetail: 'Latest manifest status is completed; hashes were verified and secrets were excluded.',
      latestLabel: 'Latest manifest verified',
      latestTone: 'verified',
    })
  })

  it('calls attention to an unverified latest manifest', () => {
    expect(buildBackupCreateViewModel({
      backupCount: 1,
      latestBackup: { error: 'checksum mismatch', status: 'failed', verified: false },
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackLabel: 'Create a fresh verified recovery point',
      latestDetail: 'Latest manifest is not verified: checksum mismatch',
      latestLabel: 'Latest manifest needs review',
      latestTone: 'attention',
    })
  })

  it('blocks duplicate creation while pending', () => {
    expect(buildBackupCreateViewModel({
      backupCount: 1,
      latestBackup: { status: 'completed', verified: true },
      pending: true,
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Recovery point creation is locked while PostgreSQL authority and object manifests are being captured and verified.',
      feedbackDetail: 'Creating a PostgreSQL authority snapshot and verifying the backup manifest hashes.',
      feedbackLabel: 'Creating recovery point',
      feedbackTone: 'pending',
      submitLabel: 'Creating...',
    })
  })

  it('keeps retry available after backup creation fails', () => {
    expect(buildBackupCreateViewModel({
      backupCount: 1,
      errorMessage: 'Object store unavailable.',
      latestBackup: { status: 'completed', verified: true },
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Object store unavailable.',
      feedbackLabel: 'Recovery point was not created',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    })
  })
})
