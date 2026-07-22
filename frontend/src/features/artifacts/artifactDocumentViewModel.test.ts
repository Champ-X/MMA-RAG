import { describe, expect, it } from 'vitest'
import {
  buildArtifactEvidenceBindingStrip,
  buildArtifactEvidenceRegister,
  buildArtifactInlineCitationText,
} from './artifactDocumentViewModel'

describe('Artifact document evidence register', () => {
  it('summarizes text ranges without exposing raw locator JSON', () => {
    const register = buildArtifactEvidenceRegister([{
      evidence_revision_id: '019f7e45-42a7-777e-9a7a-b348139f6c41',
      locator: {
        locator_type: 'text_range',
        char_start: 23575,
        char_end: 24260,
        extra: { filename: 'architecture.md' },
      },
    }])

    expect(register.boundCount).toBe(1)
    expect(register.items[0]).toMatchObject({
      locatorDetail: 'Characters 23575-24260',
      locatorLabel: 'Text span',
      shortRevisionId: '019f7e45',
      sourceLabel: 'architecture.md',
    })
    expect(register.items[0].ariaLabel).toContain('Evidence 019f7e45')
  })

  it('formats visual page regions and media ranges as human-readable receipts', () => {
    const register = buildArtifactEvidenceRegister([
      {
        evidence_revision_id: 'visual-a',
        source: 'paper.pdf',
        locator: { locator_type: 'page_region', page_no: 5, bbox: [121, 83, 878, 414] },
      },
      {
        evidence_revision_id: 'audio-a',
        source: 'meeting.wav',
        locator: { locator_type: 'time_range', start_ms: 0, end_ms: 4378 },
      },
    ])

    expect(register.items.map((item) => [item.locatorLabel, item.locatorDetail])).toEqual([
      ['Page region', 'Page 5 · Bounding box 121, 83, 878, 414'],
      ['Media segment', '0s-4.4s'],
    ])
  })

  it('keeps table cells and unbound references explicit', () => {
    const register = buildArtifactEvidenceRegister([
      {
        evidence_revision_id: 'table-a',
        source: 'metrics.csv',
        locator: { locator_type: 'cell_range', sheet: 'CSV', cell_range: 'A1:B2' },
      },
      { source: 'Generated source evidence' },
    ])

    expect(register.unboundCount).toBe(1)
    expect(register.items[0]).toMatchObject({ locatorLabel: 'Table cells', locatorDetail: 'CSV · A1:B2' })
    expect(register.items[1]).toMatchObject({ bound: false, shortRevisionId: 'unbound' })
  })

  it('deduplicates repeated evidence revisions and keeps the richer locator', () => {
    const register = buildArtifactEvidenceRegister([
      { evidence_revision_id: 'duplicate-a', source: 'Updated source evidence' },
      {
        evidence_revision_id: 'duplicate-a',
        source: 'brief.pdf',
        locator: { locator_type: 'page_region', page_no: 2, bbox: [1, 2, 3, 4] },
      },
    ])

    expect(register.boundCount).toBe(1)
    expect(register.summary).toBe('1 unique source receipt preserves exact locator context for audit.')
    expect(register.items).toHaveLength(1)
    expect(register.items[0]).toMatchObject({
      locatorDetail: 'Page 2 · Bounding box 1, 2, 3, 4',
      sourceLabel: 'brief.pdf',
    })
  })

  it('progressively discloses long receipt registers', () => {
    const items = Array.from({ length: 14 }, (_, index) => ({
      evidence_revision_id: `evidence-${index}`,
      source: `source-${index}.md`,
      locator: { locator_type: 'text_range', char_start: index * 10, char_end: index * 10 + 5 },
    }))

    const register = buildArtifactEvidenceRegister(items)

    expect(register.boundCount).toBe(14)
    expect(register.visibleCount).toBe(12)
    expect(register.hiddenCount).toBe(2)
    expect(new Set(register.items.map((item) => item.shortRevisionId)).size).toBe(14)
    expect(register.visibleItems[0].shortRevisionId).toBe('evidence/0')
    expect(register.archivedItems).toHaveLength(2)
    expect(register.archiveSummary).toBe('2 additional receipts are archived behind this review fold.')
  })

  it('deduplicates and folds long inline evidence binding strips', () => {
    const strip = buildArtifactEvidenceBindingStrip([
      'aaaaaaaa-0001',
      'aaaaaaaa-0001',
      'bbbbbbbb-0002',
      'cccccccc-0003',
    ], 2)

    expect(strip.items.map((item) => item.id)).toEqual(['aaaaaaaa-0001', 'bbbbbbbb-0002', 'cccccccc-0003'])
    expect(strip.visibleItems.map((item) => item.label)).toEqual(['Evidence aaaaaaaa', 'Evidence bbbbbbbb'])
    expect(strip.hiddenCount).toBe(1)
    expect(strip.archivedItems[0]).toMatchObject({ id: 'cccccccc-0003', shortId: 'cccccccc' })
  })

  it('adds a disambiguating tail when evidence revision prefixes collide', () => {
    const strip = buildArtifactEvidenceBindingStrip([
      '019f7e45-42a7-777e-9a7a-b348139f6c41',
      '019f7e45-42a7-777e-9a7a-b348139f6c99',
      '019f7bdb-1111-2222-3333-aabbccddeeff',
    ])

    expect(strip.items.map((item) => item.label)).toEqual([
      'Evidence 019f7e45/6c41',
      'Evidence 019f7e45/6c99',
      'Evidence 019f7bdb',
    ])
    expect(new Set(strip.items.map((item) => item.ariaLabel)).size).toBe(3)
  })

  it('keeps source receipt revision badges distinct when UUIDv7 prefixes repeat', () => {
    const register = buildArtifactEvidenceRegister([
      {
        evidence_revision_id: '019f7e45-42a7-777e-9a7a-b348139f6c41',
        source: 'architecture.md',
      },
      {
        evidence_revision_id: '019f7e45-42a7-777e-9a7a-b348139f6c99',
        source: 'architecture.md',
      },
    ])

    expect(register.items.map((item) => item.shortRevisionId)).toEqual([
      '019f7e45/6c41',
      '019f7e45/6c99',
    ])
    expect(register.items[0].ariaLabel).toContain('Evidence 019f7e45/6c41')
    expect(register.items[1].ariaLabel).toContain('Evidence 019f7e45/6c99')
  })

  it('converts raw evidence markers into readable inline citation links', () => {
    const firstId = '019f7e45-42a7-777e-9a7a-b348139f6c41'
    const secondId = '019f7e45-4278-7c9c-9125-9d4182f72cd8'
    const citationText = buildArtifactInlineCitationText(
      `Grounded claim[evidence:${secondId}] and repeated claim[evidence:${firstId}][evidence:${secondId}].`,
      [firstId, secondId],
    )

    expect(citationText.rawMarkerCount).toBe(3)
    expect(citationText.markdown).not.toContain('[evidence:')
    expect(citationText.markdown).toContain(`[E1](#artifact-evidence-${secondId})`)
    expect(citationText.markdown).toContain(`[E2](#artifact-evidence-${firstId})`)
    expect(citationText.references.map((reference) => reference.label)).toEqual(['E1', 'E2'])
    expect(citationText.references.map((reference) => reference.evidenceRevisionId)).toEqual([secondId, firstId])
  })

  it('keeps inline citation aria labels distinct when evidence prefixes collide', () => {
    const firstId = '019f7e45-42a7-777e-9a7a-b348139f6c41'
    const secondId = '019f7e45-42a7-777e-9a7a-b348139f6c99'
    const citationText = buildArtifactInlineCitationText(
      `One claim[evidence:${firstId}] and another[evidence:${secondId}].`,
    )

    expect(citationText.references.map((reference) => reference.ariaLabel)).toEqual([
      'Open Evidence reference E1, revision 019f7e45/6c41.',
      'Open Evidence reference E2, revision 019f7e45/6c99.',
    ])
  })
})
