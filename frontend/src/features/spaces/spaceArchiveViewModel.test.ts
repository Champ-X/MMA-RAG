import { describe, expect, it } from 'vitest'
import { buildSpaceArchiveViewModel } from './spaceArchiveViewModel'

describe('buildSpaceArchiveViewModel', () => {
  it('keeps archive feedback quiet before an action runs', () => {
    expect(buildSpaceArchiveViewModel({
      pending: false,
    })).toMatchObject({
      archiveLabel: 'Archive Space',
      ariaDisabled: false,
      canArchive: true,
      feedbackDetail: 'Archive removes a Space from routing and navigation without deleting retained Sources or historical Run snapshots.',
      feedbackLabel: 'Space archive ready',
      feedbackTone: 'ready',
      visible: false,
    })
  })

  it('announces pending archive with retained-source context', () => {
    expect(buildSpaceArchiveViewModel({
      pending: true,
      targetName: 'Launch research',
    })).toMatchObject({
      archiveLabel: 'Archiving...',
      ariaDisabled: true,
      canArchive: false,
      disabledDetail: 'Archive is locked while Launch research is leaving routing and navigation.',
      feedbackDetail: 'Archiving Launch research from routing and navigation. Sources remain globally retained and existing Run snapshots stay readable.',
      feedbackLabel: 'Archiving Space',
      feedbackTone: 'pending',
      visible: true,
    })
  })

  it('keeps failed archives retryable', () => {
    expect(buildSpaceArchiveViewModel({
      errorMessage: 'Archive failed.',
      pending: false,
      targetName: 'Launch research',
    })).toMatchObject({
      archiveLabel: 'Try archive again',
      ariaDisabled: false,
      canArchive: true,
      feedbackDetail: 'Archive failed. Launch research remains active and can be retried.',
      feedbackLabel: 'Space archive failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes archived Spaces after returning to the list', () => {
    expect(buildSpaceArchiveViewModel({
      archivedName: 'Launch research',
      pending: false,
    })).toMatchObject({
      archiveLabel: 'Archive Space',
      ariaDisabled: false,
      feedbackDetail: 'Launch research left routing and navigation. Sources remain globally retained for other Spaces and historical Runs.',
      feedbackLabel: 'Space archived',
      feedbackTone: 'ready',
      visible: true,
    })
  })
})
