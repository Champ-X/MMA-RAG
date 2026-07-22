import { describe, expect, it } from 'vitest'
import { buildConversationArchiveViewModel } from './conversationArchiveViewModel'

describe('buildConversationArchiveViewModel', () => {
  it('keeps archive guidance quiet before an action runs', () => {
    expect(buildConversationArchiveViewModel({
      action: 'archive',
      pending: false,
    })).toMatchObject({
      actionLabel: 'Archive',
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Archive moves a conversation out of active history without changing its Runs, citations or Evidence bindings.',
      feedbackLabel: 'Archive ready',
      feedbackTone: 'ready',
      visible: false,
    })
  })

  it('announces pending archives with frozen-run context', () => {
    expect(buildConversationArchiveViewModel({
      action: 'archive',
      pending: true,
      targetTitle: 'Launch decision thread',
    })).toMatchObject({
      actionLabel: 'Archive...',
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Archive is locked while history placement is being updated for Launch decision thread. Frozen Runs and Evidence bindings remain unchanged.',
      feedbackDetail: 'Archiving Launch decision thread from active history. Frozen Runs and citation bindings remain unchanged.',
      feedbackLabel: 'Archiving conversation',
      feedbackTone: 'pending',
      role: 'status',
      visible: true,
    })
  })

  it('keeps failed archives retryable', () => {
    expect(buildConversationArchiveViewModel({
      action: 'archive',
      errorMessage: 'Revision conflict.',
      pending: false,
      targetTitle: 'Launch decision thread',
    })).toMatchObject({
      actionLabel: 'Try archive again',
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Revision conflict. Launch decision thread remains in its previous history list and can be retried.',
      feedbackLabel: 'Archive failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes archived conversations after the list refreshes', () => {
    expect(buildConversationArchiveViewModel({
      action: 'archive',
      completedTitle: 'Launch decision thread',
      pending: false,
    })).toMatchObject({
      feedbackDetail: 'Launch decision thread left active history. Runs, citations and Evidence bindings remain recoverable from Archived.',
      feedbackLabel: 'Conversation archived',
      feedbackTone: 'ready',
      visible: true,
    })
  })

  it('summarizes restore readiness and success', () => {
    expect(buildConversationArchiveViewModel({
      action: 'restore',
      pending: false,
    })).toMatchObject({
      actionLabel: 'Restore',
      feedbackDetail: 'Restore returns an archived conversation to active history without changing its frozen Runs or Evidence bindings.',
      feedbackLabel: 'Restore ready',
      visible: false,
    })

    expect(buildConversationArchiveViewModel({
      action: 'restore',
      completedTitle: 'Launch decision thread',
      pending: false,
    })).toMatchObject({
      feedbackDetail: 'Launch decision thread returned to active history. Runs, citations and Evidence bindings remain unchanged.',
      feedbackLabel: 'Conversation restored',
      feedbackTone: 'ready',
      visible: true,
    })
  })
})
