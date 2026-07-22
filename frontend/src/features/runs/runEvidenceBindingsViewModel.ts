import type { Run } from '@/api/nexus'
import { preservedRecoveryEvidenceIds } from './runCapabilityRecoveryViewModel'

export type RunCitation = {
  evidence_revision_id: string
  locator?: Record<string, unknown>
  source_name?: string
}

export function runCitations(run: Pick<Run, 'result'>): RunCitation[] {
  const result = run.result as Record<string, unknown> | null
  return Array.isArray(result?.citations) ? result.citations as RunCitation[] : []
}

export function runEvidenceIds(run: Pick<Run, 'result'>): string[] {
  const result = run.result as Record<string, unknown> | null
  return Array.from(new Set([
    ...runCitations(run).map((citation) => citation.evidence_revision_id),
    ...preservedRecoveryEvidenceIds(result),
  ]))
}

export function conversationEvidenceIds(runs: Array<Pick<Run, 'result'>>): string[] {
  return Array.from(new Set(runs.flatMap(runEvidenceIds)))
}
