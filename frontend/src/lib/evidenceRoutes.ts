export const evidenceBrowserRunId = 'browser'

function resolveEvidenceRunId(runId?: string | null) {
  const normalized = runId?.trim()
  return normalized || evidenceBrowserRunId
}

export function buildEvidenceDetailPath(evidenceRevisionId: string, runId?: string | null) {
  return `/runs/${encodeURIComponent(resolveEvidenceRunId(runId))}/evidence/${encodeURIComponent(evidenceRevisionId)}`
}

export function buildEvidenceDetailBackPath(runId?: string | null) {
  const resolved = resolveEvidenceRunId(runId)
  return resolved === evidenceBrowserRunId ? '/evidence' : `/runs/${encodeURIComponent(resolved)}`
}
