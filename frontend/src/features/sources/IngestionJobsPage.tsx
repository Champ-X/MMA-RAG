import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  FileClock,
  FileSearch,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { nexusApi, type IngestionJob } from '@/api/nexus'
import { ConfirmDialog } from '@/components/nexus/ConfirmDialog'
import { EmptyState } from '@/components/nexus/EmptyState'
import { InlineNotice } from '@/components/nexus/InlineNotice'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { StatusMark } from '@/components/nexus/StatusMark'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { copyTextToClipboard } from '@/lib/clipboard'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import {
  buildIngestionJobActionConfirmation,
  buildIngestionJobActionViewModel,
  buildIngestionJobAuditLinkCopyViewModel,
  buildIngestionJobAuditLinkViewModel,
  buildIngestionJobArrivalViewModel,
  buildIngestionJobEventNarrative,
  buildIngestionJobRecoveryBriefing,
  buildIngestionJobsEmptyState,
  buildIngestionJobStatusFilters,
  buildIngestionJobStatusSearchParams,
  buildIngestionTimelineRefreshViewModel,
  countIngestionJobsByStatus,
  getIngestionJobStageProgress,
  getIngestionJobStageStepState,
  ingestionStages,
  ingestionJobStatusFilterOrder,
  type IngestionJobAction,
  type IngestionJobAuditLinkCopyState,
  type IngestionJobStatusFilter,
  labelIngestionValue,
  parseIngestionJobStatusFilter,
  resolveIngestionJobSelection,
  terminalIngestionStatuses,
} from './ingestionJobsPageViewModel'
import './IngestionJobsPage.css'

const ingestionJobActionFeedbackId = 'ingestion-job-action-feedback'
const ingestionTimelineRefreshGateId = 'ingestion-timeline-refresh-gate'
const ingestionJobAuditLinkFeedbackId = 'ingestion-job-audit-link-feedback'
const ingestionTimelineRefreshFeedbackId = 'ingestion-timeline-refresh-feedback'
const ingestionJobActionGateId = 'ingestion-job-action-gate'
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const formatRefreshTimestamp = (timestamp?: number) => timestamp
  ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : undefined

export default function IngestionJobsPage() {
  const { spaceId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedJobId = searchParams.get('job') ?? ''
  const client = useQueryClient()
  const statusFilterRefs = useRef<Partial<Record<IngestionJobStatusFilter, HTMLButtonElement | null>>>({})
  const [selectedId, setSelectedId] = useState('')
  const [actionTarget, setActionTarget] = useState<{ action: IngestionJobAction; job: IngestionJob } | null>(null)
  const [actionReceipt, setActionReceipt] = useState<{ action: IngestionJobAction; jobName: string } | null>(null)
  const [lastAction, setLastAction] = useState<{ action: IngestionJobAction; jobName: string } | null>(null)
  const [auditLinkState, setAuditLinkState] = useState<IngestionJobAuditLinkCopyState>('idle')
  const [refreshState, setRefreshState] = useState<{ errorMessage?: string; lastSucceededAt?: number; pending: boolean }>({ pending: false })
  const filter = parseIngestionJobStatusFilter(searchParams.get('status'))
  const space = useQuery({ queryKey: ['space', spaceId], queryFn: () => nexusApi.getSpace(spaceId), enabled: Boolean(spaceId) })
  const jobs = useQuery({ queryKey: ['ingestion-jobs', spaceId], queryFn: () => nexusApi.listIngestionJobs({ spaceId, limit: 200 }), enabled: Boolean(spaceId), refetchInterval: (query) => query.state.data?.items.some((job) => !terminalIngestionStatuses.has(job.status)) ? 2500 : false })
  const selected = useQuery({ queryKey: ['ingestion-job', selectedId], queryFn: () => nexusApi.getIngestionJob(selectedId), enabled: Boolean(selectedId), refetchInterval: (query) => query.state.data && !terminalIngestionStatuses.has(query.state.data.status) ? 1500 : false })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: space.error, hasData: Boolean(space.data), label: 'Space', required: true },
    { error: jobs.error, hasData: Boolean(jobs.data), label: 'Jobs ledger', required: true },
    { error: selectedId ? selected.error : undefined, hasData: Boolean(selected.data), label: 'Selected job' },
  ])
  const retryIngestionTimelineQueries = () => {
    void space.refetch()
    void jobs.refetch()
    if (selectedId) void selected.refetch()
  }
  const refresh = async () => {
    const invalidations = [
      client.invalidateQueries({ queryKey: ['ingestion-jobs', spaceId] }),
      client.invalidateQueries({ queryKey: ['sources', spaceId] }),
    ]
    if (selectedId) invalidations.push(client.invalidateQueries({ queryKey: ['ingestion-job', selectedId] }))
    await Promise.all(invalidations)
  }
  const retry = useMutation({ mutationFn: nexusApi.retryIngestionJob, onSuccess: refresh })
  const cancel = useMutation({ mutationFn: nexusApi.cancelIngestionJob, onSuccess: refresh })
  const reprocess = useMutation({ mutationFn: nexusApi.reprocessSource, onSuccess: (job) => { setSelectedId(job.id); refresh() } })

  useEffect(() => {
    const nextSelectedId = resolveIngestionJobSelection({
      currentSelectedId: selectedId,
      jobs: jobs.data?.items ?? [],
      requestedJobId,
    })
    if (nextSelectedId !== selectedId) setSelectedId(nextSelectedId)
  }, [jobs.data?.items, requestedJobId, selectedId])
  const counts = useMemo(() => {
    return countIngestionJobsByStatus(jobs.data?.items ?? [])
  }, [jobs.data?.items])
  const statusFilters = useMemo(() => {
    return buildIngestionJobStatusFilters(counts, filter)
  }, [counts, filter])
  const filtered = (jobs.data?.items ?? []).filter((job) => filter === 'all' || job.status === filter)
  const activeJobCount = (jobs.data?.items ?? []).filter((job) => !terminalIngestionStatuses.has(job.status)).length
  const timelineRefresh = buildIngestionTimelineRefreshViewModel({
    activeJobCount,
    errorMessage: refreshState.errorMessage
      ?? (jobs.error ? message(jobs.error) : undefined)
      ?? (selected.error ? message(selected.error) : undefined),
    lastRefreshLabel: formatRefreshTimestamp(refreshState.lastSucceededAt),
    pending: refreshState.pending,
    selectedJobId: selectedId || requestedJobId || undefined,
    totalJobCount: jobs.data?.items.length ?? 0,
  })
  const refreshTimeline = async () => {
    setRefreshState((current) => ({ ...current, errorMessage: undefined, pending: true }))
    try {
      await refresh()
      setRefreshState({ lastSucceededAt: Date.now(), pending: false })
    } catch (error) {
      setRefreshState((current) => ({ ...current, errorMessage: message(error), pending: false }))
    }
  }
  const emptyState = buildIngestionJobsEmptyState(filter, counts.all ?? 0)
  const arrivalReceipt = requestedJobId && selected.data?.id === requestedJobId
    ? buildIngestionJobArrivalViewModel(selected.data)
    : null
  const recoveryBriefing = selected.data ? buildIngestionJobRecoveryBriefing(selected.data) : null
  const actionConfirmation = actionTarget
    ? buildIngestionJobActionConfirmation(actionTarget.job, actionTarget.action)
    : null
  const actionBusy = retry.isPending || cancel.isPending || reprocess.isPending
  const pendingAction = actionBusy ? actionTarget?.action : undefined
  const actionError = retry.error ?? reprocess.error ?? cancel.error
  const errorAction = retry.error
    ? 'retry'
    : reprocess.error
      ? 'reprocess'
      : cancel.error ? 'cancel' : undefined
  const jobAction = buildIngestionJobActionViewModel({
    action: recoveryBriefing?.primaryAction,
    completedAction: actionReceipt?.action,
    completedName: actionReceipt?.jobName,
    errorAction,
    errorMessage: actionError ? message(actionError) : undefined,
    pendingAction,
    targetName: actionTarget?.job.display_name ?? lastAction?.jobName ?? selected.data?.display_name ?? undefined,
  })
  const auditLink = useMemo(() => buildIngestionJobAuditLinkViewModel({
    filter,
    origin: typeof window === 'undefined' ? '' : window.location.origin,
    pathname: typeof window === 'undefined' ? '' : window.location.pathname,
    searchParams,
    selectedJobId: selectedId || requestedJobId || undefined,
  }), [filter, requestedJobId, searchParams, selectedId])
  const auditLinkCopy = buildIngestionJobAuditLinkCopyViewModel({
    auditLink,
    state: auditLinkState,
  })
  const setStatusFilter = (nextFilter: IngestionJobStatusFilter) => {
    setSearchParams(buildIngestionJobStatusSearchParams(searchParams, nextFilter))
  }
  const handleStatusFilterKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextFilter = moveRadioGroupValue(ingestionJobStatusFilterOrder, filter, direction)
    setStatusFilter(nextFilter)
    window.requestAnimationFrame(() => statusFilterRefs.current[nextFilter]?.focus({ preventScroll: true }))
  }
  useEffect(() => {
    setAuditLinkState('idle')
  }, [auditLink.href])
  useEffect(() => {
    if (auditLinkState === 'idle' || auditLinkState === 'copying') return
    const timer = window.setTimeout(() => setAuditLinkState('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [auditLinkState])
  const copyAuditLink = async () => {
    setAuditLinkState('copying')
    try {
      await copyTextToClipboard(auditLink.href)
      setAuditLinkState('copied')
    } catch {
      setAuditLinkState('failed')
    }
  }
  const confirmJobAction = () => {
    if (!actionTarget) return
    const target = actionTarget
    const jobName = target.job.display_name ?? target.job.source_version_id ?? target.job.id.slice(0, 8)
    setActionReceipt(null)
    setLastAction({ action: target.action, jobName })
    retry.reset()
    reprocess.reset()
    cancel.reset()
    if (actionTarget.action === 'retry') {
      retry.mutate(target.job.id, {
        onSuccess: () => setActionReceipt({ action: 'retry', jobName }),
        onSettled: () => setActionTarget(null),
      })
      return
    }
    if (actionTarget.action === 'reprocess') {
      if (!target.job.source_id) {
        setActionTarget(null)
        return
      }
      reprocess.mutate(target.job.source_id, {
        onSuccess: () => setActionReceipt({ action: 'reprocess', jobName }),
        onSettled: () => setActionTarget(null),
      })
      return
    }
    cancel.mutate(target.job.id, {
      onSuccess: () => setActionReceipt({ action: 'cancel', jobName }),
      onSettled: () => setActionTarget(null),
    })
  }
  if (space.isLoading || jobs.isLoading) return <LoadingState />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell ingestion-jobs-page"><PageHeader eyebrow="Ingestion timeline" title="Ingestion timeline could not be loaded" description="Nexus could not verify this Space or its durable ingestion job ledger." actions={<Link className="button" to={`/spaces/${spaceId}/sources`}><FileSearch size={16} />Materials</Link>} /><QueryErrorNotice model={queryErrorNotice} onRetry={retryIngestionTimelineQueries} /><EmptyState title="Ingestion ledger is temporarily unavailable" body="Retry before treating this Space as having no ingestion history. Job recovery, cancellation and reprocessing depend on the authoritative ledger." /></div>

  return <div className="page-shell ingestion-jobs-page">
    <PageHeader eyebrow={`Space · ${space.data?.name ?? 'Ingestion'}`} title="Ingestion timeline" description="PostgreSQL keeps every stage, retry and parser failure. Redis delivery can disappear without erasing this history." actions={<div className="ingestion-refresh-actions"><Link className="button" to={`/spaces/${spaceId}/sources`}><FileSearch size={16} />Materials</Link><button type="button" className="button primary" aria-describedby={`${ingestionTimelineRefreshFeedbackId}${timelineRefresh.disabledDetail ? ` ${ingestionTimelineRefreshGateId}` : ''}`} aria-disabled={timelineRefresh.ariaDisabled || undefined} onClick={() => { if (timelineRefresh.canRefresh) void refreshTimeline() }}><RefreshCw className={timelineRefresh.feedbackTone === 'pending' ? 'spin' : undefined} size={16} />{timelineRefresh.submitLabel}</button>{timelineRefresh.disabledDetail && <span className="sr-only" id={ingestionTimelineRefreshGateId}>{timelineRefresh.disabledDetail}</span>}<SubmitReadinessCard className="ingestion-refresh-feedback" id={ingestionTimelineRefreshFeedbackId} model={timelineRefresh} /></div>} />
    <QueryErrorNotice model={queryErrorNotice} onRetry={retryIngestionTimelineQueries} />

    <section className="job-status-ribbon" role="radiogroup" aria-label="Ingestion status filters">{statusFilters.map((status) => <button type="button" key={status.key} ref={(node) => { statusFilterRefs.current[status.key] = node }} role="radio" aria-checked={status.active} tabIndex={status.active ? 0 : -1} className={`${status.active ? 'active' : ''} tone-${status.tone}`} aria-label={status.ariaLabel} onKeyDown={handleStatusFilterKeyDown} onClick={() => setStatusFilter(status.key)}><span>{status.key === 'failed' ? <AlertTriangle /> : status.key === 'completed' ? <CheckCircle2 /> : status.key === 'running' ? <Loader2 /> : status.key === 'cancelled' ? <X /> : <Clock3 />}</span><strong>{status.count}</strong><small>{status.label}</small></button>)}</section>

    <section className="job-audit-link" aria-label={auditLink.ariaLabel}>
      <div>
        <p className="eyebrow">{auditLink.title}</p>
        <strong>{auditLink.shortLabel}</strong>
        <small>{auditLink.detail}</small>
      </div>
      <dl>
        {auditLink.facets.map((facet) => <div key={facet.label}>
          <dt>{facet.label}</dt>
          <dd>{facet.value}</dd>
        </div>)}
      </dl>
      <button className="button" type="button" aria-describedby={ingestionJobAuditLinkFeedbackId} onClick={copyAuditLink}>
        {auditLinkState === 'copied' ? <CheckCircle2 size={14} /> : auditLinkState === 'failed' ? <AlertTriangle size={14} /> : <Copy size={14} />}
        {auditLinkCopy.submitLabel}
      </button>
      <SubmitReadinessCard className="job-audit-copy-feedback" id={ingestionJobAuditLinkFeedbackId} model={auditLinkCopy} />
    </section>

    {arrivalReceipt && <section className={`job-arrival-receipt ${arrivalReceipt.tone}`} role="status" aria-label={arrivalReceipt.ariaLabel}>
      <span>{arrivalReceipt.tone === 'failed' ? <AlertTriangle /> : arrivalReceipt.tone === 'active' ? <Loader2 className="spin" /> : <CheckCircle2 />}</span>
      <div>
        <p className="eyebrow">{arrivalReceipt.statusLabel}</p>
        <h2>{arrivalReceipt.title}</h2>
        <p>{arrivalReceipt.detail}</p>
      </div>
      <dl>
        {arrivalReceipt.metrics.map((metric) => <div key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>)}
      </dl>
    </section>}

    {requestedJobId && selected.isError && <InlineNotice tone="negative">
      <strong>Linked job unavailable</strong>
      <span>The intake receipt points to a job that could not be loaded. Refresh the timeline or return to Materials to inspect the latest source record.</span>
    </InlineNotice>}
    <SubmitReadinessCard className="ingestion-job-action-feedback" id={ingestionJobActionFeedbackId} model={jobAction} />

    {filtered.length ? <div className="jobs-workspace">
      <section className="job-ledger" aria-label="Ingestion jobs">{filtered.map((job) => <button type="button" key={job.id} className={selectedId === job.id ? 'selected' : ''} onClick={() => setSelectedId(job.id)}>
        <span className={`job-modality modality-${job.modality ?? 'text'}`}><FileClock /><small>{job.modality ?? 'source'}</small></span>
        <span className="job-copy"><span><strong>{job.display_name ?? job.source_version_id}</strong><StatusMark status={job.status} /></span><small>{job.mime_type ?? 'unknown MIME'} · attempt {job.attempt_count} · {job.event_count} events</small><span className="job-progress"><i style={{ width: `${getIngestionJobStageProgress(job)}%` }} /><em>{labelIngestionValue(job.stage)}</em></span></span>
        <span className="job-time"><small>{formatDate(job.updated_at)}</small><ArrowRight /></span>
      </button>)}</section>

      <aside className="job-inspector">
        {selected.isLoading ? <LoadingState /> : selected.data ? <>
          <header><div><p className="eyebrow">Durable job · {selected.data.id.slice(0, 8)}</p><h2>{selected.data.display_name ?? 'Ingestion attempt'}</h2></div><button type="button" className="icon-button" aria-label="Close job details" onClick={() => setSelectedId('')}><X /></button></header>
          <div className="job-inspector-state"><StatusMark status={selected.data.status} /><strong>{labelIngestionValue(selected.data.stage)}</strong><span>attempt {selected.data.attempt_count}</span></div>
          {selected.data.error_message && <div className="job-error-sheet"><AlertTriangle /><span><strong>{selected.data.error_code ?? 'INGESTION_FAILED'}</strong><small>{selected.data.error_message}</small></span></div>}
          {recoveryBriefing && <section className={`job-recovery-briefing ${recoveryBriefing.tone}`} aria-label={recoveryBriefing.ariaLabel}>
            <header>
              <span>{recoveryBriefing.tone === 'failed' ? <AlertTriangle /> : recoveryBriefing.tone === 'active' ? <Loader2 className="spin" /> : <CheckCircle2 />}</span>
              <div>
                <p className="eyebrow">{recoveryBriefing.statusLabel}</p>
                <h3>{recoveryBriefing.title}</h3>
                <p>{recoveryBriefing.detail}</p>
              </div>
              {recoveryBriefing.primaryAction && <button type="button" className={`button ${recoveryBriefing.primaryTone === 'danger' ? 'danger-quiet' : 'primary'}`} aria-describedby={`${ingestionJobActionFeedbackId}${jobAction.disabledDetail ? ` ${ingestionJobActionGateId}` : ''}`} aria-disabled={jobAction.ariaDisabled || undefined} onClick={() => { if (jobAction.canSubmit) setActionTarget({ action: recoveryBriefing.primaryAction!, job: selected.data! }) }}>
                {recoveryBriefing.primaryAction === 'retry' ? <RotateCcw size={14} /> : recoveryBriefing.primaryAction === 'reprocess' ? <RefreshCw size={14} /> : <X size={14} />}
                {jobAction.actionLabel}
              </button>}{jobAction.disabledDetail && <span className="sr-only" id={ingestionJobActionGateId}>{jobAction.disabledDetail}</span>}
            </header>
            <ol>
              {recoveryBriefing.steps.map((step) => <li key={step.label} className={step.state}>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </li>)}
            </ol>
          </section>}
          <div className="job-stage-track">{ingestionStages.map((stage, index) => { const step = getIngestionJobStageStepState(selected.data, stage, index); return <div key={stage} className={`${step.done ? 'done' : ''}${step.active ? ' active' : ''}`}><span>{step.done ? <CheckCircle2 /> : step.active ? <Loader2 /> : index + 1}</span><strong>{step.label}</strong></div> })}</div>
          <section className="job-event-timeline"><div><p className="eyebrow">Event record</p><h3>{selected.data.event_count} persisted transitions</h3></div>{(selected.data.events ?? []).map((event) => {
            const narrative = buildIngestionJobEventNarrative(event)
            return <article key={event.sequence} className={`tone-${narrative.tone}`} aria-label={narrative.ariaLabel}>
              <span>{narrative.sequenceLabel}</span>
              <div>
                <span className="job-event-copy">
                  <strong>{narrative.title}</strong>
                  <small>{formatDate(event.occurred_at)} · {narrative.statusLabel}</small>
                  <em>{narrative.detail}</em>
                </span>
                {narrative.facts.length > 0 && <dl>
                  {narrative.facts.map((item) => <div key={`${event.sequence}-${item.label}`}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>)}
                </dl>}
                {narrative.payloadPreview && <details className="job-event-payload">
                  <summary><span>Raw payload</span><code>{event.event_type}</code></summary>
                  <code>{narrative.payloadPreview}</code>
                </details>}
              </div>
            </article>
          })}</section>
          <footer><span><Sparkles /> Every attempt remains inspectable in this durable timeline.</span></footer>
        </> : selected.isError ? <EmptyState title="Job details could not be loaded" body="The durable job list remains visible, but this selected job detail did not load. Retry before treating the receipt as missing." action={<button type="button" className="button" onClick={() => { void selected.refetch() }}><RotateCcw size={14} />Retry job</button>} /> : <EmptyState title="Select a job" body="Open any row to inspect its persisted stage events." />}
      </aside>
    </div> : <section className={`job-empty-state ${emptyState.tone}`} aria-label={emptyState.title}>
      <p className="eyebrow">{emptyState.eyebrow}</p>
      <h2>{emptyState.title}</h2>
      <p>{emptyState.body}</p>
      {emptyState.action === 'view-all'
        ? <button className="button primary" type="button" onClick={() => setStatusFilter('all')}>{emptyState.actionLabel}</button>
        : <Link className="button primary" to={`/spaces/${spaceId}/sources`}><FileSearch size={15} />{emptyState.actionLabel}</Link>}
    </section>}
    {actionConfirmation && <ConfirmDialog
      body={actionConfirmation.body}
      busy={actionBusy}
      confirmLabel={actionConfirmation.confirmLabel}
      open={Boolean(actionTarget)}
      title={actionConfirmation.title}
      tone={actionConfirmation.tone}
      onCancel={() => setActionTarget(null)}
      onConfirm={confirmJobAction}
    />}
  </div>
}
