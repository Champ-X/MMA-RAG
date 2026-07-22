export type ConfirmDialogActionViewModel = {
  canCancel: boolean
  canConfirm: boolean
  cancelAriaDisabled: boolean
  confirmAriaDisabled: boolean
  confirmLabel: string
  statusDetail: string
  statusLabel: string
  statusLive: 'polite'
  statusRole: 'status'
  statusVisible: boolean
}

export function buildConfirmDialogActionViewModel({
  busy,
  confirmLabel,
}: {
  busy: boolean
  confirmLabel: string
}): ConfirmDialogActionViewModel {
  if (busy) {
    return {
      canCancel: false,
      canConfirm: false,
      cancelAriaDisabled: true,
      confirmAriaDisabled: true,
      confirmLabel: 'Working...',
      statusDetail: 'This checkpoint is processing. The dialog stays open, focus remains trapped, and repeated confirmation is locked until the request finishes.',
      statusLabel: 'Action in progress',
      statusLive: 'polite',
      statusRole: 'status',
      statusVisible: true,
    }
  }

  return {
    canCancel: true,
    canConfirm: true,
    cancelAriaDisabled: false,
    confirmAriaDisabled: false,
    confirmLabel,
    statusDetail: `Cancel closes this checkpoint without continuing. ${confirmLabel} proceeds with the selected action.`,
    statusLabel: 'Confirmation ready',
    statusLive: 'polite',
    statusRole: 'status',
    statusVisible: false,
  }
}
