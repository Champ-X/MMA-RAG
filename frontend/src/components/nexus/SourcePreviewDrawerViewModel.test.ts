import { describe, expect, it } from 'vitest'
import type { SourceVersion } from '@/api/nexus'
import {
  buildSourcePreviewActionButtonGateViewModel,
  buildSourcePreviewActionViewModel,
  buildSourceNoteDiscardConfirmation,
  buildSourceNoteEditorViewModel,
  buildSourceNoteVersionActionViewModel,
  buildSourcePreviewViewModel,
  sourceVisualSectionCopy,
} from './SourcePreviewDrawerViewModel'

function stubSource(overrides: Partial<SourceVersion> = {}): SourceVersion {
  return {
    byte_size: 2048,
    canonical_uri: 'https://example.test/source.md',
    capabilities: {},
    capability_details: {},
    connector_kind: 'url',
    content_hash: 'abcdef1234567890',
    cover_evidence_id: 'evidence-cover',
    created_at: '2026-07-21T00:00:00Z',
    derived_image_count: 2,
    display_name: 'source.md',
    external_version: null,
    health: {
      blockers: [],
      outcome: 'ready',
      primary_action: null,
      searchable: true,
      severity: 'positive',
      summary: 'Ready',
    },
    id: 'source-version-a',
    latest_job: null,
    mime_type: 'text/markdown',
    modality: 'text',
    projection: {
      active_evidence_count: 6,
      expected_evidence_count: 6,
      release_id: 'release-a',
      state: 'active',
    },
    published_evidence_count: 6,
    source_id: 'source-a',
    space_ids: ['space-a'],
    status: 'published',
    sync: {
      connector_kind: 'url',
      last_checked_at: '2026-07-21T01:00:00Z',
      refreshable: true,
      schedules: [{
        created_at: '2026-07-21T01:00:00Z',
        enabled: true,
        id: 'schedule-a',
        interval_minutes: 1440,
        last_error: null,
        last_run_at: null,
        last_status: 'never',
        next_run_at: '2026-07-22T01:00:00Z',
        revision: 1,
        source_id: 'source-a',
        space_id: 'space-a',
        updated_at: '2026-07-21T01:00:00Z',
      }],
      scope: 'source',
    },
    version_no: 3,
    ...overrides,
  } as SourceVersion
}

describe('Source preview drawer view model', () => {
  it('keeps drawer action feedback quiet before an action starts', () => {
    expect(buildSourcePreviewActionViewModel({
      pending: false,
      sourceName: 'source.md',
    })).toMatchObject({
      detail: 'Refresh, retry and reparse actions keep the retained original available while durable ingestion jobs run.',
      label: 'Source actions ready',
      tone: 'ready',
      visible: false,
    })
  })

  it('announces upstream refresh while retained evidence remains available', () => {
    expect(buildSourcePreviewActionViewModel({
      action: 'refresh',
      pending: true,
      sourceName: 'source.md',
    })).toMatchObject({
      detail: 'Checking upstream for source.md; retained evidence stays available until a new version publishes.',
      label: 'Upstream check in progress',
      tone: 'pending',
      visible: true,
    })
  })

  it('turns schedule failures into retryable drawer feedback', () => {
    expect(buildSourcePreviewActionViewModel({
      action: 'schedule',
      errorMessage: 'Revision conflict.',
      pending: false,
      sourceName: 'source.md',
    })).toMatchObject({
      detail: 'Revision conflict. source.md remains unchanged and the action can be retried.',
      label: 'Schedule update failed',
      liveMode: 'assertive',
      role: 'alert',
      tone: 'error',
      visible: true,
    })
  })

  it('summarizes completed drawer actions', () => {
    expect(buildSourcePreviewActionViewModel({
      action: 'reprocess',
      message: 'Reparsed the stored original without contacting the upstream source.',
      pending: false,
      sourceName: 'source.md',
    })).toMatchObject({
      detail: 'Reparsed the stored original without contacting the upstream source.',
      label: 'Reparse completed',
      tone: 'ready',
      visible: true,
    })
  })

  it('keeps source action buttons focusable but logically locked while another action runs', () => {
    expect(buildSourcePreviewActionButtonGateViewModel({
      action: 'refresh',
      pending: true,
      sourceName: 'source.md',
    })).toEqual({
      ariaDisabled: true,
      canSubmit: false,
      detail: 'Upstream check is locked while another Source action is running for source.md.',
    })
  })

  it('explains blocked source action buttons without hiding them from focus', () => {
    expect(buildSourcePreviewActionButtonGateViewModel({
      action: 'schedule',
      blockedDetail: 'This cadence is already active for source.md.',
      pending: false,
      sourceName: 'source.md',
    })).toEqual({
      ariaDisabled: true,
      canSubmit: false,
      detail: 'This cadence is already active for source.md.',
    })
  })

  it('allows source action buttons when there is no pending or blocked state', () => {
    expect(buildSourcePreviewActionButtonGateViewModel({
      action: 'reprocess',
      pending: false,
      sourceName: 'source.md',
    })).toEqual({
      ariaDisabled: false,
      canSubmit: true,
    })
  })

  it('summarizes a connected source contract', () => {
    const vm = buildSourcePreviewViewModel(stubSource(), 'space-a')

    expect(vm.materialSummary).toBe('url · text/markdown · 2.0 KB')
    expect(vm.nativeAudioLabel).toBe('Audio source preview for source.md · version 3 · 2.0 KB')
    expect(vm.nativeVideoLabel).toBe('Video source preview for source.md · version 3 · 2.0 KB')
    expect(vm.syncSummary.label).toBe('Connected source')
    expect(vm.contractSignals.map((item) => [item.label, item.value])).toEqual([
      ['Version', 'v3'],
      ['Evidence', '6'],
      ['Visuals', '2'],
      ['Sync', 'auto'],
    ])
    expect(vm.readinessSteps.every((step) => step.state === 'ready')).toBe(true)
  })

  it('keeps snapshot materials explicit when no upstream refresh contract exists', () => {
    const vm = buildSourcePreviewViewModel(stubSource({
      cover_evidence_id: null,
      derived_image_count: 0,
      health: {
        blockers: ['embedder_not_configured'],
        outcome: 'searchable_exact_only',
        primary_action: 'reprocess',
        searchable: false,
        severity: 'warning',
        summary: 'Exact text only',
      },
      projection: {
        active_evidence_count: 0,
        expected_evidence_count: 4,
        release_id: null,
        state: 'pending',
      },
      sync: {
        connector_kind: 'upload',
        last_checked_at: '2026-07-21T01:00:00Z',
        refreshable: false,
        schedules: [],
        scope: 'snapshot',
      },
    }), 'space-a')

    expect(vm.syncSummary).toEqual({
      label: 'Snapshot material',
      detail: 'Reparse uses the retained original only.',
    })
    expect(vm.contractSignals[vm.contractSignals.length - 1]).toMatchObject({ label: 'Sync', value: 'sealed' })
    expect(vm.readinessSteps.map((step) => step.state)).toEqual(['ready', 'waiting', 'waiting'])
  })

  it('does not call standalone image evidence an extracted document visual', () => {
    expect(sourceVisualSectionCopy(stubSource({ derived_image_count: 0, modality: 'image' }), 1)).toEqual({
      eyebrow: 'Original visual evidence',
      title: '1 citable visual · standalone image',
    })
    expect(sourceVisualSectionCopy(stubSource({ derived_image_count: 3, modality: 'text' }), 2).eyebrow).toBe('Extracted from document')
  })

  it('guards manual note edits from empty and unchanged versions', () => {
    const source = stubSource({ connector_kind: 'markdown', version_no: 7 })
    const empty = buildSourceNoteEditorViewModel('   ', 'Original note', source)
    const unchanged = buildSourceNoteEditorViewModel('Original note\r\n', 'Original note\n', source)
    const changed = buildSourceNoteEditorViewModel('Original note\n\nNew finding.', 'Original note\n', source)

    expect(empty).toMatchObject({
      canSave: false,
      hasUnsavedChanges: true,
      saveLabel: 'Add note content',
      state: 'empty',
      stateLabel: 'Needs content',
    })
    expect(unchanged).toMatchObject({
      canSave: false,
      hasUnsavedChanges: false,
      saveLabel: 'No changes to save',
      state: 'unchanged',
    })
    expect(changed).toMatchObject({
      canSave: true,
      hasUnsavedChanges: true,
      saveLabel: 'Save as v8',
      state: 'ready',
      stateLabel: 'Ready to version',
    })
    expect(changed.signals.map((signal) => [signal.label, signal.value])).toContainEqual([
      'Next version',
      'v8',
    ])
  })

  it('uses consequence-specific copy before discarding a manual note draft', () => {
    const confirmation = buildSourceNoteDiscardConfirmation(stubSource({ version_no: 7 }))

    expect(confirmation).toMatchObject({
      confirmLabel: 'Discard note draft',
      title: 'Discard unsaved note changes?',
      tone: 'danger',
    })
    expect(confirmation.body).toContain('discards the unsaved Markdown draft')
    expect(confirmation.body).toContain('No Source Version will be created')
    expect(confirmation.body).toContain('version v7')
  })

  it('turns manual note save readiness into action feedback', () => {
    const source = stubSource({ display_name: 'field-note.md', connector_kind: 'markdown', version_no: 7 })
    const editor = buildSourceNoteEditorViewModel('Original note\n\nNew finding.', 'Original note\n', source)

    expect(buildSourceNoteVersionActionViewModel({
      currentVersionNo: source.version_no,
      editor,
      pending: false,
      sourceName: source.display_name,
    })).toMatchObject({
      ariaDisabled: false,
      canSave: true,
      feedbackDetail: 'Saving creates immutable version v8; existing citations keep version v7.',
      feedbackLabel: 'Ready to create version',
      feedbackTone: 'ready',
      saveLabel: 'Save as v8',
      visible: true,
    })
  })

  it('announces manual note version creation while preserving existing citations', () => {
    const source = stubSource({ display_name: 'field-note.md', connector_kind: 'markdown', version_no: 7 })
    const editor = buildSourceNoteEditorViewModel('Original note\n\nNew finding.', 'Original note\n', source)

    expect(buildSourceNoteVersionActionViewModel({
      currentVersionNo: source.version_no,
      editor,
      pending: true,
      sourceName: source.display_name,
    })).toMatchObject({
      ariaDisabled: true,
      canSave: false,
      disabledDetail: 'Manual note save is locked while version v8 is being created for field-note.md.',
      feedbackDetail: 'Creating immutable version v8 for field-note.md. Existing citations stay bound to version v7 while ingestion publishes the new Evidence.',
      feedbackLabel: 'Creating Source Version',
      feedbackTone: 'pending',
      role: 'status',
      saveLabel: 'Creating version...',
      visible: true,
    })
  })

  it('keeps manual note save failures retryable', () => {
    const source = stubSource({ display_name: 'field-note.md', connector_kind: 'markdown', version_no: 7 })
    const editor = buildSourceNoteEditorViewModel('Original note\n\nNew finding.', 'Original note\n', source)

    expect(buildSourceNoteVersionActionViewModel({
      currentVersionNo: source.version_no,
      editor,
      errorMessage: 'Upload failed.',
      pending: false,
      sourceName: source.display_name,
    })).toMatchObject({
      ariaDisabled: false,
      canSave: true,
      feedbackDetail: 'Upload failed. field-note.md remains on version v7; the Markdown draft can be retried without changing existing citations.',
      feedbackLabel: 'Source Version was not created',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      saveLabel: 'Try save again',
      visible: true,
    })
  })

  it('keeps a manual note version success receipt visible after saving', () => {
    const source = stubSource({ display_name: 'field-note.md', connector_kind: 'markdown', version_no: 8 })
    const editor = buildSourceNoteEditorViewModel('Original note\n\nNew finding.', 'Original note\n\nNew finding.', source)

    expect(buildSourceNoteVersionActionViewModel({
      currentVersionNo: source.version_no,
      editor,
      pending: false,
      previousVersionNo: 7,
      savedVersionNo: 8,
      sourceName: source.display_name,
    })).toMatchObject({
      ariaDisabled: true,
      canSave: false,
      disabledDetail: 'Edit the Markdown draft before creating another Source Version.',
      feedbackDetail: 'field-note.md is now version v8. Existing citations remain on version v7; new Evidence publishes from the retained Markdown original.',
      feedbackLabel: 'Source Version created',
      feedbackTone: 'ready',
      saveLabel: 'Version created',
      visible: true,
    })
  })

  it('keeps blocked manual note save focusable with the editor reason', () => {
    const source = stubSource({ display_name: 'field-note.md', connector_kind: 'markdown', version_no: 7 })
    const editor = buildSourceNoteEditorViewModel('', 'Original note\n', source)

    expect(buildSourceNoteVersionActionViewModel({
      currentVersionNo: source.version_no,
      editor,
      pending: false,
      sourceName: source.display_name,
    })).toMatchObject({
      ariaDisabled: true,
      canSave: false,
      disabledDetail: 'Add Markdown content before creating a new Source Version.',
      feedbackLabel: 'Needs content',
      feedbackTone: 'blocked',
    })
  })
})
