export type RunLifecycleAction = 'cancel' | 'pause' | 'resume'
export type RunLifecycleFeedbackTone = 'error' | 'pending' | 'ready'

type RunLifecycleControl = {
  ariaDisabled: boolean
  ariaLabel: string
  canSubmit: boolean
  disabledDetail?: string
  label: string
}

export type RunLifecycleActionViewModelInput = {
  completedAction?: RunLifecycleAction
  errorAction?: RunLifecycleAction
  errorMessage?: string
  pendingAction?: RunLifecycleAction
  runGoal?: string
  status: string
}

export type RunLifecycleActionViewModel = {
  controls: Record<RunLifecycleAction, RunLifecycleControl>
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: RunLifecycleFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

const terminalStatuses = new Set(['cancelled', 'completed', 'failed', 'partial'])

const actionCopy = {
  cancel: {
    ariaLabel: 'Cancel Run',
    label: 'Cancel',
    pendingLabel: 'Cancelling...',
    pendingTitle: 'Cancelling Run',
    successDetail: 'Run cancelled. Completed events, retrieved Evidence and partial work remain preserved for review.',
    successTitle: 'Run cancelled',
  },
  pause: {
    ariaLabel: 'Pause Run',
    label: 'Pause',
    pendingLabel: 'Pausing...',
    pendingTitle: 'Pausing Run',
    successDetail: 'Run paused at the next safe checkpoint. Resume when you are ready to continue the same frozen scope.',
    successTitle: 'Run paused',
  },
  resume: {
    ariaLabel: 'Resume Run',
    label: 'Resume',
    pendingLabel: 'Resuming...',
    pendingTitle: 'Resuming Run',
    successDetail: 'Run resumed from the preserved checkpoint with the same frozen scope and Evidence ledger.',
    successTitle: 'Run resumed',
  },
} satisfies Record<RunLifecycleAction, {
  ariaLabel: string
  label: string
  pendingLabel: string
  pendingTitle: string
  successDetail: string
  successTitle: string
}>

function runLabel(runGoal?: string) {
  return runGoal?.trim() ? `"${runGoal.trim()}"` : 'this Run'
}

function lifecycleControlGate({
  action,
  busy,
  canSubmit,
  pendingAction,
  runGoal,
  status,
}: {
  action: RunLifecycleAction
  busy: boolean
  canSubmit: boolean
  pendingAction?: RunLifecycleAction
  runGoal?: string
  status: string
}): Pick<RunLifecycleControl, 'ariaDisabled' | 'disabledDetail'> {
  if (canSubmit) {
    return {
      ariaDisabled: false,
    }
  }

  if (busy && pendingAction) {
    return {
      ariaDisabled: true,
      disabledDetail: `${actionCopy[action].label} is locked while ${actionCopy[pendingAction].label.toLowerCase()} is in progress for ${runLabel(runGoal)}. Completed events and Evidence bindings remain preserved.`,
    }
  }

  return {
    ariaDisabled: true,
    disabledDetail: `${actionCopy[action].label} is unavailable while this Run is at status "${status}".`,
  }
}

export function buildRunLifecycleActionViewModel({
  completedAction,
  errorAction,
  errorMessage,
  pendingAction,
  runGoal,
  status,
}: RunLifecycleActionViewModelInput): RunLifecycleActionViewModel {
  const busy = Boolean(pendingAction)
  const terminal = terminalStatuses.has(status)
  const paused = status === 'paused'
  const cancelCanSubmit = !busy && !terminal
  const pauseCanSubmit = !busy && !terminal && !paused
  const resumeCanSubmit = !busy && paused
  const controls: Record<RunLifecycleAction, RunLifecycleControl> = {
    cancel: {
      ariaLabel: actionCopy.cancel.ariaLabel,
      canSubmit: cancelCanSubmit,
      label: pendingAction === 'cancel' ? actionCopy.cancel.pendingLabel : actionCopy.cancel.label,
      ...lifecycleControlGate({ action: 'cancel', busy, canSubmit: cancelCanSubmit, pendingAction, runGoal, status }),
    },
    pause: {
      ariaLabel: actionCopy.pause.ariaLabel,
      canSubmit: pauseCanSubmit,
      label: pendingAction === 'pause' ? actionCopy.pause.pendingLabel : actionCopy.pause.label,
      ...lifecycleControlGate({ action: 'pause', busy, canSubmit: pauseCanSubmit, pendingAction, runGoal, status }),
    },
    resume: {
      ariaLabel: actionCopy.resume.ariaLabel,
      canSubmit: resumeCanSubmit,
      label: pendingAction === 'resume' ? actionCopy.resume.pendingLabel : actionCopy.resume.label,
      ...lifecycleControlGate({ action: 'resume', busy, canSubmit: resumeCanSubmit, pendingAction, runGoal, status }),
    },
  }

  if (pendingAction) {
    return {
      controls,
      feedbackDetail: `${actionCopy[pendingAction].label} request sent for ${runLabel(runGoal)}. The control plane will preserve completed events and Evidence bindings.`,
      feedbackLabel: actionCopy[pendingAction].pendingTitle,
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorAction && errorMessage) {
    return {
      controls,
      feedbackDetail: `${errorMessage} ${runLabel(runGoal)} remains at status "${status}" and the action can be retried if still available.`,
      feedbackLabel: `${actionCopy[errorAction].label} failed`,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (completedAction) {
    return {
      controls,
      feedbackDetail: actionCopy[completedAction].successDetail,
      feedbackLabel: actionCopy[completedAction].successTitle,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (paused) {
    return {
      controls,
      feedbackDetail: 'Resume continues from the paused checkpoint; cancel stops future work while preserving completed events.',
      feedbackLabel: 'Run controls ready',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: false,
    }
  }

  if (!terminal) {
    return {
      controls,
      feedbackDetail: 'Pause waits for a safe checkpoint. Cancel stops future work while preserving completed events and retrieved Evidence.',
      feedbackLabel: 'Run controls ready',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: false,
    }
  }

  return {
    controls,
    feedbackDetail: 'This Run is already settled; lifecycle controls are unavailable because the preserved result is now read-only.',
    feedbackLabel: 'Run settled',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}
