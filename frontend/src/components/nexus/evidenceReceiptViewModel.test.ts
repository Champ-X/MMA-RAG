import { describe, expect, it } from 'vitest'
import type { Evidence } from '@/api/nexus'
import {
  buildEvidenceReceiptCopyActionViewModel,
  buildEvidenceReceiptViewModel,
  buildRunEvidenceReceiptViewModel,
} from './evidenceReceiptViewModel'

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

describe('evidence receipt view model', () => {
  it('builds stable custody fields for a known evidence path', () => {
    const receipt = buildEvidenceReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      path: '/runs/browser/evidence/revision-alpha-123456',
    })

    expect(receipt).toMatchObject({
      copiedLabel: 'Evidence receipt copied',
      copyLabel: 'Copy receipt link',
      failedLabel: 'Copy failed',
      href: 'http://127.0.0.1:3000/runs/browser/evidence/revision-alpha-123456',
      locatorLabel: 'chars 32–128',
      path: '/runs/browser/evidence/revision-alpha-123456',
      revisionLabel: 'revision',
      shortLabel: '/runs/browser/evidence/revision-alpha-123456',
      sourceVersionLabel: 'source-v',
      statusLabel: 'published',
      title: 'Evidence receipt',
    })
    expect(receipt.ariaLabel).toContain('revision-alpha-123456')
    expect(receipt.facets).toContainEqual({ label: 'Locator', value: 'chars 32–128' })
  })

  it('builds run-scoped receipt links with compact action copy', () => {
    const receipt = buildRunEvidenceReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      runId: 'run-1',
    })

    expect(receipt).toMatchObject({
      copiedLabel: 'Receipt copied',
      copyLabel: 'Copy receipt',
      detail: 'Copies the stable Evidence receipt without leaving this Run.',
      href: 'http://127.0.0.1:3000/runs/run-1/evidence/revision-alpha-123456',
      path: '/runs/run-1/evidence/revision-alpha-123456',
    })
  })

  it('keeps evidence receipt copy guidance quiet before copying', () => {
    const receipt = buildEvidenceReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      path: '/evidence/revision-alpha-123456',
    })

    expect(buildEvidenceReceiptCopyActionViewModel({
      receipt,
      state: 'idle',
    })).toMatchObject({
      feedbackDetail: 'Copies a stable Evidence receipt URL for revision revision; it does not change the Source Version, locator or inspection state.',
      feedbackLabel: 'Evidence receipt ready',
      feedbackTone: 'ready',
      role: 'status',
      submitLabel: 'Copy receipt link',
      visible: false,
    })
  })

  it('announces copied evidence receipt links with custody details', () => {
    const receipt = buildEvidenceReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      path: '/evidence/revision-alpha-123456',
    })

    expect(buildEvidenceReceiptCopyActionViewModel({
      receipt,
      state: 'copied',
    })).toMatchObject({
      feedbackDetail: 'The receipt URL for Evidence revision revision is on the clipboard. It preserves source version source-v and locator chars 32–128.',
      feedbackLabel: 'Evidence receipt copied',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Evidence receipt copied',
      visible: true,
    })
  })

  it('announces receipt copy as pending before clipboard settlement', () => {
    const receipt = buildEvidenceReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      path: '/evidence/revision-alpha-123456',
    })

    expect(buildEvidenceReceiptCopyActionViewModel({
      receipt,
      state: 'copying',
    })).toMatchObject({
      feedbackDetail: 'Copying the stable receipt URL for Evidence revision revision. The Evidence record and Source Version remain unchanged.',
      feedbackLabel: 'Copying receipt link',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copying...',
      visible: true,
    })
  })


  it('turns evidence receipt copy failures into assertive retry guidance', () => {
    const receipt = buildEvidenceReceiptViewModel({
      evidence: stubEvidence(),
      origin: 'http://127.0.0.1:3000',
      path: '/evidence/revision-alpha-123456',
    })

    expect(buildEvidenceReceiptCopyActionViewModel({
      receipt,
      state: 'failed',
    })).toMatchObject({
      feedbackDetail: 'Clipboard access failed. Copy the visible receipt URL manually; revision revision, source version source-v and locator chars 32–128 remain stable.',
      feedbackLabel: 'Copy failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try copy again',
      visible: true,
    })
  })
})
