import { describe, expect, it } from 'vitest'
import { buildConversationPinViewModel } from './conversationPinViewModel'

describe('buildConversationPinViewModel', () => {
  it('keeps idle pin guidance quiet before an action runs', () => {
    expect(buildConversationPinViewModel({
      action: 'pin',
      pending: false,
      targetTitle: 'Launch decision thread',
    })).toMatchObject({
      actionLabel: 'Pin',
      ariaDisabled: false,
      ariaLabel: 'Pin Launch decision thread',
      canSubmit: true,
      feedbackDetail: 'Pin keeps a conversation near the top of active history without changing its Runs, citations or Evidence bindings.',
      feedbackLabel: 'Pin ready',
      feedbackTone: 'ready',
      visible: false,
    })
  })

  it('announces pending pins with content-safety copy', () => {
    expect(buildConversationPinViewModel({
      action: 'pin',
      pending: true,
      targetTitle: 'Launch decision thread',
    })).toMatchObject({
      actionLabel: 'Pin...',
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Pin is locked while priority is being updated for Launch decision thread. Runs, citations and Evidence bindings remain unchanged.',
      feedbackDetail: 'Pinning Launch decision thread in active history. Conversation content and Evidence bindings remain unchanged.',
      feedbackLabel: 'Pinning conversation',
      feedbackTone: 'pending',
      role: 'status',
      visible: true,
    })
  })

  it('keeps failed pin changes retryable', () => {
    expect(buildConversationPinViewModel({
      action: 'unpin',
      errorMessage: 'Revision conflict.',
      pending: false,
      targetTitle: 'Launch decision thread',
    })).toMatchObject({
      actionLabel: 'Try unpin again',
      ariaDisabled: false,
      ariaLabel: 'Try unpin Launch decision thread again',
      canSubmit: true,
      feedbackDetail: 'Revision conflict. Launch decision thread keeps its previous history priority and can be retried.',
      feedbackLabel: 'Unpin failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes pinned conversations after the list refreshes', () => {
    expect(buildConversationPinViewModel({
      action: 'pin',
      completedTitle: 'Launch decision thread',
      pending: false,
    })).toMatchObject({
      feedbackDetail: 'Launch decision thread now stays at the top of active history. Runs, citations and Evidence bindings were not changed.',
      feedbackLabel: 'Conversation pinned',
      feedbackTone: 'ready',
      visible: true,
    })
  })

  it('summarizes unpin success without implying content changes', () => {
    expect(buildConversationPinViewModel({
      action: 'unpin',
      completedTitle: 'Launch decision thread',
      pending: false,
    })).toMatchObject({
      feedbackDetail: 'Launch decision thread returned to normal history ordering. Runs, citations and Evidence bindings remain unchanged.',
      feedbackLabel: 'Conversation unpinned',
      feedbackTone: 'ready',
      visible: true,
    })
  })
})
