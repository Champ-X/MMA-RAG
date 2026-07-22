export type FollowUpComposerFeedbackTone = 'blocked' | 'error' | 'pending' | 'ready'

export type FollowUpComposerViewModelInput = {
  attachmentCount: number
  errorMessage?: string
  followUp: string
  pending: boolean
  stage: string
}

export type FollowUpComposerViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: FollowUpComposerFeedbackTone
  promptRequired: boolean
  submitLabel: string
}

export function buildFollowUpComposerViewModel({
  attachmentCount,
  errorMessage,
  followUp,
  pending,
  stage,
}: FollowUpComposerViewModelInput): FollowUpComposerViewModel {
  const hasPrompt = Boolean(followUp.trim())

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Follow-up submission is locked while attachments are retained, parsed and bound to the next turn.',
      feedbackDetail: stage || 'Preparing the next evidence-bound turn.',
      feedbackLabel: 'Sending follow-up',
      feedbackTone: 'pending',
      promptRequired: !hasPrompt,
      submitLabel: 'Sending follow-up...',
    }
  }

  if (errorMessage) {
    const canSubmit = hasPrompt

    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : 'Write a follow-up question before retrying the next turn.',
      feedbackDetail: errorMessage,
      feedbackLabel: 'Follow-up could not start',
      feedbackTone: 'error',
      promptRequired: !hasPrompt,
      submitLabel: 'Try again',
    }
  }

  if (!hasPrompt) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Write a follow-up question before sending the next evidence-bound turn.',
      feedbackDetail: 'Write a follow-up question before starting the next turn.',
      feedbackLabel: 'Follow-up required',
      feedbackTone: 'blocked',
      promptRequired: true,
      submitLabel: 'Send follow-up',
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: attachmentCount
      ? `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} will be retained and parsed before the next turn starts.`
      : 'Ready to continue with the current conversation context and evidence ledger.',
    feedbackLabel: 'Ready to continue',
    feedbackTone: 'ready',
    promptRequired: false,
    submitLabel: 'Send follow-up',
  }
}
