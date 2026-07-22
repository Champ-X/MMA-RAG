import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/nexus'
import { EvidenceAnswer } from './EvidenceAnswer'

const evidence = (id: string, modality: Evidence['modality'] = 'text'): Evidence => ({
  asset_url: `/api/v1/assets/${id}`,
  created_at: '2026-07-21T00:00:00Z',
  evidence_type: 'text_chunk',
  id,
  locator: { locator_type: 'page', page_no: 1, start_ms: null, end_ms: null, bbox: null, sheet: null, cell_range: null, extra: {} },
  modality,
  quality_flags: [],
  searchable_text: 'Launch evidence.',
  source_id: 'source-1',
  source_name: 'Launch Briefing',
  source_version_id: 'version-1',
  status: 'published',
  text_content: 'Launch evidence.',
  visible_from_sequence: 1,
  visible_until_sequence: null,
})

const result = (answer: string, citationIds: string[]): Record<string, unknown> => ({
  answer,
  citations: citationIds.map((id) => ({ evidence_revision_id: id })),
})

describe('EvidenceAnswer', () => {
  it('renders citable evidence as preview buttons', () => {
    const markup = renderToStaticMarkup(
      <EvidenceAnswer
        result={result('Answer [evidence:019f8400-f17f-7b62-bb89-54f4df9b3d42]', ['019f8400-f17f-7b62-bb89-54f4df9b3d42'])}
        evidenceById={new Map([
          ['019f8400-f17f-7b62-bb89-54f4df9b3d42', evidence('019f8400-f17f-7b62-bb89-54f4df9b3d42')],
        ])}
        onPreview={() => undefined}
      />,
    )

    expect(markup).toContain('class="inline-citation"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('data-citation-trigger-key="citation-019f8400-f17f-7b62-bb89-54f4df9b3d42-1"')
    expect(markup).toContain('aria-label="Preview citation from Launch Briefing"')
  })

  it('renders missing citations as unavailable markers', () => {
    const markup = renderToStaticMarkup(
      <EvidenceAnswer
        result={result('Missing [evidence:019f8400-f17f-7b62-bb89-54f4df9b3d42]', ['019f8400-f17f-7b62-bb89-54f4df9b3d42'])}
        evidenceById={new Map()}
        onPreview={() => undefined}
      />,
    )

    expect(markup).toContain('class="inline-citation unavailable"')
    expect(markup).toContain('title="Citation is unavailable"')
  })

  it('renders inline media only for the first citation occurrence', () => {
    const evidenceId = '019f8400-f17f-7b62-bb89-54f4df9b3d42'
    const markup = renderToStaticMarkup(
      <EvidenceAnswer
        result={result(`Image [evidence:${evidenceId}] repeated [evidence:${evidenceId}]`, [evidenceId])}
        evidenceById={new Map([[evidenceId, evidence(evidenceId, 'image')]])}
        onPreview={() => undefined}
      />,
    )

    expect(markup.match(/class="inline-evidence-media"/g)?.length).toBe(1)
    expect(markup).toContain('data-citation-trigger-key="citation-019f8400-f17f-7b62-bb89-54f4df9b3d42-1"')
    expect(markup).toContain('data-citation-trigger-key="citation-019f8400-f17f-7b62-bb89-54f4df9b3d42-2"')
  })
})
