export type ConversationRenameFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type ConversationRenameViewModelInput = {
  draftTitle: string
  errorMessage?: string
  originalTitle: string
  pending: boolean
}

export type ConversationRenameViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ConversationRenameFeedbackTone
  submitLabel: string
  titleInvalid: boolean
}

export function buildConversationRenameViewModel({
  draftTitle,
  errorMessage,
  originalTitle,
  pending,
}: ConversationRenameViewModelInput): ConversationRenameViewModel {
  const normalizedDraft = draftTitle.trim()
  const normalizedOriginal = originalTitle.trim()
  const hasTitle = Boolean(normalizedDraft)
  const changed = normalizedDraft !== normalizedOriginal

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Rename is locked while the title is being saved with the latest conversation revision.',
      feedbackDetail: 'Saving the title with the latest conversation revision.',
      feedbackLabel: 'Saving title',
      feedbackTone: 'pending',
      submitLabel: 'Saving',
      titleInvalid: !hasTitle,
    }
  }

  if (errorMessage) {
    const canSubmit = hasTitle && changed
    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Edit the title before retrying this rename.',
      feedbackDetail: errorMessage,
      feedbackLabel: 'Title was not saved',
      feedbackTone: 'error',
      submitLabel: 'Try again',
      titleInvalid: !hasTitle,
    }
  }

  if (!hasTitle) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Add a title before saving this conversation name.',
      feedbackDetail: 'Add a title before saving so this evidence-bound thread remains searchable.',
      feedbackLabel: 'Title required',
      feedbackTone: 'blocked',
      submitLabel: 'Save title',
      titleInvalid: true,
    }
  }

  if (!changed) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Edit the title before saving, or press Escape to keep the current name.',
      feedbackDetail: 'Edit the title or press Escape to keep the current name.',
      feedbackLabel: 'No title change yet',
      feedbackTone: 'blocked',
      submitLabel: 'Save title',
      titleInvalid: false,
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: 'Ready to rename this conversation without changing its Run snapshots or Evidence bindings.',
    feedbackLabel: 'Ready to save',
    feedbackTone: 'ready',
    submitLabel: 'Save title',
    titleInvalid: false,
  }
}
