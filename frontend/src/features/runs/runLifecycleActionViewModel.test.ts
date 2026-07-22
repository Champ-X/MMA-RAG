import { describe, expect, it } from 'vitest'
import { buildRunLifecycleActionViewModel } from './runLifecycleActionViewModel'

describe('buildRunLifecycleActionViewModel', () => {
  it('enables pause and cancel while an active Run is not settled', () => {
    const model = buildRunLifecycleActionViewModel({
      status: 'running',
    })

    expect(model.controls.pause).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      label: 'Pause',
    })
    expect(model.controls.resume.canSubmit).toBe(false)
    expect(model.controls.cancel.canSubmit).toBe(true)
    expect(model).toMatchObject({
      feedbackDetail: 'Pause waits for a safe checkpoint. Cancel stops future work while preserving completed events and retrieved Evidence.',
      feedbackLabel: 'Run controls ready',
      visible: false,
    })
  })

  it('enables resume and cancel while paused', () => {
    const model = buildRunLifecycleActionViewModel({
      status: 'paused',
    })

    expect(model.controls.pause.canSubmit).toBe(false)
    expect(model.controls.resume).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      label: 'Resume',
    })
    expect(model.controls.cancel.canSubmit).toBe(true)
    expect(model.feedbackDetail).toBe('Resume continues from the paused checkpoint; cancel stops future work while preserving completed events.')
  })

  it('disables lifecycle controls once a Run is terminal', () => {
    const model = buildRunLifecycleActionViewModel({
      status: 'completed',
    })

    expect(model.controls.pause.canSubmit).toBe(false)
    expect(model.controls.pause).toMatchObject({
      ariaDisabled: true,
      disabledDetail: 'Pause is unavailable while this Run is at status "completed".',
    })
    expect(model.controls.resume.canSubmit).toBe(false)
    expect(model.controls.cancel.canSubmit).toBe(false)
    expect(model).toMatchObject({
      feedbackLabel: 'Run settled',
      visible: false,
    })
  })

  it('announces pending lifecycle actions', () => {
    const model = buildRunLifecycleActionViewModel({
      pendingAction: 'pause',
      runGoal: 'Compare launch evidence',
      status: 'running',
    })

    expect(model.controls.pause).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Pause is locked while pause is in progress for "Compare launch evidence". Completed events and Evidence bindings remain preserved.',
      label: 'Pausing...',
    })
    expect(model.controls.cancel.canSubmit).toBe(false)
    expect(model).toMatchObject({
      feedbackDetail: 'Pause request sent for "Compare launch evidence". The control plane will preserve completed events and Evidence bindings.',
      feedbackLabel: 'Pausing Run',
      feedbackTone: 'pending',
      role: 'status',
      visible: true,
    })
  })

  it('keeps failed lifecycle actions retryable when still available', () => {
    const model = buildRunLifecycleActionViewModel({
      errorAction: 'cancel',
      errorMessage: 'Run revision changed.',
      runGoal: 'Compare launch evidence',
      status: 'running',
    })

    expect(model.controls.cancel.canSubmit).toBe(true)
    expect(model).toMatchObject({
      feedbackDetail: 'Run revision changed. "Compare launch evidence" remains at status "running" and the action can be retried if still available.',
      feedbackLabel: 'Cancel failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes completed actions without reopening controls incorrectly', () => {
    const model = buildRunLifecycleActionViewModel({
      completedAction: 'cancel',
      status: 'cancelled',
    })

    expect(model.controls.cancel.canSubmit).toBe(false)
    expect(model).toMatchObject({
      feedbackDetail: 'Run cancelled. Completed events, retrieved Evidence and partial work remain preserved for review.',
      feedbackLabel: 'Run cancelled',
      feedbackTone: 'ready',
      visible: true,
    })
  })
})
