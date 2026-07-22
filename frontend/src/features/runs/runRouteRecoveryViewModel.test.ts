import { describe, expect, it } from 'vitest'
import { buildRunRouteReceiptViewModel } from './runRouteReceiptViewModel'
import {
  buildRunRouteAuditViewModel,
  buildRunRouteRecoveryRunRequest,
  buildRunRouteRecoveryViewModel,
} from './runRouteRecoveryViewModel'

describe('buildRunRouteAuditViewModel', () => {
  const storedReceipt = buildRunRouteReceiptViewModel({
    candidates: [
      { auto_route_eligible: true, score: 0.05, space_name: 'feishu' },
      { auto_route_eligible: true, score: 0.04, space_name: 'test' },
    ],
    method: 'all_low_safe_broadening',
    recommended_kind: 'quick',
    recommended_quality: 'deep',
    selected_space_ids: ['old-feishu', 'old-test'],
  })

  it('flags historical traces that the current router would change', () => {
    expect(buildRunRouteAuditViewModel({
      currentRoute: {
        candidates: [
          {
            auto_route_eligible: true,
            matched_terms: ['dog', 'puppy', 'white'],
            score: 0.293,
            score_contributions: { cluster: 0.143, lexical: 0.15, metadata: 0, policy: 0 },
            selected_for_search: true,
            space_id: 'new-paper',
            space_name: 'paper',
          },
          { auto_route_eligible: true, matched_terms: [], score: 0.039, selected_for_search: false, space_id: 'landscape', space_name: 'landscape' },
        ],
        method: 'dominant_cluster',
        recommended_kind: 'quick',
        recommended_quality: 'quality',
        selection_reason: 'Top candidate leads by 25%, meeting the 22% dominant gap; the route is narrowed to one Space.',
        selected_space_ids: ['new-paper'],
      },
      pending: false,
      storedReceipt,
    })).toMatchObject({
      candidateSummary: 'paper 29% selected for search · landscape 4% reviewed only',
      changeSummary: 'Changed: Space scope · routing method · execution depth.',
      decisionReason: 'Top candidate leads by 25%, meeting the 22% dominant gap; the route is narrowed to one Space.',
      detail: 'paper leads at 29% · 1 Space now selected.',
      evidence: {
        matchedTerms: ['dog', 'puppy', 'white'],
        scoreBreakdown: 'score contribution: lexical 15% · cluster 14%',
      },
      label: 'Current router changes this historical route',
      methodLabel: 'Dominant portrait match',
      role: 'status',
      tone: 'changed',
      visible: true,
    })
  })

  it('marks the audit aligned when the preserved scope still matches', () => {
    expect(buildRunRouteAuditViewModel({
      currentRoute: {
        candidates: [
          { auto_route_eligible: true, matched_terms: [], score: 0.05, space_name: 'feishu' },
        ],
        method: 'all_low_safe_broadening',
        recommended_kind: 'quick',
        recommended_quality: 'deep',
        selected_space_ids: ['old-test', 'old-feishu'],
      },
      pending: false,
      storedReceipt,
    })).toMatchObject({
      changeSummary: 'No route fingerprint changes detected.',
      label: 'Current router matches the preserved route',
      methodLabel: 'Low-confidence broadening',
      tone: 'aligned',
      visible: true,
    })
  })

  it('flags route recommendation drift even when the selected Spaces are unchanged', () => {
    expect(buildRunRouteAuditViewModel({
      currentRoute: {
        candidates: [
          { auto_route_eligible: true, matched_terms: [], score: 0.07, space_name: 'feishu' },
        ],
        method: 'multi_space_cluster_match',
        recommended_kind: 'research',
        recommended_quality: 'quality',
        selected_space_ids: ['old-test', 'old-feishu'],
      },
      pending: false,
      storedReceipt,
    })).toMatchObject({
      changeSummary: 'Changed: routing method · execution depth.',
      label: 'Current router changes this historical route',
      tone: 'changed',
      visible: true,
    })
  })
})

describe('buildRunRouteRecoveryViewModel', () => {
  it('offers a rerun action only when the current router changed the historical route', () => {
    expect(buildRunRouteRecoveryViewModel({
      audit: {
        detail: 'paper leads at 29% · 1 Space now selected.',
        label: 'Current router changes this historical route',
        role: 'status',
        tone: 'changed',
        visible: true,
      },
      currentRoute: {
        candidates: [{ auto_route_eligible: true, score: 0.293, space_name: 'paper' }],
        method: 'dominant_cluster',
        recommended_kind: 'quick',
        recommended_quality: 'quality',
        selected_space_ids: ['new-paper'],
      },
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      confirmation: {
        body: 'The preserved historical Run stays read-only. Nexus will start a new Run in the same conversation using the current router-selected Spaces, current route recommendation, and a fresh Evidence ledger.',
        confirmLabel: 'Start corrected Run',
        title: 'Rerun with current router?',
      },
      detail: 'Starts a new Run in this conversation using the current router-selected Spaces and recommended execution depth.',
      feedbackDetail: 'The old Run remains immutable; the next Run uses the current route recommendation.',
      feedbackTone: 'ready',
      label: 'Rerun with current router',
      role: 'status',
      visible: true,
    })
  })

  it('hides recovery when the current router is aligned with the preserved trace', () => {
    expect(buildRunRouteRecoveryViewModel({
      audit: {
        detail: 'feishu leads at 5% · 2 Spaces now selected.',
        label: 'Current router matches the preserved route',
        role: 'status',
        tone: 'aligned',
        visible: true,
      },
      pending: false,
    })).toMatchObject({
      canSubmit: false,
      visible: false,
    })
  })

  it('keeps recovery focusable but guarded while a corrected Run is starting', () => {
    expect(buildRunRouteRecoveryViewModel({
      audit: {
        detail: 'paper leads at 29% · 1 Space now selected.',
        label: 'Current router changes this historical route',
        role: 'status',
        tone: 'changed',
        visible: true,
      },
      currentRoute: {
        candidates: [],
        method: 'dominant_cluster',
        recommended_kind: 'quick',
        recommended_quality: 'quality',
        selected_space_ids: ['new-paper'],
      },
      pending: true,
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      feedbackTone: 'pending',
      label: 'Starting corrected Run...',
      visible: true,
    })
  })
})

describe('buildRunRouteRecoveryRunRequest', () => {
  it('builds a current-router authoritative rerun request', () => {
    expect(buildRunRouteRecoveryRunRequest({
      conversationId: 'conversation-1',
      currentRoute: {
        candidates: [{ auto_route_eligible: true, score: 0.293, space_name: 'paper' }],
        method: 'dominant_cluster',
        recommended_kind: 'quick',
        recommended_quality: 'quality',
        selected_space_ids: ['paper-space'],
      },
      goal: '找一下可爱小白狗',
      parentRunId: 'run-1',
      selectedModelDeploymentId: 'model-1',
    })).toEqual({
      auto_route: true,
      conversation_id: 'conversation-1',
      goal: '找一下可爱小白狗',
      kind: 'quick',
      parent_run_id: 'run-1',
      quality_mode: 'quality',
      scope: {
        source_ids: [],
        space_ids: ['paper-space'],
      },
      selected_model_deployment_id: 'model-1',
    })
  })

  it('does not build a rerun request before the current router has selected a Space', () => {
    expect(buildRunRouteRecoveryRunRequest({
      conversationId: 'conversation-1',
      currentRoute: null,
      goal: '找一下可爱小白狗',
      parentRunId: 'run-1',
    })).toBeNull()
  })
})
