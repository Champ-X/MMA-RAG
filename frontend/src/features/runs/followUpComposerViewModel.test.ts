import { describe, expect, it } from 'vitest'
import { buildFollowUpComposerViewModel } from './followUpComposerViewModel'

const baseInput = {
  attachmentCount: 0,
  errorMessage: undefined,
  followUp: 'Continue with the risk evidence.',
  pending: false,
  stage: '',
}

describe('buildFollowUpComposerViewModel', () => {
  it('blocks empty follow-ups with explicit guidance', () => {
    expect(buildFollowUpComposerViewModel({ ...baseInput, followUp: '   ' })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Write a follow-up question before sending the next evidence-bound turn.',
      feedbackDetail: 'Write a follow-up question before starting the next turn.',
      feedbackLabel: 'Follow-up required',
      feedbackTone: 'blocked',
      promptRequired: true,
      submitLabel: 'Send follow-up',
    })
  })

  it('summarizes queued attachments before sending', () => {
    expect(buildFollowUpComposerViewModel({ ...baseInput, attachmentCount: 1 })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: '1 attachment will be retained and parsed before the next turn starts.',
      feedbackLabel: 'Ready to continue',
      feedbackTone: 'ready',
    })
  })

  it('surfaces pending stage copy through a live-region friendly model', () => {
    expect(buildFollowUpComposerViewModel({
      ...baseInput,
      pending: true,
      stage: 'Resolving context and starting the next turn...',
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Follow-up submission is locked while attachments are retained, parsed and bound to the next turn.',
      feedbackDetail: 'Resolving context and starting the next turn...',
      feedbackLabel: 'Sending follow-up',
      feedbackTone: 'pending',
      submitLabel: 'Sending follow-up...',
    })
  })

  it('keeps retry available after a failed follow-up when prompt remains valid', () => {
    expect(buildFollowUpComposerViewModel({
      ...baseInput,
      errorMessage: 'Attachment ingestion failed.',
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Attachment ingestion failed.',
      feedbackLabel: 'Follow-up could not start',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    })
  })

  it('keeps failed empty retries focusable but locked with a retry reason', () => {
    expect(buildFollowUpComposerViewModel({
      ...baseInput,
      errorMessage: 'Attachment ingestion failed.',
      followUp: '',
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Write a follow-up question before retrying the next turn.',
      feedbackLabel: 'Follow-up could not start',
      feedbackTone: 'error',
    })
  })
})
