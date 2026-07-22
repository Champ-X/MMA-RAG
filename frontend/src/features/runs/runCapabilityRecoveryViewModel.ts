export type RunCapabilityRecoveryViewModel = {
  actions: string[]
  detail: string
  evidenceLabel: string
  label: string
  phaseLabel: string
  preservedEvidenceIds: string[]
  role: 'alert' | 'status'
  visible: boolean
}

const hiddenRecovery: RunCapabilityRecoveryViewModel = {
  actions: [],
  detail: '',
  evidenceLabel: '',
  label: '',
  phaseLabel: '',
  preservedEvidenceIds: [],
  role: 'status',
  visible: false,
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))).slice(0, limit)
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function phaseLabel(value: string) {
  if (value === 'before_retrieval') return 'Before retrieval'
  if (value === 'retrieved') return 'Evidence retrieved'
  if (value === 'verified') return 'Verification checkpoint'
  if (value === 'planned') return 'Research plan saved'
  return value.replaceAll('_', ' ')
}

function defaultAction(phase: string, evidenceCount: number) {
  if (evidenceCount > 0 || phase === 'retrieved' || phase === 'verified') {
    return 'Review the preserved Evidence ledger, then retry after the missing capability is repaired.'
  }
  return 'Retry after the connector, retrieval index, or tool dependency is available.'
}

export function buildRunCapabilityRecoveryViewModel(result: Record<string, unknown> | null): RunCapabilityRecoveryViewModel {
  if (!result) return hiddenRecovery
  const recovery = recordValue(result.recovery)
  if (!Object.keys(recovery).length) return hiddenRecovery

  const error = recordValue(result.error)
  const reason = textValue(recovery.reason) ?? textValue(error.message) ?? 'A required runtime capability was unavailable.'
  const phase = textValue(recovery.phase) ?? 'before_retrieval'
  const evidenceCount = numberValue(recovery.evidence_count)
  const preservedEvidenceIds = stringList(recovery.preserved_evidence_revision_ids, 12)
  const actions = stringList(recovery.actions, 4)
  const checkpointAvailable = recovery.checkpoint_available === true

  return {
    actions: actions.length ? actions : [defaultAction(phase, evidenceCount)],
    detail: `${reason} ${checkpointAvailable ? 'A runtime checkpoint is available.' : 'No retrieval checkpoint was created before the interruption.'}`,
    evidenceLabel: `${evidenceCount} preserved Evidence item${evidenceCount === 1 ? '' : 's'}`,
    label: textValue(recovery.label) ?? 'Capability recovery required',
    phaseLabel: phaseLabel(phase),
    preservedEvidenceIds,
    role: 'alert',
    visible: true,
  }
}

export function preservedRecoveryEvidenceIds(result: Record<string, unknown> | null): string[] {
  if (!result) return []
  const recovery = recordValue(result.recovery)
  return stringList(recovery.preserved_evidence_revision_ids, 12)
}
