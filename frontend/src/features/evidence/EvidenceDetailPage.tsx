import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, LocateFixed } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { EvidenceCard } from '@/components/nexus/EvidenceCard'
import { locatorLabel } from '@/components/nexus/locatorLabel'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'

export default function EvidenceDetailPage() {
  const { runId, revisionId = '' } = useParams()
  const evidence = useQuery({ queryKey: ['evidence', revisionId], queryFn: () => nexusApi.getEvidence(revisionId), enabled: Boolean(revisionId) })
  const context = useQuery({ queryKey: ['evidence-context', revisionId], queryFn: () => nexusApi.expandEvidence(revisionId), enabled: Boolean(revisionId) })
  if (evidence.isLoading || context.isLoading) return <LoadingState />
  if (!evidence.data) return <EmptyState title="Evidence unavailable" body="This revision may have been tombstoned or purged." />
  const hasDerivedVisual = Boolean(evidence.data.locator.extra?.object_key)
  return (
    <div className="page-shell evidence-detail-page">
      <PageHeader eyebrow="Stable Evidence Revision" title={evidence.data.source_name} description={`${evidence.data.modality} · ${evidence.data.evidence_type} · ${evidence.data.id}`} actions={<Link className="button" to={runId && runId !== 'browser' ? `/runs/${runId}` : '/evidence'}><ArrowLeft size={16} />Back</Link>} />
      <div className="evidence-detail-grid">
        <section><EvidenceCard evidence={evidence.data} /><div className="original-preview"><div className="preview-label"><LocateFixed size={15} />Original materialization</div>{evidence.data.modality === 'image' || hasDerivedVisual ? <img src={evidence.data.asset_url} alt={evidence.data.source_name} /> : evidence.data.modality === 'audio' ? <audio src={evidence.data.asset_url} controls /> : evidence.data.modality === 'video' ? <video src={evidence.data.asset_url} controls /> : <a className="button" href={evidence.data.asset_url} target="_blank" rel="noreferrer"><ExternalLink size={16} />Open original Source</a>}</div></section>
        <aside className="locator-sheet"><p className="eyebrow">Source locator</p><h2>{locatorLabel(evidence.data)}</h2>{evidence.data.modality === 'image' && <p className="locator-definition">Standalone images are cited as one immutable original. Layout-aware document parsers may expose a meaningful embedded figure, but the image pipeline does not manufacture generic sub-image regions.</p>}<dl>{Object.entries(evidence.data.locator).filter(([, value]) => value !== null && value !== undefined && (typeof value !== 'object' || Object.keys(value).length)).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><code>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</code></dd></div>)}</dl><p className="locator-note">This locator belongs to Source Version <code>{evidence.data.source_version_id}</code>. Generated captions or summaries never replace it.</p><div className="context-chunks"><p className="eyebrow">Surrounding chunks</p>{context.data?.items.map((item, index) => <Link key={item.id} className={item.id === revisionId ? 'active' : ''} to={`/runs/${runId ?? 'browser'}/evidence/${item.id}`}><span>{index + 1}</span><span><strong>{item.evidence_type.replaceAll('_', ' ')}</strong><small>{item.text_content.slice(0, 120)}</small></span></Link>)}</div></aside>
      </div>
    </div>
  )
}
