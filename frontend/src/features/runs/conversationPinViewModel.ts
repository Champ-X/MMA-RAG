export type ConversationPinAction = 'pin' | 'unpin'
export type ConversationPinFeedbackTone = 'error' | 'pending' | 'ready'

export type ConversationPinViewModelInput = {
  action: ConversationPinAction
  completedTitle?: string
  errorMessage?: string
  pending: boolean
  targetTitle?: string
}

export type ConversationPinViewModel = {
  actionLabel: string
  ariaDisabled: boolean
  ariaLabel: string
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ConversationPinFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

const actionCopy = {
  pin: {
    actionLabel: 'Pin',
    completedDetail: (title: string) => `${title} now stays at the top of active history. Runs, citations and Evidence bindings were not changed.`,
    completedLabel: 'Conversation pinned',
    idleDetail: 'Pin keeps a conversation near the top of active history without changing its Runs, citations or Evidence bindings.',
    idleLabel: 'Pin ready',
    pendingDetail: (title: string) => `Pinning ${title} in active history. Conversation content and Evidence bindings remain unchanged.`,
    pendingLabel: 'Pinning conversation',
  },
  unpin: {
    actionLabel: 'Unpin',
    completedDetail: (title: string) => `${title} returned to normal history ordering. Runs, citations and Evidence bindings remain unchanged.`,
    completedLabel: 'Conversation unpinned',
    idleDetail: 'Unpin returns a conversation to normal history ordering without changing its Runs or Evidence bindings.',
    idleLabel: 'Unpin ready',
    pendingDetail: (title: string) => `Unpinning ${title} from the priority lane. Conversation content and Evidence bindings remain unchanged.`,
    pendingLabel: 'Unpinning conversation',
  },
} satisfies Record<ConversationPinAction, {
  actionLabel: string
  completedDetail: (title: string) => string
  completedLabel: string
  idleDetail: string
  idleLabel: string
  pendingDetail: (title: string) => string
  pendingLabel: string
}>

export function buildConversationPinViewModel({
  action,
  completedTitle,
  errorMessage,
  pending,
  targetTitle,
}: ConversationPinViewModelInput): ConversationPinViewModel {
  const copy = actionCopy[action]
  const title = targetTitle?.trim() || completedTitle?.trim() || 'this conversation'

  if (pending) {
    return {
      actionLabel: `${copy.actionLabel}...`,
      ariaDisabled: true,
      ariaLabel: `${copy.actionLabel} ${title}`,
      canSubmit: false,
      disabledDetail: `${copy.actionLabel} is locked while priority is being updated for ${title}. Runs, citations and Evidence bindings remain unchanged.`,
      feedbackDetail: copy.pendingDetail(title),
      feedbackLabel: copy.pendingLabel,
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorMessage) {
    return {
      actionLabel: `Try ${copy.actionLabel.toLowerCase()} again`,
      ariaDisabled: false,
      ariaLabel: `Try ${copy.actionLabel.toLowerCase()} ${title} again`,
      canSubmit: true,
      feedbackDetail: `${errorMessage} ${title} keeps its previous history priority and can be retried.`,
      feedbackLabel: `${copy.actionLabel} failed`,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (completedTitle) {
    return {
      actionLabel: copy.actionLabel,
      ariaDisabled: false,
      ariaLabel: `${copy.actionLabel} ${completedTitle}`,
      canSubmit: true,
      feedbackDetail: copy.completedDetail(completedTitle),
      feedbackLabel: copy.completedLabel,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  return {
    actionLabel: copy.actionLabel,
    ariaDisabled: false,
    ariaLabel: `${copy.actionLabel} ${title}`,
    canSubmit: true,
    feedbackDetail: copy.idleDetail,
    feedbackLabel: copy.idleLabel,
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}
