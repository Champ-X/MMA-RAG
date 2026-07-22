import { describe, expect, it } from 'vitest'
import { buildAutoRoutePreviewViewModel } from './autoRoutePreviewViewModel'

const baseInput = {
  errorMessage: undefined,
  goal: 'Compare launch risks.',
  pending: false,
  routing: null,
}

describe('buildAutoRoutePreviewViewModel', () => {
  it('blocks preview until a question exists', () => {
    expect(buildAutoRoutePreviewViewModel({ ...baseInput, goal: '   ' })).toMatchObject({
      ariaDisabled: true,
      canPreview: false,
      detail: 'Enter a question first so the router can compare it against Space portraits.',
      disabledDetail: 'Enter a question first so the router can compare it against Space portraits.',
      label: 'Question required for preview',
      tone: 'blocked',
    })
  })

  it('shows ready preview guidance', () => {
    expect(buildAutoRoutePreviewViewModel(baseInput)).toMatchObject({
      ariaDisabled: false,
      canPreview: true,
      detail: 'Preview before starting to apply routing policy recommendations to execution depth.',
      label: 'Portrait router is ready',
      previewLabel: 'Preview & apply',
      tone: 'ready',
    })
  })

  it('surfaces pending preview state', () => {
    expect(buildAutoRoutePreviewViewModel({ ...baseInput, pending: true })).toMatchObject({
      ariaDisabled: true,
      canPreview: false,
      detail: 'Comparing the question against Space portraits and routing policy.',
      disabledDetail: 'Route preview is already comparing this question against Space portraits.',
      label: 'Previewing route',
      previewLabel: 'Previewing...',
      tone: 'pending',
    })
  })

  it('keeps retry available after preview fails when a goal exists', () => {
    expect(buildAutoRoutePreviewViewModel({
      ...baseInput,
      errorMessage: 'Router service unavailable.',
    })).toMatchObject({
      ariaDisabled: false,
      canPreview: true,
      detail: 'Router service unavailable.',
      label: 'Route preview failed',
      role: 'alert',
      tone: 'error',
    })
  })

  it('summarizes matched Spaces and recommendation', () => {
    expect(buildAutoRoutePreviewViewModel({
      ...baseInput,
      routing: {
        candidates: [
          { auto_route_eligible: true, score: 0.82, selected_for_search: true, space_id: 'space-1', space_name: 'Launch' },
          { auto_route_eligible: true, score: 0.47, selected_for_search: true, space_id: 'space-2', space_name: 'Docs' },
          { auto_route_eligible: false, score: 0.12, selected_for_search: false, space_id: 'archive', space_name: 'Archive' },
        ],
        method: 'multi_space_cluster_match',
        recommended_kind: 'research',
        recommended_quality: 'deep',
        selection_reason: 'Top candidate leads by 10%, below the 22% dominant gap; the highest-ranked Spaces scoring at least 58% of the leader remain in scope, capped at 2.',
        selected_space_ids: ['space-1', 'space-2'],
      },
    })).toMatchObject({
      ariaDisabled: false,
      canPreview: true,
      decision: {
        label: 'Multi-Space portrait match',
        reason: 'Top candidate leads by 10%, below the 22% dominant gap; the highest-ranked Spaces scoring at least 58% of the leader remain in scope, capped at 2.',
      },
      detail: '2 Spaces selected for search · 3 candidates reviewed: Launch 82% selected for search · Docs 47% selected for search · Archive 12% manual scope only · recommends Research run · deep retrieval.',
      evidence: {
        matchedTerms: [],
        reason: 'Route score is 82%.',
        scoreBreakdown: 'route score 82%',
      },
      label: '2 Spaces selected · Multi-Space portrait match',
      previewLabel: 'Preview again',
      tone: 'matched',
    })
  })

  it('blocks route application when auto-route cannot select a searchable Space', () => {
    expect(buildAutoRoutePreviewViewModel({
      ...baseInput,
      routing: {
        candidates: [
          { auto_route_eligible: false, score: 0, space_id: 'archive', space_name: 'Archive' },
        ],
        method: 'no_auto_route_spaces',
        recommended_kind: 'quick',
        recommended_quality: 'fast',
        selection_reason: 'All available Spaces are manual-scope only; choose an explicit Space to search them.',
        selected_space_ids: [],
      },
    })).toMatchObject({
      ariaDisabled: false,
      canPreview: true,
      decision: {
        label: 'Manual-only Spaces',
        reason: 'All available Spaces are manual-scope only; choose an explicit Space to search them.',
      },
      detail: 'Auto-route did not select a searchable Space for this question. Pin a Space manually or add searchable evidence before starting.',
      label: '0 Spaces selected · Manual-only Spaces',
      previewLabel: 'Preview again',
      tone: 'blocked',
    })
  })

  it('explains matched route terms and score components', () => {
    expect(buildAutoRoutePreviewViewModel({
      ...baseInput,
      routing: {
        candidates: [
          {
            auto_route_eligible: true,
            matched_terms: ['dog', 'puppy', 'white', '<script>'],
            score: 0.293,
            score_contributions: { cluster: 0.143, lexical: 0.15, metadata: 0, policy: 0 },
            score_components: { cluster: 0.23, lexical: 0.75, metadata: 0, policy: 0 },
            space_id: 'space-1',
            space_name: 'paper',
          },
        ],
        method: 'dominant_cluster',
        recommended_kind: 'quick',
        recommended_quality: 'quality',
        selection_reason: 'Top candidate leads by 25%, meeting the 22% dominant gap; the route is narrowed to one Space.',
        selected_space_ids: ['space-1'],
      },
    })).toMatchObject({
      decision: {
        label: 'Dominant portrait match',
        reason: 'Top candidate leads by 25%, meeting the 22% dominant gap; the route is narrowed to one Space.',
      },
      detail: '1 Space selected for search: paper 29% selected for search · recommends Quick run · quality retrieval.',
      evidence: {
        matchedTerms: ['dog', 'puppy', 'white', 'script'],
        reason: 'Matched dog, puppy, white, script in indexed Space evidence.',
        scoreBreakdown: 'score contribution: lexical 15% · cluster 14%',
      },
      label: '1 Space selected · Dominant portrait match',
    })
  })

  it('formats execution recommendations without raw policy punctuation', () => {
    const preview = buildAutoRoutePreviewViewModel({
      ...baseInput,
      routing: {
        candidates: [{ auto_route_eligible: true, score: 0.6, space_name: 'Briefing' }],
        method: 'dominant_cluster',
        recommended_kind: 'research',
        recommended_quality: 'fast',
        selected_space_ids: ['space-1'],
      },
    })

    expect(preview.detail).toContain('Research run · fast retrieval')
    expect(preview.detail).not.toContain('research / fast')
  })

  it('keeps manual-only candidates from duplicating scope labels', () => {
    const preview = buildAutoRoutePreviewViewModel({
      ...baseInput,
      routing: {
        candidates: [
          { auto_route_eligible: false, score: 0.12, selected_for_search: false, space_name: 'Archive' },
        ],
        method: 'all_low_safe_broadening',
        recommended_kind: 'quick',
        recommended_quality: 'fast',
        selected_space_ids: ['space-1'],
      },
    })

    expect(preview.detail).toContain('Archive 12% manual scope only')
    expect(preview.detail).not.toContain('candidate only manual only')
  })
})
