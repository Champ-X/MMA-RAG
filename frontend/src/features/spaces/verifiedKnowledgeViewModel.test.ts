import { describe, expect, it } from 'vitest'
import type { SpaceKnowledgeClaim } from '@/api/nexus'
import { parseKnowledgeFilter, presentClaim, summarizeVerifiedKnowledge } from './verifiedKnowledgeViewModel'

function stubClaim(overrides: Partial<SpaceKnowledgeClaim> = {}): SpaceKnowledgeClaim {
  return {
    claim_type: 'fact',
    created_at: '2026-07-21T00:00:00Z',
    evidence: [{
      evidence_revision_id: 'evidence-a',
      evidence_type: 'markdown_section',
      locator_type: 'char_range',
      modality: 'text',
      relation: 'supports',
      source_name: 'alpha.md',
      support_score: 0.84,
    }],
    explanation: 'Supported by one source.',
    id: 'claim-a',
    run_id: 'run-a',
    status: 'supported',
    text: 'The policy is active.',
    verification_level: 'T2',
    ...overrides,
  } as SpaceKnowledgeClaim
}

describe('Verified knowledge view model', () => {
  it('parses shareable filter params defensively', () => {
    expect(parseKnowledgeFilter('supported')).toBe('supported')
    expect(parseKnowledgeFilter('attention')).toBe('attention')
    expect(parseKnowledgeFilter('legacy')).toBe('all')
    expect(parseKnowledgeFilter(null)).toBe('all')
  })

  it('summarizes loaded claims and distinct sources', () => {
    const summary = summarizeVerifiedKnowledge([
      stubClaim(),
      stubClaim({
        evidence: [{
          evidence_revision_id: 'evidence-b',
          evidence_type: 'markdown_section',
          locator_type: 'char_range',
          modality: 'text',
          relation: 'supports',
          source_name: 'beta.md',
          support_score: 0.7,
        }],
        id: 'claim-b',
        status: 'conflicted',
      }),
    ], true)

    expect(summary).toEqual({
      attention: 1,
      claimsLoadedLabel: '2+',
      sourceCount: 2,
      supported: 1,
      total: 2,
    })
  })

  it('surfaces risk labels for claims that need review', () => {
    expect(presentClaim(stubClaim()).riskLabel).toBe('Ready to reuse with citations')
    expect(presentClaim(stubClaim({ status: 'conflicted' }))).toMatchObject({
      label: 'Conflicting evidence',
      riskLabel: 'Evidence disagrees',
      tone: 'attention',
    })
    expect(presentClaim(stubClaim({ evidence: [], status: 'stale' })).highestSupport).toBe(0)
  })
})
