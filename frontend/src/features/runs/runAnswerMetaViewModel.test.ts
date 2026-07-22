import { describe, expect, it } from 'vitest'
import { buildRunAnswerMetaViewModel } from './runAnswerMetaViewModel'

describe('buildRunAnswerMetaViewModel', () => {
  it('summarizes normal citations', () => {
    expect(buildRunAnswerMetaViewModel({
      citations: [
        { evidence_revision_id: 'evidence-1' },
        { evidence_revision_id: 'evidence-2' },
      ],
    })).toEqual({
      evidenceLabel: '2 citations',
    })
  })

  it('summarizes preserved recovery evidence when citations are absent', () => {
    expect(buildRunAnswerMetaViewModel({
      citations: [],
      recovery: {
        preserved_evidence_revision_ids: ['evidence-1'],
      },
    })).toEqual({
      evidenceLabel: '1 preserved Evidence item',
    })
  })

  it('combines citations and preserved evidence without hiding either source', () => {
    expect(buildRunAnswerMetaViewModel({
      citations: [{ evidence_revision_id: 'evidence-1' }],
      recovery: {
        preserved_evidence_revision_ids: ['evidence-2', 'evidence-3'],
      },
    })).toEqual({
      evidenceLabel: '1 citation · 2 preserved Evidence items',
    })
  })

  it('keeps empty runs explicit', () => {
    expect(buildRunAnswerMetaViewModel(null)).toEqual({
      evidenceLabel: 'No evidence linked yet',
    })
  })
})
