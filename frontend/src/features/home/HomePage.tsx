import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowRight, Database, Microscope, Plus } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'
import { GettingStarted } from './GettingStarted'

export default function HomePage() {
  const [params] = useSearchParams()
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: nexusApi.listSpaces })
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => nexusApi.listRuns(), refetchInterval: 5000 })
  const health = useQuery({ queryKey: ['health'], queryFn: nexusApi.getHealth, refetchInterval: 15_000 })
  if (spaces.isLoading || runs.isLoading || health.isLoading) return <LoadingState />
  const activeRuns = runs.data?.items.filter((run) => !['completed', 'failed', 'cancelled', 'partial'].includes(run.status)) ?? []
  const degraded = Object.entries(health.data?.capabilities ?? {}).filter(([, value]) => value.status !== 'ready')
  const spaceItems = spaces.data?.items ?? []
  const sourceCount = spaceItems.reduce((total, space) => total + space.source_count, 0)
  const citedRunCount = (runs.data?.items ?? []).filter((run) => Array.isArray(run.result?.citations) && run.result.citations.length > 0).length
  return (
    <div className="page-shell home-page">
      <PageHeader
        eyebrow="Local knowledge control room"
        title="Work from evidence, not memory."
        description="Every source, conclusion and research step stays addressable—down to a page, figure, timestamp or cell range."
        actions={spaceItems.length ? <Link className="button primary" to="/research/new"><Plus size={16} />Start research</Link> : <Link className="button primary" to="/spaces"><Plus size={16} />Create first Space</Link>}
      />

      <GettingStarted
        spaceCount={spaceItems.length}
        sourceCount={sourceCount}
        citedRunCount={citedRunCount}
        firstSpaceId={spaceItems[0]?.id}
        forced={params.get('guide') === '1'}
      />

      <section className="home-thesis" aria-label="System overview">
        <div className="thesis-copy">
          <span className="live-label"><span />Control plane {health.data?.control_ready ? 'ready' : 'unavailable'}</span>
          <p>{spaces.data?.items.length ?? 0}<small>knowledge spaces</small></p>
          <p>{runs.data?.items.length ?? 0}<small>durable runs</small></p>
          <p>{activeRuns.length}<small>in progress</small></p>
        </div>
        <div className="evidence-seam" aria-hidden="true">
          <span>source</span><i /><span>evidence</span><i /><span>claim</span><i /><span>artifact</span>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel panel-wide">
          <div className="panel-head"><div><p className="eyebrow">Execution</p><h2>Recent runs</h2></div><Link to="/research/new">New goal <ArrowRight size={14} /></Link></div>
          {runs.data?.items.length ? (
            <div className="run-list">
              {runs.data.items.slice(0, 6).map((run) => (
                <Link to={`/runs/${run.id}`} key={run.id} className="run-row">
                  <span className="run-kind"><Microscope size={16} />{run.kind}</span>
                  <strong>{run.goal}</strong>
                  <StatusMark status={run.status} />
                  <time>{new Date(run.updated_at).toLocaleString()}</time>
                  <ArrowRight size={15} />
                </Link>
              ))}
            </div>
          ) : <EmptyState title="No research runs yet" body="Ask a question or start a multi-step investigation. Refreshing this page will never cancel it." action={<Link className="button" to="/research/new">Set a goal</Link>} />}
        </section>

        <section className="panel">
          <div className="panel-head"><div><p className="eyebrow">Knowledge</p><h2>Spaces</h2></div><Link to="/spaces">View all</Link></div>
          <div className="space-stack">
            {spaces.data?.items.slice(0, 5).map((space) => (
              <Link to={`/spaces/${space.id}`} key={space.id}>
                <span className="space-monogram">{space.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{space.name}</strong><small>{space.source_count} sources · {space.knowledge_profile}</small></span>
              </Link>
            ))}
            {!spaces.data?.items.length && <EmptyState title="Build your first Space" body="Spaces organize a goal and its Sources without copying the underlying evidence." action={<Link className="button" to="/spaces">Create Space</Link>} />}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><div><p className="eyebrow">Readiness</p><h2>Capability gaps</h2></div><Database size={17} /></div>
          {degraded.length ? (
            <div className="health-stack">
              {degraded.map(([name, value]) => (
                <div key={name}><AlertCircle size={15} /><span><strong>{name.replaceAll('_', ' ')}</strong><small>{value.status === 'not_configured' ? 'Configure when this capability is needed.' : 'Inspect system details.'}</small></span><StatusMark status={value.status} /></div>
              ))}
            </div>
          ) : <EmptyState title="All capabilities ready" body="The configured ingestion, retrieval and model routes are healthy." />}
        </section>
      </div>
    </div>
  )
}
