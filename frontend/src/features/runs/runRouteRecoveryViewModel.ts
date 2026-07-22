import {
  buildAutoRouteEvidence,
  candidateScopeLabel,
  routeMethodLabel,
  type AutoRoutePreviewEvidence,
  type AutoRoutePreviewResult,
} from './autoRoutePreviewViewModel'
import type { RunRouteReceiptViewModel } from './runRouteReceiptViewModel'

export type RunRouteAuditTone = 'aligned' | 'changed' | 'checking' | 'error'

export type RunRouteAuditViewModel = {
  candidateSummary?: string
  changeSummary?: string
  decisionReason?: string
  detail: string
  evidence?: AutoRoutePreviewEvidence
  label: string
  methodLabel?: string
  role: 'alert' | 'status'
  tone: RunRouteAuditTone
  visible: boolean
}

export type RunRouteAuditViewModelInput = {
  currentRoute?: AutoRoutePreviewResult | null
  errorMessage?: string
  pending: boolean
  storedReceipt: RunRouteReceiptViewModel
}

export type RunRouteRecoveryViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  confirmation?: {
    body: string
    confirmLabel: string
    title: string
  }
  detail: string
  feedbackDetail: string
  feedbackTone: 'error' | 'pending' | 'ready'
  label: string
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

export type RunRouteRecoveryViewModelInput = {
  audit: RunRouteAuditViewModel
  currentRoute?: AutoRoutePreviewResult | null
  errorMessage?: string
  pending: boolean
}

export type RunRouteRecoveryRunRequest = {
  auto_route: true
  conversation_id: string
  goal: string
  kind: AutoRoutePreviewResult['recommended_kind']
  parent_run_id: string
  quality_mode: AutoRoutePreviewResult['recommended_quality']
  scope: {
    source_ids: string[]
    space_ids: string[]
  }
  selected_model_deployment_id?: string
}

export type RunRouteRecoveryRunRequestInput = {
  conversationId: string
  currentRoute?: AutoRoutePreviewResult | null
  goal: string
  parentRunId: string
  selectedModelDeploymentId?: string
}

function formatScore(value: number): string {
  return `${Math.round(value * 100)}%`
}

function sameSpaceSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((value, index) => value === rightSorted[index])
}

function currentCandidateSummary(candidate: AutoRoutePreviewResult['candidates'][number], selectedSpaceIds: Set<string>): string {
  const scopeLabel = candidate.selected_for_search != null || candidate.space_id || !candidate.auto_route_eligible
    ? ` ${candidateScopeLabel(candidate, selectedSpaceIds, 'inline')}`
    : ''
  return `${candidate.space_name} ${formatScore(candidate.score)}${scopeLabel}`
}

function routeFingerprintChanges(storedReceipt: RunRouteReceiptViewModel, currentRoute: AutoRoutePreviewResult): string[] {
  const changes: string[] = []
  if (!sameSpaceSet(storedReceipt.selectedSpaceIds, currentRoute.selected_space_ids)) {
    changes.push('Space scope')
  }
  if (storedReceipt.method && storedReceipt.method !== currentRoute.method) {
    changes.push('routing method')
  }
  if (
    (storedReceipt.recommendedKind && storedReceipt.recommendedKind !== currentRoute.recommended_kind)
    || (storedReceipt.recommendedQuality && storedReceipt.recommendedQuality !== currentRoute.recommended_quality)
  ) {
    changes.push('execution depth')
  }
  return changes
}

function routeRecoveryConfirmation() {
  return {
    body: 'The preserved historical Run stays read-only. Nexus will start a new Run in the same conversation using the current router-selected Spaces, current route recommendation, and a fresh Evidence ledger.',
    confirmLabel: 'Start corrected Run',
    title: 'Rerun with current router?',
  }
}

export function buildRunRouteAuditViewModel({
  currentRoute,
  errorMessage,
  pending,
  storedReceipt,
}: RunRouteAuditViewModelInput): RunRouteAuditViewModel {
  if (!storedReceipt.visible) {
    return {
      detail: 'No preserved automatic routing trace exists for this turn.',
      label: 'No route audit available',
      role: 'status',
      tone: 'aligned',
      visible: false,
    }
  }

  if (pending) {
    return {
      detail: 'Replaying this question against the current Space routing policy.',
      label: 'Checking current router',
      role: 'status',
      tone: 'checking',
      visible: true,
    }
  }

  if (errorMessage) {
    return {
      detail: errorMessage,
      label: 'Current router audit failed',
      role: 'alert',
      tone: 'error',
      visible: true,
    }
  }

  if (!currentRoute) {
    return {
      detail: 'Current routing has not been replayed yet.',
      label: 'Current router audit waiting',
      role: 'status',
      tone: 'checking',
      visible: false,
    }
  }

  const changes = routeFingerprintChanges(storedReceipt, currentRoute)
  const changed = changes.length > 0
  const topCandidate = currentRoute.candidates[0]
  const evidence = topCandidate ? buildAutoRouteEvidence(topCandidate) : undefined
  const selectedSpaceIds = new Set(currentRoute.selected_space_ids)
  const candidateSummary = currentRoute.candidates
    .slice(0, 3)
    .map((candidate) => currentCandidateSummary(candidate, selectedSpaceIds))
    .join(' · ')
  const selectedCount = currentRoute.selected_space_ids.length
  const selectedLabel = selectedCount === 1 ? '1 Space now selected' : `${selectedCount} Spaces now selected`
  const topSummary = topCandidate ? `${topCandidate.space_name} leads at ${formatScore(topCandidate.score)}` : selectedLabel
  const changeSummary = changed ? `Changed: ${changes.join(' · ')}.` : 'No route fingerprint changes detected.'

  return {
    candidateSummary,
    changeSummary,
    decisionReason: currentRoute.selection_reason,
    detail: `${topSummary} · ${selectedLabel}.`,
    evidence,
    label: changed ? 'Current router changes this historical route' : 'Current router matches the preserved route',
    methodLabel: routeMethodLabel(currentRoute.method),
    role: 'status',
    tone: changed ? 'changed' : 'aligned',
    visible: true,
  }
}

export function buildRunRouteRecoveryViewModel({
  audit,
  currentRoute,
  errorMessage,
  pending,
}: RunRouteRecoveryViewModelInput): RunRouteRecoveryViewModel {
  const canRecover = audit.visible && audit.tone === 'changed' && Boolean(currentRoute?.selected_space_ids.length)

  if (!audit.visible || audit.tone !== 'changed') {
    return {
      ariaDisabled: true,
      canSubmit: false,
      detail: 'Recovery is only offered when the current router would change the preserved scope.',
      feedbackDetail: 'The preserved route is aligned with the current router, or the audit has not produced a changed scope.',
      feedbackTone: 'ready',
      label: 'Rerun with current router',
      liveMode: 'polite',
      role: 'status',
      visible: false,
    }
  }

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      confirmation: canRecover ? routeRecoveryConfirmation() : undefined,
      detail: 'Starting a new Run with the current router-selected Spaces.',
      feedbackDetail: 'The historical result stays unchanged while a new evidence-bound Run is created.',
      feedbackTone: 'pending',
      label: 'Starting corrected Run...',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorMessage) {
    return {
      ariaDisabled: !canRecover,
      canSubmit: canRecover,
      confirmation: canRecover ? routeRecoveryConfirmation() : undefined,
      detail: 'Retry creating a new Run with the current router-selected Spaces.',
      feedbackDetail: errorMessage,
      feedbackTone: 'error',
      label: 'Try rerun again',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  return {
    ariaDisabled: !canRecover,
    canSubmit: canRecover,
    confirmation: canRecover ? routeRecoveryConfirmation() : undefined,
    detail: canRecover
      ? 'Starts a new Run in this conversation using the current router-selected Spaces and recommended execution depth.'
      : 'Current router audit did not return a recoverable selected Space.',
    feedbackDetail: canRecover
      ? 'The old Run remains immutable; the next Run uses the current route recommendation.'
      : 'Wait for the current router audit to finish before rerunning.',
    feedbackTone: 'ready',
    label: 'Rerun with current router',
    liveMode: 'polite',
    role: 'status',
    visible: true,
  }
}

export function buildRunRouteRecoveryRunRequest({
  conversationId,
  currentRoute,
  goal,
  parentRunId,
  selectedModelDeploymentId,
}: RunRouteRecoveryRunRequestInput): RunRouteRecoveryRunRequest | null {
  if (!goal.trim() || !conversationId || !parentRunId || !currentRoute?.selected_space_ids.length) {
    return null
  }

  return {
    auto_route: true,
    conversation_id: conversationId,
    goal,
    kind: currentRoute.recommended_kind,
    parent_run_id: parentRunId,
    quality_mode: currentRoute.recommended_quality,
    scope: {
      source_ids: [],
      space_ids: currentRoute.selected_space_ids,
    },
    selected_model_deployment_id: selectedModelDeploymentId || undefined,
  }
}
