export type ConversationArchiveAction = 'archive' | 'restore'
export type ConversationArchiveFeedbackTone = 'error' | 'pending' | 'ready'

export type ConversationArchiveViewModelInput = {
  action: ConversationArchiveAction
  completedTitle?: string
  errorMessage?: string
  pending: boolean
  targetTitle?: string
}

export type ConversationArchiveViewModel = {
  actionLabel: string
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ConversationArchiveFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

const actionCopy = {
  archive: {
    actionLabel: 'Archive',
    completedDetail: (title: string) => `${title} left active history. Runs, citations and Evidence bindings remain recoverable from Archived.`,
    completedLabel: 'Conversation archived',
    idleDetail: 'Archive moves a conversation out of active history without changing its Runs, citations or Evidence bindings.',
    idleLabel: 'Archive ready',
    pendingDetail: (title: string) => `Archiving ${title} from active history. Frozen Runs and citation bindings remain unchanged.`,
    pendingLabel: 'Archiving conversation',
  },
  restore: {
    actionLabel: 'Restore',
    completedDetail: (title: string) => `${title} returned to active history. Runs, citations and Evidence bindings remain unchanged.`,
    completedLabel: 'Conversation restored',
    idleDetail: 'Restore returns an archived conversation to active history without changing its frozen Runs or Evidence bindings.',
    idleLabel: 'Restore ready',
    pendingDetail: (title: string) => `Restoring ${title} to active history. Frozen Runs and citation bindings remain unchanged.`,
    pendingLabel: 'Restoring conversation',
  },
} satisfies Record<ConversationArchiveAction, {
  actionLabel: string
  completedDetail: (title: string) => string
  completedLabel: string
  idleDetail: string
  idleLabel: string
  pendingDetail: (title: string) => string
  pendingLabel: string
}>

export function buildConversationArchiveViewModel({
  action,
  completedTitle,
  errorMessage,
  pending,
  targetTitle,
}: ConversationArchiveViewModelInput): ConversationArchiveViewModel {
  const copy = actionCopy[action]
  const title = targetTitle?.trim() || completedTitle?.trim() || 'this conversation'

  if (pending) {
    return {
      actionLabel: `${copy.actionLabel}...`,
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: `${copy.actionLabel} is locked while history placement is being updated for ${title}. Frozen Runs and Evidence bindings remain unchanged.`,
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
      canSubmit: true,
      feedbackDetail: `${errorMessage} ${title} remains in its previous history list and can be retried.`,
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
    canSubmit: true,
    feedbackDetail: copy.idleDetail,
    feedbackLabel: copy.idleLabel,
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}
