import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/nexus'
import {
  buildCitationMarkdown,
  buildCitationRenderModel,
  createCitationRenderState,
  evidenceIdFromHref,
} from './runCitationAnswerViewModel'

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

describe('runCitationAnswerViewModel', () => {
  it('rewrites evidence markers to numbered markdown citations', () => {
    expect(buildCitationMarkdown(
      'Alpha [evidence:019f8400-f17f-7b62-bb89-54f4df9b3d42] Beta [evidence:019f8400-f17f-7b62-bb89-54f4df9b3d43]',
      [
        { evidence_revision_id: '019f8400-f17f-7b62-bb89-54f4df9b3d42' },
      ],
    )).toBe(
      'Alpha [1](#evidence-019f8400-f17f-7b62-bb89-54f4df9b3d42) Beta [source](#evidence-019f8400-f17f-7b62-bb89-54f4df9b3d43)',
    )
  })

  it('extracts evidence ids only from citation links', () => {
    expect(evidenceIdFromHref('#evidence-evidence-1')).toBe('evidence-1')
    expect(evidenceIdFromHref('/runs/run-1/evidence/evidence-1')).toBeNull()
    expect(evidenceIdFromHref(undefined)).toBeNull()
  })

  it('assigns stable citation trigger keys and only renders media once', () => {
    const state = createCitationRenderState()
    const evidenceById = new Map([
      ['evidence-1', evidence('evidence-1', 'image')],
    ])

    expect(buildCitationRenderModel({ evidenceById, href: '#evidence-evidence-1', state })).toMatchObject({
      id: 'evidence-1',
      mediaTriggerKey: 'media-evidence-1',
      shouldRenderMedia: true,
      triggerKey: 'citation-evidence-1-1',
    })
    expect(buildCitationRenderModel({ evidenceById, href: '#evidence-evidence-1', state })).toMatchObject({
      id: 'evidence-1',
      mediaTriggerKey: 'media-evidence-1',
      shouldRenderMedia: false,
      triggerKey: 'citation-evidence-1-2',
    })
  })

  it('keeps missing citations renderable as unavailable markers', () => {
    const state = createCitationRenderState()

    expect(buildCitationRenderModel({
      evidenceById: new Map(),
      href: '#evidence-missing',
      state,
    })).toEqual({
      id: 'missing',
      shouldRenderMedia: false,
    })
  })
})
