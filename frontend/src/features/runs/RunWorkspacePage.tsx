import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Ban,
  BrainCircuit,
  ChevronRight,
  FileOutput,
  LocateFixed,
  Paperclip,
  PauseCircle,
  Play,
  Radio,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { DurableRunEvent, Evidence } from '@/api/nexus'
import { nexusApi } from '@/api/nexus'
import { DurableEventClient } from '@/events/DurableEventClient'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PendingAttachmentTray } from '@/components/nexus/PendingAttachmentTray'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { StatusMark } from '@/components/nexus/StatusMark'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { CatalogModelPicker } from '@/features/models/CatalogModelPicker'
import { EvidenceAnswer } from './EvidenceAnswer'
import { buildFollowUpComposerViewModel } from './followUpComposerViewModel'
import { RunProgressSummary } from './RunProgressSummary'
import { runEvidenceDrawerId } from './runEvidenceDrawerContract'
import {
  buildRunLifecycleActionViewModel,
  type RunLifecycleAction,
} from './runLifecycleActionViewModel'
import {
  buildRunRouteReceiptViewModel,
} from './runRouteReceiptViewModel'
import {
  buildRunRouteAuditViewModel,
  buildRunRouteRecoveryRunRequest,
  buildRunRouteRecoveryViewModel,
} from './runRouteRecoveryViewModel'
import { RunRouteRecoveryPanel } from './RunRouteRecoveryPanel'
import { RunModelFallbackNotice } from './RunModelFallbackNotice'
import { RunCapabilityRecoveryNotice } from './RunCapabilityRecoveryNotice'
import { SearchOutcomeNotice } from './SearchOutcomeNotice'
import { buildQueryUnderstandingFallbackViewModel } from './queryUnderstandingViewModel'
import { buildRunAnswerMetaViewModel } from './runAnswerMetaViewModel'
import { buildRunCapabilityRecoveryViewModel } from './runCapabilityRecoveryViewModel'
import {
  conversationEvidenceIds,
  runEvidenceIds,
} from './runEvidenceBindingsViewModel'
import { buildRunModelFallbackViewModel } from './runModelFallbackViewModel'
import { buildRunScopeSummaryViewModel } from './runScopeSummaryViewModel'
import { suggestionProvenance } from './runSuggestions'
import {
  useRunEvidenceDrawerController,
  type RunEvidenceLocationState,
} from './useRunEvidenceDrawerController'
import { useRunCitationPreviewController } from './useRunCitationPreviewController'
import './RunWorkspacePage.css'

type RunLifecycleReceipt = {
  action: RunLifecycleAction
}
const terminal = new Set(['completed', 'failed', 'partial', 'cancelled'])
const terminalJobs = new Set(['completed', 'failed', 'cancelled'])
const followUpFeedbackId = 'follow-up-composer-feedback'
const followUpGateId = 'follow-up-composer-gate'
const followUpHelpId = 'follow-up-composer-help'
const runLifecycleFeedbackId = 'run-lifecycle-feedback'
const runLifecycleControlGateId = (action: RunLifecycleAction) => `${runLifecycleFeedbackId}-${action}-gate`
const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))
const loadCitationPreviewPopover = () => import('@/components/nexus/CitationPreviewPopover')
const CitationPreviewPopover = lazy(() => loadCitationPreviewPopover().then((module) => ({
  default: module.CitationPreviewPopover,
})))
const RunEvidenceDrawer = lazy(() => import('./RunEvidenceDrawer').then((module) => ({
  default: module.RunEvidenceDrawer,
})))

async function waitForIngestion(jobId: string) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const job = await nexusApi.getIngestionJob(jobId)
    if (terminalJobs.has(job.status)) {
      if (job.status !== 'completed') throw new Error(job.error_message || `Attachment ingestion ${job.status}`)
      return
    }
    await sleep(1000)
  }
  throw new Error('Attachment ingestion did not finish within 15 minutes.')
}

export default function RunWorkspacePage() {
  const { runId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const locationState = location.state as RunEvidenceLocationState | null
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const followUpInput = useRef<HTMLTextAreaElement>(null)
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => nexusApi.getRun(runId), enabled: Boolean(runId), refetchInterval: (query) => terminal.has(query.state.data?.status ?? '') ? false : 3000 })
  const snapshot = useQuery({ queryKey: ['run-snapshot', runId], queryFn: () => nexusApi.getRunSnapshot(runId), enabled: Boolean(runId) })
  const eventHistory = useQuery({ queryKey: ['run-events', runId], queryFn: () => nexusApi.listRunEvents(runId), enabled: Boolean(runId), staleTime: Infinity })
  const conversation = useQuery({
    queryKey: ['conversation-runs', run.data?.conversation_id],
    queryFn: () => nexusApi.listConversationRuns(run.data!.conversation_id),
    enabled: Boolean(run.data?.conversation_id),
    refetchInterval: (query) => query.state.data?.items.some((item) => !terminal.has(item.status) && item.status !== 'paused') ? 3000 : false,
  })
  const providers = useQuery({ queryKey: ['providers'], queryFn: nexusApi.listProviders })
  const models = useQuery({ queryKey: ['models'], queryFn: nexusApi.listModels })
  const suggestions = useQuery({
    queryKey: ['run-suggestions', runId],
    queryFn: () => nexusApi.getRunSuggestedQuestions(runId),
    enabled: Boolean(run.data?.result && terminal.has(run.data.status)),
    staleTime: Infinity,
  })
  const hasStoredRoutingTrace = Boolean(run.data?.request_context.routing_trace && Object.keys(run.data.request_context.routing_trace as Record<string, unknown>).length)
  const routeAudit = useQuery({
    queryKey: ['run-route-audit', run.data?.id, run.data?.goal],
    queryFn: () => nexusApi.routeSpaces(run.data!.goal),
    enabled: Boolean(run.data?.goal && hasStoredRoutingTrace),
    staleTime: 60_000,
  })
  const [events, setEvents] = useState<DurableRunEvent[]>([])
  const [streamState, setStreamState] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting')
  const [followUp, setFollowUp] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [followUpStage, setFollowUpStage] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(location.hash === '#execution-details')
  const [lifecycleReceipt, setLifecycleReceipt] = useState<RunLifecycleReceipt | null>(null)
  const [routeRecoveryConfirmOpen, setRouteRecoveryConfirmOpen] = useState(false)
  const eventClient = useRef<DurableEventClient | null>(null)
  const citationPreview = useRunCitationPreviewController(runId)
  const preloadCitationPreview = useCallback(() => {
    void loadCitationPreviewPopover()
  }, [])
  const clearOpenEvidenceLocationState = useCallback(() => {
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, navigate])
  const {
    closeButtonRef: evidenceCloseRef,
    closeEvidence,
    evidenceOpen,
    openEvidence,
    toggleEvidence,
  } = useRunEvidenceDrawerController({
    locationPathname: location.pathname,
    locationState,
    onConsumeOpenEvidenceState: clearOpenEvidenceLocationState,
  })
  const turns = useMemo(
    () => conversation.data?.items ?? (run.data ? [run.data] : []),
    [conversation.data, run.data],
  )
  const citationIds = useMemo(() => conversationEvidenceIds(turns), [turns])
  const evidenceQueries = useQueries({ queries: citationIds.map((id) => ({ queryKey: ['evidence', id], queryFn: () => nexusApi.getEvidence(id), staleTime: Infinity })) })
  const evidence = evidenceQueries.flatMap((query) => query.data ? [query.data] : [])
  const evidenceById = useMemo(() => new Map(evidence.map((item) => [item.id, item])), [evidence])
  const evidenceQueryFailed = evidenceQueries.some((query) => query.error)
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: run.error, hasData: Boolean(run.data), label: 'Run', required: true },
    { error: snapshot.error, hasData: Boolean(snapshot.data), label: 'Snapshot', required: true },
    { error: eventHistory.error, hasData: Boolean(eventHistory.data), label: 'Event history', required: true },
    { error: conversation.error, hasData: Boolean(conversation.data), label: 'Conversation' },
    { error: providers.error, hasData: Boolean(providers.data), label: 'Providers' },
    { error: models.error, hasData: Boolean(models.data), label: 'Models' },
    { error: suggestions.error, hasData: Boolean(suggestions.data), label: 'Suggested questions' },
    { error: routeAudit.error, hasData: Boolean(routeAudit.data), label: 'Route audit' },
    { error: evidenceQueryFailed ? new Error('One or more cited Evidence revisions could not refresh.') : undefined, hasData: evidence.length > 0, label: 'Evidence revisions' },
  ])
  const retryRunWorkspaceQueries = () => {
    void run.refetch()
    void snapshot.refetch()
    void eventHistory.refetch()
    if (run.data?.conversation_id) void conversation.refetch()
    void providers.refetch()
    void models.refetch()
    if (run.data?.result && terminal.has(run.data.status)) void suggestions.refetch()
    if (run.data?.goal && hasStoredRoutingTrace) void routeAudit.refetch()
    evidenceQueries.forEach((query) => {
      void query.refetch()
    })
  }
  const queueAttachments = (files: FileList | File[]) => {
    const incoming = Array.from(files)
    setAttachments((current) => {
      const known = new Set(current.map((file) => `${file.name}-${file.size}-${file.lastModified}`))
      return [...current, ...incoming.filter((file) => !known.has(`${file.name}-${file.size}-${file.lastModified}`))].slice(0, 6)
    })
  }
  const removeAttachment = (index: number) => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))

  useEffect(() => { if (eventHistory.data) setEvents(eventHistory.data.items) }, [eventHistory.data])
  useEffect(() => {
    setDetailsOpen(location.hash === '#execution-details')
  }, [location.hash, runId])
  useEffect(() => {
    if (!runId || !snapshot.data || !eventHistory.data) return
    if (run.data && terminal.has(run.data.status)) { setStreamState('closed'); return }
    const client = new DurableEventClient(runId, eventHistory.data.items[eventHistory.data.items.length - 1]?.sequence ?? 0)
    eventClient.current = client
    const unsubscribe = client.subscribe((event) => {
      setEvents((current) => current.some((item) => item.event_id === event.event_id) ? current : [...current, event])
      queryClient.invalidateQueries({ queryKey: ['run', runId] })
    })
    const unsubscribeState = client.onState(setStreamState)
    client.connect()
    return () => { unsubscribe(); unsubscribeState(); client.close() }
  }, [eventHistory.data, queryClient, run.data, runId, snapshot.data])

  const pause = useMutation({
    mutationFn: () => nexusApi.pauseRun(runId),
    onSuccess: (data) => {
      queryClient.setQueryData(['run', runId], data)
      setLifecycleReceipt({ action: 'pause' })
    },
  })
  const resume = useMutation({
    mutationFn: () => nexusApi.resumeRun(runId),
    onSuccess: (data) => {
      queryClient.setQueryData(['run', runId], data)
      setLifecycleReceipt({ action: 'resume' })
    },
  })
  const cancel = useMutation({
    mutationFn: () => nexusApi.cancelRun(runId),
    onSuccess: (data) => {
      queryClient.setQueryData(['run', runId], data)
      setLifecycleReceipt({ action: 'cancel' })
    },
  })
  const rerunWithCurrentRoute = useMutation({
    mutationFn: () => {
      if (!run.data) {
        throw new Error('Run context is unavailable for current router recovery.')
      }
      const request = buildRunRouteRecoveryRunRequest({
        conversationId: run.data.conversation_id,
        currentRoute: routeAudit.data ?? null,
        goal: run.data.goal,
        parentRunId: run.data.id,
        selectedModelDeploymentId: selectedModel || undefined,
      })
      if (!request) {
        throw new Error('Current routing audit has not produced a recoverable Space scope.')
      }
      return nexusApi.createRun(request)
    },
    onError: () => setRouteRecoveryConfirmOpen(false),
    onSuccess: (next) => navigate(`/runs/${next.id}`),
  })
  const clearLifecycleFeedback = () => {
    setLifecycleReceipt(null)
    pause.reset()
    resume.reset()
    cancel.reset()
  }
  const submitLifecycleAction = (action: RunLifecycleAction) => {
    clearLifecycleFeedback()
    if (action === 'pause') pause.mutate()
    else if (action === 'resume') resume.mutate()
    else cancel.mutate()
  }
  const sendFollowUp = useMutation({
    mutationFn: async () => {
      if (!run.data) throw new Error('Run context is unavailable.')
      const attachmentSourceIds: string[] = []
      const attachmentSpace = (run.data.scope.space_ids ?? [])[0]
      if (attachments.length && !attachmentSpace) throw new Error('This conversation has no Space for attachment persistence.')
      for (const [index, file] of attachments.entries()) {
        setFollowUpStage(`Importing attachment ${index + 1}/${attachments.length}: ${file.name}`)
        const result = await nexusApi.uploadSource(attachmentSpace, file)
        await waitForIngestion(result.job.id)
        attachmentSourceIds.push(result.source_version.source_id)
      }
      setFollowUpStage('Resolving context and starting the next turn…')
      const routingTrace = run.data.request_context.routing_trace as Record<string, unknown> | undefined
      return nexusApi.createRun({
        goal: followUp,
        kind: run.data.kind,
        quality_mode: run.data.quality_mode,
        scope: { space_ids: run.data.scope.space_ids ?? [], source_ids: [] },
        auto_route: Boolean(routingTrace && Object.keys(routingTrace).length),
        conversation_id: run.data.conversation_id,
        parent_run_id: run.data.id,
        attachment_source_ids: attachmentSourceIds,
        selected_model_deployment_id: selectedModel || undefined,
      })
    },
    onSuccess: (next) => navigate(`/runs/${next.id}`),
  })
  const followUpComposer = buildFollowUpComposerViewModel({
    attachmentCount: attachments.length,
    errorMessage: sendFollowUp.error?.message,
    followUp,
    pending: sendFollowUp.isPending,
    stage: followUpStage,
  })
  const plan = useMemo(() => events.find((event) => event.event_type === 'research.plan.created')?.public_payload.steps as Array<{ id: number; query: string }> | undefined, [events])
  const understanding = events.find((event) => event.event_type === 'query.understood')?.public_payload
  const queryFallback = buildQueryUnderstandingFallbackViewModel(understanding)
  if (run.isLoading) return <LoadingState label="Recovering conversation state" />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell"><QueryErrorNotice model={queryErrorNotice} onRetry={retryRunWorkspaceQueries} /><EmptyState title="Run workspace could not be loaded" body="Retry before treating this Run as missing. Nexus could not verify the required Run record, snapshot, or durable event history." action={<button type="button" className="button" onClick={retryRunWorkspaceQueries}><RotateCcw size={14} />Retry workspace</button>} /></div>
  if (!run.data) return <EmptyState title="Run not found" body="The requested Run is not present in the authoritative control plane." />
  const pendingLifecycleAction: RunLifecycleAction | undefined = pause.isPending
    ? 'pause'
    : resume.isPending
      ? 'resume'
      : cancel.isPending ? 'cancel' : undefined
  const errorLifecycleAction: RunLifecycleAction | undefined = pause.error
    ? 'pause'
    : resume.error
      ? 'resume'
      : cancel.error ? 'cancel' : undefined
  const lifecycleError = pause.error ?? resume.error ?? cancel.error
  const lifecycle = buildRunLifecycleActionViewModel({
    completedAction: lifecycleReceipt?.action,
    errorAction: errorLifecycleAction,
    errorMessage: lifecycleError?.message,
    pendingAction: pendingLifecycleAction,
    runGoal: run.data.goal,
    status: run.data.status,
  })
  const routeReceipt = buildRunRouteReceiptViewModel(run.data.request_context.routing_trace)
  const routeAuditView = buildRunRouteAuditViewModel({
    currentRoute: routeAudit.data ?? null,
    errorMessage: routeAudit.error?.message,
    pending: routeAudit.isLoading || (routeAudit.isFetching && !routeAudit.data),
    storedReceipt: routeReceipt,
  })
  const routeRecovery = buildRunRouteRecoveryViewModel({
    audit: routeAuditView,
    currentRoute: routeAudit.data ?? null,
    errorMessage: rerunWithCurrentRoute.error?.message,
    pending: rerunWithCurrentRoute.isPending,
  })
  const scopeSummary = buildRunScopeSummaryViewModel(run.data)
  const currentEvidence = runEvidenceIds(run.data).map((id) => evidenceById.get(id)).filter((item): item is Evidence => Boolean(item))
  const submitFollowUp = (event: FormEvent) => {
    event.preventDefault()
    if (!followUpComposer.canSubmit) return
    sendFollowUp.mutate()
  }
  const openTurnEvidence = (targetRunId: string) => {
    if (targetRunId === runId) {
      openEvidence()
      return
    }
    navigate(`/runs/${targetRunId}`, { state: { openEvidence: true } })
  }
  return (
    <div className={`run-workspace conversation-workspace${evidenceOpen ? ' evidence-open' : ''}`}>
      <header className="run-topbar">
        <button type="button" className="icon-button" onClick={() => navigate('/research/new')} aria-label="Back to new conversation"><ArrowLeft /></button>
        <div><p className="eyebrow">Conversation · {run.data.conversation_id.slice(0, 8)} · turn {turns.length}</p><h1>{run.data.goal}</h1></div>
        <div className="run-control-stack">
          <div className="run-controls">
            <button type="button" className="evidence-drawer-toggle" aria-controls={runEvidenceDrawerId} aria-expanded={evidenceOpen} onClick={toggleEvidence}><LocateFixed size={14} /><span>Evidence</span><strong>{currentEvidence.length}</strong></button>
            <span className={`stream-state stream-${streamState}`}><Radio size={13} />{streamState}</span>
            <StatusMark status={run.data.status} />
            {!terminal.has(run.data.status) && run.data.status !== 'paused' && <button type="button" className="icon-button" aria-describedby={`${runLifecycleFeedbackId}${lifecycle.controls.pause.disabledDetail ? ` ${runLifecycleControlGateId('pause')}` : ''}`} aria-disabled={lifecycle.controls.pause.ariaDisabled || undefined} aria-label={lifecycle.controls.pause.label === 'Pause' ? lifecycle.controls.pause.ariaLabel : lifecycle.controls.pause.label} onClick={() => { if (lifecycle.controls.pause.canSubmit) submitLifecycleAction('pause') }}><PauseCircle size={17} /></button>}
            {run.data.status === 'paused' && <button type="button" className="button" aria-describedby={`${runLifecycleFeedbackId}${lifecycle.controls.resume.disabledDetail ? ` ${runLifecycleControlGateId('resume')}` : ''}`} aria-disabled={lifecycle.controls.resume.ariaDisabled || undefined} onClick={() => { if (lifecycle.controls.resume.canSubmit) submitLifecycleAction('resume') }}><Play size={15} />{lifecycle.controls.resume.label}</button>}
            {!terminal.has(run.data.status) && <button type="button" className="icon-button danger" aria-describedby={`${runLifecycleFeedbackId}${lifecycle.controls.cancel.disabledDetail ? ` ${runLifecycleControlGateId('cancel')}` : ''}`} aria-disabled={lifecycle.controls.cancel.ariaDisabled || undefined} aria-label={lifecycle.controls.cancel.label === 'Cancel' ? lifecycle.controls.cancel.ariaLabel : lifecycle.controls.cancel.label} onClick={() => { if (lifecycle.controls.cancel.canSubmit) submitLifecycleAction('cancel') }}><Ban size={17} /></button>}
            {lifecycle.controls.pause.disabledDetail && <span className="sr-only" id={runLifecycleControlGateId('pause')}>{lifecycle.controls.pause.disabledDetail}</span>}
            {lifecycle.controls.resume.disabledDetail && <span className="sr-only" id={runLifecycleControlGateId('resume')}>{lifecycle.controls.resume.disabledDetail}</span>}
            {lifecycle.controls.cancel.disabledDetail && <span className="sr-only" id={runLifecycleControlGateId('cancel')}>{lifecycle.controls.cancel.disabledDetail}</span>}
          </div>
          <SubmitReadinessCard className="run-lifecycle-feedback" detail={lifecycle.feedbackDetail} id={runLifecycleFeedbackId} label={lifecycle.feedbackLabel} liveMode={lifecycle.liveMode} pending={lifecycle.feedbackTone === 'pending'} role={lifecycle.role} tone={lifecycle.feedbackTone} visible={lifecycle.visible} />
        </div>
      </header>
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryRunWorkspaceQueries} />
      <div className="run-columns">
        <aside className="run-plan-column">
          <div className="column-head"><span>Conversation & process</span><code>v{run.data.state_version}</code></div>
          <nav className="conversation-turns">{turns.map((turn, index) => <Link key={turn.id} className={turn.id === runId ? 'active' : ''} to={`/runs/${turn.id}`}><span>{index + 1}</span><p><strong>{turn.goal}</strong><small>{turn.kind} · {turn.status}</small></p><ChevronRight /></Link>)}</nav>
          <RunProgressSummary run={run.data} events={events} />
          <details id="execution-details" className="process-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary>Execution details <span>{events.length} event{events.length === 1 ? '' : 's'}</span></summary>
            {understanding && <section className="query-understanding"><p className="eyebrow"><BrainCircuit />Query understanding</p><dl><div><dt>Intent</dt><dd>{String(understanding.intent)} · {String(understanding.modality_intent)}</dd></div><div><dt>Rewrite</dt><dd>{String(understanding.rewritten_query)}</dd></div><div><dt>Retrieval</dt><dd>{String(understanding.retrieval_strategy)}</dd></div></dl>{queryFallback.visible && <div className="query-guardrail-fallback" role="status" aria-live="polite"><strong>{queryFallback.label}</strong><small>{queryFallback.detail}</small><code>{queryFallback.modelLabel}</code></div>}</section>}
            {plan && <ol className="plan-list">{plan.map((step, index) => <li key={step.id}><span>{index + 1}</span><p>{step.query}</p><ChevronRight size={14} /></li>)}</ol>}
            <div className="event-timeline"><p className="eyebrow">Public trace</p>{events.slice(-16).map((event) => <div key={event.event_id}><span>{event.sequence}</span><i /><p><strong>{event.event_type.replaceAll('.', ' ')}</strong><small>{new Date(event.occurred_at).toLocaleTimeString()}</small></p></div>)}</div>
          </details>
        </aside>

        <main className="run-result-column conversation-column">
          <div className="column-head"><span>Evidence conversation</span><span>{turns.length} turn{turns.length === 1 ? '' : 's'}</span></div>
          <RunRouteRecoveryPanel
            evidenceOpen={evidenceOpen}
            recoveryBusy={rerunWithCurrentRoute.isPending}
            recoveryConfirmOpen={routeRecoveryConfirmOpen}
            routeAudit={routeAuditView}
            routeReceipt={routeReceipt}
            routeRecovery={routeRecovery}
            onCancelRecovery={() => { if (!rerunWithCurrentRoute.isPending) setRouteRecoveryConfirmOpen(false) }}
            onConfirmRecovery={() => { if (routeRecovery.canSubmit) rerunWithCurrentRoute.mutate() }}
            evidenceDrawerId={runEvidenceDrawerId}
            onOpenEvidence={openEvidence}
            onRequestRecovery={() => setRouteRecoveryConfirmOpen(true)}
          />
          <div className="message-stream">
            {turns.map((turn) => {
              const result = turn.result as Record<string, unknown> | null
              const answerMeta = buildRunAnswerMetaViewModel(result)
              const modelFallback = buildRunModelFallbackViewModel(result)
              const capabilityRecovery = buildRunCapabilityRecoveryViewModel(result)
              return <section className="conversation-turn" key={turn.id}>
                <div className="user-message"><span>You</span><p>{turn.goal}</p></div>
                <article className="assistant-message">
                  <header><span className="assistant-orb"><BrainCircuit /></span><span><strong>Nexus</strong><small>{turn.kind} · {String((result?.model as Record<string, unknown> | undefined)?.actual_model ?? 'configured route')}</small></span><StatusMark status={turn.status} /></header>
                  {!result ? <div className="working-state compact"><RotateCcw className="spin" /><p>This turn is retrieving and verifying evidence. You may safely leave and return.</p></div> : <><SearchOutcomeNotice run={turn} result={result} /><RunCapabilityRecoveryNotice evidenceDrawerId={turn.id === runId ? runEvidenceDrawerId : undefined} model={capabilityRecovery} onOpenEvidence={() => openTurnEvidence(turn.id)} /><RunModelFallbackNotice model={modelFallback} /><div className="answer-meta"><span>Verification {String(result.verification_level ?? '—')}</span><StatusMark status={String(result.verification_status ?? turn.status)} /><span>{answerMeta.evidenceLabel}</span></div><div className="answer-body"><EvidenceAnswer activeTriggerKey={citationPreview.activeTriggerKey} result={result} evidenceById={evidenceById} onPreview={citationPreview.openPreview} onPreviewIntent={preloadCitationPreview} /></div>{Boolean(result.artifact_id) && <Link className="artifact-callout" to={`/artifacts/${String(result.artifact_id)}`}><FileOutput /><span><strong>Open Canonical Artifact</strong><small>Review structured blocks, stable citations and exports.</small></span><ChevronRight /></Link>}</>}
                </article>
              </section>
            })}
          </div>
          {terminal.has(run.data.status) && <form className="follow-up-composer" onSubmit={submitFollowUp}>
            {suggestions.data?.items.length ? <section className="evidence-follow-ups">
              <header><span><Sparkles /><strong>Continue from the evidence</strong></span><small>{suggestions.data.ledger_evidence_count} retrieved · frozen at watermark {suggestions.data.scope.publish_watermark ?? 'current'}</small></header>
              <div>{suggestions.data.items.map((item, index) => <button type="button" key={item.id} onClick={() => { setFollowUp(item.question); window.requestAnimationFrame(() => followUpInput.current?.focus()) }}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.question}</strong><small>{suggestionProvenance(item)}</small></button>)}</div>
            </section> : null}
            <input ref={fileInput} hidden type="file" multiple accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.md,.markdown,.txt,.csv,.xls,.xlsx,.xlsm" onChange={(event) => { queueAttachments(event.target.files ?? []); event.currentTarget.value = '' }} />
            <PendingAttachmentTray files={attachments} onRemove={removeAttachment} detail="These originals are retained and parsed before the follow-up starts." label="Follow-up attachments" />
            <p className="sr-only" id={followUpHelpId}>Follow-up references are rewritten using the current conversation context before retrieval.</p>
            <textarea ref={followUpInput} aria-label="Follow-up question" aria-describedby={`${followUpHelpId} ${followUpFeedbackId}`} aria-invalid={followUpComposer.promptRequired} aria-required="true" value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="Ask a follow-up. References such as ‘this’, ‘the second one’, or ‘continue’ are rewritten using conversation context…" rows={3} />
            <footer><button type="button" className="text-button" onClick={() => fileInput.current?.click()}><Paperclip />Attach evidence</button><CatalogModelPicker models={models.data?.items ?? []} providers={providers.data?.items ?? []} capability="text" value={selectedModel} onChange={setSelectedModel} label="Choose follow-up model" /><button type="submit" className="button primary" aria-describedby={`${followUpFeedbackId}${followUpComposer.disabledDetail ? ` ${followUpGateId}` : ''}`} aria-disabled={followUpComposer.ariaDisabled || undefined} onClick={(event) => { if (!followUpComposer.canSubmit) event.preventDefault() }}>{followUpComposer.feedbackTone === 'pending' ? <RotateCcw className="spin" /> : <Send />}{followUpComposer.submitLabel}</button></footer>
            {followUpComposer.disabledDetail && <p className="sr-only" id={followUpGateId}>{followUpComposer.disabledDetail}</p>}
            <SubmitReadinessCard className="follow-up-submit-feedback" detail={followUpComposer.feedbackDetail} id={followUpFeedbackId} label={followUpComposer.feedbackLabel} liveMode={followUpComposer.feedbackTone === 'error' ? 'assertive' : 'polite'} pending={followUpComposer.feedbackTone === 'pending'} role={followUpComposer.feedbackTone === 'error' ? 'alert' : 'status'} tone={followUpComposer.feedbackTone} />
          </form>}
        </main>

        {evidenceOpen && <button type="button" className="evidence-drawer-backdrop" aria-label="Close current evidence" onClick={closeEvidence} />}
        {evidenceOpen && <Suspense fallback={<aside id={runEvidenceDrawerId} className="run-evidence-column" role="dialog" aria-modal="false" aria-label="Current evidence"><div className="column-head evidence-column-head"><span>Current evidence</span><button ref={evidenceCloseRef} type="button" className="text-button" aria-label="Close current evidence" onClick={closeEvidence}>Close</button></div><LoadingState label="Opening evidence ledger" /></aside>}><RunEvidenceDrawer closeButtonRef={evidenceCloseRef} currentEvidence={currentEvidence} routeReceipt={routeReceipt} runId={runId} scope={run.data.scope} scopeSummary={scopeSummary} onClose={closeEvidence} /></Suspense>}
      </div>
      {citationPreview.preview && <Suspense fallback={<div className="citation-preview-loading" role="status" aria-live="polite" style={{ left: citationPreview.preview.anchorRect.left, top: citationPreview.preview.anchorRect.bottom + 8 }}>Opening citation preview...</div>}><CitationPreviewPopover evidence={citationPreview.preview.evidence} anchorRect={citationPreview.preview.anchorRect} runId={runId} onClose={citationPreview.closePreview} /></Suspense>}
    </div>
  )
}
