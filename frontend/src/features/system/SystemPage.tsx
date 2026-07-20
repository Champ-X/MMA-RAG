import { useMutation, useQuery } from '@tanstack/react-query'
import { Activity, Archive, Boxes, Check, Database, Monitor, Moon, RefreshCw, ScrollText, Settings2, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'
import { useTheme, type ThemePreference } from '@/app/theme'

const tabs = [
  ['status', 'Status', Activity], ['jobs', 'Queues', Boxes], ['storage', 'Storage', Database],
  ['backups', 'Backups', Archive], ['traces', 'Traces', ScrollText], ['settings', 'Settings', Settings2],
] as const

export default function SystemPage({ tab }: { tab: string }) {
  const health = useQuery({ queryKey: ['health'], queryFn: nexusApi.getHealth, refetchInterval: 10_000 })
  const indexes = useQuery({ queryKey: ['index-health'], queryFn: nexusApi.getIndexHealth, enabled: tab === 'storage' || tab === 'status' })
  const jobs = useQuery({ queryKey: ['ingestion-jobs'], queryFn: () => nexusApi.listIngestionJobs(), enabled: tab === 'jobs' })
  const backups = useQuery({ queryKey: ['backups'], queryFn: nexusApi.listBackups, enabled: tab === 'backups' })
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => nexusApi.listRuns(), enabled: tab === 'traces' })
  const config = useQuery({ queryKey: ['safe-config'], queryFn: nexusApi.getSafeSystemConfig, enabled: tab === 'settings' })
  const reconcile = useMutation({ mutationFn: nexusApi.reconcile })
  const backup = useMutation({ mutationFn: nexusApi.createBackup, onSuccess: () => backups.refetch() })
  if (health.isLoading) return <LoadingState />
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Production diagnostics" title="System" description="Readiness describes real dependencies and capability gaps. A live API process alone is never reported as healthy." actions={<button className="button" onClick={() => { health.refetch(); indexes.refetch() }}><RefreshCw size={15} />Refresh</button>} />
      <div className="subnav">{tabs.map(([value, label, Icon]) => <Link className={tab === value ? 'active' : ''} key={value} to={`/system/${value}`}><Icon size={15} />{label}</Link>)}</div>
      {tab === 'status' && <div className="system-grid"><section className="system-overall"><p className="eyebrow">Control readiness</p><strong>{health.data?.status}</strong><StatusMark status={health.data?.status ?? 'unavailable'} /><p>Version {health.data?.version}</p></section>{Object.entries(health.data?.capabilities ?? {}).map(([name, value]) => <article className="health-card" key={name}><div><span className="status-dot" /><h2>{name.replaceAll('_', ' ')}</h2></div><StatusMark status={value.status} /><pre>{JSON.stringify(value.detail, null, 2)}</pre></article>)}</div>}
      {tab === 'storage' && <div className="two-column"><section className="panel"><div className="panel-head"><div><p className="eyebrow">Index release</p><h2>Qdrant projection</h2></div><StatusMark status={String(indexes.data?.status ?? 'unavailable')} /></div><pre className="diagnostic-json">{JSON.stringify(indexes.data, null, 2)}</pre></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">Authority drift</p><h2>Reconciliation</h2></div><button className="button" onClick={() => reconcile.mutate()}>Run now</button></div>{reconcile.data ? <pre className="diagnostic-json">{JSON.stringify(reconcile.data, null, 2)}</pre> : <EmptyState title="No reconciliation run in this view" body="Reconciliation repairs derived stores from PostgreSQL and Blob authority, never the reverse." />}</section></div>}
      {tab === 'backups' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Authoritative recovery points</p><h2>{backups.data?.items.length ?? 0} backup manifests</h2></div><button className="button primary" disabled={backup.isPending} onClick={() => backup.mutate()}><Archive size={14} />{backup.isPending ? 'Creating…' : 'Create & verify'}</button></div>{backup.error && <p className="form-error">{backup.error.message}</p>}{backups.data?.items.length ? <div className="operations-list">{backups.data.items.map((item) => <div key={item.id}><span><strong>{item.id}</strong><small>{new Date(item.created_at).toLocaleString()} · secrets excluded</small></span><StatusMark status={item.status} /><span>{item.verified ? 'hash verified' : 'not verified'}</span></div>)}</div> : <EmptyState title="No recovery point yet" body="Create a consistent PostgreSQL + raw/derived object backup. Qdrant remains derived and is rebuilt after restore." />}</section>}
      {tab === 'jobs' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">PostgreSQL durable truth</p><h2>{jobs.data?.items.length ?? 0} recent ingestion jobs</h2></div><StatusMark status={String(health.data?.capabilities.workers?.status ?? 'unavailable')} /></div>{jobs.data?.items.length ? <div className="operations-list">{jobs.data.items.map((job) => <div key={job.id}><span><strong>{job.id}</strong><small>{job.source_version_id}</small></span><StatusMark status={job.status} /><span>{job.stage}</span></div>)}</div> : <EmptyState title="No ingestion jobs" body="Celery delivery is disposable; pending/running stages and fencing epochs remain authoritative in PostgreSQL." />}</section>}
      {tab === 'traces' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Durable public execution trace</p><h2>{runs.data?.items.length ?? 0} Runs</h2></div></div>{runs.data?.items.length ? <div className="operations-list">{runs.data.items.map((run) => <div key={run.id}><span><strong><Link to={`/runs/${run.id}`}>{run.goal}</Link></strong><small>{run.id} · epoch {run.execution_epoch}</small></span><StatusMark status={run.status} /><span>{run.stop_reason ?? 'in progress'}</span></div>)}</div> : <EmptyState title="No Run traces" body="Run events, tool executions, checkpoints and verification results appear after the first task." />}</section>}
      {tab === 'settings' && <div className="system-settings-layout"><AppearanceSettings /><section className="panel"><div className="panel-head"><div><p className="eyebrow">Redacted effective configuration</p><h2>Runtime policy and kill switches</h2></div></div><pre className="diagnostic-json">{JSON.stringify(config.data ?? {}, null, 2)}</pre></section></div>}
    </div>
  )
}

const appearanceOptions: Array<{ value: ThemePreference; label: string; description: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', description: 'Crisp paper surfaces for daylight and projection.', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Low-glare evidence reading for long sessions.', icon: Moon },
  { value: 'system', label: 'System', description: 'Follow the operating system and update automatically.', icon: Monitor },
]

function AppearanceSettings() {
  const { preference, resolvedTheme, setPreference } = useTheme()
  return <section className="appearance-settings panel">
    <div className="panel-head"><div><p className="eyebrow">Personal workspace</p><h2>Appearance</h2></div><span className="appearance-current">{resolvedTheme} now</span></div>
    <p>Theme preference is local to this browser and applies immediately. System mode continues following OS changes.</p>
    <div className="appearance-options" role="radiogroup" aria-label="Workspace appearance">{appearanceOptions.map(({ value, label, description, icon: Icon }) => <button key={value} type="button" role="radio" aria-checked={preference === value} className={preference === value ? 'selected' : ''} onClick={() => setPreference(value)}><span className={`appearance-preview preview-${value}`}><i /><i /><i /></span><span><Icon /><strong>{label}</strong><small>{description}</small></span>{preference === value && <Check className="appearance-check" />}</button>)}</div>
  </section>
}
