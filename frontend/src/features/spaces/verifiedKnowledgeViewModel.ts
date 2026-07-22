import type { SpaceKnowledgeClaim } from '@/api/nexus'

export type KnowledgeFilter = 'all' | 'supported' | 'attention'

export type KnowledgeSummary = {
  attention: number
  claimsLoadedLabel: string
  sourceCount: number
  supported: number
  total: number
}

export type ClaimPresentation = {
  evidenceCountLabel: string
  highestSupport: number
  label: string
  riskLabel: string
  tone: 'supported' | 'attention'
}

export const knowledgeFilterOptions: Array<{ value: KnowledgeFilter; label: string; detail: string }> = [
  { value: 'all', label: 'All claims', detail: 'Every verified claim in this Space.' },
  { value: 'supported', label: 'Supported', detail: 'Claims with clear evidence support.' },
  { value: 'attention', label: 'Needs review', detail: 'Partial, stale, conflicted or unresolved claims.' },
]

export function parseKnowledgeFilter(value: string | null): KnowledgeFilter {
  return knowledgeFilterOptions.some((option) => option.value === value)
    ? (value as KnowledgeFilter)
    : 'all'
}

export function summarizeVerifiedKnowledge(
  claims: SpaceKnowledgeClaim[],
  hasMore: boolean,
): KnowledgeSummary {
  const supported = claims.filter((claim) => claim.status === 'supported').length
  const sourceNames = new Set(claims.flatMap((claim) => claim.evidence.map((item) => item.source_name)))
  return {
    attention: claims.length - supported,
    claimsLoadedLabel: `${claims.length}${hasMore ? '+' : ''}`,
    sourceCount: sourceNames.size,
    supported,
    total: claims.length,
  }
}

export function presentClaim(claim: SpaceKnowledgeClaim): ClaimPresentation {
  const highestSupport = claim.evidence.length
    ? Math.round(Math.max(...claim.evidence.map((item) => item.support_score)) * 100)
    : 0
  const needsAttention = claim.status !== 'supported'
  return {
    evidenceCountLabel: `${claim.evidence.length} bound Evidence revision${claim.evidence.length === 1 ? '' : 's'}`,
    highestSupport,
    label: claimStatusLabel(claim.status),
    riskLabel: needsAttention ? riskCopy(claim.status) : 'Ready to reuse with citations',
    tone: needsAttention ? 'attention' : 'supported',
  }
}

export function claimStatusLabel(status: string) {
  if (status === 'supported') return 'Supported'
  if (status === 'partially_supported') return 'Partially supported'
  if (status === 'conflicted') return 'Conflicting evidence'
  if (status === 'stale') return 'Stale evidence'
  return status.replaceAll('_', ' ')
}

function riskCopy(status: string) {
  if (status === 'conflicted') return 'Evidence disagrees'
  if (status === 'stale') return 'Refresh before reuse'
  if (status === 'partially_supported') return 'Coverage is incomplete'
  return 'Review before reuse'
}
