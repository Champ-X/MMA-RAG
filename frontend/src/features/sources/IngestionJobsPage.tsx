import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileClock,
  FileSearch,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { nexusApi, type IngestionJob } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'

const stages = ['raw_stored', 'claimed', 'parsing', 'published']
const terminal = new Set(['completed', 'failed', 'cancelled'])
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const label = (value: string) => value.replaceAll('_', ' ')

function stageProgress(job: IngestionJob) {
  if (job.status === 'completed') return 100
  if (job.status === 'failed' || job.status === 'cancelled') return Math.max(12, stages.indexOf(job.stage) / (stages.length - 1) * 100)
  return Math.max(8, (stages.indexOf(job.stage) + 0.45) / (stages.length - 1) * 100)
}

export default function IngestionJobsPage() {
  const { spaceId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const requestedJobId = searchParams.get('job') ?? ''
  const client = useQueryClient()
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const space = useQuery({ queryKey: ['space', spaceId], queryFn: () => nexusApi.getSpace(spaceId), enabled: Boolean(spaceId) })
  const jobs = useQuery({ queryKey: ['ingestion-jobs', spaceId], queryFn: () => nexusApi.listIngestionJobs({ spaceId, limit: 200 }), enabled: Boolean(spaceId), refetchInterval: (query) => query.state.data?.items.some((job) => !terminal.has(job.status)) ? 2500 : false })
  const selected = useQuery({ queryKey: ['ingestion-job', selectedId], queryFn: () => nexusApi.getIngestionJob(selectedId), enabled: Boolean(selectedId), refetchInterval: (query) => query.state.data && !terminal.has(query.state.data.status) ? 1500 : false })
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['ingestion-jobs', spaceId] }),
      client.invalidateQueries({ queryKey: ['ingestion-job', selectedId] }),
      client.invalidateQueries({ queryKey: ['sources', spaceId] }),
    ])
  }
  const retry = useMutation({ mutationFn: nexusApi.retryIngestionJob, onSuccess: refresh })
  const cancel = useMutation({ mutationFn: nexusApi.cancelIngestionJob, onSuccess: refresh })
  const reprocess = useMutation({ mutationFn: nexusApi.reprocessSource, onSuccess: (job) => { setSelectedId(job.id); refresh() } })

  useEffect(() => {
    if (requestedJobId && jobs.data?.items.some((job) => job.id === requestedJobId)) {
      setSelectedId(requestedJobId)
      return
    }
    if (jobs.data?.items[0]) {
      setSelectedId((current) => current || jobs.data!.items[0].id)
    }
  }, [jobs.data, requestedJobId])
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: jobs.data?.items.length ?? 0 }
    jobs.data?.items.forEach((job) => { result[job.status] = (result[job.status] ?? 0) + 1 })
    return result
  }, [jobs.data?.items])
  const filtered = (jobs.data?.items ?? []).filter((job) => filter === 'all' || job.status === filter)
  if (space.isLoading || jobs.isLoading) return <LoadingState />

  return <div className="page-shell ingestion-jobs-page">
    <PageHeader eyebrow={`Space · ${space.data?.name ?? 'Ingestion'}`} title="Ingestion timeline" description="PostgreSQL keeps every stage, retry and parser failure. Redis delivery can disappear without erasing this history." actions={<><Link className="button" to={`/spaces/${spaceId}/sources`}><FileSearch size={16} />Materials</Link><button className="button primary" onClick={() => refresh()}><RefreshCw size={16} />Refresh</button></>} />

    <section className="job-status-ribbon" aria-label="Ingestion status filters">{['all', 'pending', 'running', 'completed', 'failed'].map((status) => <button type="button" key={status} className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}><span>{status === 'failed' ? <AlertTriangle /> : status === 'completed' ? <CheckCircle2 /> : status === 'running' ? <Loader2 /> : <Clock3 />}</span><strong>{counts[status] ?? 0}</strong><small>{status}</small></button>)}</section>

    {filtered.length ? <div className="jobs-workspace">
      <section className="job-ledger" aria-label="Ingestion jobs">{filtered.map((job) => <button type="button" key={job.id} className={selectedId === job.id ? 'selected' : ''} onClick={() => setSelectedId(job.id)}>
        <span className={`job-modality modality-${job.modality ?? 'text'}`}><FileClock /><small>{job.modality ?? 'source'}</small></span>
        <span className="job-copy"><span><strong>{job.display_name ?? job.source_version_id}</strong><StatusMark status={job.status} /></span><small>{job.mime_type ?? 'unknown MIME'} · attempt {job.attempt_count} · {job.event_count} events</small><span className="job-progress"><i style={{ width: `${stageProgress(job)}%` }} /><em>{label(job.stage)}</em></span></span>
        <span className="job-time"><small>{formatDate(job.updated_at)}</small><ArrowRight /></span>
      </button>)}</section>

      <aside className="job-inspector">
        {selected.isLoading ? <LoadingState /> : selected.data ? <>
          <header><div><p className="eyebrow">Durable job · {selected.data.id.slice(0, 8)}</p><h2>{selected.data.display_name ?? 'Ingestion attempt'}</h2></div><button className="icon-button" aria-label="Close job details" onClick={() => setSelectedId('')}><X /></button></header>
          <div className="job-inspector-state"><StatusMark status={selected.data.status} /><strong>{label(selected.data.stage)}</strong><span>attempt {selected.data.attempt_count}</span></div>
          {selected.data.error_message && <div className="job-error-sheet"><AlertTriangle /><span><strong>{selected.data.error_code ?? 'INGESTION_FAILED'}</strong><small>{selected.data.error_message}</small></span></div>}
          <div className="job-stage-track">{stages.map((stage, index) => { const current = stages.indexOf(selected.data.stage); const done = selected.data.status === 'completed' || index < current; const active = index === current && selected.data.status !== 'completed'; return <div key={stage} className={`${done ? 'done' : ''}${active ? ' active' : ''}`}><span>{done ? <CheckCircle2 /> : active ? <Loader2 /> : index + 1}</span><strong>{label(stage)}</strong></div> })}</div>
          <section className="job-event-timeline"><div><p className="eyebrow">Event record</p><h3>{selected.data.event_count} persisted transitions</h3></div>{(selected.data.events ?? []).map((event) => <article key={event.sequence}><span>{event.sequence}</span><div><strong>{label(event.event_type)}</strong><small>{formatDate(event.occurred_at)}</small>{Object.keys(event.payload).length > 0 && <code>{JSON.stringify(event.payload)}</code>}</div></article>)}</section>
          <footer>{selected.data.status === 'failed' || selected.data.status === 'cancelled' ? <button className="button primary" disabled={retry.isPending} onClick={() => retry.mutate(selected.data.id)}><RotateCcw size={15} />Retry failed stage</button> : selected.data.source_id && selected.data.status === 'completed' ? <button className="button" disabled={reprocess.isPending} onClick={() => reprocess.mutate(selected.data.source_id!)}><RefreshCw size={15} />Reparse current original</button> : <><span><Sparkles /> Worker progress is persisted as it arrives.</span><button className="button danger-quiet" disabled={cancel.isPending} onClick={() => cancel.mutate(selected.data.id)}>Cancel job</button></>}</footer>
        </> : <EmptyState title="Select a job" body="Open any row to inspect its persisted stage events." />}
      </aside>
    </div> : <EmptyState title={filter === 'all' ? 'No ingestion attempts yet' : `No ${filter} ingestion jobs`} body={filter === 'all' ? 'Add a file or connected source; its raw-first pipeline will appear here.' : 'Choose another status or import more material.'} action={<Link className="button primary" to={`/spaces/${spaceId}/sources`}>Add materials</Link>} />}
  </div>
}
