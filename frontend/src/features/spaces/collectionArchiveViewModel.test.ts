import { describe, expect, it } from 'vitest'
import { buildCollectionArchiveViewModel } from './collectionArchiveViewModel'

describe('buildCollectionArchiveViewModel', () => {
  it('keeps archive feedback quiet before an action runs', () => {
    expect(buildCollectionArchiveViewModel({
      pending: false,
    })).toMatchObject({
      archiveLabel: 'Archive view',
      ariaDisabled: false,
      canArchive: true,
      feedbackDetail: 'Archive removes a saved view from the active collection list without deleting retained Sources or historical Run snapshots.',
      feedbackLabel: 'Collection archive ready',
      feedbackTone: 'ready',
      visible: false,
    })
  })

  it('announces pending archive with frozen-run context', () => {
    expect(buildCollectionArchiveViewModel({
      pending: true,
      targetName: 'Launch shelf',
    })).toMatchObject({
      archiveLabel: 'Archiving...',
      ariaDisabled: true,
      canArchive: false,
      disabledDetail: 'Archive is locked while Launch shelf leaves active saved views.',
      feedbackDetail: 'Archiving Launch shelf from active saved views. Existing Run snapshots keep their frozen scopes and Sources remain retained.',
      feedbackLabel: 'Archiving collection',
      feedbackTone: 'pending',
      role: 'status',
      visible: true,
    })
  })

  it('keeps failed archives retryable', () => {
    expect(buildCollectionArchiveViewModel({
      errorMessage: 'Archive failed.',
      pending: false,
      targetName: 'Launch shelf',
    })).toMatchObject({
      archiveLabel: 'Try archive again',
      ariaDisabled: false,
      canArchive: true,
      feedbackDetail: 'Archive failed. Launch shelf remains active and can be retried.',
      feedbackLabel: 'Collection archive failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes archived collections after the list refreshes', () => {
    expect(buildCollectionArchiveViewModel({
      archivedName: 'Launch shelf',
      pending: false,
    })).toMatchObject({
      archiveLabel: 'Archive view',
      ariaDisabled: false,
      feedbackDetail: 'Launch shelf left the active collection list. Existing Run snapshots keep their frozen scopes.',
      feedbackLabel: 'Collection archived',
      feedbackTone: 'ready',
      visible: true,
    })
  })
})
