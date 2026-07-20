import { FormEvent, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BrainCircuit,
  Check,
  FileAudio,
  FileImage,
  FileText,
  Film,
  Layers3,
  LockKeyhole,
  Microscope,
  Paperclip,
  Route,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { spaceCoverUrl } from '@/components/nexus/spaceCoverUrl'
import { CatalogModelPicker } from '@/features/models/CatalogModelPicker'
import { recommendSpaceSelection } from '@/features/spaces/spacePolicies'

const terminalJobs = new Set(['completed', 'failed', 'cancelled'])

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

async function waitForIngestion(jobId: string) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const job = await nexusApi.getIngestionJob(jobId)
    if (terminalJobs.has(job.status)) {
      if (job.status !== 'completed') throw new Error(job.error_message || `Attachment ingestion ${job.status}`)
      return job
    }
    await sleep(1000)
  }
  throw new Error('Attachment ingestion is still running. Try again when the job completes.')
}

function fileIcon(file: File) {
  if (file.type.startsWith('image/')) return <FileImage />
  if (file.type.startsWith('audio/')) return <FileAudio />
  if (file.type.startsWith('video/')) return <Film />
  return <FileText />
}

export default function ResearchNewPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: nexusApi.listSpaces })
  const providers = useQuery({ queryKey: ['providers'], queryFn: nexusApi.listProviders })
  const models = useQuery({ queryKey: ['models'], queryFn: nexusApi.listModels })
  const [goal, setGoal] = useState(params.get('question') ?? '')
  const initialSpace = params.get('space')
  const initialCollection = params.get('collection') ?? ''
  const [autoRoute, setAutoRoute] = useState(!initialSpace && !initialCollection)
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>(initialSpace ? [initialSpace] : [])
  const [selectedCollection, setSelectedCollection] = useState(initialCollection)
  const collectionSpaceId = !autoRoute && selectedSpaces.length === 1 ? selectedSpaces[0] : ''
  const collections = useQuery({ queryKey: ['collections', collectionSpaceId], queryFn: () => nexusApi.listCollections(collectionSpaceId), enabled: Boolean(collectionSpaceId) })
  const [kind, setKind] = useState<'quick' | 'research'>('quick')
  const [quality, setQuality] = useState<'fast' | 'quality' | 'deep'>('quality')
  const [executionTouched, setExecutionTouched] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [routing, setRouting] = useState<Awaited<ReturnType<typeof nexusApi.routeSpaces>> | null>(null)
  const [stage, setStage] = useState('')
  const selectedSpaceRecords = spaces.data?.items.filter((space) => selectedSpaces.includes(space.id)) ?? []
  const pinnedRecommendation = recommendSpaceSelection(selectedSpaceRecords)
  useEffect(() => {
    if (autoRoute || executionTouched || !selectedSpaceRecords.length) return
    setKind(pinnedRecommendation.kind)
    setQuality(pinnedRecommendation.quality)
  }, [autoRoute, executionTouched, pinnedRecommendation.kind, pinnedRecommendation.quality, selectedSpaceRecords.length])
  const create = useMutation({
    mutationFn: async () => {
      setStage(autoRoute ? 'Routing across Space portraits…' : 'Freezing selected Spaces…')
      const routeResult = autoRoute ? await nexusApi.routeSpaces(goal) : null
      if (routeResult) setRouting(routeResult)
      const routedSpaces = routeResult?.selected_space_ids.length ? routeResult.selected_space_ids : selectedSpaces
      const policyRecommendation = routeResult
        ? { kind: routeResult.recommended_kind, quality: routeResult.recommended_quality }
        : pinnedRecommendation
      const resolvedKind = executionTouched ? kind : policyRecommendation.kind
      const resolvedQuality = executionTouched ? quality : policyRecommendation.quality
      const attachmentSpace = routedSpaces[0] ?? spaces.data?.items[0]?.id
      if (attachments.length && !attachmentSpace) throw new Error('A Space is required to persist attachment evidence.')
      const attachmentSourceIds: string[] = []
      for (const [index, file] of attachments.entries()) {
        setStage(`Importing attachment ${index + 1}/${attachments.length}: ${file.name}`)
        const uploaded = await nexusApi.uploadSource(attachmentSpace!, file)
        await waitForIngestion(uploaded.job.id)
        attachmentSourceIds.push(uploaded.source_version.source_id)
      }
      setStage('Starting evidence-bound Run…')
      return nexusApi.createRun({
        goal,
        kind: resolvedKind,
        quality_mode: resolvedQuality,
        scope: {
          space_ids: routedSpaces,
          collection_ids: selectedCollection && !autoRoute ? [selectedCollection] : [],
        },
        auto_route: autoRoute,
        attachment_source_ids: attachmentSourceIds,
        selected_model_deployment_id: selectedModel || undefined,
      })
    },
    onSuccess: (run) => navigate(`/runs/${run.id}`),
  })
  if (spaces.isLoading || providers.isLoading || models.isLoading) return <LoadingState />
  if (!spaces.data?.items.length) return <div className="page-shell"><PageHeader eyebrow="Ask / Research" title="Set a bounded goal" description="A Run needs at least one available Space." /><EmptyState title="Create a Space first" body="Sources and Evidence enter a Run through an auditable Space or attachment scope." action={<button className="button" onClick={() => navigate('/spaces')}>Create Space</button>} /></div>

  const toggleSpace = (spaceId: string) => {
    setSelectedCollection('')
    setSelectedSpaces((current) => current.includes(spaceId) ? current.filter((id) => id !== spaceId) : [...current, spaceId])
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!goal.trim() || (!autoRoute && !selectedSpaces.length)) return
    create.mutate()
  }
  return (
    <div className="page-shell research-new-page">
      <PageHeader eyebrow="Conversation / Research" title="Ask across your evidence" description="Auto-route by cluster portrait or pin multiple Spaces. Each turn preserves its own scope, model and citation ledger." />
      <form className="goal-composer evidence-composer" onSubmit={submit}>
        <div className="composer-question-head"><label htmlFor="research-goal">Question or research outcome</label><span><Sparkles size={13} />Intent analysis · rewrite · multi-channel retrieval</span></div>
        <textarea id="research-goal" value={goal} onChange={(event) => { setGoal(event.target.value); setRouting(null) }} placeholder="Ask a question, compare evidence, or describe the decision you need to make…" rows={5} autoFocus />

        <section className="scope-mode-card">
          <div className="scope-mode-tabs" role="radiogroup" aria-label="Space routing mode">
            <button type="button" role="radio" aria-checked={autoRoute} className={autoRoute ? 'active' : ''} onClick={() => { setAutoRoute(true); setSelectedCollection('') }}><Route /><span><strong>Auto-route Spaces</strong><small>Cluster portraits select the strongest scopes.</small></span></button>
            <button type="button" role="radio" aria-checked={!autoRoute} className={!autoRoute ? 'active' : ''} onClick={() => setAutoRoute(false)}><Layers3 /><span><strong>Pin multiple Spaces</strong><small>You control the exact frozen scope.</small></span></button>
          </div>
          {!autoRoute && <div className="space-choice-grid">{spaces.data.items.map((space) => { const coverUrl = spaceCoverUrl(space); return <button type="button" key={space.id} className={selectedSpaces.includes(space.id) ? 'selected' : ''} onClick={() => toggleSpace(space.id)}><span className={`space-choice-cover${coverUrl ? ' has-image' : ''}`} style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>{!coverUrl && space.name.slice(0, 1)}</span><span><strong>{space.name}</strong><small>{space.source_count} sources · {space.policy.label}</small></span>{selectedSpaces.includes(space.id) && <Check />}</button> })}</div>}
          {!autoRoute && collectionSpaceId && Boolean(collections.data?.items.length) && <div className="collection-scope-choice"><div><p className="eyebrow">Optional saved view</p><small>Narrow this turn to a Collection; its Sources are frozen when the Run starts.</small></div><button type="button" className={!selectedCollection ? 'active' : ''} onClick={() => setSelectedCollection('')}>Entire Space</button>{collections.data?.items.map((collection) => <button type="button" key={collection.id} className={selectedCollection === collection.id ? 'active' : ''} onClick={() => setSelectedCollection(collection.id)}><Layers3 /><span><strong>{collection.name}</strong><small>{collection.source_count} materials · {collection.view_kind}</small></span>{selectedCollection === collection.id && <Check />}</button>)}</div>}
          {!autoRoute && selectedSpaceRecords.length > 0 && <div className="policy-recommendation"><Sparkles /><span><strong>{pinnedRecommendation.labels.join(' + ')}</strong><small>Recommended: {pinnedRecommendation.kind === 'research' ? 'Deep Research' : 'Quick Answer'} · {pinnedRecommendation.quality} retrieval{executionTouched ? ' · your manual choice is preserved' : ' · applied automatically'}</small></span></div>}
          {autoRoute && <div className="route-preview"><BrainCircuit /><span><strong>{routing ? `${routing.selected_space_ids.length} Spaces matched · ${routing.method.replaceAll('_', ' ')}` : 'Portrait router is ready'}</strong><small>{routing ? `${routing.candidates.slice(0, 3).map((item) => `${item.space_name} ${(item.score * 100).toFixed(0)}%${item.auto_route_eligible ? '' : ' (manual only)'}`).join(' · ')} · recommends ${routing.recommended_kind} / ${routing.recommended_quality}` : 'Routing decisions and their policy recommendation are stored with the Run snapshot.'}</small></span><button type="button" className="text-button" disabled={!goal.trim()} onClick={async () => { const result = await nexusApi.routeSpaces(goal); setRouting(result); if (!executionTouched) { setKind(result.recommended_kind); setQuality(result.recommended_quality) } }}>Preview & apply</button></div>}
        </section>

        <div className="composer-options enriched-options">
          <div><label htmlFor="quality">Retrieval depth</label><select id="quality" value={quality} onChange={(event) => { setQuality(event.target.value as typeof quality); setExecutionTouched(true) }}><option value="fast">Fast · compact retrieval</option><option value="quality">Quality · RRF + rerank</option><option value="deep">Deep · iterative evidence gain</option></select></div>
          <div><label>Answer model</label><CatalogModelPicker models={models.data?.items ?? []} providers={providers.data?.items ?? []} capability="text" value={selectedModel} onChange={setSelectedModel} label="Choose answer model" /></div>
        </div>

        <div className="attachment-composer">
          <input ref={inputRef} type="file" hidden multiple accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.md,.markdown,.txt,.csv,.xls,.xlsx,.xlsm" onChange={(event) => { setAttachments((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 6)); event.currentTarget.value = '' }} />
          <button className="attachment-add" type="button" onClick={() => inputRef.current?.click()}><Paperclip /><span><strong>Attach evidence</strong><small>Images, audio, video and documents are parsed before this turn starts.</small></span></button>
          {attachments.map((file, index) => <div className="attachment-tile" key={`${file.name}-${index}`}>{fileIcon(file)}<span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB · raw retained</small></span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /></button></div>)}
        </div>

        <div className="execution-choice" role="radiogroup" aria-label="Execution depth">
          <button type="button" role="radio" aria-checked={kind === 'quick'} className={kind === 'quick' ? 'active' : ''} onClick={() => { setExecutionTouched(true); setKind('quick'); if (quality === 'deep') setQuality('quality') }}><Zap /><span><strong>Quick Answer</strong><small>Intent + rewrite, multi-route retrieval, RRF, rerank and T1 verification.</small></span></button>
          <button type="button" role="radio" aria-checked={kind === 'research'} className={kind === 'research' ? 'active' : ''} onClick={() => { setExecutionTouched(true); setKind('research'); setQuality('deep') }}><Microscope /><span><strong>Deep Research</strong><small>Plan, retrieve, observe, verify, re-plan and deliver a reusable Artifact.</small></span></button>
        </div>
        <div className="snapshot-preview"><LockKeyhole size={16} /><span><strong>Per-turn snapshot</strong>{autoRoute ? 'Selected portrait clusters · current Source versions · chosen model' : selectedCollection ? 'Saved view identity · resolved Source versions · chosen model' : `${selectedSpaces.length} pinned Spaces · current Source versions · chosen model`}</span><Layers3 size={18} /></div>
        {create.error && <div className="notice negative">{create.error.message}</div>}
        {stage && create.isPending && <div className="run-create-stage"><span className="spin" />{stage}</div>}
        <button className="button primary large" disabled={create.isPending || !goal.trim() || (!autoRoute && !selectedSpaces.length)}>{create.isPending ? 'Preparing evidence…' : 'Start conversation'}<ArrowRight size={17} /></button>
      </form>
    </div>
  )
}
