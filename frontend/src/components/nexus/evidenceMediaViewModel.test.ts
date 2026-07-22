import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/nexus'
import { buildEvidenceMediaViewModel } from './evidenceMediaViewModel'

const baseEvidence = {
  asset_url: '/api/v1/evidence/ev1/asset',
  evidence_type: 'whole_image',
  id: 'ev1',
  locator: {
    bbox: null,
    cell_range: null,
    char_end: null,
    char_start: null,
    end_ms: null,
    extra: {},
    locator_type: 'image',
    page_no: null,
    sheet: null,
    start_ms: null,
  },
  modality: 'image',
  quality_flags: [],
  searchable_text: '',
  source_name: 'Field study board.png',
  status: 'ready',
  text_content: 'A pinned field study board with clustered notes and annotated receipts.',
} as unknown as Evidence

describe('buildEvidenceMediaViewModel', () => {
  it('builds descriptive alt text for citable image evidence', () => {
    expect(buildEvidenceMediaViewModel(baseEvidence).imageAlt).toBe(
      'Image evidence from Field study board.png at whole image: A pinned field study board with clustered notes and annotated receipts.',
    )
  })

  it('uses timed locators for audio and video labels', () => {
    const audio = {
      ...baseEvidence,
      evidence_type: 'audio_segment',
      locator: { ...baseEvidence.locator, locator_type: 'time_range', start_ms: 3200, end_ms: 6900 },
      modality: 'audio',
      source_name: 'Research interview.mp3',
      text_content: 'Participant describes the handoff failure.',
    } as unknown as Evidence

    expect(buildEvidenceMediaViewModel(audio).audioLabel).toBe(
      'Audio evidence from Research interview.mp3 at 3s–6s: Participant describes the handoff failure.',
    )
  })

  it('cleans HTML and truncates long generated descriptions', () => {
    const longText = `<p>${'handoff '.repeat(40)}</p>`
    const viewModel = buildEvidenceMediaViewModel({
      ...baseEvidence,
      text_content: longText,
    } as unknown as Evidence)

    expect(viewModel.imageAlt).not.toContain('<p>')
    expect(viewModel.imageAlt).toMatch(/\.\.\.$/)
    expect(viewModel.imageAlt.length).toBeLessThan(230)
  })

  it('labels derived table visuals separately from image evidence', () => {
    expect(buildEvidenceMediaViewModel({ ...baseEvidence, modality: 'table' } as unknown as Evidence).visualKindLabel).toBe('Table visual')
  })
})
