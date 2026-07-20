import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Ban,
  BrainCircuit,
  ChevronRight,
  FileAudio,
  FileImage,
  FileOutput,
  FileText,
  Film,
  LocateFixed,
  Paperclip,
  PauseCircle,
  Play,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { DurableRunEvent, Evidence, Run } from '@/api/nexus'
import { nexusApi } from '@/api/nexus'
import { DurableEventClient } from '@/events/DurableEventClient'
import { EvidenceCard } from '@/components/nexus/EvidenceCard'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { StatusMark } from '@/components/nexus/StatusMark'
import { CatalogModelPicker } from '@/features/models/CatalogModelPicker'
import { RunProgressSummary } from './RunProgressSummary'
import { SearchOutcomeNotice } from './SearchOutcomeNotice'
import { suggestionProvenance } from './runSuggestions'

type Citation = { evidence_revision_id: string; source_name?: string; locator?: Record<string, unknown> }

const terminal = new Set(['completed', 'failed', 'partial', 'cancelled'])
const terminalJobs = new Set(['completed', 'failed', 'cancelled'])
const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

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

const runCitations = (run: Run) => {
  const result = run.result as Record<string, unknown> | null
  return Array.isArray(result?.citations) ? result.citations as Citation[] : []
}

function fileIcon(file: File) {
  if (file.type.startsWith('image/')) return <FileImage />
  if (file.type.startsWith('audio/')) return <FileAudio />
  if (file.type.startsWith('video/')) return <Film />
  return <FileText />
}

function InlineMedia({ evidence, runId }: { evidence: Evidence; runId: string }) {
  const start = Number(evidence.locator.start_ms ?? 0) / 1000
  const end = Number(evidence.locator.end_ms ?? 0) / 1000
  const timedUrl = start ? `${evidence.asset_url}#t=${start}${end > start ? `,${end}` : ''}` : evidence.asset_url
  const hasDerivedVisual = Boolean(evidence.locator.extra?.object_key)
  if (evidence.modality === 'image' || hasDerivedVisual) return <span className="inline-evidence-media"><img src={evidence.asset_url} alt={evidence.source_name} /><span><FileImage />{evidence.modality === 'table' ? 'Table visual' : 'Image evidence'} · <Link to={`/runs/${runId}/evidence/${evidence.id}`}>{evidence.source_name}</Link></span></span>
  if (evidence.modality === 'audio') return <span className="inline-evidence-media"><audio src={timedUrl} controls preload="metadata" /><span><FileAudio />Audio evidence · {(start).toFixed(1)}–{(end).toFixed(1)}s</span></span>
  if (evidence.modality === 'video') return <span className="inline-evidence-media"><video src={timedUrl} controls preload="metadata" /><span><Film />Video evidence · {(start).toFixed(1)}–{(end).toFixed(1)}s</span></span>
  return null
}

function EvidenceAnswer({ run, evidenceById }: { run: Run; evidenceById: Map<string, Evidence> }) {
  const result = run.result as Record<string, unknown> | null
  const answer = String(result?.answer ?? '')
  const citations = runCitations(run)
  const citationNumbers = new Map(citations.map((citation, index) => [citation.evidence_revision_id, index + 1]))
  const prepared = answer.replace(/\[evidence:([0-9a-f-]{36})\]/gi, (_match, id: string) => `[${citationNumbers.get(id) ?? 'source'}](#evidence-${id})`)
  const seenMedia = new Set<string>()
  return <ReactMarkdown components={{
    a: ({ href, children }) => {
      const id = href?.startsWith('#evidence-') ? href.slice('#evidence-'.length) : null
      if (!id) return <a href={href}>{children}</a>
      const item = evidenceById.get(id)
      const media = item && (['image', 'audio', 'video'].includes(item.modality) || Boolean(item.locator.extra?.object_key)) && !seenMedia.has(id)
      if (media) seenMedia.add(id)
      return <><Link className="inline-citation" to={`/runs/${run.id}/evidence/${id}`} title={item ? `${item.source_name} · ${item.locator.locator_type}` : 'Open citation'}>{children}</Link>{media && item ? <InlineMedia evidence={item} runId={run.id} /> : null}</>
    },
  }}>{prepared}</ReactMarkdown>
}

export default function RunWorkspacePage() {
  const { runId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
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
  const [events, setEvents] = useState<DurableRunEvent[]>([])
  const [streamState, setStreamState] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting')
  const [followUp, setFollowUp] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [followUpStage, setFollowUpStage] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(location.hash === '#execution-details')
  const eventClient = useRef<DurableEventClient | null>(null)
  const turns = useMemo(
    () => conversation.data?.items ?? (run.data ? [run.data] : []),
    [conversation.data, run.data],
  )
  const citationIds = useMemo(() => Array.from(new Set(turns.flatMap((turn) => runCitations(turn).map((citation) => citation.evidence_revision_id)))), [turns])
  const evidenceQueries = useQueries({ queries: citationIds.map((id) => ({ queryKey: ['evidence', id], queryFn: () => nexusApi.getEvidence(id), staleTime: Infinity })) })
  const evidence = evidenceQueries.flatMap((query) => query.data ? [query.data] : [])
  const evidenceById = useMemo(() => new Map(evidence.map((item) => [item.id, item])), [evidence])

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

  const pause = useMutation({ mutationFn: () => nexusApi.pauseRun(runId), onSuccess: (data) => queryClient.setQueryData(['run', runId], data) })
  const resume = useMutation({ mutationFn: () => nexusApi.resumeRun(runId), onSuccess: (data) => queryClient.setQueryData(['run', runId], data) })
  const cancel = useMutation({ mutationFn: () => nexusApi.cancelRun(runId), onSuccess: (data) => queryClient.setQueryData(['run', runId], data) })
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
  const plan = useMemo(() => events.find((event) => event.event_type === 'research.plan.created')?.public_payload.steps as Array<{ id: number; query: string }> | undefined, [events])
  const understanding = events.find((event) => event.event_type === 'query.understood')?.public_payload
  if (run.isLoading) return <LoadingState label="Recovering conversation state" />
  if (!run.data) return <EmptyState title="Run not found" body="The requested Run is not present in the authoritative control plane." />
  const currentEvidence = runCitations(run.data).map((citation) => evidenceById.get(citation.evidence_revision_id)).filter((item): item is Evidence => Boolean(item))
  const submitFollowUp = (event: FormEvent) => { event.preventDefault(); if (followUp.trim()) sendFollowUp.mutate() }
  return (
    <div className="run-workspace conversation-workspace">
      <header className="run-topbar">
        <button className="icon-button" onClick={() => navigate('/research/new')} aria-label="Back to new conversation"><ArrowLeft /></button>
        <div><p className="eyebrow">Conversation · {run.data.conversation_id.slice(0, 8)} · turn {turns.length}</p><h1>{run.data.goal}</h1></div>
        <div className="run-controls"><span className={`stream-state stream-${streamState}`}><Radio size={13} />{streamState}</span><StatusMark status={run.data.status} />{!terminal.has(run.data.status) && run.data.status !== 'paused' && <button className="icon-button" onClick={() => pause.mutate()} aria-label="Pause Run"><PauseCircle size={17} /></button>}{run.data.status === 'paused' && <button className="button" onClick={() => resume.mutate()}><Play size={15} />Resume</button>}{!terminal.has(run.data.status) && <button className="icon-button danger" onClick={() => cancel.mutate()} aria-label="Cancel Run"><Ban size={17} /></button>}</div>
      </header>
      <div className="run-columns">
        <aside className="run-plan-column">
          <div className="column-head"><span>Conversation & process</span><code>v{run.data.state_version}</code></div>
          <nav className="conversation-turns">{turns.map((turn, index) => <Link key={turn.id} className={turn.id === runId ? 'active' : ''} to={`/runs/${turn.id}`}><span>{index + 1}</span><p><strong>{turn.goal}</strong><small>{turn.kind} · {turn.status}</small></p><ChevronRight /></Link>)}</nav>
          <RunProgressSummary run={run.data} events={events} />
          <details id="execution-details" className="process-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary>Execution details <span>{events.length} event{events.length === 1 ? '' : 's'}</span></summary>
            {understanding && <section className="query-understanding"><p className="eyebrow"><BrainCircuit />Query understanding</p><dl><div><dt>Intent</dt><dd>{String(understanding.intent)} · {String(understanding.modality_intent)}</dd></div><div><dt>Rewrite</dt><dd>{String(understanding.rewritten_query)}</dd></div><div><dt>Retrieval</dt><dd>{String(understanding.retrieval_strategy)}</dd></div></dl></section>}
            {plan && <ol className="plan-list">{plan.map((step, index) => <li key={step.id}><span>{index + 1}</span><p>{step.query}</p><ChevronRight size={14} /></li>)}</ol>}
            <div className="event-timeline"><p className="eyebrow">Public trace</p>{events.slice(-16).map((event) => <div key={event.event_id}><span>{event.sequence}</span><i /><p><strong>{event.event_type.replaceAll('.', ' ')}</strong><small>{new Date(event.occurred_at).toLocaleTimeString()}</small></p></div>)}</div>
          </details>
        </aside>

        <main className="run-result-column conversation-column">
          <div className="column-head"><span>Evidence conversation</span><span>{turns.length} turn{turns.length === 1 ? '' : 's'}</span></div>
          <div className="message-stream">
            {turns.map((turn) => {
              const result = turn.result as Record<string, unknown> | null
              return <section className="conversation-turn" key={turn.id}>
                <div className="user-message"><span>You</span><p>{turn.goal}</p></div>
                <article className="assistant-message">
                  <header><span className="assistant-orb"><BrainCircuit /></span><span><strong>Nexus</strong><small>{turn.kind} · {String((result?.model as Record<string, unknown> | undefined)?.actual_model ?? 'configured route')}</small></span><StatusMark status={turn.status} /></header>
                  {!result ? <div className="working-state compact"><RotateCcw className="spin" /><p>This turn is retrieving and verifying evidence. You may safely leave and return.</p></div> : <><SearchOutcomeNotice run={turn} result={result} /><div className="answer-meta"><span>Verification {String(result.verification_level ?? '—')}</span><StatusMark status={String(result.verification_status ?? turn.status)} /><span>{runCitations(turn).length} citation{runCitations(turn).length === 1 ? '' : 's'}</span></div><div className="answer-body"><EvidenceAnswer run={turn} evidenceById={evidenceById} /></div>{Boolean(result.artifact_id) && <Link className="artifact-callout" to={`/artifacts/${String(result.artifact_id)}`}><FileOutput /><span><strong>Open Canonical Artifact</strong><small>Review structured blocks, stable citations and exports.</small></span><ChevronRight /></Link>}</>}
                </article>
              </section>
            })}
          </div>
          {terminal.has(run.data.status) && <form className="follow-up-composer" onSubmit={submitFollowUp}>
            {suggestions.data?.items.length ? <section className="evidence-follow-ups">
              <header><span><Sparkles /><strong>Continue from the evidence</strong></span><small>{suggestions.data.ledger_evidence_count} retrieved · frozen at watermark {suggestions.data.scope.publish_watermark ?? 'current'}</small></header>
              <div>{suggestions.data.items.map((item, index) => <button type="button" key={item.id} onClick={() => { setFollowUp(item.question); window.requestAnimationFrame(() => followUpInput.current?.focus()) }}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.question}</strong><small>{suggestionProvenance(item)}</small></button>)}</div>
            </section> : null}
            <textarea ref={followUpInput} aria-label="Follow-up question" value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="Ask a follow-up. References such as ‘this’, ‘the second one’, or ‘continue’ are rewritten using conversation context…" rows={3} />
            <div className="follow-up-attachments"><input ref={fileInput} hidden type="file" multiple accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.md,.markdown,.txt,.csv,.xls,.xlsx,.xlsm" onChange={(event) => { setAttachments((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 6)); event.currentTarget.value = '' }} />{attachments.map((file, index) => <span key={`${file.name}-${index}`}>{fileIcon(file)}{file.name}<button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /></button></span>)}</div>
            <footer><button type="button" className="text-button" onClick={() => fileInput.current?.click()}><Paperclip />Attach evidence</button><CatalogModelPicker models={models.data?.items ?? []} providers={providers.data?.items ?? []} capability="text" value={selectedModel} onChange={setSelectedModel} label="Choose follow-up model" /><button className="button primary" disabled={sendFollowUp.isPending || !followUp.trim()}>{sendFollowUp.isPending ? <RotateCcw className="spin" /> : <Send />}Send follow-up</button></footer>
            {followUpStage && sendFollowUp.isPending && <p className="composer-stage">{followUpStage}</p>}
            {sendFollowUp.error && <p className="form-error">{sendFollowUp.error.message}</p>}
          </form>}
        </main>

        <aside className="run-evidence-column">
          <div className="column-head"><span>Current evidence</span><strong>{currentEvidence.length}</strong></div>
          {currentEvidence.length ? <div className="ledger-list">{currentEvidence.map((item) => <Link key={item.id} to={`/runs/${runId}/evidence/${item.id}`}><EvidenceCard evidence={item} compact /></Link>)}</div> : <EmptyState title="Ledger is waiting" body="Retrieved Evidence appears here and remains bound to this turn's snapshot." />}
          <div className="scope-capsule"><LocateFixed size={15} /><span><strong>{run.data.scope.space_ids?.length ?? 0} routed Spaces</strong><small>{run.data.scope.source_ids?.length ?? 0} Sources · watermark {run.data.scope.publish_watermark ?? 'current'}</small></span></div>
          <div className="scope-capsule"><ShieldCheck size={15} /><span><strong>Per-turn model</strong><small>{run.data.selected_model_deployment_id ? 'Explicit verified deployment' : 'Active task route / configured fallback'}</small></span></div>
        </aside>
      </div>
    </div>
  )
}
