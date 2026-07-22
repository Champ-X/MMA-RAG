import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Activity, Archive, Boxes, Check, Database, Monitor, Moon, RefreshCw, ScrollText, Settings2, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { StatusMark } from '@/components/nexus/StatusMark'
import { Subnav, type SubnavItem } from '@/components/nexus/Subnav'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { useTheme, type ThemePreference } from '@/app/theme'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import { buildBackupCreateViewModel } from './systemBackupViewModel'
import { buildSystemConfigViewModel } from './systemConfigViewModel'
import { buildSystemModelGatewayViewModel } from './systemModelGatewayViewModel'
import { buildReconciliationViewModel } from './systemReconciliationViewModel'
import { buildSystemRefreshViewModel } from './systemRefreshViewModel'
import './SystemPage.css'

const tabs: Array<SubnavItem<string>> = [
  { value: 'status', label: 'Status', to: '/system/status', icon: <Activity size={15} /> },
  { value: 'jobs', label: 'Queues', to: '/system/jobs', icon: <Boxes size={15} /> },
  { value: 'storage', label: 'Storage', to: '/system/storage', icon: <Database size={15} /> },
  { value: 'backups', label: 'Backups', to: '/system/backups', icon: <Archive size={15} /> },
  { value: 'traces', label: 'Traces', to: '/system/traces', icon: <ScrollText size={15} /> },
  { value: 'settings', label: 'Settings', to: '/system/settings', icon: <Settings2 size={15} /> },
]
const backupCreateFeedbackId = 'backup-create-feedback'
const backupCreateGateId = 'backup-create-gate'
const reconciliationFeedbackId = 'reconciliation-feedback'
const reconciliationGateId = 'reconciliation-gate'
const systemRefreshFeedbackId = 'system-refresh-feedback'
const systemRefreshGateId = 'system-refresh-gate'

type RefetchResult = {
  error: unknown
  isError: boolean
}

type RefreshState = {
  errorMessage?: string
  lastSucceededAt?: number
  pending: boolean
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function formatRefreshTimestamp(timestamp?: number) {
  if (!timestamp) return undefined
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function queryErrorMessage(error: unknown) {
  return error ? message(error) : undefined
}

function DiagnosticDisclosure({ detail }: { detail: unknown }) {
  const fieldCount = detail && typeof detail === 'object' && !Array.isArray(detail)
    ? Object.keys(detail).length
    : detail === null || detail === undefined ? 0 : 1
  if (!fieldCount) return <p className="diagnostic-empty">No additional diagnostic payload.</p>
  return <details className="diagnostic-disclosure">
    <summary><span>Diagnostic payload</span><code>{fieldCount} field{fieldCount === 1 ? '' : 's'}</code></summary>
    <pre>{JSON.stringify(detail, null, 2)}</pre>
  </details>
}

function ModelGatewayHealthCard({ component }: { component: unknown }) {
  const gateway = buildSystemModelGatewayViewModel(component)
  const detail = component && typeof component === 'object' && !Array.isArray(component)
    ? (component as { detail?: unknown }).detail
    : undefined
  return <article className={`health-card model-gateway-card tone-${gateway.tone}`}><div><span className="health-orb" /><h2>model gateway</h2></div><StatusMark status={gateway.tone === 'ready' ? 'ready' : 'degraded'} /><section><strong>{gateway.label}</strong><small>{gateway.detail}</small></section><dl><div><dt>State</dt><dd>{gateway.stateLabel}</dd></div><div><dt>Routes</dt><dd>{gateway.activeRouteCountLabel}</dd></div>{gateway.fallbackLabel && <div><dt>Fallback</dt><dd>{gateway.fallbackLabel}</dd></div>}</dl>{gateway.failureLabels.length > 0 && <ul aria-label="Model gateway failures">{gateway.failureLabels.map((failure) => <li key={failure}>{failure}</li>)}</ul>}<DiagnosticDisclosure detail={detail} /></article>
}

export default function SystemPage({ tab }: { tab: string }) {
  const [refreshState, setRefreshState] = useState<RefreshState>({ pending: false })
  const health = useQuery({ queryKey: ['health'], queryFn: nexusApi.getHealth, refetchInterval: 10_000 })
  const indexes = useQuery({ queryKey: ['index-health'], queryFn: nexusApi.getIndexHealth, enabled: tab === 'storage' || tab === 'status' })
  const jobs = useQuery({ queryKey: ['ingestion-jobs'], queryFn: () => nexusApi.listIngestionJobs(), enabled: tab === 'jobs' })
  const backups = useQuery({ queryKey: ['backups'], queryFn: nexusApi.listBackups, enabled: tab === 'backups' })
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => nexusApi.listRuns(), enabled: tab === 'traces' })
  const config = useQuery({ queryKey: ['safe-config'], queryFn: nexusApi.getSafeSystemConfig, enabled: tab === 'settings' })
  const reconcile = useMutation({ mutationFn: nexusApi.reconcile })
  const backup = useMutation({ mutationFn: nexusApi.createBackup, onSuccess: () => backups.refetch() })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: health.error, hasData: Boolean(health.data), label: 'Health', required: true },
    { error: tab === 'status' || tab === 'storage' ? indexes.error : undefined, hasData: Boolean(indexes.data), label: 'Index health', required: tab === 'status' || tab === 'storage' },
    { error: tab === 'jobs' ? jobs.error : undefined, hasData: Boolean(jobs.data), label: 'Ingestion jobs', required: tab === 'jobs' },
    { error: tab === 'backups' ? backups.error : undefined, hasData: Boolean(backups.data), label: 'Backups', required: tab === 'backups' },
    { error: tab === 'traces' ? runs.error : undefined, hasData: Boolean(runs.data), label: 'Runs', required: tab === 'traces' },
    { error: tab === 'settings' ? config.error : undefined, hasData: Boolean(config.data), label: 'Safe config', required: tab === 'settings' },
  ])
  const retrySystemQueries = () => {
    void health.refetch()
    if (tab === 'status' || tab === 'storage') void indexes.refetch()
    if (tab === 'jobs') void jobs.refetch()
    if (tab === 'backups') void backups.refetch()
    if (tab === 'traces') void runs.refetch()
    if (tab === 'settings') void config.refetch()
  }
  const currentTabError = tab === 'jobs'
    ? jobs.error
    : tab === 'backups'
      ? backups.error
      : tab === 'traces'
        ? runs.error
        : tab === 'settings'
          ? config.error
          : tab === 'status' || tab === 'storage'
            ? indexes.error
            : undefined
  const systemRefresh = buildSystemRefreshViewModel({
    errorMessage: refreshState.errorMessage ?? queryErrorMessage(health.error) ?? queryErrorMessage(currentTabError),
    healthStatus: health.data?.status,
    lastRefreshLabel: formatRefreshTimestamp(refreshState.lastSucceededAt),
    pending: refreshState.pending,
    tab,
  })
  const refreshSystemDiagnostics = async () => {
    const refetchers: Array<() => Promise<RefetchResult>> = [() => health.refetch()]
    if (tab === 'status' || tab === 'storage') refetchers.push(() => indexes.refetch())
    if (tab === 'jobs') refetchers.push(() => jobs.refetch())
    if (tab === 'backups') refetchers.push(() => backups.refetch())
    if (tab === 'traces') refetchers.push(() => runs.refetch())
    if (tab === 'settings') refetchers.push(() => config.refetch())

    setRefreshState((current) => ({ ...current, errorMessage: undefined, pending: true }))
    try {
      const results = await Promise.all(refetchers.map((refetch) => refetch()))
      const failed = results.find((result) => result.isError)
      if (failed) {
        setRefreshState((current) => ({ ...current, errorMessage: message(failed.error), pending: false }))
        return
      }
      setRefreshState({ lastSucceededAt: Date.now(), pending: false })
    } catch (error) {
      setRefreshState((current) => ({ ...current, errorMessage: message(error), pending: false }))
    }
  }
  const reconciliation = buildReconciliationViewModel({
    errorMessage: reconcile.error instanceof Error ? reconcile.error.message : reconcile.error ? String(reconcile.error) : undefined,
    pending: reconcile.isPending,
    result: reconcile.data,
  })
  const latestBackup = backups.data?.items[0]
  const backupCreate = buildBackupCreateViewModel({
    backupCount: backups.data?.items.length ?? 0,
    errorMessage: backup.error instanceof Error ? backup.error.message : backup.error ? String(backup.error) : undefined,
    latestBackup: latestBackup ? {
      error: latestBackup.error,
      status: latestBackup.status,
      verified: latestBackup.verified,
    } : undefined,
    pending: backup.isPending,
  })
  const systemConfig = buildSystemConfigViewModel(config.data)
  if (health.isLoading) return <LoadingState />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell"><PageHeader eyebrow="Production diagnostics" title="System diagnostics could not be loaded" description="Nexus could not verify the required control-plane diagnostics for this operating view." actions={<button type="button" className="button" onClick={retrySystemQueries}><RefreshCw size={15} />Retry diagnostics</button>} /><QueryErrorNotice model={queryErrorNotice} onRetry={retrySystemQueries} /><EmptyState title="Diagnostics are temporarily unavailable" body="Retry before treating this view as empty or healthy. Backups, queues, traces and storage status need authoritative control-plane data." /></div>
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Production diagnostics"
        title="System"
        description="Readiness describes real dependencies and capability gaps. A live API process alone is never reported as healthy."
        actions={<div className="system-refresh-actions">
          <button
            type="button"
            className="button"
            aria-describedby={`${systemRefreshFeedbackId}${systemRefresh.disabledDetail ? ` ${systemRefreshGateId}` : ''}`}
            aria-disabled={systemRefresh.ariaDisabled || undefined}
            onClick={() => { if (systemRefresh.canRefresh) void refreshSystemDiagnostics() }}
          >
            <RefreshCw className={systemRefresh.feedbackTone === 'pending' ? 'spin' : undefined} size={15} />
            {systemRefresh.submitLabel}
          </button>
          {systemRefresh.disabledDetail && <span className="sr-only" id={systemRefreshGateId}>{systemRefresh.disabledDetail}</span>}
          <SubmitReadinessCard className="system-refresh-feedback" id={systemRefreshFeedbackId} model={systemRefresh} />
        </div>}
      />
      <Subnav active={tab} ariaLabel="System diagnostic sections" items={tabs} />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retrySystemQueries} />
      {tab === 'status' && <div className="system-grid"><section className="system-overall"><p className="eyebrow">Control readiness</p><strong>{health.data?.status}</strong><StatusMark status={health.data?.status ?? 'unavailable'} /><p>Version {health.data?.version}</p></section>{Object.entries(health.data?.capabilities ?? {}).map(([name, value]) => name === 'model_gateway' ? <ModelGatewayHealthCard key={name} component={value} /> : <article className="health-card" key={name}><div><span className="health-orb" /><h2>{name.replaceAll('_', ' ')}</h2></div><StatusMark status={value.status} /><DiagnosticDisclosure detail={value.detail} /></article>)}</div>}
      {tab === 'storage' && <div className="two-column"><section className="panel"><div className="panel-head"><div><p className="eyebrow">Index release</p><h2>Qdrant projection</h2></div><StatusMark status={String(indexes.data?.status ?? 'unavailable')} /></div><pre className="diagnostic-json">{JSON.stringify(indexes.data, null, 2)}</pre></section><section className="panel"><div className="panel-head"><div><p className="eyebrow">Authority drift</p><h2>Reconciliation</h2></div><button type="button" className="button" aria-describedby={`${reconciliationFeedbackId}${reconciliation.disabledDetail ? ` ${reconciliationGateId}` : ''}`} aria-disabled={reconciliation.ariaDisabled || undefined} onClick={() => { if (reconciliation.canSubmit) reconcile.mutate() }}><RefreshCw size={14} />{reconciliation.submitLabel}</button>{reconciliation.disabledDetail && <span className="sr-only" id={reconciliationGateId}>{reconciliation.disabledDetail}</span>}</div><div className={`reconciliation-result-card tone-${reconciliation.resultTone}`}><span><Database /></span><div><strong>{reconciliation.resultLabel}</strong><small>{reconciliation.resultDetail}</small></div></div><SubmitReadinessCard className="reconciliation-feedback" id={reconciliationFeedbackId} model={reconciliation} />{reconcile.data ? <DiagnosticDisclosure detail={reconcile.data} /> : <EmptyState title="No reconciliation run in this view" body="Reconciliation repairs derived stores from PostgreSQL and Blob authority, never the reverse." />}</section></div>}
      {tab === 'backups' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Authoritative recovery points</p><h2>{backups.data?.items.length ?? 0} backup manifests</h2></div><button type="button" className="button primary" aria-describedby={`${backupCreateFeedbackId}${backupCreate.disabledDetail ? ` ${backupCreateGateId}` : ''}`} aria-disabled={backupCreate.ariaDisabled || undefined} onClick={() => { if (backupCreate.canSubmit) backup.mutate() }}><Archive size={14} />{backupCreate.submitLabel}</button>{backupCreate.disabledDetail && <span className="sr-only" id={backupCreateGateId}>{backupCreate.disabledDetail}</span>}</div><div className={`backup-recovery-gate tone-${backupCreate.latestTone}`}><span><Archive /></span><div><strong>{backupCreate.latestLabel}</strong><small>{backupCreate.latestDetail}</small></div></div><SubmitReadinessCard className="backup-create-feedback" id={backupCreateFeedbackId} model={backupCreate} />{backups.data?.items.length ? <div className="operations-list">{backups.data.items.map((item) => <div key={item.id}><span><strong>{item.id}</strong><small>{new Date(item.created_at).toLocaleString()} · secrets excluded · {item.destination}</small></span><StatusMark status={item.status} /><span>{item.verified ? 'hash verified' : 'not verified'}</span></div>)}</div> : <EmptyState title="No recovery point yet" body="Create a consistent PostgreSQL + raw/derived object backup. Qdrant remains derived and is rebuilt after restore." />}</section>}
      {tab === 'jobs' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">PostgreSQL durable truth</p><h2>{jobs.data?.items.length ?? 0} recent ingestion jobs</h2></div><StatusMark status={String(health.data?.capabilities.workers?.status ?? 'unavailable')} /></div>{jobs.data?.items.length ? <div className="operations-list">{jobs.data.items.map((job) => <div key={job.id}><span><strong>{job.id}</strong><small>{job.source_version_id}</small></span><StatusMark status={job.status} /><span>{job.stage}</span></div>)}</div> : <EmptyState title="No ingestion jobs" body="Celery delivery is disposable; pending/running stages and fencing epochs remain authoritative in PostgreSQL." />}</section>}
      {tab === 'traces' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Durable public execution trace</p><h2>{runs.data?.items.length ?? 0} Runs</h2></div></div>{runs.data?.items.length ? <div className="operations-list">{runs.data.items.map((run) => <div key={run.id}><span><strong><Link to={`/runs/${run.id}`}>{run.goal}</Link></strong><small>{run.id} · epoch {run.execution_epoch}</small></span><StatusMark status={run.status} /><span>{run.stop_reason ?? 'in progress'}</span></div>)}</div> : <EmptyState title="No Run traces" body="Run events, tool executions, checkpoints and verification results appear after the first task." />}</section>}
      {tab === 'settings' && <div className="system-settings-layout"><AppearanceSettings /><section className="panel safe-config-panel"><div className="panel-head"><div><p className="eyebrow">Safe configuration summary</p><h2>Runtime policy and operator-visible paths</h2><p>{systemConfig.overviewDetail}</p></div><span className="safe-config-state">{systemConfig.overviewLabel}</span></div><div className="safe-config-notice" role="note"><Settings2 size={14} /><span>{systemConfig.notice}</span></div><div className="safe-config-sections">{systemConfig.sections.map((section) => <article className="safe-config-section" key={section.title}><div><p className="eyebrow">{section.eyebrow}</p><h3>{section.title}</h3><small>{section.description}</small></div><dl>{section.items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><span className={`safe-config-pill tone-${item.tone}`}>{item.code ? <code>{item.value}</code> : item.value}</span>{item.detail && <small>{item.detail}</small>}</dd></div>)}</dl></article>)}</div><DiagnosticDisclosure detail={systemConfig.diagnostic} /></section></div>}
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
  const appearanceRefs = useRef<Partial<Record<ThemePreference, HTMLButtonElement | null>>>({})
  const selectPreference = (nextPreference: ThemePreference) => {
    setPreference(nextPreference)
  }
  const handleAppearanceKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextPreference = moveRadioGroupValue(appearanceOptions.map((option) => option.value), preference, direction)
    selectPreference(nextPreference)
    window.requestAnimationFrame(() => appearanceRefs.current[nextPreference]?.focus({ preventScroll: true }))
  }
  return <section className="appearance-settings panel">
    <div className="panel-head"><div><p className="eyebrow">Personal workspace</p><h2>Appearance</h2></div><span className="appearance-current">{resolvedTheme} now</span></div>
    <p>Theme preference is local to this browser and applies immediately. System mode continues following OS changes.</p>
    <div className="appearance-options" role="radiogroup" aria-label="Workspace appearance">{appearanceOptions.map(({ value, label, description, icon: Icon }) => <button type="button" key={value} ref={(node) => { appearanceRefs.current[value] = node }} role="radio" aria-checked={preference === value} tabIndex={preference === value ? 0 : -1} className={preference === value ? 'selected' : ''} onKeyDown={handleAppearanceKeyDown} onClick={() => selectPreference(value)}><span className={`appearance-preview preview-${value}`}><i /><i /><i /></span><span><Icon /><strong>{label}</strong><small>{description}</small></span>{preference === value && <Check className="appearance-check" />}</button>)}</div>
  </section>
}
