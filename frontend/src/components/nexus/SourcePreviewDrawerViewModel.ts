import type { SourceVersion } from '@/api/nexus'

export type SourceReadinessStep = {
  key: 'original' | 'evidence' | 'projection'
  label: string
  detail: string
  state: 'ready' | 'waiting'
}

export type SourcePreviewSignal = {
  label: string
  value: string
  detail: string
}

export type SourcePreviewViewModel = {
  contractSignals: SourcePreviewSignal[]
  materialSummary: string
  nativeAudioLabel: string
  nativeVideoLabel: string
  readinessSteps: SourceReadinessStep[]
  syncSummary: {
    label: string
    detail: string
  }
}

export type SourceNoteEditorState = 'empty' | 'ready' | 'unchanged'

export type SourceNoteEditorSignal = {
  detail: string
  label: string
  value: string
}

export type SourceNoteEditorViewModel = {
  canSave: boolean
  detail: string
  hasUnsavedChanges: boolean
  saveLabel: string
  signals: SourceNoteEditorSignal[]
  state: SourceNoteEditorState
  stateLabel: string
  title: string
}

export type SourceNoteVersionActionViewModelInput = {
  currentVersionNo: number
  editor: SourceNoteEditorViewModel
  errorMessage?: string
  pending: boolean
  previousVersionNo?: number
  savedVersionNo?: number
  sourceName: string
}

export type SourceNoteVersionActionViewModel = {
  ariaDisabled: boolean
  canSave: boolean
  disabledDetail?: string
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'blocked' | 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  saveLabel: string
  visible: boolean
}

export type SourceNoteDiscardConfirmation = {
  body: string
  confirmLabel: string
  title: string
  tone: 'danger'
}

export type SourcePreviewActionKind = 'refresh' | 'reprocess' | 'retry' | 'schedule'

export type SourcePreviewActionViewModelInput = {
  action?: SourcePreviewActionKind | null
  errorMessage?: string
  message?: string
  pending: boolean
  sourceName: string
}

export type SourcePreviewActionViewModel = {
  detail: string
  label: string
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  tone: 'error' | 'pending' | 'ready'
  visible: boolean
}

export type SourcePreviewActionButtonGateViewModelInput = {
  action: SourcePreviewActionKind
  blockedDetail?: string
  pending: boolean
  sourceName: string
}

export type SourcePreviewActionButtonGateViewModel = {
  ariaDisabled: boolean
  canSubmit: boolean
  detail?: string
}

function sourcePreviewActionLabel(action?: SourcePreviewActionKind | null) {
  if (action === 'refresh') return 'Upstream check'
  if (action === 'reprocess') return 'Reparse'
  if (action === 'retry') return 'Retry'
  if (action === 'schedule') return 'Schedule update'
  return 'Source action'
}

function sourcePreviewPendingDetail(action: SourcePreviewActionKind | null | undefined, sourceName: string) {
  if (action === 'refresh') return `Checking upstream for ${sourceName}; retained evidence stays available until a new version publishes.`
  if (action === 'reprocess') return `Queueing a reparse for ${sourceName} from the retained original.`
  if (action === 'retry') return `Retrying the failed ingestion stage for ${sourceName}.`
  if (action === 'schedule') return `Updating the automatic check cadence for ${sourceName}.`
  return `Updating ${sourceName}.`
}

export function buildSourcePreviewActionButtonGateViewModel({
  action,
  blockedDetail,
  pending,
  sourceName,
}: SourcePreviewActionButtonGateViewModelInput): SourcePreviewActionButtonGateViewModel {
  if (pending) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      detail: `${sourcePreviewActionLabel(action)} is locked while another Source action is running for ${sourceName}.`,
    }
  }

  if (blockedDetail) {
    return {
      ariaDisabled: true,
      canSubmit: false,
      detail: blockedDetail,
    }
  }

  return {
    ariaDisabled: false,
    canSubmit: true,
  }
}

export function buildSourcePreviewActionViewModel({
  action,
  errorMessage,
  message,
  pending,
  sourceName,
}: SourcePreviewActionViewModelInput): SourcePreviewActionViewModel {
  const actionLabel = sourcePreviewActionLabel(action)
  if (pending) {
    return {
      detail: sourcePreviewPendingDetail(action, sourceName),
      label: `${actionLabel} in progress`,
      liveMode: 'polite',
      role: 'status',
      tone: 'pending',
      visible: true,
    }
  }

  if (errorMessage) {
    return {
      detail: `${errorMessage} ${sourceName} remains unchanged and the action can be retried.`,
      label: `${actionLabel} failed`,
      liveMode: 'assertive',
      role: 'alert',
      tone: 'error',
      visible: true,
    }
  }

  if (message) {
    return {
      detail: message,
      label: `${actionLabel} completed`,
      liveMode: 'polite',
      role: 'status',
      tone: 'ready',
      visible: true,
    }
  }

  return {
    detail: 'Refresh, retry and reparse actions keep the retained original available while durable ingestion jobs run.',
    label: 'Source actions ready',
    liveMode: 'polite',
    role: 'status',
    tone: 'ready',
    visible: false,
  }
}

export function sourceVisualSectionCopy(source: SourceVersion, visualEvidenceCount: number) {
  if (source.derived_image_count > 0) {
    return {
      eyebrow: 'Extracted from document',
      title: `${visualEvidenceCount} citable visual${visualEvidenceCount === 1 ? '' : 's'} · ${source.derived_image_count} derived visual asset${source.derived_image_count === 1 ? '' : 's'}`,
    }
  }
  if (source.modality === 'image') {
    return {
      eyebrow: 'Original visual evidence',
      title: `${visualEvidenceCount} citable visual${visualEvidenceCount === 1 ? '' : 's'} · standalone image`,
    }
  }
  return {
    eyebrow: 'Visual evidence',
    title: `${visualEvidenceCount} citable visual${visualEvidenceCount === 1 ? '' : 's'} · no derived visual assets`,
  }
}

export function buildSourceNoteEditorViewModel(
  draft: string,
  original: string,
  source: SourceVersion,
): SourceNoteEditorViewModel {
  const nextVersion = source.version_no + 1
  const characterCount = draft.length
  const unchanged = normalizeNoteDraft(draft) === normalizeNoteDraft(original)
  const hasUnsavedChanges = !unchanged
  const empty = !draft.trim()
  const signals = [
    {
      detail: 'The retained Source Version stays immutable.',
      label: 'Current version',
      value: `v${source.version_no}`,
    },
    {
      detail: 'A saved edit becomes a new manual Markdown Source Version.',
      label: 'Next version',
      value: `v${nextVersion}`,
    },
    {
      detail: 'Whitespace is preserved in the stored original.',
      label: 'Draft size',
      value: `${characterCount} chars`,
    },
  ]

  if (empty) {
    return {
      canSave: false,
      detail: 'Add Markdown content before creating a new Source Version.',
      hasUnsavedChanges,
      saveLabel: 'Add note content',
      signals,
      state: 'empty',
      stateLabel: 'Needs content',
      title: 'Manual note editor',
    }
  }

  if (unchanged) {
    return {
      canSave: false,
      detail: 'This draft matches the retained original, so no new version is needed.',
      hasUnsavedChanges,
      saveLabel: 'No changes to save',
      signals,
      state: 'unchanged',
      stateLabel: 'No changes',
      title: 'Manual note editor',
    }
  }

  return {
    canSave: true,
    detail: `Saving creates immutable version v${nextVersion}; existing citations keep version v${source.version_no}.`,
    hasUnsavedChanges,
    saveLabel: `Save as v${nextVersion}`,
    signals,
    state: 'ready',
    stateLabel: 'Ready to version',
    title: 'Manual note editor',
  }
}

export function buildSourceNoteVersionActionViewModel({
  currentVersionNo,
  editor,
  errorMessage,
  pending,
  previousVersionNo,
  savedVersionNo,
  sourceName,
}: SourceNoteVersionActionViewModelInput): SourceNoteVersionActionViewModel {
  const nextVersionNo = currentVersionNo + 1

  if (pending) {
    return {
      ariaDisabled: true,
      canSave: false,
      disabledDetail: `Manual note save is locked while version v${nextVersionNo} is being created for ${sourceName}.`,
      feedbackDetail: `Creating immutable version v${nextVersionNo} for ${sourceName}. Existing citations stay bound to version v${currentVersionNo} while ingestion publishes the new Evidence.`,
      feedbackLabel: 'Creating Source Version',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      saveLabel: 'Creating version...',
      visible: true,
    }
  }

  if (errorMessage) {
    const canSave = editor.canSave
    return {
      ariaDisabled: !canSave,
      canSave,
      disabledDetail: canSave ? undefined : 'Fix the manual note draft before retrying Source Version creation.',
      feedbackDetail: `${errorMessage} ${sourceName} remains on version v${currentVersionNo}; the Markdown draft can be retried without changing existing citations.`,
      feedbackLabel: 'Source Version was not created',
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      saveLabel: canSave ? 'Try save again' : editor.saveLabel,
      visible: true,
    }
  }

  if (savedVersionNo) {
    const canSave = editor.canSave
    return {
      ariaDisabled: !canSave,
      canSave,
      disabledDetail: canSave ? undefined : 'Edit the Markdown draft before creating another Source Version.',
      feedbackDetail: `${sourceName} is now version v${savedVersionNo}. Existing citations remain on version v${previousVersionNo ?? savedVersionNo - 1}; new Evidence publishes from the retained Markdown original.`,
      feedbackLabel: 'Source Version created',
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      saveLabel: canSave ? editor.saveLabel : 'Version created',
      visible: true,
    }
  }

  const canSave = editor.canSave
  return {
    ariaDisabled: !canSave,
    canSave,
    disabledDetail: canSave ? undefined : editor.detail,
    feedbackDetail: editor.detail,
    feedbackLabel: editor.state === 'ready' ? 'Ready to create version' : editor.stateLabel,
    feedbackTone: editor.state === 'ready' ? 'ready' : 'blocked',
    liveMode: 'polite',
    role: 'status',
    saveLabel: editor.saveLabel,
    visible: editor.state !== 'unchanged',
  }
}

export function buildSourceNoteDiscardConfirmation(
  source: SourceVersion,
): SourceNoteDiscardConfirmation {
  return {
    body: (
      'This closes the manual note editor and discards the unsaved Markdown draft. '
      + `No Source Version will be created; existing citations remain on version v${source.version_no}.`
    ),
    confirmLabel: 'Discard note draft',
    title: 'Discard unsaved note changes?',
    tone: 'danger',
  }
}

export function buildSourcePreviewViewModel(source: SourceVersion, spaceId?: string): SourcePreviewViewModel {
  const schedule = (source.sync.schedules ?? []).find((item) => item.space_id === spaceId)
  const syncLabel = source.sync.refreshable
    ? source.sync.scope === 'source_set' ? 'Connected source set' : 'Connected source'
    : 'Snapshot material'

  return {
    contractSignals: [
      {
        label: 'Version',
        value: `v${source.version_no}`,
        detail: source.content_hash.slice(0, 8),
      },
      {
        label: 'Evidence',
        value: String(source.published_evidence_count),
        detail: source.health.searchable ? 'searchable' : 'not searchable',
      },
      {
        label: 'Visuals',
        value: String(source.derived_image_count),
        detail: source.cover_evidence_id ? 'cover ready' : 'no cover',
      },
      {
        label: 'Sync',
        value: source.sync.refreshable ? (schedule?.enabled ? 'auto' : 'manual') : 'sealed',
        detail: source.sync.refreshable ? source.sync.scope.replaceAll('_', ' ') : 'stored original',
      },
    ],
    materialSummary: `${source.connector_kind} · ${source.mime_type} · ${formatBytes(source.byte_size)}`,
    nativeAudioLabel: buildSourceNativeMediaLabel(source, 'audio'),
    nativeVideoLabel: buildSourceNativeMediaLabel(source, 'video'),
    readinessSteps: [
      {
        key: 'original',
        label: 'Original retained',
        detail: `${formatBytes(source.byte_size)} · immutable version ${source.version_no}`,
        state: 'ready',
      },
      {
        key: 'evidence',
        label: source.health.searchable ? 'Evidence searchable' : 'Evidence unavailable',
        detail: `${source.published_evidence_count} published Evidence Revision${source.published_evidence_count === 1 ? '' : 's'}`,
        state: source.health.searchable ? 'ready' : 'waiting',
      },
      {
        key: 'projection',
        label: `Advanced projection · ${formatLabel(source.projection.state)}`,
        detail: `${source.projection.active_evidence_count}/${source.projection.expected_evidence_count} evidence active`,
        state: source.projection.state === 'active' ? 'ready' : 'waiting',
      },
    ],
    syncSummary: {
      label: syncLabel,
      detail: source.sync.refreshable
        ? `Last checked ${new Date(source.sync.last_checked_at).toLocaleString()}`
        : 'Reparse uses the retained original only.',
    },
  }
}

export function buildSourceNativeMediaLabel(source: SourceVersion, modality: 'audio' | 'video') {
  const kind = modality === 'audio' ? 'Audio source preview' : 'Video source preview'
  return `${kind} for ${source.display_name} · version ${source.version_no} · ${formatBytes(source.byte_size)}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function formatLabel(value: string) {
  return value.replaceAll('_', ' ')
}

function normalizeNoteDraft(value: string) {
  return value.replace(/\r\n/g, '\n')
}
