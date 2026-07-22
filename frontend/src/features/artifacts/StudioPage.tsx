import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FileOutput, LayoutTemplate, Search, ShieldAlert, ShieldCheck, Stamp } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { SegmentedControl } from '@/components/nexus/SegmentedControl'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { StatusMark } from '@/components/nexus/StatusMark'
import { ArtifactCoverageMeter } from './ArtifactCoverageMeter'
import { ArtifactTemplateComposer } from './ArtifactTemplateComposer'
import {
  filterArtifacts,
  parseStudioFilter,
  presentArtifactCard,
  studioFilterOptions,
  summarizeArtifacts,
} from './studioViewModel'
import './StudioPage.css'

export default function StudioPage() {
  const [query, setQuery] = useState('')
  const [params, setParams] = useSearchParams()
  const filter = parseStudioFilter(params.get('status'))
  const setFilter = (nextFilter: typeof filter) => {
    const next = new URLSearchParams(params)
    if (nextFilter === 'all') next.delete('status')
    else next.set('status', nextFilter)
    setParams(next, { replace: true })
  }
  const [showTemplates, setShowTemplates] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const artifacts = useQuery({ queryKey: ['artifacts'], queryFn: nexusApi.listArtifacts })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: artifacts.error, hasData: Boolean(artifacts.data), label: 'Artifacts', required: true },
  ])
  const retryArtifactStudio = () => {
    void artifacts.refetch()
  }
  const items = artifacts.data?.items ?? []
  const summary = summarizeArtifacts(items)
  const visibleItems = filterArtifacts(items, query, filter)
  if (artifacts.isLoading) return <LoadingState />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell studio-page"><PageHeader eyebrow="Durable outcomes" title="Artifact Studio could not be loaded" description="Nexus could not read the durable artifact ledger." /><QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactStudio} /><EmptyState title="Artifact ledger is temporarily unavailable" body="Retry before treating this workspace as having no durable artifacts. Template creation is hidden until the current artifact ledger is trustworthy." /></div>
  return (
    <div className="page-shell studio-page">
      <PageHeader eyebrow="Durable outcomes" title="Artifact Studio" description="Review evidence coverage, publish intentionally, and keep every result traceable to an immutable revision." actions={<button type="button" className="button" onClick={() => setShowTemplates((value) => !value)}><LayoutTemplate size={15} />Create from template</button>} />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryArtifactStudio} />
      {showTemplates && <ArtifactTemplateComposer artifacts={items} onClose={() => setShowTemplates(false)} onCreated={(created) => {
        queryClient.invalidateQueries({ queryKey: ['artifacts'] })
        navigate(`/artifacts/${created.id}`)
      }} />}
      {items.length ? <>
        <section className="studio-release-gate" aria-label="Publication gate contract">
          <span><Stamp /></span>
          <div>
            <p className="eyebrow">Publication gate · explicit promotion only</p>
            <h2>Nothing becomes durable knowledge until coverage and refresh checks are visible.</h2>
            <p>Use this studio as a review queue: candidates can be refined, blocked items explain what is missing, and published artifacts keep their evidence-backed revision history.</p>
          </div>
          <dl>
            <div><dt>Publishable</dt><dd>{summary.publishableCount}</dd></div>
            <div><dt>Candidates</dt><dd>{summary.candidateCount}</dd></div>
            <div><dt>Avg coverage</dt><dd>{summary.averageCoverage}%</dd></div>
          </dl>
        </section>
        <section className="studio-summary" aria-label="Artifact summary">
          <div><FileOutput /><span><strong>{summary.total}</strong><small>Artifacts</small></span></div>
          <div><ShieldCheck /><span><strong>{summary.publishedCount}</strong><small>Published</small></span></div>
          <div><ShieldAlert /><span><strong>{summary.attentionCount}</strong><small>Need review</small></span></div>
          <div><span className="coverage-number">{summary.averageCoverage}%</span><span><strong>Average</strong><small>Evidence coverage</small></span></div>
        </section>
        <section className="studio-toolbar" aria-label="Artifact filters">
          <label><Search size={15} /><span className="sr-only">Search artifacts</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or artifact type…" /></label>
          <SegmentedControl ariaLabel="Artifact status filter" options={studioFilterOptions} value={filter} onChange={setFilter} />
        </section>
        {visibleItems.length ? <div className="artifact-grid">{visibleItems.map((artifact) => {
          const presentation = presentArtifactCard(artifact)
          return <Link className="artifact-card" key={artifact.id} to={`/artifacts/${artifact.id}`}>
            <div className="artifact-card-heading"><span><FileOutput /></span><div><p className="eyebrow">{artifact.artifact_type.replaceAll('_', ' ')}</p><h2>{artifact.title}</h2></div><StatusMark status={artifact.status} /></div>
            <ArtifactCoverageMeter coverage={artifact.coverage} compact />
            <div className={`artifact-card-gate ${presentation.readinessTone}`}><span>{presentation.gateLabel}</span><strong>{presentation.statusLabel}</strong><small>{presentation.gateDetail}</small></div>
            <div className={`artifact-card-note ${presentation.readinessTone}`}><span>Revision {artifact.revision_no}</span><small>{artifact.coverage.bound_evidence_count} Evidence bindings</small></div>
            <ArrowRight className="artifact-card-arrow" />
          </Link>
        })}</div> : <EmptyState title="No Artifacts match this view" body="Try another status filter or a broader search term." />}
      </> : <EmptyState title="No durable artifacts yet" body="A completed Deep Research Run creates a candidate report here. Nothing is promoted into formal knowledge automatically." action={<Link className="button" to="/research/new">Start Deep Research</Link>} />}
    </div>
  )
}
