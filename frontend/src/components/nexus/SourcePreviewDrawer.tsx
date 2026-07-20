import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileSearch,
  Image as ImageIcon,
  Pause,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  SearchCheck,
  ShieldCheck,
  Table2,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { nexusApi, type SourceVersion } from '@/api/nexus'
import { LoadingState } from './LoadingState'
import { StatusMark } from './StatusMark'

const label = (value: string) => value.replaceAll('_', ' ')
const scheduleOptions = [
  { value: 60, label: 'Hourly' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Daily' },
  { value: 10080, label: 'Weekly' },
]

export function SourcePreviewDrawer({ source: initialSource, spaceId, onClose }: { source: SourceVersion; spaceId?: string; onClose: () => void }) {
  const client = useQueryClient()
  const [source, setSource] = useState(initialSource)
  const [actionJobId, setActionJobId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  useEffect(() => setSource(initialSource), [initialSource])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editError, setEditError] = useState('')
  const evidence = useQuery({ queryKey: ['source-preview', source.source_id], queryFn: () => nexusApi.listEvidence({ sourceId: source.source_id, limit: 200 }) })
  const figures = useQuery({ queryKey: ['source-preview-figures', source.source_id], queryFn: () => nexusApi.listEvidence({ sourceId: source.source_id, modality: 'image', limit: 200 }) })
  const assetUrl = `/api/v1/assets/${source.id}`
  const chunks = useMemo(() => evidence.data?.items ?? [], [evidence.data?.items])
  const tablePreview = useMemo(() => {
    const rowBlocks = chunks.filter((item) => item.evidence_type === 'table_row_block' && item.text_content.trim())
    if (!rowBlocks.length) return null
    const sheetNames = Array.from(new Set(rowBlocks.map((item) => item.locator.sheet || 'Table')))
    const sheets = sheetNames.map((sheet) => {
      const blocks = rowBlocks.filter((item) => (item.locator.sheet || 'Table') === sheet)
      let header: string[] = []
      const rows: string[][] = []
      for (const block of blocks) {
        const parsed = block.text_content.split('\n').map((line) => line.split(' | ').map((cell) => cell.trim()))
        if (!header.length && parsed.length) header = parsed[0]
        for (const row of parsed.slice(1)) {
          if (row.some(Boolean) && rows.length < 100) rows.push(row)
        }
      }
      return { sheet, header, rows, range: blocks.map((item) => item.locator.cell_range).filter(Boolean).join(' · ') }
    })
    return sheets
  }, [chunks])
  const [selectedSheet, setSelectedSheet] = useState(0)
  const visualEvidence = useMemo(() => {
    const byAsset = new Map<string, (typeof chunks)[number]>()
    for (const item of [...(figures.data?.items ?? []), ...chunks]) {
      const objectKey = typeof item.locator.extra?.object_key === 'string' ? item.locator.extra.object_key : ''
      if (objectKey && !byAsset.has(objectKey)) byAsset.set(objectKey, item)
    }
    return Array.from(byAsset.values())
  }, [chunks, figures.data?.items])
  const isPdf = source.mime_type === 'application/pdf' || source.display_name.toLowerCase().endsWith('.pdf')
  const isOfficeDocument = /wordprocessingml|msword|presentationml|powerpoint/.test(source.mime_type)
  const isManualMarkdown = source.connector_kind === 'markdown' && source.mime_type === 'text/markdown'
  const effectiveSpaceId = spaceId || source.space_ids[0]
  const schedule = (source.sync.schedules ?? []).find((item) => item.space_id === effectiveSpaceId)
  const [scheduleInterval, setScheduleInterval] = useState(1440)
  useEffect(() => setScheduleInterval(schedule?.interval_minutes ?? 1440), [schedule?.interval_minutes])
  const syncHistory = useQuery({
    queryKey: ['source-sync-executions', effectiveSpaceId, source.source_id],
    queryFn: () => nexusApi.listSourceSyncExecutions(effectiveSpaceId!, source.source_id, 8),
    enabled: Boolean(source.sync.refreshable && effectiveSpaceId),
  })
  const refreshSourceQueries = async () => {
    await client.invalidateQueries({ queryKey: ['sources'] })
    await client.invalidateQueries({ queryKey: ['space'] })
    await client.invalidateQueries({ queryKey: ['space-portrait'] })
    await client.invalidateQueries({ queryKey: ['source-preview', source.source_id] })
    await client.invalidateQueries({ queryKey: ['source-preview-figures', source.source_id] })
  }
  const loadCurrentSource = async () => {
    if (!effectiveSpaceId) return
    const register = await nexusApi.listSources(effectiveSpaceId)
    const current = register.items.find((item) => item.source_id === source.source_id)
    if (current) setSource(current)
  }
  const upstreamRefresh = useMutation({
    mutationFn: async () => {
      if (!effectiveSpaceId) throw new Error('This material is not linked to an active Space.')
      return nexusApi.refreshSource(effectiveSpaceId, source.source_id)
    },
    onSuccess: async (result) => {
      const current = result.items.find((item) => item.source_version.source_id === source.source_id)
      if (current) setSource(current.source_version)
      setActionJobId(current?.job.id ?? result.items[0]?.job.id ?? '')
      const outcome = result.execution
      setActionMessage(outcome?.status === 'changed'
        ? `Checked ${outcome.items_checked} item(s) and created ${outcome.new_version_count} immutable version${outcome.new_version_count === 1 ? '' : 's'}.`
        : outcome?.status === 'no_change'
          ? `Checked ${outcome.items_checked} upstream item(s); no content changed.`
          : source.sync.scope === 'source_set' ? `Checked ${result.items.length} material(s) in this connected source.` : 'Checked the upstream source for a new revision.')
      await refreshSourceQueries()
      await client.invalidateQueries({ queryKey: ['source-sync-executions', effectiveSpaceId, source.source_id] })
    },
  })
  const reprocess = useMutation({
    mutationFn: () => nexusApi.reprocessSource(source.source_id),
    onSuccess: async (job) => {
      setActionJobId(job.id)
      setActionMessage('Reparsed the stored original without contacting the upstream source.')
      await refreshSourceQueries()
      await loadCurrentSource()
    },
  })
  const retry = useMutation({
    mutationFn: (jobId: string) => nexusApi.retryIngestionJob(jobId),
    onSuccess: async (job) => {
      setActionJobId(job.id)
      setActionMessage('Retried the failed ingestion stage.')
      await refreshSourceQueries()
      await loadCurrentSource()
    },
  })
  const sourceActionPending = upstreamRefresh.isPending || reprocess.isPending || retry.isPending
  const configureSchedule = useMutation({
    mutationFn: ({ enabled }: { enabled: boolean }) => {
      if (!effectiveSpaceId) throw new Error('This material is not linked to an active Space.')
      return nexusApi.configureSourceSyncSchedule(effectiveSpaceId, source.source_id, {
        interval_minutes: scheduleInterval,
        enabled,
        expected_revision: schedule?.revision,
      })
    },
    onSuccess: async (updated) => {
      setActionMessage(updated.enabled
        ? `Automatic checks scheduled ${scheduleOptions.find((item) => item.value === updated.interval_minutes)?.label.toLowerCase() ?? `every ${updated.interval_minutes} minutes`}.`
        : 'Automatic upstream checks paused; the schedule and history are retained.')
      await refreshSourceQueries()
      await loadCurrentSource()
    },
  })
  const saveRevision = useMutation({
    mutationFn: () => {
      if (!effectiveSpaceId) throw new Error('This material is not linked to an active Space.')
      const file = new File([draft], source.display_name, { type: 'text/markdown' })
      return nexusApi.uploadSource(effectiveSpaceId, file, source.source_id)
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['sources'] })
      await client.invalidateQueries({ queryKey: ['space-portrait'] })
      setEditing(false)
      onClose()
    },
  })
  const beginEditing = async () => {
    setEditError('')
    try {
      const response = await fetch(assetUrl)
      if (!response.ok) throw new Error(`Original returned ${response.status}`)
      setDraft(await response.text())
      setEditing(true)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Unable to read the original note.')
    }
  }
  return <div className="source-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <aside className="source-preview-drawer" role="dialog" aria-modal="true" aria-labelledby="source-preview-title">
      <header><div><p className="eyebrow">Material inspector</p><h2 id="source-preview-title">{source.display_name}</h2><p>{source.connector_kind} · {source.mime_type} · {source.byte_size.toLocaleString()} bytes</p></div><button className="icon-button" onClick={onClose} aria-label="Close material preview"><X size={18} /></button></header>
      <div className="source-preview-meta"><StatusMark status={source.status} /><span className={`source-type modality-${source.modality}`}>{source.modality}</span><code>version {source.version_no}</code>{isManualMarkdown && <button className="text-button" type="button" onClick={beginEditing}><Pencil size={12} />Edit as new version</button>}<a href={assetUrl} target="_blank" rel="noreferrer">Open original <ExternalLink size={12} /></a></div>
      <section className={`source-readiness-panel health-${source.health.severity}`}>
        <header><span>{source.health.severity === 'positive' ? <CheckCircle2 /> : source.health.severity === 'neutral' ? <Clock3 /> : <AlertTriangle />}</span><div><p className="eyebrow">Search readiness</p><h3>{label(source.health.outcome)}</h3><p>{source.health.summary}</p></div></header>
        <div className="source-readiness-steps">
          <div className="ready"><ShieldCheck /><span><strong>Original retained</strong><small>{source.byte_size.toLocaleString()} bytes · immutable version {source.version_no}</small></span></div>
          <div className={source.health.searchable ? 'ready' : 'waiting'}><SearchCheck /><span><strong>{source.health.searchable ? 'Evidence searchable' : 'Evidence unavailable'}</strong><small>{source.published_evidence_count} published Evidence Revision{source.published_evidence_count === 1 ? '' : 's'}</small></span></div>
          <div className={source.projection.state === 'active' ? 'ready' : 'waiting'}><RefreshCw /><span><strong>Advanced projection · {label(source.projection.state)}</strong><small>{source.projection.active_evidence_count}/{source.projection.expected_evidence_count} evidence active</small></span></div>
        </div>
        {source.health.blockers.length > 0 && <details><summary>{source.health.blockers.length} capability blocker{source.health.blockers.length === 1 ? '' : 's'}</summary><ul>{source.health.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></details>}
        <footer>
          <div>{source.sync.refreshable ? <><strong>{source.sync.scope === 'source_set' ? 'Connected source set' : 'Connected source'}</strong><small>Last checked {new Date(source.sync.last_checked_at).toLocaleString()}</small></> : <><strong>Snapshot material</strong><small>Reparse uses the retained original only.</small></>}</div>
          <nav>
            {source.latest_job && <Link className="button" to={`/spaces/${effectiveSpaceId}/jobs?job=${source.latest_job.id}`}><Clock3 size={14} />Timeline</Link>}
            {source.health.primary_action === 'retry_ingestion' && source.latest_job && <button className="button primary" disabled={sourceActionPending} onClick={() => retry.mutate(source.latest_job!.id)}><RotateCcw size={14} />Retry failed stage</button>}
            {source.sync.refreshable && <button className="button primary" disabled={sourceActionPending} title={source.sync.scope === 'source_set' ? 'Checks every item described by this connector contract.' : 'Checks this upstream location for a newer revision.'} onClick={() => upstreamRefresh.mutate()}><RefreshCw size={14} />{upstreamRefresh.isPending ? 'Checking…' : 'Check upstream'}</button>}
            <button className="button" disabled={sourceActionPending} onClick={() => reprocess.mutate()}><RotateCcw size={14} />Reparse stored original</button>
          </nav>
        </footer>
        {(actionMessage || upstreamRefresh.error || reprocess.error || retry.error) && <p className={(upstreamRefresh.error || reprocess.error || retry.error) ? 'source-action-feedback error' : 'source-action-feedback'}>{upstreamRefresh.error?.message ?? reprocess.error?.message ?? retry.error?.message ?? actionMessage}{actionJobId && <Link to={`/spaces/${effectiveSpaceId}/jobs?job=${actionJobId}`}>Open job</Link>}</p>}
        {source.sync.refreshable && <section className="source-sync-automation">
          <header><span><CalendarClock /></span><div><p className="eyebrow">Upstream automation</p><h3>{schedule ? (schedule.enabled ? 'Automatic checks active' : 'Automatic checks paused') : 'Choose a safe refresh cadence'}</h3><p>The reusable connector contract is checked on schedule; unchanged content creates no duplicate Source Version.</p></div>{schedule && <StatusMark status={schedule.last_status === 'never' ? 'scheduled' : schedule.last_status} />}</header>
          <div className="source-sync-config">
            <label>Check frequency<select value={scheduleInterval} onChange={(event) => setScheduleInterval(Number(event.target.value))}>{scheduleOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <span>{schedule?.enabled ? <>Next check <strong>{new Date(schedule.next_run_at).toLocaleString()}</strong></> : <>Plans use a durable database lease, so a scheduler restart cannot erase them.</>}</span>
            <button className="button primary" disabled={configureSchedule.isPending || (schedule?.enabled && schedule.interval_minutes === scheduleInterval)} onClick={() => configureSchedule.mutate({ enabled: true })}><CalendarClock size={14} />{schedule ? (schedule.enabled ? 'Save cadence' : 'Resume schedule') : 'Enable schedule'}</button>
            {schedule?.enabled && <button className="button" disabled={configureSchedule.isPending} onClick={() => configureSchedule.mutate({ enabled: false })}><Pause size={14} />Pause</button>}
          </div>
          {configureSchedule.error && <p className="source-sync-error">{configureSchedule.error.message}</p>}
          <div className="source-sync-history">
            <p className="eyebrow">Recent upstream checks</p>
            {syncHistory.data?.items.length ? syncHistory.data.items.map((execution) => <article key={execution.id}>
              <StatusMark status={execution.status} />
              <span><strong>{execution.status === 'changed' ? `${execution.new_version_count} new version${execution.new_version_count === 1 ? '' : 's'}` : execution.status === 'no_change' ? 'No content change' : label(execution.status)}</strong><small>{execution.trigger} · checked {execution.items_checked} item{execution.items_checked === 1 ? '' : 's'} · {new Date(execution.created_at).toLocaleString()}</small></span>
              {execution.job_ids[0] ? <Link to={`/spaces/${effectiveSpaceId}/jobs?job=${execution.job_ids[0]}`}>Timeline <Clock3 size={12} /></Link> : <code>{execution.id.slice(0, 8)}</code>}
            </article>) : <p className="source-sync-empty">No checks recorded yet. “Check upstream” will create the first auditable entry.</p>}
          </div>
        </section>}
      </section>
      {editError && <p className="form-error">{editError}</p>}
      {editing && <section className="source-note-editor"><div><span><strong>Edit manual note</strong><small>Saving creates immutable version {source.version_no + 1}; prior citations keep version {source.version_no}.</small></span><button className="icon-button" onClick={() => setEditing(false)} aria-label="Close note editor"><X size={15} /></button></div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={18} spellCheck={false} />{saveRevision.error && <p className="form-error">{saveRevision.error.message}</p>}<button className="button primary" disabled={saveRevision.isPending || !draft.trim()} onClick={() => saveRevision.mutate()}><Save size={14} />{saveRevision.isPending ? 'Creating version…' : 'Save new version'}</button></section>}
      {source.modality === 'image' && <div className="source-native-preview"><img src={assetUrl} alt={source.display_name} /></div>}
      {source.modality === 'audio' && <div className="source-native-preview media"><audio src={assetUrl} controls /></div>}
      {source.modality === 'video' && <div className="source-native-preview media"><video src={assetUrl} controls /></div>}
      {isPdf && <div className="source-native-preview document"><iframe src={assetUrl} title={`${source.display_name} preview`} /></div>}
      {isOfficeDocument && chunks.length > 0 && <section className="source-document-reader">
        <div className="panel-head"><div><p className="eyebrow">Extracted document reader</p><h3>Layout-aware text and slide/page anchors</h3></div><FileSearch size={17} /></div>
        <div>{chunks.filter((item) => item.text_content.trim()).slice(0, 18).map((chunk) => <Link key={chunk.id} to={`/runs/browser/evidence/${chunk.id}`}><span>{chunk.locator.page_no ? `Page ${chunk.locator.page_no}` : chunk.evidence_type.replaceAll('_', ' ')}</span><p>{chunk.text_content}</p></Link>)}</div>
      </section>}
      {tablePreview && <section className="source-table-preview">
        <div className="panel-head"><div><p className="eyebrow">Workbook preview</p><h3>Structured cells retained with citable ranges</h3></div><Table2 size={17} /></div>
        {tablePreview.length > 1 && <div className="sheet-tabs">{tablePreview.map((sheet, index) => <button type="button" className={selectedSheet === index ? 'selected' : ''} key={sheet.sheet} onClick={() => setSelectedSheet(index)}>{sheet.sheet}</button>)}</div>}
        {tablePreview[selectedSheet] && <><div className="table-preview-meta"><strong>{tablePreview[selectedSheet].sheet}</strong><span>{tablePreview[selectedSheet].rows.length} preview rows · {tablePreview[selectedSheet].range}</span></div><div className="table-preview-scroll"><table><thead><tr>{tablePreview[selectedSheet].header.map((cell, index) => <th key={`${cell}-${index}`}>{cell || `Column ${index + 1}`}</th>)}</tr></thead><tbody>{tablePreview[selectedSheet].rows.map((row, rowIndex) => <tr key={rowIndex}>{tablePreview[selectedSheet].header.map((_, columnIndex) => <td key={columnIndex}>{row[columnIndex] ?? ''}</td>)}</tr>)}</tbody></table></div></>}
      </section>}
      {(source.derived_image_count > 0 || visualEvidence.length > 0) && <section className="source-derived-visuals">
        <div className="panel-head"><div><p className="eyebrow">Extracted from document</p><h3>{visualEvidence.length} citable visuals · {source.derived_image_count} derived visual assets</h3></div><ImageIcon size={17} /></div>
        {figures.isLoading || evidence.isLoading ? <LoadingState /> : visualEvidence.length ? <div className="source-derived-gallery">{visualEvidence.map((figure) => <Link key={figure.id} to={`/runs/browser/evidence/${figure.id}`}><img src={figure.asset_url} alt={figure.text_content.slice(0, 90) || `${source.display_name} visual`} loading="lazy" /><span><strong>{figure.locator.page_no ? `Page ${figure.locator.page_no}` : 'Document visual'} · {figure.evidence_type.replaceAll('_', ' ')}</strong><small>{figure.text_content || 'Extracted visual evidence'}</small></span></Link>)}</div> : <p className="panel-note">The parser retained derived visual assets, but none were published as citable visual evidence.</p>}
      </section>}
      <section className="source-chunk-browser">
        <div className="panel-head"><div><p className="eyebrow">Published evidence</p><h3>{source.published_evidence_count} inspectable chunks</h3></div><FileSearch size={17} /></div>
        {evidence.isLoading ? <LoadingState /> : chunks.length ? <div className="source-chunk-list">{chunks.map((chunk, index) => <Link key={chunk.id} to={`/runs/browser/evidence/${chunk.id}`}><span>{String(index + 1).padStart(2, '0')}</span><span><strong>{chunk.evidence_type.replaceAll('_', ' ')}</strong><small>{chunk.text_content || 'Non-text evidence'}</small></span><ExternalLink size={13} /></Link>)}</div> : <p className="panel-note">No published chunks yet. Check ingestion readiness or re-import the material.</p>}
      </section>
    </aside>
  </div>
}
