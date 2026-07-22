import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/nexus'
import {
  buildCitationPreviewPlacementViewModel,
  buildCitationPreviewReceiptCopyActionViewModel,
  buildCitationPreviewReceiptViewModel,
} from './CitationPreviewPopoverViewModel'

function stubEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    asset_url: '/api/v1/evidence/revision-alpha-123456/asset',
    created_at: '2026-07-21T00:00:00Z',
    evidence_type: 'markdown_section',
    id: 'revision-alpha-123456',
    locator: {
      bbox: null,
      cell_range: null,
      char_end: 128,
      char_start: 32,
      end_ms: null,
      extra: {},
      locator_type: 'char_range',
      page_no: null,
      sheet: null,
      start_ms: null,
    },
    modality: 'text',
    quality_flags: [],
    searchable_text: 'searchable',
    source_id: 'source-alpha',
    source_name: 'board-memo.md',
    source_version_id: 'source-version-alpha-123456',
    status: 'published',
    text_content: 'Evidence excerpt',
    visible_from_sequence: 1,
    visible_until_sequence: null,
    ...overrides,
  } as Evidence
}

describe('Citation preview popover view model', () => {
  it('places citation previews below the anchor when there is enough room', () => {
    expect(buildCitationPreviewPlacementViewModel({
      anchorRect: { bottom: 160, left: 360, top: 120, width: 80 },
      modality: 'text',
      viewportHeight: 900,
      viewportWidth: 1200,
    })).toMatchObject({
      className: 'citation-preview-popover modality-text',
      placement: 'below',
      style: {
        left: 205,
        maxHeight: 420,
        top: 172,
        width: 390,
      },
    })
  })

  it('places citation previews above the anchor near the bottom edge', () => {
    expect(buildCitationPreviewPlacementViewModel({
      anchorRect: { bottom: 760, left: 360, top: 720, width: 80 },
      modality: 'image',
      viewportHeight: 820,
      viewportWidth: 1200,
    })).toMatchObject({
      className: 'citation-preview-popover modality-image place-above',
      placement: 'above',
      style: {
        left: 205,
        maxHeight: 420,
        top: 288,
        width: 390,
      },
    })
  })

  it('clamps citation previews into narrow viewports without losing minimum height', () => {
    expect(buildCitationPreviewPlacementViewModel({
      anchorRect: { bottom: 230, left: 2, top: 190, width: 24 },
      modality: 'video',
      viewportHeight: 300,
      viewportWidth: 220,
    })).toMatchObject({
      className: 'citation-preview-popover modality-video place-above',
      placement: 'above',
      style: {
        left: 16,
        maxHeight: 220,
        top: 16,
        width: 248,
      },
    })
  })

  it('builds a run-scoped evidence receipt action', () => {
    const receipt = buildCitationPreviewReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      runId: 'run-1',
    })

    expect(receipt).toMatchObject({
      copiedLabel: 'Receipt copied',
      copyLabel: 'Copy receipt',
      failedLabel: 'Copy failed',
      href: 'http://127.0.0.1:3000/runs/run-1/evidence/revision-alpha-123456',
      locatorLabel: 'chars 32–128',
      openLabel: 'Open detail',
      path: '/runs/run-1/evidence/revision-alpha-123456',
      revisionLabel: 'revision',
      shortLabel: 'revision · chars 32–128',
      sourceVersionLabel: 'source-v',
    })
    expect(receipt.ariaLabel).toContain('revision-alpha-123456')
    expect(receipt.detail).toContain('without leaving this Run')
  })

  it('keeps citation copy guidance available while idle', () => {
    const receipt = buildCitationPreviewReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      runId: 'run-1',
    })

    expect(buildCitationPreviewReceiptCopyActionViewModel({
      receipt,
      state: 'idle',
    })).toMatchObject({
      feedbackDetail: 'Copies a stable citation receipt for revision revision without closing the preview or changing the Evidence ledger.',
      feedbackLabel: 'Citation receipt ready',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copy receipt',
      visible: false,
    })
  })

  it('announces citation copy as pending before clipboard settlement', () => {
    const receipt = buildCitationPreviewReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      runId: 'run-1',
    })

    expect(buildCitationPreviewReceiptCopyActionViewModel({
      receipt,
      state: 'copying',
    })).toMatchObject({
      feedbackDetail: 'Copying the citation receipt for Evidence revision revision. The preview stays open and the Source Version remains unchanged.',
      feedbackLabel: 'Copying receipt',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copying...',
      visible: true,
    })
  })

  it('announces copied citation receipts with provenance detail', () => {
    const receipt = buildCitationPreviewReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      runId: 'run-1',
    })

    expect(buildCitationPreviewReceiptCopyActionViewModel({
      receipt,
      state: 'copied',
    })).toMatchObject({
      feedbackDetail: 'The citation receipt is on the clipboard. It preserves revision revision, source version source-v and locator chars 32–128.',
      feedbackLabel: 'Receipt copied',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Receipt copied',
      visible: true,
    })
  })

  it('turns citation copy failures into assertive retry guidance', () => {
    const receipt = buildCitationPreviewReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      runId: 'run-1',
    })

    expect(buildCitationPreviewReceiptCopyActionViewModel({
      receipt,
      state: 'failed',
    })).toMatchObject({
      feedbackDetail: 'Clipboard access failed. Open the detail view or copy the visible receipt URL manually; revision revision and locator chars 32–128 remain stable.',
      feedbackLabel: 'Copy failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try copy again',
      visible: true,
    })
  })
})
