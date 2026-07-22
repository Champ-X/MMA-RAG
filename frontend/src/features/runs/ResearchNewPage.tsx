import { FormEvent, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BrainCircuit,
  Check,
  Layers3,
  LockKeyhole,
  Microscope,
  Paperclip,
  Route,
  Sparkles,
  Zap,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { PendingAttachmentTray } from '@/components/nexus/PendingAttachmentTray'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { spaceCoverUrl } from '@/components/nexus/spaceCoverUrl'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { CatalogModelPicker } from '@/features/models/CatalogModelPicker'
import { recommendSpaceSelection } from '@/features/spaces/spacePolicies'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import { buildAutoRoutePreviewViewModel } from './autoRoutePreviewViewModel'
import {
  buildResearchComposerViewModel,
  researchExecutionKindOptions,
  researchScopeModeOptions,
  resolveResearchExecutionChoice,
} from './researchNewPageViewModel'
import type { ResearchExecutionKind, ResearchQuality, ResearchScopeMode } from './researchNewPageViewModel'
import './ResearchNewPage.css'

const terminalJobs = new Set(['completed', 'failed', 'cancelled'])
const autoRoutePreviewFeedbackId = 'auto-route-preview-feedback'
const autoRoutePreviewGateId = 'auto-route-preview-gate'
const entireSpaceCollectionScopeValue = '__entire_space__'
const researchComposerFeedbackId = 'research-composer-feedback'
const researchComposerGateId = 'research-composer-gate'
const researchGoalHelpId = 'research-goal-help'
const researchQualityLegendId = 'research-quality-legend'

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

const qualityOptions: Array<{
  value: ResearchQuality
  label: string
  signal: string
  detail: string
}> = [
  { value: 'fast', label: 'Fast', signal: 'compact retrieval', detail: 'Use when you need a quick cited answer with minimal expansion.' },
  { value: 'quality', label: 'Quality', signal: 'RRF + rerank', detail: 'Balanced default: multi-channel retrieval with reranking and verification.' },
  { value: 'deep', label: 'Deep', signal: 'iterative evidence gain', detail: 'Best for research runs that can re-plan and broaden evidence coverage.' },
]

export default function ResearchNewPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const scopeModeRefs = useRef<Partial<Record<ResearchScopeMode, HTMLButtonElement | null>>>({})
  const qualityRefs = useRef<Partial<Record<ResearchQuality, HTMLButtonElement | null>>>({})
  const executionRefs = useRef<Partial<Record<ResearchExecutionKind, HTMLButtonElement | null>>>({})
  const collectionScopeRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})
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
  const [kind, setKind] = useState<ResearchExecutionKind>('quick')
  const [quality, setQuality] = useState<ResearchQuality>('quality')
  const [executionTouched, setExecutionTouched] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [routing, setRouting] = useState<Awaited<ReturnType<typeof nexusApi.routeSpaces>> | null>(null)
  const [stage, setStage] = useState('')
  const routePreview = useMutation({
    mutationFn: () => nexusApi.routeSpaces(goal),
    onSuccess: (result) => {
      setRouting(result)
      if (!executionTouched) {
        setKind(result.recommended_kind)
        setQuality(result.recommended_quality)
      }
    },
  })
  const selectedSpaceRecords = spaces.data?.items.filter((space) => selectedSpaces.includes(space.id)) ?? []
  const collectionScopeOptions = [entireSpaceCollectionScopeValue, ...(collections.data?.items.map((collection) => collection.id) ?? [])]
  const selectedCollectionScope = selectedCollection || entireSpaceCollectionScopeValue
  const pinnedRecommendation = recommendSpaceSelection(selectedSpaceRecords)
  const queueAttachments = (files: FileList | File[]) => {
    const incoming = Array.from(files)
    setAttachments((current) => {
      const known = new Set(current.map((file) => `${file.name}-${file.size}-${file.lastModified}`))
      return [...current, ...incoming.filter((file) => !known.has(`${file.name}-${file.size}-${file.lastModified}`))].slice(0, 6)
    })
  }
  const removeAttachment = (index: number) => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
  const selectScopeMode = (mode: ResearchScopeMode) => {
    if (mode === 'auto') {
      setAutoRoute(true)
      setSelectedCollection('')
    } else {
      setAutoRoute(false)
    }
  }
  const selectQuality = (nextQuality: ResearchQuality) => {
    setQuality(nextQuality)
    setExecutionTouched(true)
  }
  const selectExecutionKind = (nextKind: ResearchExecutionKind) => {
    setExecutionTouched(true)
    const choice = resolveResearchExecutionChoice({ kind: nextKind, quality })
    setKind(choice.kind)
    setQuality(choice.quality)
  }
  const selectCollectionScope = (nextScope: string) => {
    setSelectedCollection(nextScope === entireSpaceCollectionScopeValue ? '' : nextScope)
  }
  const focusRadio = <T extends string>(
    refs: Partial<Record<T, HTMLButtonElement | null>>,
    value: T,
  ) => {
    window.requestAnimationFrame(() => refs[value]?.focus({ preventScroll: true }))
  }
  const handleScopeModeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const currentMode: ResearchScopeMode = autoRoute ? 'auto' : 'manual'
    const nextMode = moveRadioGroupValue(researchScopeModeOptions, currentMode, direction)
    selectScopeMode(nextMode)
    focusRadio(scopeModeRefs.current, nextMode)
  }
  const handleQualityKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextQuality = moveRadioGroupValue(qualityOptions.map((option) => option.value), quality, direction)
    selectQuality(nextQuality)
    focusRadio(qualityRefs.current, nextQuality)
  }
  const handleExecutionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextKind = moveRadioGroupValue(researchExecutionKindOptions, kind, direction)
    selectExecutionKind(nextKind)
    focusRadio(executionRefs.current, nextKind)
  }
  const handleCollectionScopeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextScope = moveRadioGroupValue(collectionScopeOptions, selectedCollectionScope, direction)
    selectCollectionScope(nextScope)
    focusRadio(collectionScopeRefs.current, nextScope)
  }
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
      if (autoRoute && routeResult && !routeResult.selected_space_ids.length) {
        throw new Error(routeResult.selection_reason || 'Auto-route did not select a searchable Space for this question.')
      }
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
  const composer = buildResearchComposerViewModel({
    attachmentCount: attachments.length,
    autoRoute,
    autoRouteSelectedSpaceCount: routing ? routing.selected_space_ids.length : null,
    errorMessage: create.error?.message,
    goal,
    pending: create.isPending,
    selectedSpaceCount: selectedSpaces.length,
    stage,
  })
  const autoRoutePreview = buildAutoRoutePreviewViewModel({
    errorMessage: routePreview.error?.message,
    goal,
    pending: routePreview.isPending,
    routing,
  })
  const autoRoutePreviewAnnouncement = [
    `${autoRoutePreview.label}.`,
    autoRoutePreview.detail,
    autoRoutePreview.decision ? `Selection decision: ${autoRoutePreview.decision.reason}` : '',
    autoRoutePreview.evidence ? `Evidence signal: ${autoRoutePreview.evidence.reason} ${autoRoutePreview.evidence.scoreBreakdown}` : '',
  ].filter(Boolean).join(' ')
  if (spaces.isLoading || providers.isLoading || models.isLoading) return <LoadingState />
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: spaces.error, hasData: Boolean(spaces.data), label: 'Spaces', required: true },
    { error: providers.error, hasData: Boolean(providers.data), label: 'Providers', required: true },
    { error: models.error, hasData: Boolean(models.data), label: 'Models', required: true },
  ])
  const retryResearchSetup = () => {
    void spaces.refetch()
    void providers.refetch()
    void models.refetch()
  }
  if (queryErrorNotice.tone === 'blocking') {
    return <div className="page-shell"><PageHeader eyebrow="Ask / Research" title="Set a bounded goal" description="A Run needs verified Spaces and model gateway state before Nexus can freeze a turn." /><QueryErrorNotice model={queryErrorNotice} onRetry={retryResearchSetup} /><EmptyState title="Research setup could not be loaded" body="Retry the control plane before starting a Run so scope, Provider and model choices are not inferred from partial data." /></div>
  }
  if (!spaces.data?.items.length) return <div className="page-shell"><PageHeader eyebrow="Ask / Research" title="Set a bounded goal" description="A Run needs at least one available Space." /><EmptyState title="Create a Space first" body="Sources and Evidence enter a Run through an auditable Space or attachment scope." action={<button type="button" className="button" onClick={() => navigate('/spaces')}>Create Space</button>} /></div>

  const toggleSpace = (spaceId: string) => {
    setSelectedCollection('')
    setSelectedSpaces((current) => current.includes(spaceId) ? current.filter((id) => id !== spaceId) : [...current, spaceId])
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!composer.canSubmit) return
    create.mutate()
  }
  return (
    <div className="page-shell research-new-page">
      <PageHeader eyebrow="Conversation / Research" title="Ask across your evidence" description="Auto-route by cluster portrait or pin multiple Spaces. Each turn preserves its own scope, model and citation ledger." />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryResearchSetup} />
      <form className="goal-composer evidence-composer research-composer" onSubmit={submit}>
        <section className="research-setup-ledger">
          <header><span><Sparkles size={15} /><strong>Turn setup</strong></span><small>Scope, retrieval depth and execution posture are frozen with this question.</small></header>
          <section className="scope-mode-card">
          <div className="scope-mode-tabs" role="radiogroup" aria-label="Space routing mode">
            <button type="button" ref={(node) => { scopeModeRefs.current.auto = node }} role="radio" aria-checked={autoRoute} tabIndex={autoRoute ? 0 : -1} className={autoRoute ? 'active' : ''} onKeyDown={handleScopeModeKeyDown} onClick={() => selectScopeMode('auto')}><Route /><span><strong>Auto-route Spaces</strong><small>Cluster portraits select the strongest scopes.</small></span></button>
            <button type="button" ref={(node) => { scopeModeRefs.current.manual = node }} role="radio" aria-checked={!autoRoute} tabIndex={!autoRoute ? 0 : -1} className={!autoRoute ? 'active' : ''} onKeyDown={handleScopeModeKeyDown} onClick={() => selectScopeMode('manual')}><Layers3 /><span><strong>Pin multiple Spaces</strong><small>You control the exact frozen scope.</small></span></button>
          </div>
          {!autoRoute && <div className="space-choice-grid">{spaces.data.items.map((space) => { const coverUrl = spaceCoverUrl(space); return <button type="button" key={space.id} className={selectedSpaces.includes(space.id) ? 'selected' : ''} onClick={() => toggleSpace(space.id)}><span className={`space-choice-cover${coverUrl ? ' has-image' : ''}`} style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}>{!coverUrl && space.name.slice(0, 1)}</span><span><strong>{space.name}</strong><small>{space.source_count} sources · {space.policy.label}</small></span>{selectedSpaces.includes(space.id) && <Check />}</button> })}</div>}
          {!autoRoute && collectionSpaceId && Boolean(collections.data?.items.length) && <div className="collection-scope-choice" role="radiogroup" aria-label="Collection scope"><div><p className="eyebrow">Optional saved view</p><small>Narrow this turn to a Collection; its Sources are frozen when the Run starts.</small></div><button type="button" ref={(node) => { collectionScopeRefs.current[entireSpaceCollectionScopeValue] = node }} role="radio" aria-checked={!selectedCollection} tabIndex={!selectedCollection ? 0 : -1} className={!selectedCollection ? 'active' : ''} onKeyDown={handleCollectionScopeKeyDown} onClick={() => selectCollectionScope(entireSpaceCollectionScopeValue)}>Entire Space</button>{collections.data?.items.map((collection) => {
            const selected = selectedCollection === collection.id
            return <button type="button" key={collection.id} ref={(node) => { collectionScopeRefs.current[collection.id] = node }} role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} className={selected ? 'active' : ''} onKeyDown={handleCollectionScopeKeyDown} onClick={() => selectCollectionScope(collection.id)}><Layers3 /><span><strong>{collection.name}</strong><small>{collection.source_count} materials · {collection.view_kind}</small></span>{selected && <Check />}</button>
          })}</div>}
          {!autoRoute && selectedSpaceRecords.length > 0 && <div className="policy-recommendation"><Sparkles /><span><strong>{pinnedRecommendation.labels.join(' + ')}</strong><small>Recommended: {pinnedRecommendation.kind === 'research' ? 'Deep Research' : 'Quick Answer'} · {pinnedRecommendation.quality} retrieval{executionTouched ? ' · your manual choice is preserved' : ' · applied automatically'}</small></span></div>}
          {autoRoute && <div className={`route-preview tone-${autoRoutePreview.tone}`}>
            <BrainCircuit />
            <span><strong>{autoRoutePreview.label}</strong><small>{autoRoutePreview.detail}</small></span>
            <button type="button" className="text-button" aria-describedby={`${autoRoutePreviewFeedbackId}${autoRoutePreview.disabledDetail ? ` ${autoRoutePreviewGateId}` : ''}`} aria-disabled={autoRoutePreview.ariaDisabled || undefined} onClick={() => { if (autoRoutePreview.canPreview) routePreview.mutate() }}>{autoRoutePreview.previewLabel}</button>
            {(autoRoutePreview.decision || autoRoutePreview.evidence) && <div className="route-preview-evidence">
              {autoRoutePreview.decision && <span className="route-preview-decision"><strong>Selection decision</strong><small>{autoRoutePreview.decision.reason}</small></span>}
              {autoRoutePreview.evidence && <span><strong>Evidence signal</strong><small>{autoRoutePreview.evidence.reason}</small></span>}
              {autoRoutePreview.evidence && <em>{autoRoutePreview.evidence.scoreBreakdown}</em>}
              {autoRoutePreview.evidence?.matchedTerms.length ? <ul aria-label="Matched route terms">{autoRoutePreview.evidence.matchedTerms.map((term) => <li key={term}>{term}</li>)}</ul> : null}
            </div>}
            <p className="sr-only" id={autoRoutePreviewFeedbackId} role={autoRoutePreview.role} aria-live={autoRoutePreview.liveMode}>{autoRoutePreviewAnnouncement}</p>
            {autoRoutePreview.disabledDetail && <p className="sr-only" id={autoRoutePreviewGateId}>{autoRoutePreview.disabledDetail}</p>}
          </div>}
          </section>

          <div className="research-decision-grid">
            <fieldset className="retrieval-depth-choice" role="radiogroup" aria-labelledby={researchQualityLegendId}><legend id={researchQualityLegendId}>Retrieval depth</legend>{qualityOptions.map((option) => <button type="button" ref={(node) => { qualityRefs.current[option.value] = node }} role="radio" aria-checked={quality === option.value} tabIndex={quality === option.value ? 0 : -1} className={quality === option.value ? 'active' : ''} key={option.value} onKeyDown={handleQualityKeyDown} onClick={() => selectQuality(option.value)}><span><strong>{option.label}</strong><small>{option.signal}</small></span><em>{option.detail}</em></button>)}</fieldset>
            <div className="execution-choice" role="radiogroup" aria-label="Execution depth">
              <button type="button" ref={(node) => { executionRefs.current.quick = node }} role="radio" aria-checked={kind === 'quick'} tabIndex={kind === 'quick' ? 0 : -1} className={kind === 'quick' ? 'active' : ''} onKeyDown={handleExecutionKeyDown} onClick={() => selectExecutionKind('quick')}><Zap /><span><strong>Quick Answer</strong><small>Intent + rewrite, multi-route retrieval, RRF, rerank and T1 verification.</small></span></button>
              <button type="button" ref={(node) => { executionRefs.current.research = node }} role="radio" aria-checked={kind === 'research'} tabIndex={kind === 'research' ? 0 : -1} className={kind === 'research' ? 'active' : ''} onKeyDown={handleExecutionKeyDown} onClick={() => selectExecutionKind('research')}><Microscope /><span><strong>Deep Research</strong><small>Plan, retrieve, observe, verify, re-plan and deliver a reusable Artifact.</small></span></button>
            </div>
          </div>
          <div className="snapshot-preview"><LockKeyhole size={16} /><span><strong>Per-turn snapshot</strong>{autoRoute ? 'Selected portrait clusters · current Source versions · chosen model' : selectedCollection ? 'Saved view identity · resolved Source versions · chosen model' : `${selectedSpaces.length} pinned Spaces · current Source versions · chosen model`}</span><Layers3 size={18} /></div>
        </section>

        <section className="research-composer-shell">
          <header><div className="composer-question-head"><label htmlFor="research-goal">Question or research outcome</label><span><Sparkles size={13} />Intent analysis · rewrite · multi-channel retrieval</span></div><small id={researchGoalHelpId}>Ask below. Your selected materials and model stay visible until this turn starts.</small></header>
          <PendingAttachmentTray files={attachments} onRemove={removeAttachment} />
          <textarea id="research-goal" value={goal} required aria-required="true" aria-describedby={`${researchGoalHelpId} ${researchComposerFeedbackId}`} aria-invalid={composer.goalRequired} onChange={(event) => { setGoal(event.target.value); setRouting(null) }} placeholder="Ask a question, compare evidence, or describe the decision you need to make…" rows={5} />
          <footer>
            <input ref={inputRef} type="file" hidden multiple accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.md,.markdown,.txt,.csv,.xls,.xlsx,.xlsm" onChange={(event) => { queueAttachments(event.target.files ?? []); event.currentTarget.value = '' }} />
            <button className="research-attachment-trigger" type="button" onClick={() => inputRef.current?.click()}><Paperclip /><span><strong>Attach evidence</strong><small>{attachments.length ? `${attachments.length}/6 queued` : 'Images, audio, video and documents'}</small></span></button>
            <CatalogModelPicker models={models.data?.items ?? []} providers={providers.data?.items ?? []} capability="text" value={selectedModel} onChange={setSelectedModel} label="Choose answer model" />
            <button type="submit" className="button primary large" aria-describedby={`${researchComposerFeedbackId}${composer.disabledDetail ? ` ${researchComposerGateId}` : ''}`} aria-disabled={composer.ariaDisabled || undefined}>{composer.submitLabel}<ArrowRight size={17} /></button>
          </footer>
          {composer.disabledDetail && <p className="sr-only" id={researchComposerGateId}>{composer.disabledDetail}</p>}
          <SubmitReadinessCard className="research-submit-feedback" id={researchComposerFeedbackId} model={composer} />
        </section>
      </form>
    </div>
  )
}
