import { FormEvent, useEffect, useMemo, useState } from 'react'
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
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { MaterialCover } from '@/components/nexus/MaterialCover'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'

const colors = ['cobalt', 'violet', 'teal', 'amber', 'coral'] as const

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
  const selected = collections.data?.items.find((item) => item.id === selectedId) ?? null

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
      setSelectedSources([])
    },
  })
  const update = useMutation({
    mutationFn: ({ item, sourceIds }: { item: Collection; sourceIds: string[] }) => nexusApi.updateCollection(item.id, { source_ids: sourceIds, expected_revision: item.revision }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: nexusApi.deleteCollection,
    onSuccess: async () => { setSelectedId(''); await refresh() },
  })

  const sourceMap = useMemo(() => new Map((sources.data?.items ?? []).map((source) => [source.source_id, source])), [sources.data?.items])
  const selectedMaterials = selected?.source_ids.map((id) => sourceMap.get(id)).filter(Boolean) ?? []
  if (space.isLoading || sources.isLoading || collections.isLoading) return <LoadingState />

  const toggleSource = (sourceId: string) => setSelectedSources((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId])
  const submit = (event: FormEvent) => {
    event.preventDefault()
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
    <PageHeader eyebrow={`Space · ${space.data?.name ?? 'Collections'}`} title="Collections & saved views" description="Curate a stable reading list or save a live rule over current materials. Runs resolve either view to an auditable frozen Source snapshot." actions={<><Link className="button" to={`/spaces/${spaceId}`}><Layers3 size={16} />Space overview</Link><button className="button primary" onClick={() => setCreating(true)}><FolderPlus size={16} />New collection</button></>} />

    <section className="collection-signal-strip">
      <span><strong>{collections.data?.items.length ?? 0}</strong> saved views</span>
      <span><strong>{sources.data?.items.length ?? 0}</strong> available originals</span>
      <span><Sparkles /> Dynamic views update now; Run scopes do not.</span>
    </section>

    {collections.data?.items.length ? <div className="collections-layout">
      <section className="collection-card-grid" aria-label="Saved collections">
        {collections.data.items.map((item) => { const cover = collectionCover(item); return <button type="button" key={item.id} className={`collection-card tone-${item.color}${selectedId === item.id ? ' selected' : ''}`} onClick={() => setSelectedId(item.id)}>
          <span className={`collection-card-cover${cover ? ' has-image' : ''}`} style={cover ? { backgroundImage: `url(${cover})` } : undefined}><i /><em>{item.view_kind === 'dynamic' ? <Filter /> : <Layers3 />}</em><small>{item.view_kind === 'dynamic' ? 'LIVE VIEW' : 'CURATED'}</small></span>
          <span className="collection-card-copy"><span><strong>{item.name}</strong><StatusMark status="ready" /></span><small>{item.description || 'A focused material view.'}</small><span>{Object.entries(item.modality_counts ?? {}).map(([modality, count]) => <em key={modality}>{modality} {count}</em>)}</span><b>{item.source_count} materials <ArrowRight /></b></span>
        </button> })}
      </section>

      {selected && <aside className="collection-inspector">
        <header><div><p className="eyebrow">Selected view · revision {selected.revision}</p><h2>{selected.name}</h2></div><button className="icon-button" aria-label="Close inspector" onClick={() => setSelectedId('')}><X /></button></header>
        <p>{selected.description || 'No description yet.'}</p>
        <div className="collection-rule-summary"><span>{selected.view_kind === 'dynamic' ? <Filter /> : <Layers3 />}</span><div><strong>{selected.view_kind === 'dynamic' ? 'Live rule' : 'Manual membership'}</strong><small>{selected.rules.length ? selected.rules.map((rule) => `${rule.field.replace('_', ' ')} ${rule.operator} ${String(rule.value)}`).join(` ${selected.rule_logic} `) : 'Membership changes only when you edit this view.'}</small></div></div>
        <div className="collection-inspector-actions"><Link className="button primary" to={`/research/new?space=${spaceId}&collection=${selected.id}`}><Microscope size={15} />Research this view</Link><button className="button danger-quiet" disabled={remove.isPending} onClick={() => { if (window.confirm(`Archive “${selected.name}”? Existing Run snapshots remain unchanged.`)) remove.mutate(selected.id) }}><Trash2 size={15} />Archive</button></div>
        <div className="collection-members-head"><div><p className="eyebrow">Resolved now</p><h3>{selected.source_count} materials</h3></div>{selected.view_kind === 'manual' && <button className="text-button" disabled={update.isPending || selectedSources.join() === selected.source_ids.join()} onClick={() => update.mutate({ item: selected, sourceIds: selectedSources })}><Save size={14} />Save membership</button>}</div>
        {selected.view_kind === 'manual' && <div className="collection-source-picker">{sources.data?.items.map((source) => <button type="button" key={source.source_id} className={selectedSources.includes(source.source_id) ? 'checked' : ''} onClick={() => toggleSource(source.source_id)}><span>{selectedSources.includes(source.source_id) && <Check />}</span><strong>{source.display_name}</strong><small>{source.modality}</small></button>)}</div>}
        <div className="collection-resolved-list">{selectedMaterials.slice(0, 12).map((source) => source && <article key={source.id}><MaterialCover source={source} compact /><span><strong>{source.display_name}</strong><small>{source.modality} · {source.published_evidence_count} evidence</small></span></article>)}</div>
      </aside>}
    </div> : <EmptyState title="Turn a broad Space into useful shelves" body="Create curated reading lists or dynamic views such as every video, every failed import, or names containing a project code." action={<button className="button primary" onClick={() => setCreating(true)}><Plus size={16} />Create first view</button>} />}

    {creating && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false) }}><form className="collection-create-sheet" onSubmit={submit}>
      <header><div><p className="eyebrow">New saved scope</p><h2>Build a useful shelf</h2><p>The current resolution is visible before any Run freezes it.</p></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setCreating(false)}><X /></button></header>
      <label>Collection name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Quarterly launch evidence" required autoFocus /></label>
      <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs here, and when should this view be used?" /></label>
      <fieldset><legend>View behavior</legend><div className="collection-kind-choice"><button type="button" className={viewKind === 'manual' ? 'active' : ''} onClick={() => setViewKind('manual')}><Layers3 /><span><strong>Curated collection</strong><small>Choose exact originals.</small></span></button><button type="button" className={viewKind === 'dynamic' ? 'active' : ''} onClick={() => setViewKind('dynamic')}><Filter /><span><strong>Dynamic view</strong><small>Resolve a saved rule live.</small></span></button></div></fieldset>
      {viewKind === 'manual' ? <fieldset><legend>Choose materials · {selectedSources.length} selected</legend><div className="collection-create-materials">{sources.data?.items.map((source) => <button type="button" key={source.source_id} className={selectedSources.includes(source.source_id) ? 'selected' : ''} onClick={() => toggleSource(source.source_id)}><MaterialCover source={source} compact /><span><strong>{source.display_name}</strong><small>{source.modality} · {source.mime_type}</small></span>{selectedSources.includes(source.source_id) && <Check />}</button>)}</div></fieldset> : <fieldset><legend>Live rule</legend><div className="collection-rule-builder"><select value={ruleField} onChange={(event) => setRuleField(event.target.value as typeof ruleField)}><option value="modality">Modality</option><option value="display_name">Display name</option><option value="mime_type">MIME type</option><option value="connector_kind">Connector</option><option value="status">Readiness status</option></select><select value={ruleOperator} onChange={(event) => setRuleOperator(event.target.value as typeof ruleOperator)}><option value="equals">equals</option><option value="contains">contains</option></select><input value={ruleValue} onChange={(event) => setRuleValue(event.target.value)} placeholder="text" required /></div></fieldset>}
      <fieldset><legend>Visual marker</legend><div className="collection-color-choice">{colors.map((item) => <button type="button" key={item} className={`tone-${item}${color === item ? ' active' : ''}`} onClick={() => setColor(item)} aria-label={item} />)}</div></fieldset>
      {create.error && <div className="notice negative">{create.error.message}</div>}
      <footer><span><Sparkles /> Collection identity and rule revision are retained with every Run.</span><button className="button primary" disabled={create.isPending || !name.trim()}>{create.isPending ? 'Creating…' : 'Create saved view'}<ArrowRight size={15} /></button></footer>
    </form></div>}
  </div>
}
