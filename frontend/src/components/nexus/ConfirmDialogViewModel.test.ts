import { describe, expect, it } from 'vitest'
import { buildConfirmDialogActionViewModel } from './ConfirmDialogViewModel'

describe('ConfirmDialogViewModel', () => {
  it('keeps confirmation actions available and explained while idle', () => {
    expect(buildConfirmDialogActionViewModel({
      busy: false,
      confirmLabel: 'Archive Space',
    })).toEqual({
      canCancel: true,
      canConfirm: true,
      cancelAriaDisabled: false,
      confirmAriaDisabled: false,
      confirmLabel: 'Archive Space',
      statusDetail: 'Cancel closes this checkpoint without continuing. Archive Space proceeds with the selected action.',
      statusLabel: 'Confirmation ready',
      statusLive: 'polite',
      statusRole: 'status',
      statusVisible: false,
    })
  })

  it('keeps busy confirmation controls focusable but logically locked', () => {
    expect(buildConfirmDialogActionViewModel({
      busy: true,
      confirmLabel: 'Delete materials',
    })).toEqual({
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
    })
  })
})
