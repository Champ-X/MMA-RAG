import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileSearch,
  Image as ImageIcon,
  Pause,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  SearchCheck,
  ShieldCheck,
  Table2,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { nexusApi, type SourceVersion } from '@/api/nexus'
import { buildEvidenceDetailPath } from '@/lib/evidenceRoutes'
import {
  focusTrapTargetElement,
  getFocusableElements,
  resolveFocusTrapAction,
} from '@/lib/focusTrap'
import { moveTabsValue, resolveHorizontalTabsDirection } from '@/lib/tabsKeyboard'
import { ConfirmDialog } from './ConfirmDialog'
import { LedgerSelect } from './LedgerSelect'
import { LoadingState } from './LoadingState'
import { PanelNote } from './PanelNote'
import { QueryErrorNotice } from './QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from './queryErrorNoticeViewModel'
import {
  buildSourcePreviewActionButtonGateViewModel,
  buildSourcePreviewActionViewModel,
  buildSourceNoteDiscardConfirmation,
  buildSourceNoteEditorViewModel,
  buildSourceNoteVersionActionViewModel,
  buildSourcePreviewViewModel,
  sourceVisualSectionCopy,
  type SourceNoteVersionActionViewModel,
  type SourcePreviewActionKind,
  type SourceNoteEditorViewModel,
  type SourceReadinessStep,
} from './SourcePreviewDrawerViewModel'
import { StatusMark } from './StatusMark'
import {
  buildSourceTimelineAuditLinkViewModel,
  type SourceTimelineAuditJobSnapshot,
} from './sourceTimelineAuditLinkViewModel'
import { SourceTypePill } from './SourceTypePill'
import { SubmitReadinessCard } from './SubmitReadinessCard'
import './SourcePreviewDrawer.css'

const label = (value: string) => value.replaceAll('_', ' ')
const scheduleOptions = [
  { value: 60, label: 'Hourly' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Daily' },
  { value: 10080, label: 'Weekly' },
]
const scheduleSelectOptions = scheduleOptions.map((item) => ({
  value: String(item.value),
  label: item.label,
  description: item.value === 60 ? 'Aggressive freshness checks.' : item.value === 1440 ? 'Balanced daily refresh.' : item.value === 10080 ? 'Low-noise weekly refresh.' : 'Scheduled upstream check.',
}))
const readinessIcons: Record<SourceReadinessStep['key'], typeof ShieldCheck> = {
  evidence: SearchCheck,
  original: ShieldCheck,
  projection: RefreshCw,
}

function saveRevisionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined
}

function SourceNoteEditor({
  action,
  draft,
  editor,
  error,
  feedbackId,
  onChange,
  onClose,
  onSave,
}: {
  action: SourceNoteVersionActionViewModel
  draft: string
  editor: SourceNoteEditorViewModel
  error?: Error | null
  feedbackId: string
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const gateId = `${feedbackId}-gate`
  return <section className={`source-note-editor ${editor.state}`}>
    <div>
      <span>
        <strong>{editor.title}</strong>
        <small>{editor.detail}</small>
      </span>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Close note editor">
        <X size={15} />
      </button>
    </div>
    <div
      aria-label="Manual note version checks"
      className="source-note-editor-ledger"
      id="source-note-editor-status"
    >
      <strong>{editor.stateLabel}</strong>
      {editor.signals.map((signal) => (
        <span key={signal.label} aria-label={`${signal.label}: ${signal.value}. ${signal.detail}`}>
          <small>{signal.label}</small>
          <b>{signal.value}</b>
          <em>{signal.detail}</em>
        </span>
      ))}
    </div>
    <textarea
      aria-describedby={`source-note-editor-status ${feedbackId}`}
      aria-invalid={editor.state === 'empty'}
      aria-label="Manual Markdown note"
      value={draft}
      onChange={(event) => onChange(event.target.value)}
      rows={18}
      spellCheck={false}
    />
    {error && <p className="form-error" role="alert">{error.message}</p>}
    <SubmitReadinessCard className="source-note-save-feedback" detail={action.feedbackDetail} id={feedbackId} label={action.feedbackLabel} liveMode={action.liveMode} pending={action.feedbackTone === 'pending'} role={action.role} tone={action.feedbackTone} visible={action.visible} />
    <button
      type="button"
      className="button primary"
      aria-describedby={`source-note-editor-status ${feedbackId}${action.disabledDetail ? ` ${gateId}` : ''}`}
      aria-disabled={action.ariaDisabled || undefined}
      onClick={() => { if (action.canSave) onSave() }}
    >
      <Save size={14} />
      {action.saveLabel}
    </button>
    {action.disabledDetail && <span className="sr-only" id={gateId}>{action.disabledDetail}</span>}
  </section>
}

export function SourcePreviewDrawer({ source: initialSource, spaceId, onClose }: { source: SourceVersion; spaceId?: string; onClose: () => void }) {
  const client = useQueryClient()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const actionFeedbackId = useId()
  const noteSaveFeedbackId = useId()
  const descriptionId = useId()
  const titleId = useId()
  const workbookPreviewId = useId()
  const sourceActionGateId = (action: SourcePreviewActionKind | 'pause-schedule') => `${actionFeedbackId}-${action}-gate`
  const [source, setSource] = useState(initialSource)
  const [actionKind, setActionKind] = useState<SourcePreviewActionKind | null>(null)
  const [actionJob, setActionJob] = useState<SourceTimelineAuditJobSnapshot | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  useEffect(() => setSource(initialSource), [initialSource])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [originalDraft, setOriginalDraft] = useState('')
  const [editError, setEditError] = useState('')
  const [noteVersionReceipt, setNoteVersionReceipt] = useState<{ previousVersionNo: number; savedVersionNo: number; sourceName: string } | null>(null)
  const [noteCloseTarget, setNoteCloseTarget] = useState<'drawer' | 'editor' | null>(null)
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }))
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      const previousFocus = previousFocusRef.current
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true })
      previousFocusRef.current = null
    }
  }, [])
  const evidence = useQuery({ queryKey: ['source-preview', source.source_id], queryFn: () => nexusApi.listEvidence({ sourceId: source.source_id, limit: 200 }) })
  const figures = useQuery({ queryKey: ['source-preview-figures', source.source_id], queryFn: () => nexusApi.listEvidence({ sourceId: source.source_id, modality: 'image', limit: 200 }) })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: evidence.error, hasData: Boolean(evidence.data), label: 'Published evidence', required: true },
    { error: figures.error, hasData: Boolean(figures.data), label: 'Visual evidence' },
  ])
  const retrySourcePreviewQueries = () => {
    void evidence.refetch()
    void figures.refetch()
  }
  const assetUrl = `/api/v1/assets/${source.id}`
  const chunks = useMemo(() => evidence.data?.items ?? [], [evidence.data?.items])
  const tablePreview = useMemo(() => {
    const rowBlocks = chunks.filter((item) => item.evidence_type === 'table_row_block' && item.text_content.trim())
    if (!rowBlocks.length) return null
    const sheetNames = Array.from(new Set(rowBlocks.map((item) => item.locator.sheet || 'Table')))
    const sheets = sheetNames.map((sheet) => {
      const blocks = rowBlocks.filter((item) => (item.locator.sheet || 'Table') === sheet)
      let header: string[] = []
      const rows: string[][] = []
      for (const block of blocks) {
        const parsed = block.text_content.split('\n').map((line) => line.split(' | ').map((cell) => cell.trim()))
        if (!header.length && parsed.length) header = parsed[0]
        for (const row of parsed.slice(1)) {
          if (row.some(Boolean) && rows.length < 100) rows.push(row)
        }
      }
      return { sheet, header, rows, range: blocks.map((item) => item.locator.cell_range).filter(Boolean).join(' · ') }
    })
    return sheets
  }, [chunks])
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const sheetTabRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})
  const sheetNames = useMemo(() => tablePreview?.map((sheet) => sheet.sheet) ?? [], [tablePreview])
  const selectedSheetIndex = tablePreview?.findIndex((sheet) => sheet.sheet === selectedSheetName) ?? -1
  const activeSheetIndex = selectedSheetIndex >= 0 ? selectedSheetIndex : 0
  const activeSheet = tablePreview?.[activeSheetIndex]
  const sheetTabId = (index: number) => `${workbookPreviewId}-sheet-tab-${index}`
  const sheetPanelId = (index: number) => `${workbookPreviewId}-sheet-panel-${index}`
  useEffect(() => {
    if (!sheetNames.length) {
      if (selectedSheetName) setSelectedSheetName('')
      return
    }
    if (!sheetNames.includes(selectedSheetName)) setSelectedSheetName(sheetNames[0])
  }, [selectedSheetName, sheetNames])
  const handleSheetTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveHorizontalTabsDirection(event.key)
    if (!direction || !sheetNames.length) return
    event.preventDefault()
    const currentSheetName = activeSheet?.sheet ?? sheetNames[0]
    const nextSheetName = moveTabsValue(sheetNames, currentSheetName, direction)
    setSelectedSheetName(nextSheetName)
    window.requestAnimationFrame(() => sheetTabRefs.current[nextSheetName]?.focus({ preventScroll: true }))
  }
  const visualEvidence = useMemo(() => {
    const byAsset = new Map<string, (typeof chunks)[number]>()
    for (const item of [...(figures.data?.items ?? []), ...chunks]) {
      const objectKey = typeof item.locator.extra?.object_key === 'string' ? item.locator.extra.object_key : ''
      if (objectKey && !byAsset.has(objectKey)) byAsset.set(objectKey, item)
    }
    return Array.from(byAsset.values())
  }, [chunks, figures.data?.items])
  const visualSectionCopy = sourceVisualSectionCopy(source, visualEvidence.length)
  const isPdf = source.mime_type === 'application/pdf' || source.display_name.toLowerCase().endsWith('.pdf')
  const isOfficeDocument = /wordprocessingml|msword|presentationml|powerpoint/.test(source.mime_type)
  const isManualMarkdown = source.connector_kind === 'markdown' && source.mime_type === 'text/markdown'
  const effectiveSpaceId = spaceId || source.space_ids[0]
  const previewModel = buildSourcePreviewViewModel(source, effectiveSpaceId)
  const noteEditor = editing ? buildSourceNoteEditorViewModel(draft, originalDraft, source) : null
  const noteDiscardConfirmation = noteCloseTarget && noteEditor?.hasUnsavedChanges
    ? buildSourceNoteDiscardConfirmation(source)
    : null
  const schedule = (source.sync.schedules ?? []).find((item) => item.space_id === effectiveSpaceId)
  const [scheduleInterval, setScheduleInterval] = useState(1440)
  useEffect(() => setScheduleInterval(schedule?.interval_minutes ?? 1440), [schedule?.interval_minutes])
  const sourceAuditLink = source.latest_job && effectiveSpaceId
    ? buildSourceTimelineAuditLinkViewModel({
        job: source.latest_job,
        sourceName: source.display_name,
        spaceId: effectiveSpaceId,
      })
    : null
  const actionAuditLink = actionJob && effectiveSpaceId
    ? buildSourceTimelineAuditLinkViewModel({
        job: actionJob,
        sourceName: source.display_name,
        spaceId: effectiveSpaceId,
      })
    : null
  const buildSyncExecutionAuditLink = (jobId: string) => effectiveSpaceId
    ? buildSourceTimelineAuditLinkViewModel({
        job: { id: jobId },
        sourceName: source.display_name,
        spaceId: effectiveSpaceId,
      })
    : null
  const syncHistory = useQuery({
    queryKey: ['source-sync-executions', effectiveSpaceId, source.source_id],
    queryFn: () => nexusApi.listSourceSyncExecutions(effectiveSpaceId!, source.source_id, 8),
    enabled: Boolean(source.sync.refreshable && effectiveSpaceId),
  })
  const syncHistoryNotice = buildQueryErrorNoticeViewModel([
    { error: syncHistory.error, hasData: Boolean(syncHistory.data), label: 'Sync history' },
  ])
  const retrySourceSyncHistory = () => {
    void syncHistory.refetch()
  }
  const refreshSourceQueries = async () => {
    await client.invalidateQueries({ queryKey: ['sources'] })
    await client.invalidateQueries({ queryKey: ['space'] })
    await client.invalidateQueries({ queryKey: ['space-portrait'] })
    await client.invalidateQueries({ queryKey: ['source-preview', source.source_id] })
    await client.invalidateQueries({ queryKey: ['source-preview-figures', source.source_id] })
  }
  const loadCurrentSource = async () => {
    if (!effectiveSpaceId) return
    const register = await nexusApi.listSources(effectiveSpaceId)
    const current = register.items.find((item) => item.source_id === source.source_id)
    if (current) setSource(current)
  }
  const upstreamRefresh = useMutation({
    mutationFn: async () => {
      if (!effectiveSpaceId) throw new Error('This material is not linked to an active Space.')
      return nexusApi.refreshSource(effectiveSpaceId, source.source_id)
    },
    onMutate: () => {
      setActionKind('refresh')
      setActionJob(null)
      setActionMessage('')
    },
    onSuccess: async (result) => {
      const current = result.items.find((item) => item.source_version.source_id === source.source_id)
      if (current) setSource(current.source_version)
      setActionJob(current?.job ?? result.items[0]?.job ?? null)
      const outcome = result.execution
      setActionMessage(outcome?.status === 'changed'
        ? `Checked ${outcome.items_checked} item(s) and created ${outcome.new_version_count} immutable version${outcome.new_version_count === 1 ? '' : 's'}.`
        : outcome?.status === 'no_change'
          ? `Checked ${outcome.items_checked} upstream item(s); no content changed.`
          : source.sync.scope === 'source_set' ? `Checked ${result.items.length} material(s) in this connected source.` : 'Checked the upstream source for a new revision.')
      await refreshSourceQueries()
      await client.invalidateQueries({ queryKey: ['source-sync-executions', effectiveSpaceId, source.source_id] })
    },
  })
  const reprocess = useMutation({
    mutationFn: () => nexusApi.reprocessSource(source.source_id),
    onMutate: () => {
      setActionKind('reprocess')
      setActionJob(null)
      setActionMessage('')
    },
    onSuccess: async (job) => {
      setActionJob(job)
      setActionMessage('Reparsed the stored original without contacting the upstream source.')
      await refreshSourceQueries()
      await loadCurrentSource()
    },
  })
  const retry = useMutation({
    mutationFn: (jobId: string) => nexusApi.retryIngestionJob(jobId),
    onMutate: () => {
      setActionKind('retry')
      setActionJob(null)
      setActionMessage('')
    },
    onSuccess: async (job) => {
      setActionJob(job)
      setActionMessage('Retried the failed ingestion stage.')
      await refreshSourceQueries()
      await loadCurrentSource()
    },
  })
  const sourceActionPending = upstreamRefresh.isPending || reprocess.isPending || retry.isPending
  const configureSchedule = useMutation({
    mutationFn: ({ enabled }: { enabled: boolean }) => {
      if (!effectiveSpaceId) throw new Error('This material is not linked to an active Space.')
      return nexusApi.configureSourceSyncSchedule(effectiveSpaceId, source.source_id, {
        interval_minutes: scheduleInterval,
        enabled,
        expected_revision: schedule?.revision,
      })
    },
    onMutate: () => {
      setActionKind('schedule')
      setActionJob(null)
      setActionMessage('')
    },
    onSuccess: async (updated) => {
      setActionMessage(updated.enabled
        ? `Automatic checks scheduled ${scheduleOptions.find((item) => item.value === updated.interval_minutes)?.label.toLowerCase() ?? `every ${updated.interval_minutes} minutes`}.`
        : 'Automatic upstream checks paused; the schedule and history are retained.')
      await refreshSourceQueries()
      await loadCurrentSource()
    },
  })
  const sourceAction = buildSourcePreviewActionViewModel({
    action: actionKind,
    errorMessage: upstreamRefresh.error?.message ?? reprocess.error?.message ?? retry.error?.message ?? configureSchedule.error?.message,
    message: actionMessage,
    pending: sourceActionPending || configureSchedule.isPending,
    sourceName: source.display_name,
  })
  const anySourceActionPending = sourceActionPending || configureSchedule.isPending
  const retryGate = buildSourcePreviewActionButtonGateViewModel({
    action: 'retry',
    pending: anySourceActionPending,
    sourceName: source.display_name,
  })
  const refreshGate = buildSourcePreviewActionButtonGateViewModel({
    action: 'refresh',
    pending: anySourceActionPending,
    sourceName: source.display_name,
  })
  const reprocessGate = buildSourcePreviewActionButtonGateViewModel({
    action: 'reprocess',
    pending: anySourceActionPending,
    sourceName: source.display_name,
  })
  const selectedScheduleLabel = scheduleOptions.find((item) => item.value === scheduleInterval)?.label.toLowerCase() ?? `every ${scheduleInterval} minutes`
  const cadenceUnchanged = Boolean(schedule?.enabled && schedule.interval_minutes === scheduleInterval)
  const scheduleGate = buildSourcePreviewActionButtonGateViewModel({
    action: 'schedule',
    blockedDetail: cadenceUnchanged ? `${source.display_name} already checks ${selectedScheduleLabel}; choose a different cadence before saving.` : undefined,
    pending: anySourceActionPending,
    sourceName: source.display_name,
  })
  const pauseScheduleGate = buildSourcePreviewActionButtonGateViewModel({
    action: 'schedule',
    pending: anySourceActionPending,
    sourceName: source.display_name,
  })
  const saveRevision = useMutation({
    mutationFn: () => {
      if (!effectiveSpaceId) throw new Error('This material is not linked to an active Space.')
      const file = new File([draft], source.display_name, { type: 'text/markdown' })
      return nexusApi.uploadSource(effectiveSpaceId, file, source.source_id)
    },
    onMutate: () => {
      setNoteVersionReceipt(null)
    },
    onSuccess: async (result) => {
      setNoteVersionReceipt({
        previousVersionNo: source.version_no,
        savedVersionNo: result.source_version.version_no,
        sourceName: result.source_version.display_name,
      })
      setSource(result.source_version)
      setOriginalDraft(draft)
      await client.invalidateQueries({ queryKey: ['sources'] })
      await client.invalidateQueries({ queryKey: ['space-portrait'] })
      setNoteCloseTarget(null)
    },
  })
  const noteVersionAction = noteEditor
    ? buildSourceNoteVersionActionViewModel({
        currentVersionNo: source.version_no,
        editor: noteEditor,
        errorMessage: saveRevisionErrorMessage(saveRevision.error),
        pending: saveRevision.isPending,
        previousVersionNo: noteVersionReceipt?.previousVersionNo,
        savedVersionNo: noteVersionReceipt?.savedVersionNo,
        sourceName: noteVersionReceipt?.sourceName ?? source.display_name,
      })
    : null
  const closeNoteEditor = () => {
    saveRevision.reset()
    setEditing(false)
    setDraft('')
    setOriginalDraft('')
    setNoteVersionReceipt(null)
    setNoteCloseTarget(null)
  }
  const requestCloseNoteEditor = (target: 'drawer' | 'editor' = 'editor') => {
    if (noteEditor?.hasUnsavedChanges) {
      setNoteCloseTarget(target)
      return
    }
    closeNoteEditor()
    if (target === 'drawer') onClose()
  }
  const closeDrawer = () => {
    if (editing && noteEditor?.hasUnsavedChanges) {
      setNoteCloseTarget('drawer')
      return
    }
    onClose()
  }
  const confirmDiscardNoteDraft = () => {
    const target = noteCloseTarget
    closeNoteEditor()
    if (target === 'drawer') onClose()
  }
  const keepFocusInsideDrawer = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDrawer()
      return
    }
    const focusable = getFocusableElements(drawerRef.current)
    const action = resolveFocusTrapAction({
      activeElement: document.activeElement,
      activeInside: Boolean(drawerRef.current?.contains(document.activeElement)),
      emptyTarget: 'container',
      firstElement: focusable[0],
      key: event.key,
      lastElement: focusable[focusable.length - 1],
      shiftKey: event.shiftKey,
    })
    if (!action.preventDefault) return
    event.preventDefault()
    focusTrapTargetElement({ action, container: drawerRef.current, focusable })?.focus({ preventScroll: true })
  }
  const beginEditing = async () => {
    setEditError('')
    setNoteVersionReceipt(null)
    setNoteCloseTarget(null)
    try {
      const response = await fetch(assetUrl)
      if (!response.ok) throw new Error(`Original returned ${response.status}`)
      const body = await response.text()
      setDraft(body)
      setOriginalDraft(body)
      setEditing(true)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to read the original note.')
    }
  }
  return <div className="source-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeDrawer() }}>
    <aside
      className="source-preview-drawer"
      ref={drawerRef}
      role="dialog"
      aria-describedby={descriptionId}
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={keepFocusInsideDrawer}
    >
      <header><div><p className="eyebrow">Material inspector</p><h2 id={titleId}>{source.display_name}</h2><p id={descriptionId}>{previewModel.materialSummary}</p></div><button type="button" className="icon-button" ref={closeButtonRef} onClick={closeDrawer} aria-label="Close material preview"><X size={18} /></button></header>
      {noteDiscardConfirmation && <ConfirmDialog
        body={noteDiscardConfirmation.body}
        confirmLabel={noteDiscardConfirmation.confirmLabel}
        open={Boolean(noteCloseTarget)}
        title={noteDiscardConfirmation.title}
        tone={noteDiscardConfirmation.tone}
        onCancel={() => setNoteCloseTarget(null)}
        onConfirm={confirmDiscardNoteDraft}
      />}
      <div className="source-preview-meta"><StatusMark status={source.status} /><SourceTypePill modality={source.modality} /><code>version {source.version_no}</code>{isManualMarkdown && <button className="text-button" type="button" onClick={beginEditing}><Pencil size={12} />Edit as new version</button>}<a href={assetUrl} target="_blank" rel="noreferrer">Open original <ExternalLink size={12} /></a></div>
      <QueryErrorNotice model={queryErrorNotice} onRetry={retrySourcePreviewQueries} />
      <section className="source-contract-ribbon" aria-label="Material contract summary">
        {previewModel.contractSignals.map((signal) => (
          <span key={signal.label}>
            <strong>{signal.value}</strong>
            <small>{signal.label}</small>
            <em>{signal.detail}</em>
          </span>
        ))}
      </section>
      <section className={`source-readiness-panel health-${source.health.severity}`}>
        <header><span>{source.health.severity === 'positive' ? <CheckCircle2 /> : source.health.severity === 'neutral' ? <Clock3 /> : <AlertTriangle />}</span><div><p className="eyebrow">Search readiness</p><h3>{label(source.health.outcome)}</h3><p>{source.health.summary}</p></div></header>
        <div className="source-readiness-steps">
          {previewModel.readinessSteps.map((step) => {
            const Icon = readinessIcons[step.key]
            return <div key={step.key} className={step.state}><Icon /><span><strong>{step.label}</strong><small>{step.detail}</small></span></div>
          })}
        </div>
        {source.health.blockers.length > 0 && <details><summary>{source.health.blockers.length} capability blocker{source.health.blockers.length === 1 ? '' : 's'}</summary><ul>{source.health.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></details>}
        <footer>
          <div><strong>{previewModel.syncSummary.label}</strong><small>{previewModel.syncSummary.detail}</small></div>
          <nav>
            {sourceAuditLink && <Link className="button" aria-label={sourceAuditLink.ariaLabel} title={sourceAuditLink.detail} to={sourceAuditLink.href}><Clock3 size={14} />{sourceAuditLink.label}</Link>}
            {source.health.primary_action === 'retry_ingestion' && source.latest_job && <button type="button" className="button primary" aria-describedby={`${actionFeedbackId}${retryGate.detail ? ` ${sourceActionGateId('retry')}` : ''}`} aria-disabled={retryGate.ariaDisabled || undefined} onClick={() => { if (retryGate.canSubmit) retry.mutate(source.latest_job!.id) }}><RotateCcw size={14} />Retry failed stage</button>}
            {source.sync.refreshable && <button type="button" className="button primary" aria-describedby={`${actionFeedbackId}${refreshGate.detail ? ` ${sourceActionGateId('refresh')}` : ''}`} aria-disabled={refreshGate.ariaDisabled || undefined} title={refreshGate.detail ?? (source.sync.scope === 'source_set' ? 'Checks every item described by this connector contract.' : 'Checks this upstream location for a newer revision.')} onClick={() => { if (refreshGate.canSubmit) upstreamRefresh.mutate() }}><RefreshCw size={14} />{upstreamRefresh.isPending ? 'Checking…' : 'Check upstream'}</button>}
            <button type="button" className="button" aria-describedby={`${actionFeedbackId}${reprocessGate.detail ? ` ${sourceActionGateId('reprocess')}` : ''}`} aria-disabled={reprocessGate.ariaDisabled || undefined} onClick={() => { if (reprocessGate.canSubmit) reprocess.mutate() }}><RotateCcw size={14} />Reparse stored original</button>
            {retryGate.detail && <span className="sr-only" id={sourceActionGateId('retry')}>{retryGate.detail}</span>}
            {refreshGate.detail && <span className="sr-only" id={sourceActionGateId('refresh')}>{refreshGate.detail}</span>}
            {reprocessGate.detail && <span className="sr-only" id={sourceActionGateId('reprocess')}>{reprocessGate.detail}</span>}
          </nav>
        </footer>
        <SubmitReadinessCard className="source-action-feedback" detail={sourceAction.detail} id={actionFeedbackId} label={sourceAction.label} liveMode={sourceAction.liveMode} pending={sourceAction.tone === 'pending'} role={sourceAction.role} tone={sourceAction.tone} visible={sourceAction.visible}>
          {actionAuditLink && sourceAction.visible && <Link aria-label={actionAuditLink.ariaLabel} title={actionAuditLink.detail} to={actionAuditLink.href}>{actionAuditLink.label}</Link>}
        </SubmitReadinessCard>
        {source.sync.refreshable && <section className="source-sync-automation">
          <header><span><CalendarClock /></span><div><p className="eyebrow">Upstream automation</p><h3>{schedule ? (schedule.enabled ? 'Automatic checks active' : 'Automatic checks paused') : 'Choose a safe refresh cadence'}</h3><p>The reusable connector contract is checked on schedule; unchanged content creates no duplicate Source Version.</p></div>{schedule && <StatusMark status={schedule.last_status === 'never' ? 'scheduled' : schedule.last_status} />}</header>
          <div className="source-sync-config">
            <label>Check frequency<LedgerSelect ariaLabel="Check frequency" value={String(scheduleInterval)} options={scheduleSelectOptions} onChange={(next) => setScheduleInterval(Number(next))} /></label>
            <span>{schedule?.enabled ? <>Next check <strong>{new Date(schedule.next_run_at).toLocaleString()}</strong></> : <>Plans use a durable database lease, so a scheduler restart cannot erase them.</>}</span>
            <button type="button" className="button primary" aria-describedby={`${actionFeedbackId}${scheduleGate.detail ? ` ${sourceActionGateId('schedule')}` : ''}`} aria-disabled={scheduleGate.ariaDisabled || undefined} onClick={() => { if (scheduleGate.canSubmit) configureSchedule.mutate({ enabled: true }) }}><CalendarClock size={14} />{schedule ? (schedule.enabled ? 'Save cadence' : 'Resume schedule') : 'Enable schedule'}</button>
            {schedule?.enabled && <button type="button" className="button" aria-describedby={`${actionFeedbackId}${pauseScheduleGate.detail ? ` ${sourceActionGateId('pause-schedule')}` : ''}`} aria-disabled={pauseScheduleGate.ariaDisabled || undefined} onClick={() => { if (pauseScheduleGate.canSubmit) configureSchedule.mutate({ enabled: false }) }}><Pause size={14} />Pause</button>}
            {scheduleGate.detail && <span className="sr-only" id={sourceActionGateId('schedule')}>{scheduleGate.detail}</span>}
            {pauseScheduleGate.detail && <span className="sr-only" id={sourceActionGateId('pause-schedule')}>{pauseScheduleGate.detail}</span>}
          </div>
          <div className="source-sync-history">
            <p className="eyebrow">Recent upstream checks</p>
            <QueryErrorNotice model={syncHistoryNotice} onRetry={retrySourceSyncHistory} />
            {syncHistoryNotice.tone === 'blocking' ? <p className="source-sync-empty">Sync history could not be loaded. Retry before treating this connector as having no checks recorded.</p> : syncHistory.data?.items.length ? syncHistory.data.items.map((execution) => {
              const auditLink = execution.job_ids[0] ? buildSyncExecutionAuditLink(execution.job_ids[0]) : null
              return <article key={execution.id}>
                <StatusMark status={execution.status} />
                <span><strong>{execution.status === 'changed' ? `${execution.new_version_count} new version${execution.new_version_count === 1 ? '' : 's'}` : execution.status === 'no_change' ? 'No content change' : label(execution.status)}</strong><small>{execution.trigger} · checked {execution.items_checked} item{execution.items_checked === 1 ? '' : 's'} · {new Date(execution.created_at).toLocaleString()}</small></span>
                {auditLink ? <Link aria-label={auditLink.ariaLabel} title={auditLink.detail} to={auditLink.href}>{auditLink.label}<Clock3 size={12} /></Link> : <code>{execution.id.slice(0, 8)}</code>}
              </article>
            }) : <p className="source-sync-empty">No checks recorded yet. “Check upstream” will create the first auditable entry.</p>}
          </div>
        </section>}
      </section>
      {editError && <p className="form-error">{editError}</p>}
      {editing && noteEditor && noteVersionAction && <SourceNoteEditor
        action={noteVersionAction}
        draft={draft}
        editor={noteEditor}
        error={saveRevision.error}
        feedbackId={noteSaveFeedbackId}
        onChange={(value) => {
          saveRevision.reset()
          setNoteVersionReceipt(null)
          setDraft(value)
        }}
        onClose={() => requestCloseNoteEditor()}
        onSave={() => {
          if (noteEditor.canSave) saveRevision.mutate()
        }}
      />}
      {source.modality === 'image' && <div className="source-native-preview"><img src={assetUrl} alt={source.display_name} /></div>}
      {source.modality === 'audio' && <div className="source-native-preview media"><audio src={assetUrl} controls aria-label={previewModel.nativeAudioLabel} /></div>}
      {source.modality === 'video' && <div className="source-native-preview media"><video src={assetUrl} controls aria-label={previewModel.nativeVideoLabel} /></div>}
      {isPdf && <div className="source-native-preview document"><iframe src={assetUrl} title={`${source.display_name} preview`} /></div>}
      {isOfficeDocument && chunks.length > 0 && <section className="source-document-reader">
        <div className="panel-head"><div><p className="eyebrow">Extracted document reader</p><h3>Layout-aware text and slide/page anchors</h3></div><FileSearch size={17} /></div>
        <div>{chunks.filter((item) => item.text_content.trim()).slice(0, 18).map((chunk) => <Link key={chunk.id} to={buildEvidenceDetailPath(chunk.id)}><span>{chunk.locator.page_no ? `Page ${chunk.locator.page_no}` : chunk.evidence_type.replaceAll('_', ' ')}</span><p>{chunk.text_content}</p></Link>)}</div>
      </section>}
      {tablePreview && <section className="source-table-preview">
        <div className="panel-head"><div><p className="eyebrow">Workbook preview</p><h3>Structured cells retained with citable ranges</h3></div><Table2 size={17} /></div>
        {tablePreview.length > 1 && <div className="sheet-tabs" role="tablist" aria-label="Workbook sheets">{tablePreview.map((sheet, index) => {
          const selected = activeSheetIndex === index
          return <button type="button" role="tab" id={sheetTabId(index)} aria-selected={selected} aria-controls={sheetPanelId(index)} tabIndex={selected ? 0 : -1} className={selected ? 'selected' : ''} key={sheet.sheet} ref={(node) => { sheetTabRefs.current[sheet.sheet] = node }} onKeyDown={handleSheetTabKeyDown} onClick={() => setSelectedSheetName(sheet.sheet)}>{sheet.sheet}</button>
        })}</div>}
        {activeSheet && <div className="table-preview-panel" role={tablePreview.length > 1 ? 'tabpanel' : undefined} id={tablePreview.length > 1 ? sheetPanelId(activeSheetIndex) : undefined} aria-labelledby={tablePreview.length > 1 ? sheetTabId(activeSheetIndex) : undefined} tabIndex={tablePreview.length > 1 ? 0 : undefined}><div className="table-preview-meta"><strong>{activeSheet.sheet}</strong><span>{activeSheet.rows.length} preview rows · {activeSheet.range}</span></div><div className="table-preview-scroll"><table><thead><tr>{activeSheet.header.map((cell, index) => <th key={`${cell}-${index}`}>{cell || `Column ${index + 1}`}</th>)}</tr></thead><tbody>{activeSheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{activeSheet.header.map((_, columnIndex) => <td key={columnIndex}>{row[columnIndex] ?? ''}</td>)}</tr>)}</tbody></table></div></div>}
      </section>}
      {(source.derived_image_count > 0 || visualEvidence.length > 0) && <section className="source-derived-visuals">
        <div className="panel-head"><div><p className="eyebrow">{visualSectionCopy.eyebrow}</p><h3>{visualSectionCopy.title}</h3></div><ImageIcon size={17} /></div>
        {figures.isLoading || evidence.isLoading ? <LoadingState /> : queryErrorNotice.visible && !figures.data && figures.error ? <PanelNote align="start">Visual evidence could not be loaded. Retry before treating derived visuals as unpublished.</PanelNote> : visualEvidence.length ? <div className="source-derived-gallery">{visualEvidence.map((figure) => <Link key={figure.id} to={buildEvidenceDetailPath(figure.id)}><img src={figure.asset_url} alt={figure.text_content.slice(0, 90) || `${source.display_name} visual`} loading="lazy" /><span><strong>{figure.locator.page_no ? `Page ${figure.locator.page_no}` : 'Document visual'} · {figure.evidence_type.replaceAll('_', ' ')}</strong><small>{figure.text_content || 'Extracted visual evidence'}</small></span></Link>)}</div> : <PanelNote align="start">The parser retained derived visual assets, but none were published as citable visual evidence.</PanelNote>}
      </section>}
      <section className="source-chunk-browser">
        <div className="panel-head"><div><p className="eyebrow">Published evidence</p><h3>{source.published_evidence_count} inspectable chunks</h3></div><FileSearch size={17} /></div>
        {evidence.isLoading ? <LoadingState /> : queryErrorNotice.tone === 'blocking' ? <PanelNote align="start">Published Evidence could not be loaded. Retry before treating this material as having no published chunks.</PanelNote> : chunks.length ? <div className="source-chunk-list">{chunks.map((chunk, index) => <Link key={chunk.id} to={buildEvidenceDetailPath(chunk.id)}><span>{String(index + 1).padStart(2, '0')}</span><span><strong>{chunk.evidence_type.replaceAll('_', ' ')}</strong><small>{chunk.text_content || 'Non-text evidence'}</small></span><ExternalLink size={13} /></Link>)}</div> : <PanelNote align="start">No published chunks yet. Check ingestion readiness or re-import the material.</PanelNote>}
      </section>
    </aside>
  </div>
}
