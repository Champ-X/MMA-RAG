import { describe, expect, it } from 'vitest'
import {
  conversationEvidenceIds,
  runCitations,
  runEvidenceIds,
} from './runEvidenceBindingsViewModel'

describe('runEvidenceBindingsViewModel', () => {
  it('extracts citations from a Run result', () => {
    expect(runCitations({
      result: {
        citations: [
          { evidence_revision_id: 'evidence-1', source_name: 'Briefing' },
        ],
      },
    })).toEqual([
      { evidence_revision_id: 'evidence-1', source_name: 'Briefing' },
    ])
  })

  it('merges citations with preserved recovery evidence ids', () => {
    expect(runEvidenceIds({
      result: {
        citations: [
          { evidence_revision_id: 'evidence-1' },
          { evidence_revision_id: 'evidence-2' },
        ],
        recovery: {
          preserved_evidence_revision_ids: ['evidence-2', 'evidence-3'],
        },
      },
    })).toEqual(['evidence-1', 'evidence-2', 'evidence-3'])
  })

  it('deduplicates evidence ids across conversation turns', () => {
    expect(conversationEvidenceIds([
      {
        result: {
          citations: [{ evidence_revision_id: 'evidence-1' }],
        },
      },
      {
        result: {
          recovery: {
            preserved_evidence_revision_ids: ['evidence-1', 'evidence-2'],
          },
        },
      },
    ])).toEqual(['evidence-1', 'evidence-2'])
  })

  it('stays empty when no result exists', () => {
    expect(runEvidenceIds({ result: null })).toEqual([])
  })
})
