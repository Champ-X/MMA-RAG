import { describe, expect, it } from 'vitest'
import { buildSpaceCreateViewModel } from './spaceCreateViewModel'

const baseInput = {
  errorMessage: undefined,
  name: 'Product intelligence',
  pending: false,
  policyLabel: 'Research dossier',
}

describe('buildSpaceCreateViewModel', () => {
  it('blocks unnamed Spaces with explicit guidance', () => {
    expect(buildSpaceCreateViewModel({ ...baseInput, name: '   ' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Name the Space before creating the routing scope.',
      feedbackDetail: 'Name the Space so future Runs and evidence scopes remain legible.',
      feedbackLabel: 'Space name required',
      feedbackTone: 'blocked',
      nameRequired: true,
      submitLabel: 'Create Space',
    })
  })

  it('summarizes the selected policy when ready', () => {
    expect(buildSpaceCreateViewModel(baseInput)).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Research dossier will become the visible routing and execution contract for this Space.',
      feedbackLabel: 'Ready to create',
      feedbackTone: 'ready',
      nameRequired: false,
    })
  })

  it('turns pending creation into live-region friendly copy', () => {
    expect(buildSpaceCreateViewModel({ ...baseInput, pending: true })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Space creation is locked while the routing contract is being created.',
      feedbackDetail: 'Creating the Space contract and preparing it for routing.',
      feedbackLabel: 'Creating Space',
      feedbackTone: 'pending',
      submitLabel: 'Creating...',
    })
  })

  it('keeps retry available after creation fails when the name remains valid', () => {
    expect(buildSpaceCreateViewModel({
      ...baseInput,
      errorMessage: 'A Space with this name already exists.',
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'A Space with this name already exists.',
      feedbackLabel: 'Space could not be created',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    })
  })
})
