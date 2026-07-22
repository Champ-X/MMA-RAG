import {
  buildAutoRouteEvidence,
  candidateScopeLabel,
  routeRecommendationLabel,
  routeMethodLabel,
  type AutoRoutePreviewCandidate,
  type AutoRoutePreviewEvidence,
  type AutoRoutePreviewScoreComponents,
  type SpaceRouteMethod,
} from './autoRoutePreviewViewModel'

export type RunRouteReceiptCandidateViewModel = {
  matchedTerms: string[]
  name: string
  scopeLabel?: string
  scoreLabel: string
}

export type RunRouteReceiptKind = 'quick' | 'research'
export type RunRouteReceiptQuality = 'deep' | 'fast' | 'quality'

export type RunRouteReceiptViewModel = {
  candidates: RunRouteReceiptCandidateViewModel[]
  decisionReason?: string
  detail: string
  evidence?: AutoRoutePreviewEvidence
  label: string
  method?: SpaceRouteMethod
  methodLabel: string
  overview?: {
    actionLabel: string
    candidateSummary: string
    decisionReason?: string
    evidenceReason?: string
    matchedTerms: string[]
    scoreBreakdown?: string
    title: string
  }
  policyLabel: string
  recommendedKind?: RunRouteReceiptKind
  recommendedQuality?: RunRouteReceiptQuality
  selectedSpaceIds: string[]
  visible: boolean
}

const emptyRouteReceipt: RunRouteReceiptViewModel = {
  candidates: [],
  detail: 'This turn did not store an automatic routing trace.',
  label: 'Manual or legacy scope',
  methodLabel: 'manual scope',
  policyLabel: 'execution unchanged',
  selectedSpaceIds: [],
  visible: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function routeMethodValue(value: unknown): SpaceRouteMethod | null {
  if (
    value === 'all_low_safe_broadening'
    || value === 'dominant_cluster'
    || value === 'multi_space_cluster_match'
    || value === 'no_auto_route_spaces'
    || value === 'no_spaces'
  ) {
    return value
  }
  return null
}

function routeKindValue(value: unknown): RunRouteReceiptKind | undefined {
  return value === 'quick' || value === 'research' ? value : undefined
}

function routeQualityValue(value: unknown): RunRouteReceiptQuality | undefined {
  return value === 'deep' || value === 'fast' || value === 'quality' ? value : undefined
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function scoreComponents(value: unknown): AutoRoutePreviewScoreComponents | undefined {
  if (!isRecord(value)) return undefined
  return {
    cluster: numberValue(value.cluster),
    lexical: numberValue(value.lexical),
    metadata: numberValue(value.metadata),
    policy: numberValue(value.policy),
  }
}

function routeCandidate(value: unknown): AutoRoutePreviewCandidate | null {
  if (!isRecord(value)) return null
  const spaceName = stringValue(value.space_name)
  if (!spaceName) return null
  return {
    auto_route_eligible: value.auto_route_eligible !== false,
    matched_terms: stringArray(value.matched_terms),
    score: numberValue(value.score),
    score_contributions: scoreComponents(value.score_contributions),
    score_components: scoreComponents(value.score_components),
    selected_for_search: typeof value.selected_for_search === 'boolean' ? value.selected_for_search : undefined,
    space_id: stringValue(value.space_id) || undefined,
    space_name: spaceName,
  }
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function buildRunRouteReceiptViewModel(trace: unknown): RunRouteReceiptViewModel {
  if (!isRecord(trace) || !Object.keys(trace).length) return emptyRouteReceipt

  const selectedSpaceIds = stringArray(trace.selected_space_ids)
  const candidates = Array.isArray(trace.candidates)
    ? trace.candidates.map(routeCandidate).filter((item): item is AutoRoutePreviewCandidate => Boolean(item))
    : []
  if (!selectedSpaceIds.length && !candidates.length) return emptyRouteReceipt

  const topCandidate = candidates[0]
  const evidence = topCandidate ? buildAutoRouteEvidence(topCandidate) : undefined
  const routeMethod = routeMethodValue(trace.method)
  const recommendedKind = routeKindValue(trace.recommended_kind)
  const recommendedQuality = routeQualityValue(trace.recommended_quality)
  const recommendation = routeRecommendationLabel(recommendedKind, recommendedQuality)
  const selectionReason = stringValue(trace.selection_reason)
  const selectedLabel = selectedSpaceIds.length === 1 ? '1 routed Space' : `${selectedSpaceIds.length} routed Spaces`
  const topSummary = topCandidate ? `${topCandidate.space_name} led at ${formatScore(topCandidate.score)}` : selectedLabel
  const methodLabel = routeMethod ? routeMethodLabel(routeMethod) : 'Legacy routing trace'
  const selectedSpaceIdSet = new Set(selectedSpaceIds)
  const candidateViewModels = candidates.slice(0, 4).map((candidate) => ({
    matchedTerms: candidate.matched_terms ?? [],
    name: candidate.space_name,
    scopeLabel: candidate.selected_for_search != null || candidate.space_id || !candidate.auto_route_eligible
      ? candidateScopeLabel(candidate, selectedSpaceIdSet)
      : undefined,
    scoreLabel: formatScore(candidate.score),
  }))
  const candidateSummary = candidateViewModels
    .slice(0, 3)
    .map((candidate) => `${candidate.name} ${candidate.scoreLabel}${candidate.scopeLabel ? ` ${candidate.scopeLabel.toLowerCase()}` : ''}`)
    .join(' · ')

  return {
    candidates: candidateViewModels,
    decisionReason: selectionReason || undefined,
    detail: `${topSummary}.`,
    evidence,
    label: selectedLabel,
    method: routeMethod ?? undefined,
    methodLabel,
    overview: {
      actionLabel: 'Open evidence ledger',
      candidateSummary,
      decisionReason: selectionReason || undefined,
      evidenceReason: evidence?.reason,
      matchedTerms: evidence?.matchedTerms ?? [],
      scoreBreakdown: evidence?.scoreBreakdown,
      title: `${methodLabel} · ${selectedLabel}`,
    },
    policyLabel: recommendation,
    recommendedKind,
    recommendedQuality,
    selectedSpaceIds,
    visible: true,
  }
}
