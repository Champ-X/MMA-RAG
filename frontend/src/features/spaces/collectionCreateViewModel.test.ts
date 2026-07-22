import { describe, expect, it } from 'vitest'
import { buildCollectionCreateViewModel } from './collectionCreateViewModel'

const baseInput = {
  availableSourceCount: 6,
  errorMessage: undefined,
  name: 'Quarterly launch evidence',
  pending: false,
  ruleValue: 'image',
  selectedSourceCount: 2,
  viewKind: 'manual' as const,
}

describe('buildCollectionCreateViewModel', () => {
  it('blocks unnamed saved views with explicit guidance', () => {
    expect(buildCollectionCreateViewModel({ ...baseInput, name: '   ' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Name this saved view before creating it.',
      feedbackDetail: 'Name this saved view so future Runs can explain exactly which scope was frozen.',
      feedbackLabel: 'Collection name required',
      feedbackTone: 'blocked',
      nameRequired: true,
      submitLabel: 'Create saved view',
    })
  })

  it('summarizes curated membership when ready', () => {
    expect(buildCollectionCreateViewModel(baseInput)).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: '2 of 6 available materials will be curated into this view.',
      feedbackLabel: 'Ready to save curated view',
      feedbackTone: 'ready',
      nameRequired: false,
      ruleValueRequired: false,
    })
  })

  it('allows an empty curated shelf with transparent copy', () => {
    expect(buildCollectionCreateViewModel({ ...baseInput, selectedSourceCount: 0 })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Ready to create an empty curated shelf; 6 materials can be added later.',
      feedbackLabel: 'Ready to save curated view',
      feedbackTone: 'ready',
    })
  })

  it('blocks dynamic views without a rule value', () => {
    expect(buildCollectionCreateViewModel({
      ...baseInput,
      ruleValue: '   ',
      viewKind: 'dynamic',
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Enter the live rule value before creating this dynamic saved view.',
      feedbackDetail: 'Enter the value that the live rule should match before saving this dynamic view.',
      feedbackLabel: 'Rule value required',
      feedbackTone: 'blocked',
      nameRequired: false,
      ruleValueRequired: true,
    })
  })

  it('summarizes the dynamic rule when ready', () => {
    expect(buildCollectionCreateViewModel({
      ...baseInput,
      ruleValue: ' failed import ',
      viewKind: 'dynamic',
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Ready to save a live rule matching "failed import"; Runs will freeze the resolved Sources at start time.',
      feedbackLabel: 'Ready to save dynamic view',
      feedbackTone: 'ready',
    })
  })

  it('keeps retry available after creation fails when required fields remain valid', () => {
    expect(buildCollectionCreateViewModel({
      ...baseInput,
      errorMessage: 'Collection name already exists.',
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Collection name already exists.',
      feedbackLabel: 'Saved view could not be created',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    })
  })
})
