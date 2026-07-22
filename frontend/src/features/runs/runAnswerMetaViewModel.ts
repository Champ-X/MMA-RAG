import { preservedRecoveryEvidenceIds } from './runCapabilityRecoveryViewModel'

export type RunAnswerMetaViewModel = {
  evidenceLabel: string
}

function citationCount(result: Record<string, unknown> | null): number {
  return Array.isArray(result?.citations) ? result.citations.length : 0
}

export function buildRunAnswerMetaViewModel(result: Record<string, unknown> | null): RunAnswerMetaViewModel {
  const citations = citationCount(result)
  const preservedEvidence = preservedRecoveryEvidenceIds(result).length
  if (citations > 0 && preservedEvidence > 0) {
    return {
      evidenceLabel: `${citations} citation${citations === 1 ? '' : 's'} · ${preservedEvidence} preserved Evidence item${preservedEvidence === 1 ? '' : 's'}`,
    }
  }
  if (citations > 0) {
    return {
      evidenceLabel: `${citations} citation${citations === 1 ? '' : 's'}`,
    }
  }
  if (preservedEvidence > 0) {
    return {
      evidenceLabel: `${preservedEvidence} preserved Evidence item${preservedEvidence === 1 ? '' : 's'}`,
    }
  }
  return {
    evidenceLabel: 'No evidence linked yet',
  }
}
