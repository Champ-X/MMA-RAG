import { describe, expect, it } from 'vitest'
import {
  buildManualNoteDraftAutosaveBeacon,
  buildManualNoteDraftAutosaveKey,
  buildManualNoteDraftAutosaveNotice,
  buildManualNoteDraftAutosaveRecord,
  buildManualNoteDraftViewModel,
  buildMaterialBatchActionViewModel,
  buildMaterialLibraryRefreshViewModel,
  buildMaterialDeleteActionViewModel,
  buildSourceConnectorImportViewModel,
  buildSourceIntakeReceiptViewModel,
  buildSourceMaterialActionButtonGateViewModel,
  buildSourceMaterialActionViewModel,
  buildSourceTimelineAuditLinkViewModel,
  buildSourceUploadActionViewModel,
  parseManualNoteDraftAutosaveRecord,
  parseRecoverableManualNoteDraftAutosaveRecord,
} from './sourcesPageViewModel'

describe('Sources page view model', () => {
  it('keeps direct upload ready before files are chosen', () => {
    expect(buildSourceUploadActionViewModel({
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      browseLabel: 'Browse files',
      canChoose: true,
      dropzoneDetail: 'Documents, images, audio, video and tabular data are stored before enrichment.',
      dropzoneLabel: 'Drop files or a folder',
      feedbackLabel: 'Direct upload ready',
      feedbackTone: 'ready',
    })
  })

  it('blocks duplicate direct uploads while selected originals are storing', () => {
    expect(buildSourceUploadActionViewModel({
      fileCount: 3,
      pending: true,
    })).toMatchObject({
      ariaDisabled: true,
      browseLabel: 'Storing originals...',
      canChoose: false,
      disabledDetail: 'Upload is locked while selected originals are being stored and queued for durable ingestion.',
      feedbackDetail: 'Storing 3 files as retained originals before parsing starts. Ingestion jobs will appear in the durable timeline.',
      feedbackLabel: 'Upload in progress',
      feedbackTone: 'pending',
    })
  })

  it('keeps pending upload copy useful even before a file count is visible', () => {
    expect(buildSourceUploadActionViewModel({
      pending: true,
    })).toMatchObject({
      feedbackDetail: 'Storing selected originals before parsing starts. Ingestion jobs will appear in the durable timeline.',
      feedbackLabel: 'Upload in progress',
    })
  })

  it('keeps failed direct uploads retryable', () => {
    expect(buildSourceUploadActionViewModel({
      errorMessage: 'Object store unavailable.',
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      browseLabel: 'Try files again',
      canChoose: true,
      dropzoneDetail: 'The previous upload did not complete. The retained register is unchanged.',
      feedbackDetail: 'Object store unavailable. Choose files again or try a smaller batch.',
      feedbackLabel: 'Upload failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
    })
  })

  it('keeps single material delete feedback quiet before an action runs', () => {
    expect(buildMaterialDeleteActionViewModel({
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      canDelete: true,
      feedbackDetail: 'Delete removes one material from active registers while preserving audit tombstones.',
      feedbackLabel: 'Material delete ready',
      feedbackTone: 'ready',
      visible: false,
    })
  })

  it('announces pending single material deletes with tombstone context', () => {
    expect(buildMaterialDeleteActionViewModel({
      pending: true,
      sourceName: 'Board memo.pdf',
    })).toMatchObject({
      ariaDisabled: true,
      canDelete: false,
      disabledDetail: 'Delete is locked while Board memo.pdf is being removed from active material registers.',
      feedbackDetail: 'Deleting Board memo.pdf from active material registers. Audit tombstones and historical Run references remain intact.',
      feedbackLabel: 'Deleting material',
      feedbackTone: 'pending',
      visible: true,
    })
  })

  it('keeps failed single material deletes retryable', () => {
    expect(buildMaterialDeleteActionViewModel({
      errorMessage: 'Delete failed.',
      pending: false,
      sourceName: 'Board memo.pdf',
    })).toMatchObject({
      ariaDisabled: false,
      canDelete: true,
      feedbackDetail: 'Delete failed. Board memo.pdf remains in the register and can be retried.',
      feedbackLabel: 'Material delete failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes completed single material deletes', () => {
    expect(buildMaterialDeleteActionViewModel({
      deletedName: 'Board memo.pdf',
      pending: false,
    })).toMatchObject({
      ariaDisabled: false,
      canDelete: true,
      feedbackDetail: 'Board memo.pdf was removed from the active register. Audit tombstones remain available for historical traces.',
      feedbackLabel: 'Material deleted',
      feedbackTone: 'ready',
      visible: true,
    })
  })

  it('blocks source connector import when the required URL is missing', () => {
    expect(buildSourceConnectorImportViewModel({
      connectorKind: 'url',
      connectorLabel: 'Web URL',
      pending: false,
      readiness: 'ready',
      requiredLabel: 'URL',
      requiredReady: false,
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Fill URL before importing so the retained Source contract is auditable.',
      feedbackDetail: 'Fill URL before importing so the retained Source contract is auditable.',
      feedbackLabel: 'URL required',
      feedbackTone: 'blocked',
      requiredInvalid: true,
      submitLabel: 'Add URL',
    })
  })

  it('explains setup-gated connector imports', () => {
    expect(buildSourceConnectorImportViewModel({
      connectorKind: 'news',
      connectorLabel: 'News search',
      pending: false,
      readiness: 'setup',
      requiredLabel: 'search query',
      requiredReady: true,
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Configure Tavily news search before materializing news results.',
      feedbackDetail: 'Configure Tavily news search before materializing news results.',
      feedbackLabel: 'News search setup required',
      feedbackTone: 'blocked',
      submitLabel: 'Setup required',
    })
  })

  it('uses manual note draft readiness for markdown imports', () => {
    expect(buildSourceConnectorImportViewModel({
      connectorKind: 'markdown',
      connectorLabel: 'Manual note',
      manualNote: {
        canImport: false,
        detail: 'Write Markdown content before creating the Source Version.',
        importLabel: 'Add note content',
        stateLabel: 'Needs content',
      },
      pending: false,
      readiness: 'ready',
      requiredReady: true,
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'Write Markdown content before creating the Source Version.',
      feedbackDetail: 'Write Markdown content before creating the Source Version.',
      feedbackLabel: 'Needs content',
      feedbackTone: 'blocked',
      requiredInvalid: true,
      submitLabel: 'Add note content',
    })
  })

  it('blocks duplicate connector imports while pending', () => {
    expect(buildSourceConnectorImportViewModel({
      connectorKind: 'rss',
      connectorLabel: 'RSS / Atom',
      pending: true,
      readiness: 'ready',
      requiredLabel: 'feed URL',
      requiredReady: true,
    })).toMatchObject({
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: 'RSS / Atom import is locked while originals are being stored and ingestion jobs are queued.',
      feedbackDetail: 'Storing RSS / Atom originals first, then queueing parsing and enrichment as durable ingestion jobs.',
      feedbackLabel: 'Importing RSS / Atom',
      feedbackTone: 'pending',
      submitLabel: 'Importing...',
    })
  })

  it('keeps failed connector imports retryable after correction', () => {
    expect(buildSourceConnectorImportViewModel({
      connectorKind: 'git',
      connectorLabel: 'Git repository',
      errorMessage: 'Repository unreachable.',
      pending: false,
      readiness: 'ready',
      requiredLabel: 'repository URL',
      requiredReady: true,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Repository unreachable. Correct the source contract or retry; retained originals from prior imports remain unchanged.',
      feedbackLabel: 'Git repository import failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      submitLabel: 'Try import again',
    })
  })

  it('marks complete connector contracts ready to import', () => {
    expect(buildSourceConnectorImportViewModel({
      connectorKind: 'image_search',
      connectorLabel: 'Image search',
      pending: false,
      readiness: 'ready',
      requiredLabel: 'search query',
      requiredReady: true,
    })).toMatchObject({
      ariaDisabled: false,
      canSubmit: true,
      feedbackDetail: 'Ready to store Image search originals before parsing; evidence projection will be tracked in the ingestion timeline.',
      feedbackLabel: 'Image search import ready',
      feedbackTone: 'ready',
      requiredInvalid: false,
      submitLabel: 'Import Image search',
    })
  })

  it('keeps batch actions hidden until materials are selected', () => {
    expect(buildMaterialBatchActionViewModel({
      pending: false,
      selectedCount: 0,
    })).toMatchObject({
      canDelete: false,
      canReprocess: false,
      deleteAriaDisabled: true,
      deleteDisabledDetail: 'Select one or more materials before starting batch delete.',
      feedbackLabel: 'No batch selection',
      reprocessAriaDisabled: true,
      reprocessDisabledDetail: 'Select one or more materials before starting batch reparse.',
      selectionDetail: 'Select one or more materials from the register.',
      visible: false,
    })
  })

  it('makes selected materials eligible for batch reparse or delete', () => {
    expect(buildMaterialBatchActionViewModel({
      pending: false,
      selectedCount: 3,
    })).toMatchObject({
      canDelete: true,
      canReprocess: true,
      deleteAriaDisabled: false,
      feedbackDetail: 'Choose Reparse to enqueue fresh parsing, or Delete to remove selected materials with audit tombstones.',
      feedbackLabel: 'Batch action ready',
      reprocessAriaDisabled: false,
      selectionLabel: '3 materials selected',
      visible: true,
    })
  })

  it('locks batch actions while a reparse request is pending', () => {
    expect(buildMaterialBatchActionViewModel({
      action: 'reprocess',
      pending: true,
      selectedCount: 2,
    })).toMatchObject({
      canDelete: false,
      canReprocess: false,
      deleteAriaDisabled: true,
      deleteDisabledDetail: 'Batch reparse is queueing fresh parsing jobs for selected retained originals. Keep this page open until the request settles.',
      feedbackDetail: 'Batch reparse is queueing fresh parsing jobs for selected retained originals. Keep this page open until the request settles.',
      feedbackLabel: 'Batch reparse in progress',
      feedbackTone: 'pending',
      reprocessAriaDisabled: true,
      reprocessDisabledDetail: 'Batch reparse is queueing fresh parsing jobs for selected retained originals. Keep this page open until the request settles.',
      reprocessLabel: 'Reparsing...',
      visible: true,
    })
  })

  it('keeps failed batch deletes retryable with the selection intact', () => {
    expect(buildMaterialBatchActionViewModel({
      action: 'delete',
      errorMessage: 'Delete failed.',
      pending: false,
      selectedCount: 2,
    })).toMatchObject({
      canDelete: true,
      canReprocess: true,
      deleteAriaDisabled: false,
      deleteLabel: 'Try delete again',
      feedbackDetail: 'Delete failed. The selected materials remain unchanged and can be retried.',
      feedbackLabel: 'Batch delete failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      reprocessAriaDisabled: false,
      visible: true,
    })
  })

  it('keeps material row actions focusable but locked while another material action runs', () => {
    expect(buildSourceMaterialActionButtonGateViewModel({
      action: 'refresh',
      pending: true,
      sourceName: 'Board memo.pdf',
    })).toEqual({
      ariaDisabled: true,
      canSubmit: false,
      detail: 'Upstream check is locked while another material action is running. Board memo.pdf remains available in the register.',
    })
  })

  it('allows material row actions when no material action is pending', () => {
    expect(buildSourceMaterialActionButtonGateViewModel({
      action: 'reprocess',
      pending: false,
      sourceName: 'Board memo.pdf',
    })).toEqual({
      ariaDisabled: false,
      canSubmit: true,
    })
  })

  it('summarizes queued jobs after a batch reparse clears selection', () => {
    expect(buildMaterialBatchActionViewModel({
      action: 'reprocess',
      affectedCount: 3,
      jobCount: 3,
      pending: false,
      selectedCount: 0,
    })).toMatchObject({
      feedbackDetail: 'Queued 3 ingestion jobs for 3 materials. Track durable progress from the ingestion timeline.',
      feedbackLabel: 'Batch reparse completed',
      feedbackTone: 'ready',
      selectionDetail: 'The previous selection was cleared after the batch completed.',
      visible: true,
    })
  })

  it('summarizes deleted materials after a batch delete clears selection', () => {
    expect(buildMaterialBatchActionViewModel({
      action: 'delete',
      affectedCount: 2,
      pending: false,
      selectedCount: 0,
    })).toMatchObject({
      feedbackDetail: 'Removed 2 materials from the active register. Audit tombstones remain available for historical traces.',
      feedbackLabel: 'Batch delete completed',
      visible: true,
    })
  })

  it('explains material library refresh readiness with filter and health counts', () => {
    expect(buildMaterialLibraryRefreshViewModel({
      attentionCount: 2,
      filteredCount: 3,
      filterText: 'memo',
      pending: false,
      processingCount: 1,
      totalCount: 8,
    })).toMatchObject({
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: 'Refresh retained originals, health summaries and the Space portrait. 3 originals match "memo". 2 need attention; 1 still processing.',
      feedbackLabel: 'Material refresh ready',
      feedbackTone: 'ready',
      submitLabel: 'Refresh',
    })
  })

  it('blocks duplicate material library refreshes while pending', () => {
    expect(buildMaterialLibraryRefreshViewModel({
      attentionCount: 0,
      filteredCount: 5,
      filterText: '',
      pending: true,
      processingCount: 0,
      totalCount: 5,
    })).toMatchObject({
      ariaDisabled: true,
      canRefresh: false,
      disabledDetail: 'Material refresh is locked while retained originals, health summaries and schedules are updating.',
      feedbackDetail: 'Refreshing retained originals, health summaries, schedules and the Space portrait.',
      feedbackLabel: 'Refreshing material register',
      feedbackTone: 'pending',
      submitLabel: 'Refreshing...',
    })
  })

  it('keeps material library refresh retryable after failure', () => {
    expect(buildMaterialLibraryRefreshViewModel({
      attentionCount: 0,
      errorMessage: 'Source API timeout.',
      filteredCount: 5,
      filterText: '',
      pending: false,
      processingCount: 0,
      totalCount: 5,
    })).toMatchObject({
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: 'Source API timeout. The current material register remains visible while you retry.',
      feedbackLabel: 'Material refresh failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try refresh again',
    })
  })

  it('summarizes the last successful material library refresh', () => {
    expect(buildMaterialLibraryRefreshViewModel({
      attentionCount: 0,
      filteredCount: 5,
      filterText: '',
      lastRefreshLabel: '12:08:13',
      pending: false,
      processingCount: 0,
      totalCount: 5,
    })).toMatchObject({
      feedbackDetail: '12:08:13; refreshed 5 originals. 5 originals visible in this Space. 0 need attention; 0 still processing.',
      feedbackLabel: 'Material register refreshed',
      submitLabel: 'Refresh again',
    })
  })

  it('keeps source material actions quiet until a row action runs', () => {
    expect(buildSourceMaterialActionViewModel({
      pending: false,
    })).toMatchObject({
      feedbackDetail: 'Retry, reparse and upstream checks enqueue durable ingestion jobs while retained originals stay available.',
      feedbackLabel: 'Material actions ready',
      feedbackTone: 'ready',
      visible: false,
    })
  })

  it('announces an upstream check in progress with retained-evidence context', () => {
    expect(buildSourceMaterialActionViewModel({
      action: 'refresh',
      pending: true,
      sourceName: 'Board memo.pdf',
    })).toMatchObject({
      feedbackDetail: 'Upstream check is checking upstream for a newer retained version for Board memo.pdf. Existing evidence remains available until a new job publishes.',
      feedbackLabel: 'Upstream check in progress',
      feedbackTone: 'pending',
      visible: true,
    })
  })

  it('turns material action failures into retryable receipts', () => {
    expect(buildSourceMaterialActionViewModel({
      action: 'retry',
      errorMessage: 'Worker unavailable.',
      pending: false,
      sourceName: 'Board memo.pdf',
    })).toMatchObject({
      feedbackDetail: 'Worker unavailable. Board memo.pdf remains in the register and can be retried.',
      feedbackLabel: 'Retry failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    })
  })

  it('summarizes queued material action jobs', () => {
    expect(buildSourceMaterialActionViewModel({
      action: 'reprocess',
      jobCount: 2,
      pending: false,
      sourceName: 'Board memo.pdf',
    })).toMatchObject({
      feedbackDetail: 'Reparse queued 2 ingestion jobs for Board memo.pdf. Track durable progress from the audit link or timeline.',
      feedbackLabel: 'Reparse queued',
      feedbackTone: 'ready',
      visible: true,
    })
  })

  it('requires a title before a manual note can be imported', () => {
    const vm = buildManualNoteDraftViewModel(' ', '# Field note')

    expect(vm).toMatchObject({
      canImport: false,
      importLabel: 'Add note title',
      state: 'missing_title',
      stateLabel: 'Needs title',
    })
    expect(vm.detail).toContain('Name this manual note')
    expect(vm.signals.map((signal) => [signal.label, signal.value])).toContainEqual([
      'Title',
      'Missing',
    ])
  })

  it('requires Markdown content before creating a durable note source', () => {
    const vm = buildManualNoteDraftViewModel('Research memo', '   ')

    expect(vm).toMatchObject({
      canImport: false,
      importLabel: 'Add note content',
      previewMarkdown: '',
      state: 'empty',
      stateLabel: 'Needs content',
    })
    expect(vm.detail).toContain('Write Markdown content')
  })

  it('summarizes ready manual notes with structure and preview content', () => {
    const vm = buildManualNoteDraftViewModel(
      'Research memo',
      '# Research memo\n\nA grounded note with [source](https://example.test).',
    )

    expect(vm).toMatchObject({
      canImport: true,
      importLabel: 'Import manual note',
      state: 'ready',
      stateLabel: 'Ready to import',
    })
    expect(vm.previewMarkdown).toContain('# Research memo')
    expect(vm.signals.map((signal) => [signal.label, signal.value])).toContainEqual([
      'Structure',
      '1 heading',
    ])
    expect(vm.signals.find((signal) => signal.label === 'Structure')?.detail).toContain('1 Markdown link')
  })

  it('scopes manual note autosave records to the current Space', () => {
    const record = buildManualNoteDraftAutosaveRecord(
      'space-a',
      'Field memo',
      '# Field memo',
      new Date('2026-07-21T12:00:00.000Z'),
    )

    expect(buildManualNoteDraftAutosaveKey('space-a')).toBe('nexus.manual-note-draft.space-a')
    expect(record).toEqual({
      content: '# Field memo',
      savedAt: '2026-07-21T12:00:00.000Z',
      spaceId: 'space-a',
      title: 'Field memo',
    })
    expect(parseManualNoteDraftAutosaveRecord(JSON.stringify(record), 'space-a')).toEqual(record)
    expect(parseManualNoteDraftAutosaveRecord(JSON.stringify(record), 'space-b')).toBeNull()
    expect(parseManualNoteDraftAutosaveRecord('not-json', 'space-a')).toBeNull()
  })

  it('only restores manual note drafts that differ from the clean default', () => {
    const blank = buildManualNoteDraftAutosaveRecord('space-a', 'Manual note', '')
    const titled = buildManualNoteDraftAutosaveRecord('space-a', 'Field memo', '')

    expect(parseRecoverableManualNoteDraftAutosaveRecord(JSON.stringify(blank), 'space-a')).toBeNull()
    expect(parseRecoverableManualNoteDraftAutosaveRecord(JSON.stringify(titled), 'space-a')).toEqual(titled)
  })

  it('summarizes recovered manual note session drafts', () => {
    const notice = buildManualNoteDraftAutosaveNotice({
      content: '# Field memo',
      savedAt: '2026-07-21T12:00:00.000Z',
      spaceId: 'space-a',
      title: 'Field memo',
    })

    expect(notice).toMatchObject({
      discardLabel: 'Discard draft',
      restoreLabel: 'Restore draft',
      savedLabel: 'Session save · 2026-07-21 12:00:00Z',
      title: 'Manual note draft recovered',
    })
    expect(notice.detail).toContain('browser-saved manual Markdown draft')
  })

  it('summarizes available manual note drafts before opening the composer', () => {
    const beacon = buildManualNoteDraftAutosaveBeacon({
      content: '# Field memo',
      savedAt: '2026-07-21T12:00:00.000Z',
      spaceId: 'space-a',
      title: 'Field memo',
    })

    expect(beacon).toMatchObject({
      label: 'Draft saved',
      savedLabel: 'Session save · 2026-07-21 12:00:00Z',
    })
    expect(beacon.ariaLabel).toContain('Manual note session draft available')
    expect(beacon.detail).toContain('Open Manual note')
  })

  it('summarizes active intake batches with job progress and timeline entry', () => {
    const receipt = buildSourceIntakeReceiptViewModel({
      connectorLabel: 'Manual note',
      jobs: [{ id: 'job-1', stage: 'parsing', status: 'running' }],
      storedCount: 1,
    })

    expect(receipt).toMatchObject({
      primaryJobId: 'job-1',
      primaryJobStatus: 'running',
      statusLabel: 'Processing',
      title: 'Manual note intake is enriching 1 material',
      tone: 'active',
    })
    expect(receipt?.detail).toContain('current stage is parsing')
    expect(receipt?.metrics).toContainEqual({ label: 'Active', value: '1' })
  })

  it('flags failed intake batches without losing the stored original', () => {
    const receipt = buildSourceIntakeReceiptViewModel({
      connectorLabel: 'Web URL',
      jobs: [
        { error_message: 'Parser failed', id: 'job-1', stage: 'parsing', status: 'failed' },
        { id: 'job-2', stage: 'published', status: 'completed' },
      ],
      storedCount: 2,
    })

    expect(receipt).toMatchObject({
      primaryJobId: 'job-1',
      primaryJobStatus: 'failed',
      statusLabel: 'Needs review',
      title: 'Web URL intake has 1 issue',
      tone: 'failed',
    })
    expect(receipt?.detail).toContain('Originals are retained')
    expect(receipt?.metrics).toContainEqual({ label: 'Issues', value: '1' })
  })

  it('summarizes completed intake batches as published ledger work', () => {
    const receipt = buildSourceIntakeReceiptViewModel({
      connectorLabel: 'File upload',
      jobs: [
        { id: 'job-1', stage: 'published', status: 'completed' },
        { id: 'job-2', stage: 'published', status: 'completed' },
      ],
      storedCount: 2,
    })

    expect(receipt).toMatchObject({
      primaryJobId: 'job-1',
      primaryJobStatus: 'completed',
      statusLabel: 'Published',
      title: 'File upload intake completed',
      tone: 'complete',
    })
    expect(receipt?.ariaLabel).toContain('All ingestion jobs completed')
    expect(receipt?.metrics).toContainEqual({ label: 'Complete', value: '2' })
  })

  it('builds material audit links with pinned job and recovery status', () => {
    const link = buildSourceTimelineAuditLinkViewModel({
      job: { id: '019f7f60-a88c-7173-a34f-714a82288d4a', status: 'failed' },
      sourceName: 'Board memo.pdf',
      spaceId: 'space-a',
    })

    expect(link).toMatchObject({
      href: '/spaces/space-a/jobs?job=019f7f60-a88c-7173-a34f-714a82288d4a&status=failed',
      jobLabel: '019f7f60',
      label: 'Review audit link',
      statusLabel: 'failed',
    })
    expect(link.ariaLabel).toContain('Board memo.pdf')
    expect(link.detail).toContain('recovery state pinned')
  })

  it('builds completed material audit links into the published filter', () => {
    const link = buildSourceTimelineAuditLinkViewModel({
      job: { id: 'job-1', status: 'completed' },
      sourceName: 'Published note',
      spaceId: 'space-a',
    })

    expect(link).toMatchObject({
      href: '/spaces/space-a/jobs?job=job-1&status=completed',
      label: 'Open audit link',
      statusLabel: 'completed',
    })
    expect(link.detail).toContain('published evidence ledger')
  })

  it('falls back to the space timeline when there is no pinned job', () => {
    const link = buildSourceTimelineAuditLinkViewModel({
      job: null,
      sourceName: 'Unprocessed source',
      spaceId: 'space-a',
    })

    expect(link).toMatchObject({
      href: '/spaces/space-a/jobs',
      jobLabel: 'not pinned',
      label: 'Open timeline',
      statusLabel: 'all jobs',
    })
  })
})
