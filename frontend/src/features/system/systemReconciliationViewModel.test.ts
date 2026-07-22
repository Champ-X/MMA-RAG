import { describe, expect, it } from 'vitest'
import { buildReconciliationViewModel, countDiagnosticFields } from './systemReconciliationViewModel'

describe('countDiagnosticFields', () => {
  it('counts object, array and scalar diagnostic payloads', () => {
    expect(countDiagnosticFields({ repaired: 2, open_issues: 0 })).toBe(2)
    expect(countDiagnosticFields(['one', 'two'])).toBe(2)
    expect(countDiagnosticFields('ok')).toBe(1)
    expect(countDiagnosticFields(null)).toBe(0)
  })
})

describe('buildReconciliationViewModel', () => {
  it('guides first reconciliation run', () => {
    expect(buildReconciliationViewModel({ pending: false })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Run reconciliation to repair derived stores from PostgreSQL and blob authority, never the reverse.',
      feedbackLabel: 'Ready to reconcile',
      feedbackTone: 'ready',
      resultLabel: 'No reconciliation run yet',
      resultTone: 'empty',
      submitLabel: 'Run now',
    })
  })

  it('blocks duplicate reconciliation while pending', () => {
    expect(buildReconciliationViewModel({ pending: true })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Reconciliation is locked while authority records and derived projections are being compared.',
      feedbackDetail: 'Comparing authority records and repairing derived projections where the backend can do so safely.',
      feedbackLabel: 'Reconciling authority',
      feedbackTone: 'pending',
      submitLabel: 'Reconciling...',
    })
  })

  it('summarizes completed reconciliation payloads', () => {
    expect(buildReconciliationViewModel({
      pending: false,
      result: { repaired: 3, open_issues: 1, checked_at: 'now' },
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackLabel: 'Ready to re-run reconciliation',
      resultDetail: 'Last reconciliation returned 3 diagnostic fields; inspect the payload before taking follow-up action.',
      resultLabel: 'Last reconciliation completed',
      resultTone: 'complete',
      submitLabel: 'Run again',
    })
  })

  it('keeps retry available after reconciliation fails', () => {
    expect(buildReconciliationViewModel({
      errorMessage: 'Qdrant is unavailable.',
      pending: false,
      result: { checked: 4 },
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Qdrant is unavailable.',
      feedbackLabel: 'Reconciliation failed',
      feedbackTone: 'error',
      resultLabel: 'Last reconciliation completed',
      submitLabel: 'Try again',
    })
  })
})
