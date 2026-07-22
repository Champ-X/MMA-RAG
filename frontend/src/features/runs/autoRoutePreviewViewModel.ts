import type { SpaceRoute } from '@/api/nexus'

export type AutoRoutePreviewFeedbackTone = 'blocked' | 'error' | 'matched' | 'pending' | 'ready'
export type SpaceRouteMethod = SpaceRoute['method']
export type RouteCandidateScopeLabelCase = 'inline' | 'sentence'

export type AutoRoutePreviewScoreComponents = {
  cluster?: number
  lexical?: number
  metadata?: number
  policy?: number
}

export type AutoRoutePreviewCandidate = {
  auto_route_eligible: boolean
  matched_terms?: string[]
  score: number
  score_contributions?: AutoRoutePreviewScoreComponents
  score_components?: AutoRoutePreviewScoreComponents
  selected_for_search?: boolean
  space_id?: string
  space_name: string
}

export type AutoRoutePreviewResult = {
  candidates: AutoRoutePreviewCandidate[]
  method: SpaceRouteMethod
  recommended_kind: 'quick' | 'research'
  recommended_quality: 'deep' | 'fast' | 'quality'
  selection_reason?: string
  selected_space_ids: string[]
}

export type AutoRoutePreviewViewModelInput = {
  errorMessage?: string
  goal: string
  pending: boolean
  routing: AutoRoutePreviewResult | null
}

export type AutoRoutePreviewEvidence = {
  matchedTerms: string[]
  reason: string
  scoreBreakdown: string
}

export type AutoRoutePreviewViewModel = {
  ariaDisabled: boolean
  canPreview: boolean
  decision?: {
    label: string
    reason: string
  }
  detail: string
  disabledDetail?: string
  evidence?: AutoRoutePreviewEvidence
  label: string
  liveMode: 'assertive' | 'polite'
  previewLabel: string
  role: 'alert' | 'status'
  tone: AutoRoutePreviewFeedbackTone
}

const scoreComponentLabels: Array<[keyof AutoRoutePreviewScoreComponents, string]> = [
  ['lexical', 'lexical'],
  ['cluster', 'cluster'],
  ['metadata', 'metadata'],
  ['policy', 'policy'],
]

const routeMethodLabels = {
  all_low_safe_broadening: 'Low-confidence broadening',
  dominant_cluster: 'Dominant portrait match',
  multi_space_cluster_match: 'Multi-Space portrait match',
  no_auto_route_spaces: 'Manual-only Spaces',
  no_spaces: 'No Spaces available',
} satisfies Record<SpaceRouteMethod, string>

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function routeMethodLabel(method: SpaceRouteMethod): string {
  return routeMethodLabels[method]
}

function selectedSpaceLabel(count: number): string {
  return count === 1 ? '1 Space selected' : `${count} Spaces selected`
}

function routeKindLabel(value: AutoRoutePreviewResult['recommended_kind']) {
  return value === 'quick' ? 'Quick run' : 'Research run'
}

function routeQualityLabel(value: AutoRoutePreviewResult['recommended_quality']) {
  if (value === 'deep') return 'deep retrieval'
  if (value === 'fast') return 'fast retrieval'
  return 'quality retrieval'
}

export function routeRecommendationLabel(
  kind?: AutoRoutePreviewResult['recommended_kind'],
  quality?: AutoRoutePreviewResult['recommended_quality'],
) {
  if (kind && quality) return `${routeKindLabel(kind)} · ${routeQualityLabel(quality)}`
  if (kind) return routeKindLabel(kind)
  if (quality) return routeQualityLabel(quality)
  return 'execution unchanged'
}

function cleanMatchedTerm(term: string): string {
  return term.replace(/[<>]/g, '').trim().slice(0, 24)
}

function matchedTerms(candidate: AutoRoutePreviewCandidate): string[] {
  const terms = candidate.matched_terms ?? []
  const unique = new Set<string>()
  for (const term of terms) {
    const cleaned = cleanMatchedTerm(term)
    if (cleaned) unique.add(cleaned)
  }
  return [...unique].slice(0, 8)
}

function scoreSignals(candidate: AutoRoutePreviewCandidate): Array<{ key: keyof AutoRoutePreviewScoreComponents; label: string; value: number }> {
  const components = candidate.score_contributions ?? candidate.score_components ?? {}
  return scoreComponentLabels
    .map(([key, label]) => ({ key, label, value: components[key] ?? 0 }))
    .filter((item) => item.value > 0)
}

function candidateSelectedForSearch(candidate: AutoRoutePreviewCandidate, selectedSpaceIds: Set<string>): boolean {
  return candidate.selected_for_search ?? Boolean(candidate.space_id && selectedSpaceIds.has(candidate.space_id))
}

export function candidateScopeLabel(
  candidate: AutoRoutePreviewCandidate,
  selectedSpaceIds: Set<string>,
  labelCase: RouteCandidateScopeLabelCase = 'sentence',
): string {
  if (!candidate.auto_route_eligible) {
    return labelCase === 'inline' ? 'manual scope only' : 'Manual scope only'
  }
  const selected = candidateSelectedForSearch(candidate, selectedSpaceIds)
  if (selected) return labelCase === 'inline' ? 'selected for search' : 'Selected for search'
  return labelCase === 'inline' ? 'reviewed only' : 'Reviewed only'
}

function routeCandidateSummary(candidate: AutoRoutePreviewCandidate, selectedSpaceIds: Set<string>): string {
  const scopeLabel = candidateScopeLabel(candidate, selectedSpaceIds, 'inline')
  return `${candidate.space_name} ${(candidate.score * 100).toFixed(0)}% ${scopeLabel}`
}

export function buildAutoRouteEvidence(candidate: AutoRoutePreviewCandidate): AutoRoutePreviewEvidence {
  const terms = matchedTerms(candidate)
  const signals = scoreSignals(candidate)
  const scoreBreakdown = signals.length
    ? `${candidate.score_contributions ? 'score contribution' : 'signal strength'}: ${signals.map((item) => `${item.label} ${formatPercent(item.value)}`).join(' · ')}`
    : `route score ${formatPercent(candidate.score)}`
  if (terms.length) {
    return {
      matchedTerms: terms,
      reason: `Matched ${terms.slice(0, 4).join(', ')} in indexed Space evidence.`,
      scoreBreakdown,
    }
  }
  const strongestSignal = [...signals].sort((left, right) => right.value - left.value)[0]
  return {
    matchedTerms: [],
    reason: strongestSignal
      ? `${strongestSignal.label} is the strongest routing signal at ${formatPercent(strongestSignal.value)}.`
      : `Route score is ${formatPercent(candidate.score)}.`,
    scoreBreakdown,
  }
}

export function buildAutoRoutePreviewViewModel({
  errorMessage,
  goal,
  pending,
  routing,
}: AutoRoutePreviewViewModelInput): AutoRoutePreviewViewModel {
  const hasGoal = Boolean(goal.trim())

  if (pending) {
    return {
      ariaDisabled: true,
      canPreview: false,
      detail: 'Comparing the question against Space portraits and routing policy.',
      disabledDetail: 'Route preview is already comparing this question against Space portraits.',
      label: 'Previewing route',
      liveMode: 'polite',
      previewLabel: 'Previewing...',
      role: 'status',
      tone: 'pending',
    }
  }

  if (errorMessage) {
    return {
      ariaDisabled: !hasGoal,
      canPreview: hasGoal,
      detail: errorMessage,
      disabledDetail: hasGoal ? undefined : 'Enter a question before retrying route preview.',
      label: 'Route preview failed',
      liveMode: 'assertive',
      previewLabel: 'Try preview again',
      role: 'alert',
      tone: 'error',
    }
  }

  if (!hasGoal) {
    return {
      ariaDisabled: true,
      canPreview: false,
      detail: 'Enter a question first so the router can compare it against Space portraits.',
      disabledDetail: 'Enter a question first so the router can compare it against Space portraits.',
      label: 'Question required for preview',
      liveMode: 'polite',
      previewLabel: 'Preview & apply',
      role: 'status',
      tone: 'blocked',
    }
  }

  if (routing) {
    const topCandidate = routing.candidates[0]
    const evidence = topCandidate ? buildAutoRouteEvidence(topCandidate) : undefined
    const selectedSpaceIds = new Set(routing.selected_space_ids)
    const selectedLabel = selectedSpaceLabel(routing.selected_space_ids.length)
    if (!routing.selected_space_ids.length) {
      return {
        ariaDisabled: false,
        canPreview: true,
        decision: routing.selection_reason
          ? { label: routeMethodLabel(routing.method), reason: routing.selection_reason }
          : undefined,
        detail: 'Auto-route did not select a searchable Space for this question. Pin a Space manually or add searchable evidence before starting.',
        evidence,
        label: `${selectedLabel} · ${routeMethodLabel(routing.method)}`,
        liveMode: 'polite',
        previewLabel: 'Preview again',
        role: 'status',
        tone: 'blocked',
      }
    }
    const candidateCount = routing.candidates.length
    const scopeDetail = candidateCount > routing.selected_space_ids.length
      ? `${selectedLabel} for search · ${candidateCount} candidates reviewed`
      : `${selectedLabel} for search`
    const topCandidates = routing.candidates
      .slice(0, 3)
      .map((item) => routeCandidateSummary(item, selectedSpaceIds))
      .join(' · ')
    return {
      ariaDisabled: false,
      canPreview: true,
      decision: routing.selection_reason
        ? { label: routeMethodLabel(routing.method), reason: routing.selection_reason }
        : undefined,
      detail: `${scopeDetail}: ${topCandidates || 'No candidate evidence yet'} · recommends ${routeRecommendationLabel(routing.recommended_kind, routing.recommended_quality)}.`,
      evidence,
      label: `${selectedLabel} · ${routeMethodLabel(routing.method)}`,
      liveMode: 'polite',
      previewLabel: 'Preview again',
      role: 'status',
      tone: 'matched',
    }
  }

  return {
    ariaDisabled: false,
    canPreview: true,
    detail: 'Preview before starting to apply routing policy recommendations to execution depth.',
    label: 'Portrait router is ready',
    liveMode: 'polite',
    previewLabel: 'Preview & apply',
    role: 'status',
    tone: 'ready',
  }
}
