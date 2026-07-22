import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Clock3,
  FileSearch,
  Files,
  FolderKanban,
  LibraryBig,
  Microscope,
  Network,
  Route,
  RouteOff,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { ConfirmDialog } from '@/components/nexus/ConfirmDialog'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { MaterialCover } from '@/components/nexus/MaterialCover'
import { PageHeader } from '@/components/nexus/PageHeader'
import { PanelNote } from '@/components/nexus/PanelNote'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { SourceTypePill } from '@/components/nexus/SourceTypePill'
import { StatusMark } from '@/components/nexus/StatusMark'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { spaceCoverUrl } from '@/components/nexus/spaceCoverUrl'
import { buildEvidenceDetailPath } from '@/lib/evidenceRoutes'
import { buildSpaceArchiveViewModel } from './spaceArchiveViewModel'
import type { SourceVersion } from '@/api/nexus'
import './SpaceOverviewPage.css'

type Portrait = Awaited<ReturnType<typeof nexusApi.getSpacePortrait>>
type Cluster = Portrait['clusters'][number]
const SourcePreviewDrawer = lazy(() => import('@/components/nexus/SourcePreviewDrawer').then((module) => ({
  default: module.SourcePreviewDrawer,
})))
const spaceArchiveFeedbackId = 'space-overview-archive-feedback'
const spaceArchiveGateId = 'space-overview-archive-gate'

function PortraitGraph({ portrait, selected, onSelect }: { portrait: Portrait; selected?: Cluster; onSelect: (cluster: Cluster) => void }) {
  return <div className="portrait-graph" role="img" aria-label={`Cluster portrait for ${portrait.space_name}`}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="13" className="portrait-halo" />{portrait.clusters.map((cluster) => <line key={cluster.id} x1="50" y1="50" x2={cluster.x} y2={cluster.y} />)}</svg>
    <div className="portrait-center"><BrainCircuit /><strong>{portrait.space_name}</strong><small>{portrait.evidence_count} evidence</small></div>
    {portrait.clusters.map((cluster) => <button type="button" key={cluster.id} className={selected?.id === cluster.id ? 'selected' : ''} style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }} onClick={() => onSelect(cluster)}><span>{cluster.evidence_count}</span><strong>{cluster.label}</strong><small>{Object.keys(cluster.modalities).join(' · ')}</small></button>)}
  </div>
}

export default function SpaceOverviewPage() {
  const { spaceId = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const space = useQuery({ queryKey: ['space', spaceId], queryFn: () => nexusApi.getSpace(spaceId), enabled: Boolean(spaceId) })
  const sources = useQuery({ queryKey: ['sources', spaceId], queryFn: () => nexusApi.listSources(spaceId), enabled: Boolean(spaceId) })
  const portrait = useQuery({ queryKey: ['space-portrait', spaceId], queryFn: () => nexusApi.getSpacePortrait(spaceId), enabled: Boolean(spaceId) })
  const suggestions = useQuery({ queryKey: ['space-suggestions', spaceId], queryFn: () => nexusApi.getSpaceSuggestedQuestions(spaceId), enabled: Boolean(spaceId) })
  const [selectedCluster, setSelectedCluster] = useState<Cluster | undefined>()
  const [preview, setPreview] = useState<SourceVersion | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const archive = useMutation({ mutationFn: () => nexusApi.deleteSpace(spaceId), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['spaces'] }); navigate('/spaces') } })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: space.error, hasData: Boolean(space.data), label: 'Space', required: true },
    { error: sources.error, hasData: Boolean(sources.data), label: 'Sources', required: true },
    { error: portrait.error, hasData: Boolean(portrait.data), label: 'Portrait' },
    { error: suggestions.error, hasData: Boolean(suggestions.data), label: 'Suggested questions' },
  ])
  const retrySpaceOverviewQueries = () => {
    void space.refetch()
    void sources.refetch()
    void portrait.refetch()
    void suggestions.refetch()
  }
  useEffect(() => { if (!selectedCluster && portrait.data?.clusters[0]) setSelectedCluster(portrait.data.clusters[0]) }, [portrait.data, selectedCluster])
  if (space.isLoading || sources.isLoading) return <LoadingState />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell"><PageHeader eyebrow="Space overview" title="Space overview could not be loaded" description="Nexus could not read the required Space metadata and Source inventory from the control plane." actions={<Link className="button" to="/spaces"><ArrowLeft size={16} />All Spaces</Link>} /><QueryErrorNotice model={queryErrorNotice} onRetry={retrySpaceOverviewQueries} /><EmptyState title="Space inventory is temporarily unavailable" body="Retry before treating this Space as missing or empty. Routing, material counts and Source actions depend on the authoritative inventory." /></div>
  if (!space.data) return <EmptyState title="Space not found" body="The requested Space may have been archived or removed." />
  const archiveModel = buildSpaceArchiveViewModel({
    errorMessage: archive.error?.message,
    pending: archive.isPending,
    targetName: space.data.name,
  })
  const coverUrl = spaceCoverUrl(space.data)
  return (
    <div className="page-shell space-overview-page">
      <PageHeader eyebrow={`Space · ${space.data.slug}`} title={space.data.name} description={space.data.description || 'Define the purpose of this Space so retrieval and research intent remain legible.'} actions={<><button type="button" className="button danger-quiet" aria-describedby={`${spaceArchiveFeedbackId}${archiveModel.disabledDetail ? ` ${spaceArchiveGateId}` : ''}`} aria-disabled={archiveModel.ariaDisabled || undefined} onClick={() => { if (archiveModel.canArchive) setArchiveOpen(true) }}><Trash2 size={15} />{archiveModel.archiveLabel}</button>{archiveModel.disabledDetail && <span className="sr-only" id={spaceArchiveGateId}>{archiveModel.disabledDetail}</span>}<Link className="button" to="/spaces"><ArrowLeft size={16} />All Spaces</Link><Link className="button primary" to={`/research/new?space=${spaceId}`}><Microscope size={16} />Research here</Link></>} />
      <SubmitReadinessCard className="space-archive-feedback" id={spaceArchiveFeedbackId} model={archiveModel} />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retrySpaceOverviewQueries} />
      {coverUrl && <section className="space-cover-masthead" style={{ backgroundImage: `url(${coverUrl})` }}><span className="space-cover-kicker">Visual cover · newest citable image</span><div><p>{space.data.policy.label} Space</p><strong>{space.data.cover_source_name}</strong></div></section>}
      <div className="space-summary-line"><StatusMark status="ready" label="Control ready" /><span>{space.data.policy.label}</span><span>{space.data.policy.default_quality} retrieval</span><span>revision {space.data.revision}</span></div>
      <section className={`space-policy-band profile-${space.data.knowledge_profile}`}>
        <span className="space-policy-glyph">{space.data.policy.auto_route_eligible ? <Route /> : <RouteOff />}</span>
        <div>
          <p className="eyebrow">Active usage strategy</p>
          <h2>{space.data.policy.label}</h2>
          <p>{space.data.policy.summary}</p>
        </div>
        <dl>
          <div><dt>Routing</dt><dd>{space.data.policy.auto_route_eligible ? 'Auto-route eligible' : 'Manual scope only'}</dd></div>
          <div><dt>Run default</dt><dd>{space.data.policy.recommended_run_kind === 'research' ? 'Deep research' : 'Quick answer'}</dd></div>
          <div><dt>Retrieval</dt><dd>{space.data.policy.default_quality}</dd></div>
        </dl>
        <div className="space-policy-behaviors">{space.data.policy.behaviors.map((behavior) => <span key={behavior}>{behavior.replaceAll('_', ' ')}</span>)}</div>
      </section>
      <div className="space-action-grid">
        <Link to={`/spaces/${spaceId}/sources`}><Files /><strong>{space.data.source_count} Sources</strong><span>Import, inspect readiness and reprocess.</span><ArrowRight /></Link>
        <Link to={`/spaces/${spaceId}/collections`}><FolderKanban /><strong>Collections & views</strong><span>Curate shelves or save live Source rules.</span><ArrowRight /></Link>
        <Link to={`/spaces/${spaceId}/evidence`}><FileSearch /><strong>Evidence browser</strong><span>Preview passages, figures, timelines and cell ranges.</span><ArrowRight /></Link>
        <Link to={`/spaces/${spaceId}/knowledge`}><BadgeCheck /><strong>Verified knowledge</strong><span>Browse T2/T3 claims, including conflicts that need review.</span><ArrowRight /></Link>
        <Link to={`/spaces/${spaceId}/jobs`}><Clock3 /><strong>Ingestion timeline</strong><span>Inspect stages, failures, retries and reparsing.</span><ArrowRight /></Link>
        <Link to={`/research/new?space=${spaceId}`}><Microscope /><strong>Ask or research</strong><span>Continue into a cited multi-turn conversation.</span><ArrowRight /></Link>
      </div>

      {portrait.data && <section className="panel portrait-panel">
        <div className="panel-head"><div><p className="eyebrow"><Network size={13} />Auto-routing portrait</p><h2>What this Space knows</h2></div><PanelNote>Clusters are rebuilt from current published evidence. Click a topic to inspect its representative chunks.</PanelNote></div>
        {portrait.data.clusters.length ? <div className="portrait-layout"><PortraitGraph portrait={portrait.data} selected={selectedCluster} onSelect={setSelectedCluster} /><aside className="portrait-inspector"><p className="eyebrow"><Sparkles size={12} />Selected cluster</p><h3>{selectedCluster?.label}</h3><div className="portrait-keywords">{selectedCluster?.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div><dl>{Object.entries(selectedCluster?.modalities ?? {}).map(([modality, count]) => <div key={modality}><dt>{modality}</dt><dd><span style={{ width: `${Math.max(8, Number(count) / Math.max(selectedCluster?.evidence_count ?? 1, 1) * 100)}%` }} />{count}</dd></div>)}</dl><div className="portrait-samples">{selectedCluster?.samples.map((sample) => <Link key={sample.evidence_revision_id} to={buildEvidenceDetailPath(sample.evidence_revision_id)}><SourceTypePill modality={sample.modality} /><span><strong>{sample.source_name}</strong><small>{sample.excerpt}</small></span><ArrowRight /></Link>)}</div></aside></div> : <EmptyState title="Portrait needs published Evidence" body="Add and finish parsing Sources; the graph appears automatically from current chunks." />}
        <footer className="portrait-footer"><code>{portrait.data.algorithm}</code><span>{portrait.data.profile_text}</span></footer>
      </section>}

      {suggestions.data?.suggestions.length ? <section className="panel suggestion-panel">
        <div className="panel-head"><div><p className="eyebrow"><Sparkles size={12} />Questions from this portrait</p><h2>Good places to start</h2></div><PanelNote>Each prompt is derived from a visible cluster and opens with this Space pinned.</PanelNote></div>
        <div className="suggestion-grid">{suggestions.data.suggestions.map((item, index) => <Link key={item.id} to={`/research/new?space=${spaceId}&question=${encodeURIComponent(item.question)}`}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.question}</strong><small>{item.cluster_label} · {item.evidence_count} evidence · {item.modalities.join(' + ') || 'text'}</small><ArrowRight /></Link>)}</div>
      </section> : null}

      <section className="panel space-materials-panel">
        <div className="panel-head"><div><p className="eyebrow"><LibraryBig size={13} />Material library</p><h2>Browse originals and published chunks</h2></div><Link className="text-button" to={`/spaces/${spaceId}/sources`}>Manage & import <ArrowRight size={13} /></Link></div>
        {sources.data?.items.length ? <><div className="material-modality-strip">{Object.entries(space.data.evidence_modality_counts ?? {}).map(([modality, count]) => <span key={modality}><i className={`modality-${modality}`} />{modality}<strong>{count}</strong></span>)}</div><div className="space-material-grid">{sources.data.items.slice(0, 8).map((source) => <button type="button" key={source.id} onClick={() => setPreview(source)}><MaterialCover source={source} /><span className="space-material-copy"><span><strong>{source.display_name}</strong><StatusMark status={source.status} /></span><small>{source.connector_kind} · {source.mime_type}</small><em>{source.derived_image_count ? `${source.derived_image_count} visuals · ` : ''}{source.published_evidence_count} evidence · {source.byte_size.toLocaleString()} bytes · version {source.version_no}</em></span></button>)}</div></> : <EmptyState title="No Sources in this Space" body="Raw content is stored before parsing, so an import remains recoverable even when a capability is unavailable." action={<Link className="button" to={`/spaces/${spaceId}/sources`}>Add Sources</Link>} />}
      </section>
      {preview && <Suspense fallback={<LoadingState label="Opening material preview" />}><SourcePreviewDrawer source={preview} spaceId={spaceId} onClose={() => setPreview(null)} /></Suspense>}
      <ConfirmDialog
        open={archiveOpen}
        title={`Archive ${space.data.name}?`}
        body="Sources remain stored globally, while this Space leaves routing and navigation. Existing conversations keep their frozen scopes."
        confirmLabel="Archive Space"
        busy={archive.isPending}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={() => { archive.mutate(); setArchiveOpen(false) }}
      />
    </div>
  )
}
