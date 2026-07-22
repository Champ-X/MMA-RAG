import { describe, expect, it } from 'vitest'
import { buildRunRouteReceiptViewModel } from './runRouteReceiptViewModel'

describe('buildRunRouteReceiptViewModel', () => {
  it('hides the receipt for legacy runs without a routing trace', () => {
    expect(buildRunRouteReceiptViewModel({})).toMatchObject({
      visible: false,
      label: 'Manual or legacy scope',
    })
  })

  it('summarizes the stored route trace with evidence and candidate scores', () => {
    expect(buildRunRouteReceiptViewModel({
      candidates: [
        {
          auto_route_eligible: true,
          matched_terms: ['dog', 'puppy', 'white'],
          score: 0.293,
          score_contributions: { cluster: 0.143, lexical: 0.15, metadata: 0, policy: 0 },
          score_components: { cluster: 0.23, lexical: 0.75, metadata: 0, policy: 0 },
          selected_for_search: true,
          space_id: 'space-1',
          space_name: 'paper',
        },
        {
          auto_route_eligible: true,
          matched_terms: [],
          score: 0.039,
          score_components: { cluster: 0.064, lexical: 0, metadata: 0, policy: 0 },
          selected_for_search: false,
          space_id: 'space-2',
          space_name: 'landscape',
        },
      ],
      method: 'dominant_cluster',
      recommended_kind: 'quick',
      recommended_quality: 'quality',
      selection_reason: 'Top candidate leads by 25%, meeting the 22% dominant gap; the route is narrowed to one Space.',
      selected_space_ids: ['space-1'],
    })).toMatchObject({
      candidates: [
        { name: 'paper', scopeLabel: 'Selected for search', scoreLabel: '29%' },
        { name: 'landscape', scopeLabel: 'Reviewed only', scoreLabel: '4%' },
      ],
      decisionReason: 'Top candidate leads by 25%, meeting the 22% dominant gap; the route is narrowed to one Space.',
      detail: 'paper led at 29%.',
      evidence: {
        matchedTerms: ['dog', 'puppy', 'white'],
        reason: 'Matched dog, puppy, white in indexed Space evidence.',
        scoreBreakdown: 'score contribution: lexical 15% · cluster 14%',
      },
      label: '1 routed Space',
      method: 'dominant_cluster',
      methodLabel: 'Dominant portrait match',
      overview: {
        actionLabel: 'Open evidence ledger',
        candidateSummary: 'paper 29% selected for search · landscape 4% reviewed only',
        decisionReason: 'Top candidate leads by 25%, meeting the 22% dominant gap; the route is narrowed to one Space.',
        evidenceReason: 'Matched dog, puppy, white in indexed Space evidence.',
        matchedTerms: ['dog', 'puppy', 'white'],
        scoreBreakdown: 'score contribution: lexical 15% · cluster 14%',
        title: 'Dominant portrait match · 1 routed Space',
      },
      policyLabel: 'Quick run · quality retrieval',
      recommendedKind: 'quick',
      recommendedQuality: 'quality',
      selectedSpaceIds: ['space-1'],
      visible: true,
    })
  })

  it('keeps legacy traces visible when the method is unknown', () => {
    expect(buildRunRouteReceiptViewModel({
      candidates: [
        { auto_route_eligible: true, score: 0.12, space_name: 'Legacy' },
      ],
      method: 'old_router',
      recommended_kind: 'quick',
      recommended_quality: 'quality',
      selected_space_ids: ['space-1'],
    })).toMatchObject({
      label: '1 routed Space',
      methodLabel: 'Legacy routing trace',
      visible: true,
    })
  })

  it('formats partial execution recommendations without raw policy punctuation', () => {
    expect(buildRunRouteReceiptViewModel({
      candidates: [
        { auto_route_eligible: true, score: 0.18, space_name: 'Research' },
      ],
      recommended_kind: 'research',
      selected_space_ids: ['space-1'],
    })).toMatchObject({
      policyLabel: 'Research run',
    })

    expect(buildRunRouteReceiptViewModel({
      candidates: [
        { auto_route_eligible: true, score: 0.18, space_name: 'Fast' },
      ],
      recommended_quality: 'fast',
      selected_space_ids: ['space-1'],
    })).toMatchObject({
      policyLabel: 'fast retrieval',
    })
  })
})
