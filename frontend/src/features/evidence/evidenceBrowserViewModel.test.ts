import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/nexus'
import { buildEvidenceBrowserSummary, parseEvidenceBrowserModality } from './evidenceBrowserViewModel'

function stubEvidence(
  id: string,
  modality: Evidence['modality'],
  sourceId = 'source-a',
  qualityFlags: string[] = [],
): Evidence {
  return {
    id,
    source_id: sourceId,
    modality,
    quality_flags: qualityFlags,
  } as Evidence
}

describe('Evidence browser view model', () => {
  it('falls back to the full evidence lens for unknown modality params', () => {
    expect(parseEvidenceBrowserModality('spreadsheet')).toBe('all')
    expect(parseEvidenceBrowserModality(null)).toBe('all')
    expect(parseEvidenceBrowserModality('image')).toBe('image')
  })

  it('summarizes the active lens without leaking UI calculations into the page', () => {
    const summary = buildEvidenceBrowserSummary({
      loadedItems: [
        stubEvidence('one', 'image', 'source-a', ['caption_unavailable']),
        stubEvidence('two', 'image', 'source-b'),
      ],
      query: '  cat  ',
      scopeHasMore: true,
      scopeItems: [
        stubEvidence('one', 'image'),
        stubEvidence('two', 'image'),
        stubEvidence('three', 'text'),
      ],
      selectedModality: 'image',
      sourceId: 'source-a',
      spaceId: 'space-a',
    })

    expect(summary).toMatchObject({
      activeFilters: ['Image', '"cat"', 'Single source'],
      currentModalityLabel: 'Image',
      flaggedCount: 1,
      scopeCountLabel: '3+',
      scopeTitle: 'Source-scoped evidence',
      sourceCount: 2,
    })
    expect(summary.modalityCounts).toMatchObject({
      all: 3,
      image: 2,
      text: 1,
      audio: 0,
      video: 0,
      table: 0,
    })
  })
})
