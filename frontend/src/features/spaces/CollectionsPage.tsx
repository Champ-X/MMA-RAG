import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Check,
  Filter,
  FolderPlus,
  Layers3,
  Microscope,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { nexusApi, type Collection, type CollectionCreate } from '@/api/nexus'
import { ConfirmDialog } from '@/components/nexus/ConfirmDialog'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LedgerSelect } from '@/components/nexus/LedgerSelect'
import { LoadingState } from '@/components/nexus/LoadingState'
import { MaterialCover } from '@/components/nexus/MaterialCover'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { StatusMark } from '@/components/nexus/StatusMark'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import {
  focusTrapTargetElement,
  getFocusableElements,
  resolveFocusTrapAction,
} from '@/lib/focusTrap'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import { buildCollectionArchiveViewModel } from './collectionArchiveViewModel'
import { buildCollectionCreateViewModel } from './collectionCreateViewModel'
import { buildCollectionMembershipViewModel } from './collectionMembershipViewModel'
import './CollectionsPage.css'

const colors = ['cobalt', 'violet', 'teal', 'amber', 'coral'] as const
const collectionViewKinds = ['manual', 'dynamic'] as const
const collectionArchiveFeedbackId = 'collection-archive-feedback'
const collectionArchiveGateId = 'collection-archive-gate'
const collectionCreateDescriptionId = 'collection-create-description'
const collectionCreateFeedbackId = 'collection-create-feedback'
const collectionCreateGateId = 'collection-create-gate'
const collectionCreateNameHelpId = 'collection-create-name-help'
const collectionCreateNameId = 'collection-create-name'
const collectionCreateRuleValueHelpId = 'collection-create-rule-value-help'
const collectionCreateRuleValueId = 'collection-create-rule-value'
const collectionCreateTitleId = 'collection-create-title'
const collectionMembershipFeedbackId = 'collection-membership-feedback'
const collectionMembershipGateId = 'collection-membership-gate'
const ruleFieldOptions = [
  { value: 'modality', label: 'Modality', description: 'text, image, audio, video or table.' },
  { value: 'display_name', label: 'Display name', description: 'Match the visible material name.' },
  { value: 'mime_type', label: 'MIME type', description: 'Match parser content type.' },
  { value: 'connector_kind', label: 'Connector', description: 'Match import source type.' },
  { value: 'status', label: 'Readiness status', description: 'Match material health state.' },
]
const ruleOperatorOptions = [
  { value: 'equals', label: 'Equals', description: 'Exact field match.' },
  { value: 'contains', label: 'Contains', description: 'Substring match.' },
]

const collectionCover = (collection: Collection) => collection.cover_evidence_id
  ? `/api/v1/evidence/${collection.cover_evidence_id}/asset`
  : collection.cover_source_version_id
    ? `/api/v1/assets/${collection.cover_source_version_id}`
    : null

export default function CollectionsPage() {
  const { spaceId = '' } = useParams()
  const client = useQueryClient()
  const space = useQuery({ queryKey: ['space', spaceId], queryFn: () => nexusApi.getSpace(spaceId), enabled: Boolean(spaceId) })
  const sources = useQuery({ queryKey: ['sources', spaceId], queryFn: () => nexusApi.listSources(spaceId), enabled: Boolean(spaceId) })
  const collections = useQuery({ queryKey: ['collections', spaceId], queryFn: () => nexusApi.listCollections(spaceId), enabled: Boolean(spaceId) })
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<(typeof colors)[number]>('cobalt')
  const [viewKind, setViewKind] = useState<'manual' | 'dynamic'>('manual')
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [ruleField, setRuleField] = useState<'display_name' | 'modality' | 'mime_type' | 'connector_kind' | 'status'>('modality')
  const [ruleOperator, setRuleOperator] = useState<'equals' | 'contains'>('equals')
  const [ruleValue, setRuleValue] = useState('text')
  const [archiveTarget, setArchiveTarget] = useState<Collection | null>(null)
  const [archiveReceipt, setArchiveReceipt] = useState('')
  const [membershipReceipt, setMembershipReceipt] = useState<{ id: string; name: string; sourceCount: number } | null>(null)
  const createDialog = useRef<HTMLFormElement>(null)
  const createNameInput = useRef<HTMLInputElement>(null)
  const colorRefs = useRef<Partial<Record<(typeof colors)[number], HTMLButtonElement | null>>>({})
  const viewKindRefs = useRef<Partial<Record<(typeof collectionViewKinds)[number], HTMLButtonElement | null>>>({})
  const previousCreateFocus = useRef<HTMLElement | null>(null)
  const selected = collections.data?.items.find((item) => item.id === selectedId) ?? null
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: space.error, hasData: Boolean(space.data), label: 'Space', required: true },
    { error: sources.error, hasData: Boolean(sources.data), label: 'Sources', required: true },
    { error: collections.error, hasData: Boolean(collections.data), label: 'Collections', required: true },
  ])
  const retryCollectionsQueries = () => {
    void space.refetch()
    void sources.refetch()
    void collections.refetch()
  }

  useEffect(() => {
    if (!selectedId && collections.data?.items[0]) setSelectedId(collections.data.items[0].id)
  }, [collections.data?.items, selectedId])
  useEffect(() => {
    if (selected) setSelectedSources(selected.source_ids)
  }, [selected])

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['collections', spaceId] })
  }
  const create = useMutation({
    mutationFn: (body: CollectionCreate) => nexusApi.createCollection(spaceId, body),
    onSuccess: async (item) => {
      await refresh()
      setSelectedId(item.id)
      setCreating(false)
      setName('')
      setDescription('')
      setColor('cobalt')
      setViewKind('manual')
      setSelectedSources([])
      setRuleField('modality')
      setRuleOperator('equals')
      setRuleValue('text')
    },
  })
  const update = useMutation({
    mutationFn: ({ item, sourceIds }: { item: Collection; sourceIds: string[] }) => nexusApi.updateCollection(item.id, { source_ids: sourceIds, expected_revision: item.revision }),
    onMutate: () => setMembershipReceipt(null),
    onSuccess: async (item) => {
      setMembershipReceipt({ id: item.id, name: item.name, sourceCount: item.source_count })
      setSelectedSources(item.source_ids)
      await refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (item: Collection) => nexusApi.deleteCollection(item.id),
    onMutate: () => setArchiveReceipt(''),
    onSuccess: async (_result, item) => {
      setArchiveReceipt(item.name)
      setSelectedId('')
      await refresh()
    },
  })

  const sourceMap = useMemo(() => new Map((sources.data?.items ?? []).map((source) => [source.source_id, source])), [sources.data?.items])
  const selectedMaterials = selected?.source_ids.map((id) => sourceMap.get(id)).filter(Boolean) ?? []
  const createModel = buildCollectionCreateViewModel({
    availableSourceCount: sources.data?.items.length ?? 0,
    errorMessage: create.error?.message,
    name,
    pending: create.isPending,
    ruleValue,
    selectedSourceCount: selectedSources.length,
    viewKind,
  })
  const archiveModel = buildCollectionArchiveViewModel({
    archivedName: archiveReceipt,
    errorMessage: remove.error?.message,
    pending: remove.isPending,
    targetName: remove.variables?.name ?? archiveTarget?.name,
  })
  const membershipTarget = update.variables?.item ?? selected
  const matchingMembershipReceipt = membershipReceipt && membershipReceipt.id === selected?.id ? membershipReceipt : null
  const membershipModel = buildCollectionMembershipViewModel({
    collectionName: membershipTarget?.name,
    currentSourceIds: membershipTarget?.source_ids ?? [],
    draftSourceIds: update.variables?.sourceIds ?? selectedSources,
    errorMessage: update.error?.message,
    pending: update.isPending,
    savedName: matchingMembershipReceipt?.name,
    savedSourceCount: matchingMembershipReceipt?.sourceCount,
  })

  const openCreate = () => {
    create.reset()
    setCreating(true)
  }
  const closeCreate = () => {
    create.reset()
    setCreating(false)
  }

  useLayoutEffect(() => {
    if (!creating) return
    previousCreateFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const initialTarget = createNameInput.current ?? getFocusableElements(createDialog.current)[0] ?? createDialog.current
    initialTarget?.focus({ preventScroll: true })
    return () => {
      const dialogElement = createDialog.current
      window.setTimeout(() => {
        if (dialogElement && document.contains(dialogElement)) return
        const previousFocus = previousCreateFocus.current
        if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true })
        previousCreateFocus.current = null
      }, 0)
    }
  }, [creating])

  useEffect(() => {
    if (!creating) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [creating])

  useEffect(() => {
    if (!creating) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeCreate()
        return
      }
      const focusables = getFocusableElements(createDialog.current)
      const action = resolveFocusTrapAction({
        activeElement: document.activeElement,
        activeInside: Boolean(createDialog.current?.contains(document.activeElement)),
        emptyTarget: 'container',
        firstElement: focusables[0],
        key: event.key,
        lastElement: focusables[focusables.length - 1],
        shiftKey: event.shiftKey,
      })
      if (!action.preventDefault) return
      event.preventDefault()
      focusTrapTargetElement({ action, container: createDialog.current, focusable: focusables })?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [creating])

  if (space.isLoading || sources.isLoading || collections.isLoading) return <LoadingState />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell collections-page"><PageHeader eyebrow="Collections & saved views" title="Collections could not be loaded" description="Nexus could not verify this Space, Source register or saved view list from the control plane." actions={<Link className="button" to={`/spaces/${spaceId}`}><Layers3 size={16} />Space overview</Link>} /><QueryErrorNotice model={queryErrorNotice} onRetry={retryCollectionsQueries} /><EmptyState title="Saved views are temporarily unavailable" body="Retry before creating a replacement collection or changing membership. Saved scopes need the authoritative Source register and collection list." /></div>

  const toggleSource = (sourceId: string) => setSelectedSources((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId])
  const selectViewKind = (nextViewKind: (typeof collectionViewKinds)[number]) => {
    setViewKind(nextViewKind)
  }
  const selectColor = (nextColor: (typeof colors)[number]) => {
    setColor(nextColor)
  }
  const handleViewKindKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextViewKind = moveRadioGroupValue(collectionViewKinds, viewKind, direction)
    selectViewKind(nextViewKind)
    window.requestAnimationFrame(() => viewKindRefs.current[nextViewKind]?.focus({ preventScroll: true }))
  }
  const handleColorKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextColor = moveRadioGroupValue(colors, color, direction)
    selectColor(nextColor)
    window.requestAnimationFrame(() => colorRefs.current[nextColor]?.focus({ preventScroll: true }))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!createModel.canSubmit) return
    create.mutate({
      name,
      description,
      color,
      view_kind: viewKind,
      rule_logic: 'all',
      source_ids: viewKind === 'manual' ? selectedSources : [],
      rules: viewKind === 'dynamic' ? [{ field: ruleField, operator: ruleOperator, value: ruleValue }] : [],
    })
  }

  return <div className="page-shell collections-page">
    <PageHeader eyebrow={`Space · ${space.data?.name ?? 'Collections'}`} title="Collections & saved views" description="Curate a stable reading list or save a live rule over current materials. Runs resolve either view to an auditable frozen Source snapshot." actions={<><Link className="button" to={`/spaces/${spaceId}`}><Layers3 size={16} />Space overview</Link><button type="button" className="button primary" onClick={openCreate}><FolderPlus size={16} />New collection</button></>} />
    <QueryErrorNotice model={queryErrorNotice} onRetry={retryCollectionsQueries} />

    <section className="collection-signal-strip">
      <span><strong>{collections.data?.items.length ?? 0}</strong> saved views</span>
      <span><strong>{sources.data?.items.length ?? 0}</strong> available originals</span>
      <span><Sparkles /> Dynamic views update now; Run scopes do not.</span>
    </section>
    <SubmitReadinessCard className="collection-archive-feedback" id={collectionArchiveFeedbackId} model={archiveModel} />

    {collections.data?.items.length ? <div className="collections-layout">
      <section className="collection-card-grid" aria-label="Saved collections">
        {collections.data.items.map((item) => { const cover = collectionCover(item); return <button type="button" key={item.id} className={`collection-card tone-${item.color}${selectedId === item.id ? ' selected' : ''}`} onClick={() => setSelectedId(item.id)}>
          <span className={`collection-card-cover${cover ? ' has-image' : ''}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined}><i /><em>{item.view_kind === 'dynamic' ? <Filter /> : <Layers3 />}</em><small>{item.view_kind === 'dynamic' ? 'LIVE VIEW' : 'CURATED'}</small></span>
          <span className="collection-card-copy"><span><strong>{item.name}</strong><StatusMark status="ready" /></span><small>{item.description || 'A focused material view.'}</small><span>{Object.entries(item.modality_counts ?? {}).map(([modality, count]) => <em key={modality}>{modality} {count}</em>)}</span><b>{item.source_count} materials <ArrowRight /></b></span>
        </button> })}
      </section>

      {selected && <aside className="collection-inspector">
        <header><div><p className="eyebrow">Selected view · revision {selected.revision}</p><h2>{selected.name}</h2></div><button type="button" className="icon-button" aria-label="Close inspector" onClick={() => setSelectedId('')}><X /></button></header>
        <p>{selected.description || 'No description yet.'}</p>
        <div className="collection-rule-summary"><span>{selected.view_kind === 'dynamic' ? <Filter /> : <Layers3 />}</span><div><strong>{selected.view_kind === 'dynamic' ? 'Live rule' : 'Manual membership'}</strong><small>{selected.rules.length ? selected.rules.map((rule) => `${rule.field.replace('_', ' ')} ${rule.operator} ${String(rule.value)}`).join(` ${selected.rule_logic} `) : 'Membership changes only when you edit this view.'}</small></div></div>
        <div className="collection-inspector-actions"><Link className="button primary" to={`/research/new?space=${spaceId}&collection=${selected.id}`}><Microscope size={15} />Research this view</Link><button type="button" className="button danger-quiet" aria-describedby={`${collectionArchiveFeedbackId}${archiveModel.disabledDetail ? ` ${collectionArchiveGateId}` : ''}`} aria-disabled={archiveModel.ariaDisabled || undefined} onClick={() => { if (archiveModel.canArchive) setArchiveTarget(selected) }}><Trash2 size={15} />{archiveModel.archiveLabel}</button>{archiveModel.disabledDetail && <span className="sr-only" id={collectionArchiveGateId}>{archiveModel.disabledDetail}</span>}</div>
        <div className="collection-members-head"><div><p className="eyebrow">Resolved now</p><h3>{selected.source_count} materials</h3></div>{selected.view_kind === 'manual' && <button type="button" className="text-button" aria-describedby={`${collectionMembershipFeedbackId}${membershipModel.disabledDetail ? ` ${collectionMembershipGateId}` : ''}`} aria-disabled={membershipModel.ariaDisabled || undefined} onClick={() => { if (membershipModel.canSave) update.mutate({ item: selected, sourceIds: selectedSources }) }}><Save size={14} />{membershipModel.saveLabel}</button>}{membershipModel.disabledDetail && <span className="sr-only" id={collectionMembershipGateId}>{membershipModel.disabledDetail}</span>}</div>
        {selected.view_kind === 'manual' && <SubmitReadinessCard className="collection-membership-feedback" id={collectionMembershipFeedbackId} model={membershipModel} />}
        {selected.view_kind === 'manual' && <div className="collection-source-picker">{sources.data?.items.map((source) => <button type="button" key={source.source_id} className={selectedSources.includes(source.source_id) ? 'checked' : ''} aria-pressed={selectedSources.includes(source.source_id)} onClick={() => toggleSource(source.source_id)}><span>{selectedSources.includes(source.source_id) && <Check />}</span><strong>{source.display_name}</strong><small>{source.modality}</small></button>)}</div>}
        <div className="collection-resolved-list">{selectedMaterials.slice(0, 12).map((source) => source && <article key={source.id}><MaterialCover source={source} compact /><span><strong>{source.display_name}</strong><small>{source.modality} · {source.published_evidence_count} evidence</small></span></article>)}</div>
      </aside>}
    </div> : <EmptyState title="Turn a broad Space into useful shelves" body="Create curated reading lists or dynamic views such as every video, every failed import, or names containing a project code." action={<button type="button" className="button primary" onClick={openCreate}><Plus size={16} />Create first view</button>} />}

    {creating && <div className="modal-backdrop collection-create-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreate() }}><form className="collection-create-sheet" ref={createDialog} role="dialog" aria-modal="true" aria-labelledby={collectionCreateTitleId} aria-describedby={collectionCreateDescriptionId} tabIndex={-1} onSubmit={submit}>
      <header><div><p className="eyebrow">New saved scope</p><h2 id={collectionCreateTitleId}>Build a useful shelf</h2><p id={collectionCreateDescriptionId}>The current resolution is visible before any Run freezes it.</p></div><button type="button" className="icon-button" aria-label="Close collection creator" onClick={closeCreate}><X /></button></header>
      <div className="collection-create-field"><label htmlFor={collectionCreateNameId}>Collection name</label><p className="sr-only" id={collectionCreateNameHelpId}>The collection name is required before this saved view can be created.</p><input id={collectionCreateNameId} ref={createNameInput} value={name} onChange={(event) => setName(event.target.value)} placeholder="Quarterly launch evidence" aria-required="true" aria-invalid={createModel.nameRequired} aria-describedby={`${collectionCreateNameHelpId} ${collectionCreateFeedbackId}`} /></div>
      <div className="collection-create-field"><label htmlFor="collection-create-description-input">Description</label><textarea id="collection-create-description-input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs here, and when should this view be used?" /></div>
      <fieldset><legend>View behavior</legend><div className="collection-kind-choice" role="radiogroup" aria-label="Collection view behavior"><button type="button" ref={(node) => { viewKindRefs.current.manual = node }} role="radio" aria-checked={viewKind === 'manual'} tabIndex={viewKind === 'manual' ? 0 : -1} className={viewKind === 'manual' ? 'active' : ''} onKeyDown={handleViewKindKeyDown} onClick={() => selectViewKind('manual')}><Layers3 /><span><strong>Curated collection</strong><small>Choose exact originals.</small></span></button><button type="button" ref={(node) => { viewKindRefs.current.dynamic = node }} role="radio" aria-checked={viewKind === 'dynamic'} tabIndex={viewKind === 'dynamic' ? 0 : -1} className={viewKind === 'dynamic' ? 'active' : ''} onKeyDown={handleViewKindKeyDown} onClick={() => selectViewKind('dynamic')}><Filter /><span><strong>Dynamic view</strong><small>Resolve a saved rule live.</small></span></button></div></fieldset>
      {viewKind === 'manual' ? <fieldset><legend>Choose materials · {selectedSources.length} selected</legend><div className="collection-create-materials">{sources.data?.items.map((source) => <button type="button" key={source.source_id} className={selectedSources.includes(source.source_id) ? 'selected' : ''} aria-pressed={selectedSources.includes(source.source_id)} onClick={() => toggleSource(source.source_id)}><MaterialCover source={source} compact /><span><strong>{source.display_name}</strong><small>{source.modality} · {source.mime_type}</small></span>{selectedSources.includes(source.source_id) && <Check />}</button>)}</div></fieldset> : <fieldset><legend>Live rule</legend><p className="sr-only" id={collectionCreateRuleValueHelpId}>The live rule value is required before a dynamic saved view can be created.</p><div className="collection-rule-builder"><LedgerSelect ariaLabel="Rule field" value={ruleField} options={ruleFieldOptions} onChange={(next) => setRuleField(next as typeof ruleField)} /><LedgerSelect ariaLabel="Rule operator" value={ruleOperator} options={ruleOperatorOptions} onChange={(next) => setRuleOperator(next as typeof ruleOperator)} /><input id={collectionCreateRuleValueId} value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} placeholder="text" aria-required="true" aria-invalid={createModel.ruleValueRequired} aria-describedby={`${collectionCreateRuleValueHelpId} ${collectionCreateFeedbackId}`} /></div></fieldset>}
      <fieldset><legend>Visual marker</legend><div className="collection-color-choice" role="radiogroup" aria-label="Collection visual marker">{colors.map((item) => <button type="button" key={item} ref={(node) => { colorRefs.current[item] = node }} role="radio" aria-label={item} aria-checked={color === item} tabIndex={color === item ? 0 : -1} className={`tone-${item}${color === item ? ' active' : ''}`} onKeyDown={handleColorKeyDown} onClick={() => selectColor(item)} />)}</div></fieldset>
      <SubmitReadinessCard className="collection-create-feedback" id={collectionCreateFeedbackId} model={createModel} liveMode={createModel.feedbackTone === 'error' ? 'assertive' : 'polite'} role={createModel.feedbackTone === 'error' ? 'alert' : 'status'} />
      <footer><span><Sparkles /> Collection identity and rule revision are retained with every Run.</span><button type="submit" className="button primary" aria-describedby={`${collectionCreateFeedbackId}${createModel.disabledDetail ? ` ${collectionCreateGateId}` : ''}`} aria-disabled={createModel.ariaDisabled || undefined}>{createModel.submitLabel}<ArrowRight size={15} /></button>{createModel.disabledDetail && <span className="sr-only" id={collectionCreateGateId}>{createModel.disabledDetail}</span>}</footer>
    </form></div>}
    <ConfirmDialog
      open={Boolean(archiveTarget)}
      title={archiveTarget ? `Archive ${archiveTarget.name}?` : 'Archive collection?'}
      body="Existing Run snapshots remain unchanged. This saved view will leave the active collection list."
      confirmLabel="Archive view"
      busy={remove.isPending}
      onCancel={() => setArchiveTarget(null)}
      onConfirm={() => { if (archiveTarget) remove.mutate(archiveTarget); setArchiveTarget(null) }}
    />
  </div>
}
