import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Filter, Search } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { EvidenceCard } from '@/components/nexus/EvidenceCard'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'

const modalities = ['all', 'text', 'image', 'audio', 'video', 'table'] as const

export default function EvidenceBrowserPage() {
  const { spaceId } = useParams()
  const [params] = useSearchParams()
  const sourceId = params.get('source') ?? undefined
  const [modality, setModality] = useState<(typeof modalities)[number]>('all')
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter.trim())
  const evidence = useQuery({
    queryKey: ['evidence', spaceId, sourceId, modality, deferredFilter],
    queryFn: () => nexusApi.listEvidence({ spaceId, sourceId, modality: modality === 'all' ? undefined : modality, query: deferredFilter || undefined }),
  })
  if (evidence.isLoading) return <LoadingState label="Hydrating published Evidence" />
  const items = evidence.data?.items ?? []
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Immutable knowledge surface" title="Evidence browser" description="Preview published chunks, then open the exact page, figure, timeline or cell locator." actions={spaceId ? <Link className="button" to={`/spaces/${spaceId}`}><ArrowLeft />Back to Space</Link> : undefined} />
      <div className="filter-bar">
        <label><Search size={15} /><span className="sr-only">Search published Evidence</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search all published Evidence" /></label>
        <div className="segmented" aria-label="Filter by modality"><Filter size={14} />{modalities.map((item) => <button key={item} className={modality === item ? 'active' : ''} onClick={() => setModality(item)}>{item}</button>)}</div>
      </div>
      {items.length ? (
        <div className="evidence-grid">
          {items.map((item) => <Link key={item.id} to={spaceId ? `/runs/browser/evidence/${item.id}` : `/runs/browser/evidence/${item.id}`}><EvidenceCard evidence={item} /></Link>)}
        </div>
      ) : <EmptyState title="No published Evidence matches" body="Check the current Space and modality filters, or inspect Source readiness for a failed parsing or indexing capability." />}
    </div>
  )
}
