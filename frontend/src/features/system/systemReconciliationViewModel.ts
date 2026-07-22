export type ReconciliationFeedbackTone = 'error' | 'pending' | 'ready'
export type ReconciliationResultTone = 'complete' | 'empty'

export type ReconciliationViewModelInput = {
  errorMessage?: string
  pending: boolean
  result?: unknown
}

export type ReconciliationViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: ReconciliationFeedbackTone
  resultDetail: string
  resultLabel: string
  resultTone: ReconciliationResultTone
  submitLabel: string
}

export function countDiagnosticFields(value: unknown) {
  if (value === null || value === undefined) return 0
  if (Array.isArray(value)) return value.length
  if (typeof value === 'object') return Object.keys(value).length
  return 1
}

function resultPresentation(result: unknown): Pick<ReconciliationViewModel, 'resultDetail' | 'resultLabel' | 'resultTone'> {
  const fieldCount = countDiagnosticFields(result)
  if (!fieldCount) {
    return {
      resultDetail: 'Run reconciliation to compare PostgreSQL authority, blob manifests and derived indexes in this view.',
      resultLabel: 'No reconciliation run yet',
      resultTone: 'empty',
    }
  }

  return {
    resultDetail: `Last reconciliation returned ${fieldCount} diagnostic field${fieldCount === 1 ? '' : 's'}; inspect the payload before taking follow-up action.`,
    resultLabel: 'Last reconciliation completed',
    resultTone: 'complete',
  }
}

export function buildReconciliationViewModel({
  errorMessage,
  pending,
  result,
}: ReconciliationViewModelInput): ReconciliationViewModel {
  const resultView = resultPresentation(result)

  if (pending) {
    return {
      ...resultView,
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Reconciliation is locked while authority records and derived projections are being compared.',
      feedbackDetail: 'Comparing authority records and repairing derived projections where the backend can do so safely.',
      feedbackLabel: 'Reconciling authority',
      feedbackTone: 'pending',
      submitLabel: 'Reconciling...',
    }
  }

  if (errorMessage) {
    return {
      ...resultView,
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: errorMessage,
      feedbackLabel: 'Reconciliation failed',
      feedbackTone: 'error',
      submitLabel: 'Try again',
    }
  }

  if (countDiagnosticFields(result)) {
    return {
      ...resultView,
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'You can run reconciliation again after new ingestion, restore or index maintenance activity.',
      feedbackLabel: 'Ready to re-run reconciliation',
      feedbackTone: 'ready',
      submitLabel: 'Run again',
    }
  }

  return {
    ...resultView,
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: 'Run reconciliation to repair derived stores from PostgreSQL and blob authority, never the reverse.',
    feedbackLabel: 'Ready to reconcile',
    feedbackTone: 'ready',
    submitLabel: 'Run now',
  }
}
