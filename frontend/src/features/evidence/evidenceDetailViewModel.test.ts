import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/nexus'
import { buildEvidenceDetailViewModel, buildEvidenceReceiptLinkViewModel } from './evidenceDetailViewModel'

function stubEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    asset_url: '/api/v1/evidence/rev-a/asset',
    created_at: '2026-07-21T00:00:00Z',
    evidence_type: 'whole_image',
    id: 'revision-alpha-123456',
    locator: {
      bbox: null,
      cell_range: null,
      char_end: null,
      char_start: null,
      end_ms: null,
      extra: { width: 1200, height: 800, scope: 'whole_image' },
      locator_type: 'image',
      page_no: null,
      sheet: null,
      start_ms: null,
    },
    modality: 'image',
    quality_flags: [],
    searchable_text: 'visual search text',
    source_id: 'source-alpha',
    source_name: 'market-map.png',
    source_version_id: 'source-version-alpha-123456',
    status: 'published',
    text_content: 'A visual description of the market map.',
    visible_from_sequence: 7,
    visible_until_sequence: null,
    ...overrides,
  } as Evidence
}

describe('Evidence detail view model', () => {
  it('summarizes clean visual evidence as a verifiable dossier', () => {
    const vm = buildEvidenceDetailViewModel(stubEvidence(), [
      stubEvidence({ id: 'neighbor', evidence_type: 'markdown_section', text_content: 'Nearby extracted context.' }),
      stubEvidence(),
    ])

    expect(vm.visualEvidence).toBe(true)
    expect(vm.hasDerivedVisual).toBe(false)
    expect(vm.primaryMaterialLabel).toBe('Original visual material')
    expect(vm.locatorSummary).toBe('whole image · 1200×800px')
    expect(vm.trustState).toMatchObject({ label: 'Clean locator', tone: 'clean' })
    expect(vm.custodySignals.map((item) => item.label)).toEqual([
      'Revision',
      'Source version',
      'Status',
      'Visible sequence',
    ])
    expect(vm.contextItems[1]).toMatchObject({ active: true, label: 'whole image' })
  })

  it('surfaces parser quality flags as attention signals', () => {
    const vm = buildEvidenceDetailViewModel(stubEvidence({
      modality: 'text',
      evidence_type: 'markdown_section',
      quality_flags: ['ocr_unavailable', 'caption_unavailable'],
    }))

    expect(vm.visualEvidence).toBe(false)
    expect(vm.primaryMaterialLabel).toBe('Original source asset')
    expect(vm.qualityFlags).toEqual(['ocr unavailable', 'caption unavailable'])
    expect(vm.trustState).toMatchObject({ label: 'Needs review', tone: 'attention' })
  })

  it('builds a shareable evidence receipt link with stable custody facets', () => {
    const receipt = buildEvidenceReceiptLinkViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      pathname: '/runs/browser/evidence/revision-alpha-123456',
    })

    expect(receipt).toMatchObject({
      copiedLabel: 'Evidence receipt copied',
      copyLabel: 'Copy receipt link',
      failedLabel: 'Copy failed',
      href: 'http://127.0.0.1:3000/runs/browser/evidence/revision-alpha-123456',
      shortLabel: '/runs/browser/evidence/revision-alpha-123456',
      title: 'Evidence receipt',
    })
    expect(receipt.ariaLabel).toContain('revision-alpha')
    expect(receipt.detail).toContain('source version')
    expect(receipt.facets).toEqual([
      { label: 'Revision', value: 'revision' },
      { label: 'Source', value: 'source-v' },
      { label: 'Status', value: 'published' },
      { label: 'Locator', value: 'whole image · 1200×800px' },
    ])
  })
})
