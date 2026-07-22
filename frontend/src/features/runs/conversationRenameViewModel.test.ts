import { describe, expect, it } from 'vitest'
import { buildConversationRenameViewModel } from './conversationRenameViewModel'

const baseInput = {
  draftTitle: 'New launch research',
  errorMessage: undefined,
  originalTitle: 'Old launch research',
  pending: false,
}

describe('buildConversationRenameViewModel', () => {
  it('blocks empty conversation titles', () => {
    expect(buildConversationRenameViewModel({ ...baseInput, draftTitle: '   ' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Add a title before saving this conversation name.',
      feedbackDetail: 'Add a title before saving so this evidence-bound thread remains searchable.',
      feedbackLabel: 'Title required',
      feedbackTone: 'blocked',
      titleInvalid: true,
    })
  })

  it('blocks unchanged titles without closing edit mode', () => {
    expect(buildConversationRenameViewModel({
      ...baseInput,
      draftTitle: 'Old launch research',
      originalTitle: 'Old launch research',
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Edit the title before saving, or press Escape to keep the current name.',
      feedbackDetail: 'Edit the title or press Escape to keep the current name.',
      feedbackLabel: 'No title change yet',
      feedbackTone: 'blocked',
      titleInvalid: false,
    })
  })

  it('summarizes ready title saves', () => {
    expect(buildConversationRenameViewModel(baseInput)).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Ready to rename this conversation without changing its Run snapshots or Evidence bindings.',
      feedbackLabel: 'Ready to save',
      feedbackTone: 'ready',
      submitLabel: 'Save title',
      titleInvalid: false,
    })
  })

  it('surfaces pending save copy', () => {
    expect(buildConversationRenameViewModel({ ...baseInput, pending: true })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Rename is locked while the title is being saved with the latest conversation revision.',
      feedbackDetail: 'Saving the title with the latest conversation revision.',
      feedbackLabel: 'Saving title',
      feedbackTone: 'pending',
      submitLabel: 'Saving',
    })
  })

  it('keeps retry available when saving fails and the title is still changed', () => {
    expect(buildConversationRenameViewModel({
      ...baseInput,
      errorMessage: 'Conversation was updated elsewhere.',
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Conversation was updated elsewhere.',
      feedbackLabel: 'Title was not saved',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    })
  })
})
