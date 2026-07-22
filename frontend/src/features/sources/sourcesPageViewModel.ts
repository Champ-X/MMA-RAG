export {
  buildSourceTimelineAuditLinkViewModel,
  type SourceTimelineAuditJobSnapshot,
  type SourceTimelineAuditLinkViewModel,
} from '@/components/nexus/sourceTimelineAuditLinkViewModel'

export type ManualNoteDraftState = 'empty' | 'missing_title' | 'ready'

export type ManualNoteDraftSignal = {
  detail: string
  label: string
  value: string
}

export type ManualNoteDraftViewModel = {
  canImport: boolean
  detail: string
  importLabel: string
  previewMarkdown: string
  signals: ManualNoteDraftSignal[]
  state: ManualNoteDraftState
  stateLabel: string
  title: string
}

export type ManualNoteDraftAutosaveRecord = {
  content: string
  savedAt: string
  spaceId: string
  title: string
}

export type ManualNoteDraftAutosaveNotice = {
  detail: string
  discardLabel: string
  restoreLabel: string
  savedLabel: string
  title: string
}

export type ManualNoteDraftAutosaveBeacon = {
  ariaLabel: string
  detail: string
  label: string
  savedLabel: string
}

export type SourceIntakeJobSnapshot = {
  error_message?: string | null
  id: string
  stage: string
  status: string
}

export type SourceIntakeReceiptMetric = {
  label: string
  value: string
}

export type SourceIntakeReceiptTone = 'active' | 'complete' | 'failed' | 'stored'

export type SourceIntakeReceiptViewModel = {
  ariaLabel: string
  detail: string
  metrics: SourceIntakeReceiptMetric[]
  primaryJobId?: string
  primaryJobStatus?: string
  statusLabel: string
  title: string
  tone: SourceIntakeReceiptTone
}

export type SourceUploadActionViewModelInput = {
  errorMessage?: string
  fileCount?: number
  pending: boolean
}

export type SourceUploadActionViewModel = {
  ariaDisabled: boolean
  browseLabel: string
  canChoose: boolean
  disabledDetail?: string
  dropzoneDetail: string
  dropzoneLabel: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
}

export type MaterialLibraryRefreshFeedbackTone = 'error' | 'pending' | 'ready'

export type MaterialLibraryRefreshViewModelInput = {
  attentionCount: number
  errorMessage?: string
  filteredCount: number
  filterText: string
  lastRefreshLabel?: string
  pending: boolean
  processingCount: number
  totalCount: number
}

export type MaterialLibraryRefreshViewModel = {
  ariaDisabled: boolean
  canRefresh: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: MaterialLibraryRefreshFeedbackTone
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  submitLabel: string
}

export type SourceMaterialAction = 'refresh' | 'reprocess' | 'retry'

export type SourceMaterialActionViewModelInput = {
  action?: SourceMaterialAction
  errorMessage?: string
  jobCount?: number
  pending: boolean
  sourceName?: string
}

export type SourceMaterialActionViewModel = {
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

export type SourceMaterialActionButtonGateViewModelInput = {
  action: SourceMaterialAction
  pending: boolean
  sourceName: string
}

export type SourceMaterialActionButtonGateViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  detail?: string
}

export type MaterialBatchAction = 'delete' | 'reprocess'

export type MaterialBatchActionViewModelInput = {
  action?: MaterialBatchAction
  affectedCount?: number
  errorMessage?: string
  jobCount?: number
  pending: boolean
  selectedCount: number
}

export type MaterialBatchActionViewModel = {
  canDelete: boolean
  canReprocess: boolean
  deleteAriaDisabled: boolean
  deleteDisabledDetail?: string
  deleteLabel: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  reprocessAriaDisabled: boolean
  reprocessDisabledDetail?: string
  reprocessLabel: string
  role: 'alert' | 'status'
  selectionDetail: string
  selectionLabel: string
  visible: boolean
}

export type SourceConnectorKind = 'folder' | 'git' | 'image_search' | 'markdown' | 'news' | 'rss' | 'url'
export type SourceConnectorReadiness = 'ready' | 'setup'

export type SourceConnectorImportViewModelInput = {
  connectorKind: SourceConnectorKind
  connectorLabel: string
  errorMessage?: string
  manualNote?: Pick<ManualNoteDraftViewModel, 'canImport' | 'detail' | 'importLabel' | 'stateLabel'>
  pending: boolean
  readiness: SourceConnectorReadiness
  requiredLabel?: string
  requiredReady: boolean
}

export type SourceConnectorImportViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'blocked' | 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  requiredInvalid: boolean
  role: 'alert' | 'status'
  submitLabel: string
}

export type MaterialDeleteActionViewModelInput = {
  deletedName?: string
  errorMessage?: string
  pending: boolean
  sourceName?: string
}

export type MaterialDeleteActionViewModel = {
  ariaDisabled: boolean
  canDelete: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  visible: boolean
}

const defaultManualNoteTitle = 'Manual note'
const terminalJobStatuses = new Set(['completed', 'failed', 'cancelled'])

function materialCountLabel(count: number) {
  return `${count} original${count === 1 ? '' : 's'}`
}

function uploadFileCountLabel(count: number) {
  return `${count} file${count === 1 ? '' : 's'}`
}

function jobCountLabel(count: number) {
  return `${count} ingestion job${count === 1 ? '' : 's'}`
}

function materialActionLabel(action?: SourceMaterialAction) {
  if (action === 'refresh') return 'Upstream check'
  if (action === 'reprocess') return 'Reparse'
  if (action === 'retry') return 'Retry'
  return 'Material action'
}

function materialActionVerb(action?: SourceMaterialAction) {
  if (action === 'refresh') return 'checking upstream for a newer retained version'
  if (action === 'reprocess') return 'reparsing the retained original'
  if (action === 'retry') return 'retrying the failed ingestion stage'
  return 'updating the material'
}

function batchActionLabel(action?: MaterialBatchAction) {
  if (action === 'delete') return 'Batch delete'
  if (action === 'reprocess') return 'Batch reparse'
  return 'Batch action'
}

function batchActionVerb(action?: MaterialBatchAction) {
  if (action === 'delete') return 'removing selected materials from every Space while retaining audit tombstones'
  if (action === 'reprocess') return 'queueing fresh parsing jobs for selected retained originals'
  return 'updating selected materials'
}

function sourceConnectorSetupDetail(kind: SourceConnectorKind, label: string) {
  if (kind === 'folder') return 'Configure at least one allowed folder root before importing from mounted storage.'
  if (kind === 'news') return 'Configure Tavily news search before materializing news results.'
  if (kind === 'image_search') return 'Choose an available image provider before importing image search results.'
  return `${label} is not available in the current runtime policy.`
}

export function buildSourceUploadActionViewModel({
  errorMessage,
  fileCount = 0,
  pending,
}: SourceUploadActionViewModelInput): SourceUploadActionViewModel {
  if (pending) {
    const countDetail = fileCount > 0
      ? `Storing ${uploadFileCountLabel(fileCount)} as retained originals before parsing starts.`
      : 'Storing selected originals before parsing starts.'
    return {
      ariaDisabled: true,
      browseLabel: 'Storing originals...',
      canChoose: false,
      disabledDetail: 'Upload is locked while selected originals are being stored and queued for durable ingestion.',
      dropzoneDetail: 'The upload request is in progress; existing material remains available.',
      dropzoneLabel: 'Storing originals...',
      feedbackDetail: `${countDetail} Ingestion jobs will appear in the durable timeline.`,
      feedbackLabel: 'Upload in progress',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
    }
  }

  if (errorMessage) {
    return {
      ariaDisabled: false,
      browseLabel: 'Try files again',
      canChoose: true,
      dropzoneDetail: 'The previous upload did not complete. The retained register is unchanged.',
      dropzoneLabel: 'Upload failed',
      feedbackDetail: `${errorMessage} Choose files again or try a smaller batch.`,
      feedbackLabel: 'Upload failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
    }
  }

  return {
    ariaDisabled: false,
    browseLabel: 'Browse files',
    canChoose: true,
    dropzoneDetail: 'Documents, images, audio, video and tabular data are stored before enrichment.',
    dropzoneLabel: 'Drop files or a folder',
    feedbackDetail: 'Ready to store originals first. Parsing and enrichment will be tracked as durable ingestion jobs.',
    feedbackLabel: 'Direct upload ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
  }
}

export function buildSourceConnectorImportViewModel({
  connectorKind,
  connectorLabel,
  errorMessage,
  manualNote,
  pending,
  readiness,
  requiredLabel = 'required field',
  requiredReady,
}: SourceConnectorImportViewModelInput): SourceConnectorImportViewModel {
  const manualNoteReady = connectorKind !== 'markdown' || Boolean(manualNote?.canImport)

  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: `${connectorLabel} import is locked while originals are being stored and ingestion jobs are queued.`,
      feedbackDetail: `Storing ${connectorLabel} originals first, then queueing parsing and enrichment as durable ingestion jobs.`,
      feedbackLabel: `Importing ${connectorLabel}`,
      feedbackTone: 'pending',
      liveMode: 'polite',
      requiredInvalid: false,
      role: 'status',
      submitLabel: 'Importing...',
    }
  }

  if (errorMessage) {
    const canSubmit = readiness === 'ready' && requiredReady && manualNoteReady
    return {
      ariaDisabled: !canSubmit,
      canSubmit,
      disabledDetail: canSubmit ? undefined : `Correct ${requiredLabel} before retrying ${connectorLabel} import.`,
      feedbackDetail: `${errorMessage} Correct the source contract or retry; retained originals from prior imports remain unchanged.`,
      feedbackLabel: `${connectorLabel} import failed`,
      feedbackTone: 'error',
      liveMode: 'assertive',
      requiredInvalid: false,
      role: 'alert',
      submitLabel: 'Try import again',
    }
  }

  if (readiness === 'setup') {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: sourceConnectorSetupDetail(connectorKind, connectorLabel),
      feedbackDetail: sourceConnectorSetupDetail(connectorKind, connectorLabel),
      feedbackLabel: `${connectorLabel} setup required`,
      feedbackTone: 'blocked',
      liveMode: 'polite',
      requiredInvalid: false,
      role: 'status',
      submitLabel: 'Setup required',
    }
  }

  if (connectorKind === 'markdown' && !manualNoteReady) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: manualNote?.detail ?? 'Complete the manual note draft before importing.',
      feedbackDetail: manualNote?.detail ?? 'Complete the manual note draft before importing.',
      feedbackLabel: manualNote?.stateLabel ?? 'Manual note incomplete',
      feedbackTone: 'blocked',
      liveMode: 'polite',
      requiredInvalid: true,
      role: 'status',
      submitLabel: manualNote?.importLabel ?? 'Complete manual note',
    }
  }

  if (!requiredReady) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      disabledDetail: `Fill ${requiredLabel} before importing so the retained Source contract is auditable.`,
      feedbackDetail: `Fill ${requiredLabel} before importing so the retained Source contract is auditable.`,
      feedbackLabel: `${requiredLabel} required`,
      feedbackTone: 'blocked',
      liveMode: 'polite',
      requiredInvalid: true,
      role: 'status',
      submitLabel: `Add ${requiredLabel}`,
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
    feedbackDetail: `Ready to store ${connectorLabel} originals before parsing; evidence projection will be tracked in the ingestion timeline.`,
    feedbackLabel: `${connectorLabel} import ready`,
    feedbackTone: 'ready',
    liveMode: 'polite',
    requiredInvalid: false,
    role: 'status',
    submitLabel: `Import ${connectorLabel}`,
  }
}

export function buildMaterialDeleteActionViewModel({
  deletedName,
  errorMessage,
  pending,
  sourceName,
}: MaterialDeleteActionViewModelInput): MaterialDeleteActionViewModel {
  const sourceLabel = sourceName?.trim() || deletedName?.trim() || 'this material'

  if (pending) {
    return {
      ariaDisabled: true,
      canDelete: false,
      disabledDetail: `Delete is locked while ${sourceLabel} is being removed from active material registers.`,
      feedbackDetail: `Deleting ${sourceLabel} from active material registers. Audit tombstones and historical Run references remain intact.`,
      feedbackLabel: 'Deleting material',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorMessage) {
    return {
      ariaDisabled: false,
      canDelete: true,
      feedbackDetail: `${errorMessage} ${sourceLabel} remains in the register and can be retried.`,
      feedbackLabel: 'Material delete failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (deletedName) {
    return {
      ariaDisabled: false,
      canDelete: true,
      feedbackDetail: `${deletedName} was removed from the active register. Audit tombstones remain available for historical traces.`,
      feedbackLabel: 'Material deleted',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  return {
    ariaDisabled: false,
    canDelete: true,
    feedbackDetail: 'Delete removes one material from active registers while preserving audit tombstones.',
    feedbackLabel: 'Material delete ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}

export function buildMaterialLibraryRefreshViewModel({
  attentionCount,
  errorMessage,
  filteredCount,
  filterText,
  lastRefreshLabel,
  pending,
  processingCount,
  totalCount,
}: MaterialLibraryRefreshViewModelInput): MaterialLibraryRefreshViewModel {
  const filterDetail = filterText.trim()
    ? `${materialCountLabel(filteredCount)} match "${filterText.trim()}".`
    : `${materialCountLabel(totalCount)} visible in this Space.`
  const healthDetail = `${attentionCount} need attention; ${processingCount} still processing.`

  if (pending) {
    return {
      ariaDisabled: true,
      canRefresh: false,
      disabledDetail: 'Material refresh is locked while retained originals, health summaries and schedules are updating.',
      feedbackDetail: 'Refreshing retained originals, health summaries, schedules and the Space portrait.',
      feedbackLabel: 'Refreshing material register',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Refreshing...',
    }
  }

  if (errorMessage) {
    return {
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: `${errorMessage} The current material register remains visible while you retry.`,
      feedbackLabel: 'Material refresh failed',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try refresh again',
    }
  }

  if (lastRefreshLabel) {
    return {
      ariaDisabled: false,
      canRefresh: true,
      feedbackDetail: `${lastRefreshLabel}; refreshed ${materialCountLabel(totalCount)}. ${filterDetail} ${healthDetail}`,
      feedbackLabel: 'Material register refreshed',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Refresh again',
    }
  }

  return {
    ariaDisabled: false,
    canRefresh: true,
    feedbackDetail: `Refresh retained originals, health summaries and the Space portrait. ${filterDetail} ${healthDetail}`,
    feedbackLabel: 'Material refresh ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    submitLabel: 'Refresh',
  }
}

export function buildSourceMaterialActionViewModel({
  action,
  errorMessage,
  jobCount,
  pending,
  sourceName,
}: SourceMaterialActionViewModelInput): SourceMaterialActionViewModel {
  const actionLabel = materialActionLabel(action)
  const sourceLabel = sourceName?.trim() || 'this material'

  if (pending) {
    return {
      feedbackDetail: `${actionLabel} is ${materialActionVerb(action)} for ${sourceLabel}. Existing evidence remains available until a new job publishes.`,
      feedbackLabel: `${actionLabel} in progress`,
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  if (errorMessage) {
    return {
      feedbackDetail: `${errorMessage} ${sourceLabel} remains in the register and can be retried.`,
      feedbackLabel: `${actionLabel} failed`,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      visible: true,
    }
  }

  if (jobCount !== undefined) {
    return {
      feedbackDetail: `${actionLabel} queued ${jobCountLabel(jobCount)} for ${sourceLabel}. Track durable progress from the audit link or timeline.`,
      feedbackLabel: `${actionLabel} queued`,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      visible: true,
    }
  }

  return {
    feedbackDetail: 'Retry, reparse and upstream checks enqueue durable ingestion jobs while retained originals stay available.',
    feedbackLabel: 'Material actions ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    visible: false,
  }
}

export function buildSourceMaterialActionButtonGateViewModel({
  action,
  pending,
  sourceName,
}: SourceMaterialActionButtonGateViewModelInput): SourceMaterialActionButtonGateViewModel {
  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      detail: `${materialActionLabel(action)} is locked while another material action is running. ${sourceName} remains available in the register.`,
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
  }
}

export function buildMaterialBatchActionViewModel({
  action,
  affectedCount,
  errorMessage,
  jobCount,
  pending,
  selectedCount,
}: MaterialBatchActionViewModelInput): MaterialBatchActionViewModel {
  const hasSelection = selectedCount > 0
  const actionLabel = batchActionLabel(action)
  const selectedLabel = `${selectedCount} material${selectedCount === 1 ? '' : 's'} selected`

  if (pending) {
    const pendingDetail = `${actionLabel} is ${batchActionVerb(action)}. Keep this page open until the request settles.`
    return {
      canDelete: false,
      canReprocess: false,
      deleteAriaDisabled: true,
      deleteDisabledDetail: pendingDetail,
      deleteLabel: action === 'delete' ? 'Deleting...' : 'Delete',
      feedbackDetail: pendingDetail,
      feedbackLabel: `${actionLabel} in progress`,
      feedbackTone: 'pending',
      liveMode: 'polite',
      reprocessAriaDisabled: true,
      reprocessDisabledDetail: pendingDetail,
      reprocessLabel: action === 'reprocess' ? 'Reparsing...' : 'Reparse',
      role: 'status',
      selectionDetail: 'The selected set is locked while the batch request is running.',
      selectionLabel: selectedLabel,
      visible: true,
    }
  }

  if (errorMessage) {
    return {
      canDelete: hasSelection,
      canReprocess: hasSelection,
      deleteAriaDisabled: !hasSelection,
      deleteDisabledDetail: hasSelection ? undefined : 'Select one or more materials before retrying batch delete.',
      deleteLabel: 'Try delete again',
      feedbackDetail: `${errorMessage} The selected materials remain unchanged and can be retried.`,
      feedbackLabel: `${actionLabel} failed`,
      feedbackTone: 'error',
      liveMode: 'assertive',
      reprocessAriaDisabled: !hasSelection,
      reprocessDisabledDetail: hasSelection ? undefined : 'Select one or more materials before retrying batch reparse.',
      reprocessLabel: 'Try reparse again',
      role: 'alert',
      selectionDetail: hasSelection
        ? 'Review the error, then retry or clear the selection.'
        : 'No active selection remains; refresh the register before retrying.',
      selectionLabel: selectedLabel,
      visible: true,
    }
  }

  if (affectedCount !== undefined) {
    const countLabel = `${affectedCount} material${affectedCount === 1 ? '' : 's'}`
    const queuedDetail = action === 'reprocess'
      ? `Queued ${jobCountLabel(jobCount ?? 0)} for ${countLabel}. Track durable progress from the ingestion timeline.`
      : `Removed ${countLabel} from the active register. Audit tombstones remain available for historical traces.`
    return {
      canDelete: hasSelection,
      canReprocess: hasSelection,
      deleteAriaDisabled: !hasSelection,
      deleteDisabledDetail: hasSelection ? undefined : 'Select one or more materials before starting another batch delete.',
      deleteLabel: 'Delete',
      feedbackDetail: queuedDetail,
      feedbackLabel: `${actionLabel} completed`,
      feedbackTone: 'ready',
      liveMode: 'polite',
      reprocessAriaDisabled: !hasSelection,
      reprocessDisabledDetail: hasSelection ? undefined : 'Select one or more materials before starting another batch reparse.',
      reprocessLabel: 'Reparse',
      role: 'status',
      selectionDetail: hasSelection
        ? 'A previous batch completed; the current selection is ready for another operation.'
        : 'The previous selection was cleared after the batch completed.',
      selectionLabel: selectedLabel,
      visible: true,
    }
  }

  return {
    canDelete: hasSelection,
    canReprocess: hasSelection,
    deleteAriaDisabled: !hasSelection,
    deleteDisabledDetail: hasSelection ? undefined : 'Select one or more materials before starting batch delete.',
    deleteLabel: 'Delete',
    feedbackDetail: hasSelection
      ? 'Choose Reparse to enqueue fresh parsing, or Delete to remove selected materials with audit tombstones.'
      : 'Select materials to unlock batch reparse or delete.',
    feedbackLabel: hasSelection ? 'Batch action ready' : 'No batch selection',
    feedbackTone: 'ready',
    liveMode: 'polite',
    reprocessAriaDisabled: !hasSelection,
    reprocessDisabledDetail: hasSelection ? undefined : 'Select one or more materials before starting batch reparse.',
    reprocessLabel: 'Reparse',
    role: 'status',
    selectionDetail: hasSelection
      ? 'Batch operations apply to the exact selected materials shown in this register.'
      : 'Select one or more materials from the register.',
    selectionLabel: selectedLabel,
    visible: hasSelection,
  }
}

export function buildManualNoteDraftViewModel(
  title: string,
  content: string,
): ManualNoteDraftViewModel {
  const trimmedTitle = title.trim()
  const trimmedContent = content.trim()
  const headingCount = trimmedContent
    ? trimmedContent.split('\n').filter((line) => /^#{1,6}\s+\S/.test(line)).length
    : 0
  const linkCount = trimmedContent.match(/\[[^\]]+\]\([^)]+\)/g)?.length ?? 0
  const characterCount = content.length
  const signals = [
    {
      detail: trimmedTitle
        ? 'Used as the retained original filename and material title.'
        : 'A title is required before the note can be stored.',
      label: 'Title',
      value: trimmedTitle ? 'Named' : 'Missing',
    },
    {
      detail: 'The exact Markdown body is stored before parsing.',
      label: 'Body',
      value: `${characterCount} chars`,
    },
    {
      detail: linkCount
        ? `${linkCount} Markdown link${linkCount === 1 ? '' : 's'} will remain in the retained original.`
        : 'Headings improve later chunk navigation and review.',
      label: 'Structure',
      value: headingCount ? `${headingCount} heading${headingCount === 1 ? '' : 's'}` : 'Flat note',
    },
  ]

  if (!trimmedTitle) {
    return {
      canImport: false,
      detail: 'Name this manual note before storing it as a durable Source.',
      importLabel: 'Add note title',
      previewMarkdown: trimmedContent,
      signals,
      state: 'missing_title',
      stateLabel: 'Needs title',
      title: 'Manual note composer',
    }
  }

  if (!trimmedContent) {
    return {
      canImport: false,
      detail: 'Write Markdown content before creating the Source Version.',
      importLabel: 'Add note content',
      previewMarkdown: '',
      signals,
      state: 'empty',
      stateLabel: 'Needs content',
      title: 'Manual note composer',
    }
  }

  return {
    canImport: true,
    detail: 'Import stores the exact Markdown original, then parsing creates searchable Evidence.',
    importLabel: 'Import manual note',
    previewMarkdown: content,
    signals,
    state: 'ready',
    stateLabel: 'Ready to import',
    title: 'Manual note composer',
  }
}

export function buildManualNoteDraftAutosaveKey(spaceId: string) {
  return `nexus.manual-note-draft.${spaceId}`
}

export function buildManualNoteDraftAutosaveRecord(
  spaceId: string,
  title: string,
  content: string,
  savedAt: Date = new Date(),
): ManualNoteDraftAutosaveRecord {
  return {
    content,
    savedAt: savedAt.toISOString(),
    spaceId,
    title,
  }
}

export function parseManualNoteDraftAutosaveRecord(
  value: string | null,
  spaceId: string,
): ManualNoteDraftAutosaveRecord | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Partial<ManualNoteDraftAutosaveRecord>
  if (
    record.spaceId !== spaceId
    || typeof record.title !== 'string'
    || typeof record.content !== 'string'
    || typeof record.savedAt !== 'string'
  ) {
    return null
  }
  return {
    content: record.content,
    savedAt: record.savedAt,
    spaceId: record.spaceId,
    title: record.title,
  }
}

export function parseRecoverableManualNoteDraftAutosaveRecord(
  value: string | null,
  spaceId: string,
): ManualNoteDraftAutosaveRecord | null {
  const record = parseManualNoteDraftAutosaveRecord(value, spaceId)
  if (!record) return null
  if (record.title === defaultManualNoteTitle && !record.content.trim()) return null
  return record
}

export function buildManualNoteDraftAutosaveNotice(
  record: ManualNoteDraftAutosaveRecord,
): ManualNoteDraftAutosaveNotice {
  return {
    detail: 'A browser-saved manual Markdown draft is available for this Space. Restore it to continue, or discard it to start clean.',
    discardLabel: 'Discard draft',
    restoreLabel: 'Restore draft',
    savedLabel: `Session save · ${record.savedAt.replace('T', ' ').replace('.000Z', 'Z')}`,
    title: 'Manual note draft recovered',
  }
}

export function buildManualNoteDraftAutosaveBeacon(
  record: ManualNoteDraftAutosaveRecord,
): ManualNoteDraftAutosaveBeacon {
  const savedLabel = `Session save · ${record.savedAt.replace('T', ' ').replace('.000Z', 'Z')}`
  return {
    ariaLabel: `Manual note session draft available. ${savedLabel}. Open Manual note to review it.`,
    detail: 'Open Manual note to review the browser-saved draft.',
    label: 'Draft saved',
    savedLabel,
  }
}

export function buildSourceIntakeReceiptViewModel({
  connectorLabel,
  jobs,
  storedCount,
}: {
  connectorLabel: string
  jobs: SourceIntakeJobSnapshot[]
  storedCount: number
}): SourceIntakeReceiptViewModel | null {
  if (storedCount <= 0) return null

  const activeJobs = jobs.filter((job) => !terminalJobStatuses.has(job.status))
  const failedJobs = jobs.filter((job) => job.status === 'failed' || job.status === 'cancelled')
  const completedJobs = jobs.filter((job) => job.status === 'completed')
  const materialLabel = `${storedCount} material${storedCount === 1 ? '' : 's'}`
  const primaryJob = failedJobs[0] ?? activeJobs[0] ?? jobs[0]
  const primaryJobId = primaryJob?.id
  const primaryJobStatus = primaryJob?.status
  const metrics = [
    { label: 'Stored', value: String(storedCount) },
    { label: 'Active', value: String(activeJobs.length) },
    { label: 'Complete', value: String(completedJobs.length) },
    { label: 'Issues', value: String(failedJobs.length) },
  ]

  if (failedJobs.length > 0) {
    const issueLabel = `${failedJobs.length} issue${failedJobs.length === 1 ? '' : 's'}`
    return {
      ariaLabel: `${connectorLabel} intake stored ${materialLabel} with ${issueLabel}. Open ingestion timeline to inspect failed stages.`,
      detail: 'Originals are retained. Open the durable timeline to inspect parser events and retry the failed stage.',
      metrics,
      primaryJobId,
      primaryJobStatus,
      statusLabel: 'Needs review',
      title: `${connectorLabel} intake has ${issueLabel}`,
      tone: 'failed',
    }
  }

  if (activeJobs.length > 0) {
    const stage = activeJobs[0].stage.replaceAll('_', ' ')
    return {
      ariaLabel: `${connectorLabel} intake stored ${materialLabel}. ${activeJobs.length} ingestion job${activeJobs.length === 1 ? '' : 's'} still active.`,
      detail: `Originals are stored. Evidence projection is updating now; current stage is ${stage}.`,
      metrics,
      primaryJobId,
      primaryJobStatus,
      statusLabel: 'Processing',
      title: `${connectorLabel} intake is enriching ${materialLabel}`,
      tone: 'active',
    }
  }

  if (jobs.length > 0 && completedJobs.length === jobs.length) {
    return {
      ariaLabel: `${connectorLabel} intake stored ${materialLabel}. All ingestion jobs completed.`,
      detail: 'Every job in this intake batch reached the published evidence ledger.',
      metrics,
      primaryJobId,
      primaryJobStatus,
      statusLabel: 'Published',
      title: `${connectorLabel} intake completed`,
      tone: 'complete',
    }
  }

  return {
    ariaLabel: `${connectorLabel} intake stored ${materialLabel}. Ingestion status will appear in the timeline.`,
    detail: 'Originals are stored before parsing. Open the timeline to inspect retained stage events.',
    metrics,
    primaryJobId,
    primaryJobStatus,
    statusLabel: 'Stored',
    title: `${connectorLabel} intake stored ${materialLabel}`,
    tone: 'stored',
  }
}
