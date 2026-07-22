import { describe, expect, it } from 'vitest'
import type { Artifact } from '@/api/nexus'
import { filterArtifacts, parseStudioFilter, presentArtifactCard, summarizeArtifacts } from './studioViewModel'

function stubArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    artifact_type: 'research_report',
    canonical_document: {},
    coverage: {
      bound_evidence_count: 3,
      content_block_count: 3,
      coverage_percent: 100,
      supported_block_count: 3,
      user_block_count: 0,
    },
    created_at: '2026-07-21T00:00:00Z',
    evidence_revision_ids: ['e1', 'e2', 'e3'],
    id: 'artifact-a',
    pending_refresh_count: 0,
    revision_id: 'revision-a',
    revision_no: 1,
    run_id: 'run-a',
    status: 'candidate',
    title: 'Market report',
    updated_at: '2026-07-21T00:00:00Z',
    ...overrides,
  } as Artifact
}

describe('Artifact Studio view model', () => {
  it('parses shareable filter params defensively', () => {
    expect(parseStudioFilter('published')).toBe('published')
    expect(parseStudioFilter('attention')).toBe('attention')
    expect(parseStudioFilter('legacy')).toBe('all')
    expect(parseStudioFilter(null)).toBe('all')
  })

  it('summarizes publication readiness across artifacts', () => {
    const summary = summarizeArtifacts([
      stubArtifact(),
      stubArtifact({ id: 'artifact-b', status: 'published' }),
      stubArtifact({
        id: 'artifact-c',
        coverage: {
          bound_evidence_count: 0,
          content_block_count: 2,
          coverage_percent: 0,
          supported_block_count: 0,
          user_block_count: 0,
        },
      }),
    ])

    expect(summary).toEqual({
      attentionCount: 1,
      averageCoverage: 67,
      candidateCount: 2,
      publishableCount: 2,
      publishedCount: 1,
      total: 3,
    })
  })

  it('filters by query and attention gate', () => {
    const blocked = stubArtifact({
      id: 'artifact-b',
      title: 'Launch brief',
      pending_refresh_count: 1,
    })
    expect(filterArtifacts([stubArtifact(), blocked], 'launch', 'all')).toEqual([blocked])
    expect(filterArtifacts([stubArtifact(), blocked], '', 'attention')).toEqual([blocked])
    expect(presentArtifactCard(blocked)).toMatchObject({
      gateLabel: 'Publication gate blocked',
      readinessTone: 'negative',
    })
  })
})
