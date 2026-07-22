import { describe, expect, it } from 'vitest'
import { buildCollectionMembershipViewModel } from './collectionMembershipViewModel'

const baseInput = {
  collectionName: 'Launch shelf',
  currentSourceIds: ['a', 'b'],
  draftSourceIds: ['a', 'b', 'c'],
  errorMessage: undefined,
  pending: false,
  savedName: undefined,
  savedSourceCount: undefined,
}

describe('buildCollectionMembershipViewModel', () => {
  it('keeps unchanged memberships quiet and unsavable', () => {
    expect(buildCollectionMembershipViewModel({
      ...baseInput,
      draftSourceIds: ['b', 'a'],
    })).toMatchObject({
      ariaDisabled: true,
      canSave: false,
      disabledDetail: 'Launch shelf membership is unchanged.',
      feedbackDetail: 'Launch shelf membership is unchanged. Future Runs will keep freezing the current 2 materials.',
      feedbackLabel: 'Membership unchanged',
      feedbackTone: 'blocked',
      saveLabel: 'Saved',
      visible: false,
    })
  })

  it('summarizes added and removed materials before saving', () => {
    expect(buildCollectionMembershipViewModel({
      ...baseInput,
      draftSourceIds: ['b', 'c', 'd'],
    })).toMatchObject({
      ariaDisabled: false,
      canSave: true,
      feedbackDetail: 'Ready to save 3 materials for Launch shelf: 2 added, 1 removed. Future Runs freeze the revised view; existing snapshots stay unchanged.',
      feedbackLabel: 'Membership change ready',
      feedbackTone: 'ready',
      role: 'status',
      visible: true,
    })
  })

  it('allows saving an empty curated view with explicit scope copy', () => {
    expect(buildCollectionMembershipViewModel({
      ...baseInput,
      draftSourceIds: [],
    })).toMatchObject({
      ariaDisabled: false,
      canSave: true,
      feedbackDetail: 'Ready to save 0 materials for Launch shelf: 0 added, 2 removed. Future Runs freeze the revised view; existing snapshots stay unchanged.',
      feedbackLabel: 'Membership change ready',
      saveLabel: 'Save membership',
    })
  })

  it('announces pending saves with future-run semantics', () => {
    expect(buildCollectionMembershipViewModel({
      ...baseInput,
      pending: true,
    })).toMatchObject({
      ariaDisabled: true,
      canSave: false,
      disabledDetail: 'Membership save is locked while Launch shelf is being updated.',
      feedbackDetail: 'Saving 3 materials for Launch shelf. Future Runs will freeze this revised membership; existing Run snapshots stay unchanged.',
      feedbackLabel: 'Saving membership',
      feedbackTone: 'pending',
      saveLabel: 'Saving...',
      visible: true,
    })
  })

  it('keeps failed saves retryable when the draft still differs', () => {
    expect(buildCollectionMembershipViewModel({
      ...baseInput,
      errorMessage: 'Revision conflict.',
    })).toMatchObject({
      ariaDisabled: false,
      canSave: true,
      feedbackDetail: 'Revision conflict. Launch shelf still uses its previous membership until this save succeeds.',
      feedbackLabel: 'Membership was not saved',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      saveLabel: 'Try save again',
      visible: true,
    })
  })

  it('keeps a success receipt after the save completes', () => {
    expect(buildCollectionMembershipViewModel({
      ...baseInput,
      currentSourceIds: ['a', 'b', 'c'],
      draftSourceIds: ['a', 'b', 'c'],
      savedName: 'Launch shelf',
      savedSourceCount: 3,
    })).toMatchObject({
      ariaDisabled: true,
      canSave: false,
      disabledDetail: 'Membership already matches the saved collection.',
      feedbackDetail: 'Launch shelf now resolves to 3 materials. Existing Run snapshots were not rewritten.',
      feedbackLabel: 'Membership saved',
      feedbackTone: 'ready',
      saveLabel: 'Membership saved',
      visible: true,
    })
  })
})
