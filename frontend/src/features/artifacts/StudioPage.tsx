import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FileOutput, LayoutTemplate, Search, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'
import { ArtifactCoverageMeter } from './ArtifactCoverageMeter'
import { ArtifactTemplateComposer } from './ArtifactTemplateComposer'
import { getArtifactReadiness } from './artifactReadiness'

type Filter = 'all' | 'candidate' | 'published' | 'attention'

export default function StudioPage() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [showTemplates, setShowTemplates] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const artifacts = useQuery({ queryKey: ['artifacts'], queryFn: nexusApi.listArtifacts })
  const items = artifacts.data?.items ?? []
  const publishedCount = items.filter((item) => item.status === 'published').length
  const attentionCount = items.filter((item) => getArtifactReadiness(item).tone !== 'positive').length
  const averageCoverage = items.length ? Math.round(items.reduce((total, item) => total + item.coverage.coverage_percent, 0) / items.length) : 0
  const visibleItems = items.filter((item) => {
    const matchesQuery = `${item.title} ${item.artifact_type}`.toLowerCase().includes(query.trim().toLowerCase())
    const matchesFilter = filter === 'all'
      || (filter === 'attention' ? getArtifactReadiness(item).tone !== 'positive' : item.status === filter)
    return matchesQuery && matchesFilter
  })
  if (artifacts.isLoading) return <LoadingState />
  return (
    <div className="page-shell studio-page">
      <PageHeader eyebrow="Durable outcomes" title="Artifact Studio" description="Review evidence coverage, publish intentionally, and keep every result traceable to an immutable revision." actions={<button className="button" onClick={() => setShowTemplates((value) => !value)}><LayoutTemplate size={15} />Create from template</button>} />
      {showTemplates && <ArtifactTemplateComposer artifacts={items} onClose={() => setShowTemplates(false)} onCreated={(created) => {
        queryClient.invalidateQueries({ queryKey: ['artifacts'] })
        navigate(`/artifacts/${created.id}`)
      }} />}
      {items.length ? <>
        <section className="studio-summary" aria-label="Artifact summary">
          <div><FileOutput /><span><strong>{items.length}</strong><small>Artifacts</small></span></div>
          <div><ShieldCheck /><span><strong>{publishedCount}</strong><small>Published</small></span></div>
          <div><ShieldAlert /><span><strong>{attentionCount}</strong><small>Need review</small></span></div>
          <div><span className="coverage-number">{averageCoverage}%</span><span><strong>Average</strong><small>Evidence coverage</small></span></div>
        </section>
        <section className="studio-toolbar" aria-label="Artifact filters">
          <label><Search size={15} /><span className="sr-only">Search artifacts</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or artifact type…" /></label>
          <div className="segmented">{(['all', 'candidate', 'published', 'attention'] as Filter[]).map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'attention' ? 'Needs review' : value}</button>)}</div>
        </section>
        {visibleItems.length ? <div className="artifact-grid">{visibleItems.map((artifact) => {
          const readiness = getArtifactReadiness(artifact)
          return <Link className="artifact-card" key={artifact.id} to={`/artifacts/${artifact.id}`}>
            <div className="artifact-card-heading"><span><FileOutput /></span><div><p className="eyebrow">{artifact.artifact_type.replaceAll('_', ' ')}</p><h2>{artifact.title}</h2></div><StatusMark status={artifact.status} /></div>
            <ArtifactCoverageMeter coverage={artifact.coverage} compact />
            <div className={`artifact-card-note ${readiness.tone}`}><span>{readiness.title}</span><small>Revision {artifact.revision_no} · {artifact.coverage.bound_evidence_count} Evidence bindings</small></div>
            <ArrowRight className="artifact-card-arrow" />
          </Link>
        })}</div> : <EmptyState title="No Artifacts match this view" body="Try another status filter or a broader search term." />}
      </> : <EmptyState title="No durable artifacts yet" body="A completed Deep Research Run creates a candidate report here. Nothing is promoted into formal knowledge automatically." action={<Link className="button" to="/research/new">Start Deep Research</Link>} />}
    </div>
  )
}
