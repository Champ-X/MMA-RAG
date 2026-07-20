import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare2,
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  FolderOpen,
  GitBranch,
  Globe2,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Newspaper,
  RefreshCw,
  RotateCcw,
  Rss,
  Search,
  SearchCheck,
  Square,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { nexusApi, type ConnectorSync, type SourceVersion } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { MaterialCover } from '@/components/nexus/MaterialCover'
import { PageHeader } from '@/components/nexus/PageHeader'
import { SourcePreviewDrawer } from '@/components/nexus/SourcePreviewDrawer'
import { StatusMark } from '@/components/nexus/StatusMark'

type ConnectorKind = 'markdown' | 'url' | 'rss' | 'folder' | 'git' | 'news' | 'image_search'
type ViewMode = 'grid' | 'list'

type ConnectorReadiness = {
  allowed_folder_roots?: string[]
  news_search_configured?: boolean
  google_images_configured?: boolean
  pixabay_configured?: boolean
  internet_archive_configured?: boolean
}

const connectorOptions: Array<{
  kind: ConnectorKind
  label: string
  description: string
  icon: typeof Globe2
  group: 'direct' | 'connected'
}> = [
  { kind: 'url', label: 'Web URL', description: 'Inspect and preserve a web page or direct file.', icon: Globe2, group: 'direct' },
  { kind: 'markdown', label: 'Manual note', description: 'Create a durable Markdown original.', icon: FileText, group: 'direct' },
  { kind: 'rss', label: 'RSS / Atom', description: 'Materialize recent feed entries with source URLs.', icon: Rss, group: 'connected' },
  { kind: 'git', label: 'Git repository', description: 'Sync a branch or repository subdirectory.', icon: GitBranch, group: 'connected' },
  { kind: 'folder', label: 'Mounted folder', description: 'Read an allow-listed server directory.', icon: FolderOpen, group: 'connected' },
  { kind: 'news', label: 'News search', description: 'Search Tavily by topic, recency and depth.', icon: Newspaper, group: 'connected' },
  { kind: 'image_search', label: 'Image search', description: 'Choose a provider, media type and ordering.', icon: ImageIcon, group: 'connected' },
]

const splitValues = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
const scheduleLabel = (minutes: number) => minutes === 60 ? 'hourly' : minutes === 1440 ? 'daily' : minutes === 10080 ? 'weekly' : `every ${minutes / 60}h`

const activeScheduleFor = (source: SourceVersion, spaceId: string | undefined) =>
  (source.sync.schedules ?? []).find((item) => item.space_id === spaceId && item.enabled)

export default function SourcesPage() {
  const { spaceId = '' } = useParams()
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const client = useQueryClient()
  const refreshSources = useCallback(() => {
    client.invalidateQueries({ queryKey: ['sources', spaceId] })
    client.invalidateQueries({ queryKey: ['space', spaceId] })
    client.invalidateQueries({ queryKey: ['spaces'] })
    client.invalidateQueries({ queryKey: ['space-portrait', spaceId] })
  }, [client, spaceId])
  const space = useQuery({ queryKey: ['space', spaceId], queryFn: () => nexusApi.getSpace(spaceId), enabled: Boolean(spaceId) })
  const sources = useQuery({ queryKey: ['sources', spaceId], queryFn: () => nexusApi.listSources(spaceId), enabled: Boolean(spaceId) })
  const system = useQuery({ queryKey: ['system-config'], queryFn: nexusApi.getSafeSystemConfig })
  const connectorReadiness = (system.data?.connectors ?? {}) as ConnectorReadiness
  const [preview, setPreview] = useState<SourceVersion | null>(null)
  const [dragging, setDragging] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [filter, setFilter] = useState('')
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [trackedJobIds, setTrackedJobIds] = useState<string[]>([])
  const trackJobs = useCallback((ids: string[]) => {
    setTrackedJobIds((current) => Array.from(new Set([...current, ...ids])))
  }, [])
  const trackedJobs = useQuery({
    queryKey: ['tracked-ingestion-jobs', ...trackedJobIds],
    queryFn: () => Promise.all(trackedJobIds.map(nexusApi.getIngestionJob)),
    enabled: trackedJobIds.length > 0,
    refetchInterval: trackedJobIds.length > 0 ? 1000 : false,
  })
  useEffect(() => {
    if (!trackedJobs.data?.length) return
    refreshSources()
    if (trackedJobs.data.every((job) => ['completed', 'failed', 'cancelled'].includes(job.status))) setTrackedJobIds([])
  }, [refreshSources, trackedJobs.data])

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const results = []
      for (const file of files) results.push(await nexusApi.uploadSource(spaceId, file))
      return results
    },
    onSuccess: (results) => { trackJobs(results.map((item) => item.job.id)); refreshSources() },
  })
  const remove = useMutation({ mutationFn: nexusApi.deleteSource, onSuccess: refreshSources })
  const batch = useMutation({
    mutationFn: async (action: 'reprocess' | 'delete') => {
      const jobs = []
      for (const sourceId of selectedSourceIds) {
        if (action === 'reprocess') jobs.push(await nexusApi.reprocessSource(sourceId))
        else await nexusApi.deleteSource(sourceId)
      }
      return jobs
    },
    onSuccess: (jobs) => { trackJobs(jobs.map((job) => job.id)); setSelectedSourceIds([]); refreshSources() },
  })
  const materialAction = useMutation({
    mutationFn: async ({ action, source }: { action: 'refresh' | 'reprocess' | 'retry'; source: SourceVersion }) => {
      if (action === 'refresh') {
        const result = await nexusApi.refreshSource(spaceId, source.source_id)
        return result.items.map((item) => item.job)
      }
      if (action === 'retry' && source.latest_job) return [await nexusApi.retryIngestionJob(source.latest_job.id)]
      return [await nexusApi.reprocessSource(source.source_id)]
    },
    onSuccess: (jobs) => { trackJobs(jobs.map((job) => job.id)); refreshSources() },
  })

  const [connectorKind, setConnectorKind] = useState<ConnectorKind>('url')
  const [url, setUrl] = useState('')
  const [urlMode, setUrlMode] = useState<'auto' | 'webpage' | 'file'>('auto')
  const [urlFilename, setUrlFilename] = useState('')
  const [includeLinks, setIncludeLinks] = useState(true)
  const [includeImages, setIncludeImages] = useState(true)
  const [noteTitle, setNoteTitle] = useState('Manual note')
  const [noteContent, setNoteContent] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [maxEntries, setMaxEntries] = useState(20)
  const [folderPath, setFolderPath] = useState(connectorReadiness.allowed_folder_roots?.[0] ?? '/imports')
  const [recursive, setRecursive] = useState(true)
  const [extensions, setExtensions] = useState('pdf, doc, docx, ppt, pptx, md, txt, csv, xls, xlsx, xlsm, png, jpg, mp3, mp4')
  const [excludeGlobs, setExcludeGlobs] = useState('.git/*, node_modules/*, __pycache__/*, *.tmp')
  const [folderLimit, setFolderLimit] = useState(500)
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [subdirectory, setSubdirectory] = useState('')
  const [includeGlobs, setIncludeGlobs] = useState('*.md, *.txt, *.pdf, *.doc, *.docx, *.ppt, *.pptx, *.csv, *.xls, *.xlsx, *.xlsm, *.png, *.jpg, *.mp3, *.mp4')
  const [gitExcludeGlobs, setGitExcludeGlobs] = useState('.git/*, node_modules/*, dist/*, build/*')
  const [gitLimit, setGitLimit] = useState(500)
  const [newsQuery, setNewsQuery] = useState('')
  const [newsTopic, setNewsTopic] = useState<'general' | 'news' | 'finance'>('news')
  const [newsRange, setNewsRange] = useState<'day' | 'week' | 'month' | 'year'>('week')
  const [newsDepth, setNewsDepth] = useState<'basic' | 'advanced' | 'fast' | 'ultra-fast'>('advanced')
  const [newsLimit, setNewsLimit] = useState(10)
  const [includeFullContent, setIncludeFullContent] = useState(false)
  const [imageQuery, setImageQuery] = useState('')
  const [imageSource, setImageSource] = useState<'google_images' | 'pixabay' | 'internet_archive'>('internet_archive')
  const [imageQuantity, setImageQuantity] = useState(8)
  const [imageType, setImageType] = useState<'all' | 'photo' | 'illustration' | 'vector'>('photo')
  const [imageOrder, setImageOrder] = useState<'popular' | 'latest' | 'relevance' | 'downloads'>('relevance')
  const [safeSearch, setSafeSearch] = useState(true)

  const connectorPayload = (): ConnectorSync => {
    if (connectorKind === 'markdown') return { kind: 'markdown', space_id: spaceId, title: noteTitle, content: noteContent }
    if (connectorKind === 'url') return { kind: 'url', space_id: spaceId, url, mode: urlMode, filename: urlFilename || null, include_links: includeLinks, include_images: includeImages }
    if (connectorKind === 'rss') return { kind: 'rss', space_id: spaceId, feed_url: feedUrl, max_entries: maxEntries }
    if (connectorKind === 'folder') return { kind: 'folder', space_id: spaceId, path: folderPath, recursive, extensions: splitValues(extensions), exclude_globs: splitValues(excludeGlobs), max_files: folderLimit }
    if (connectorKind === 'git') return { kind: 'git', space_id: spaceId, repository_url: repositoryUrl, branch: branch || null, subdirectory: subdirectory || null, include_globs: splitValues(includeGlobs), exclude_globs: splitValues(gitExcludeGlobs), max_files: gitLimit }
    if (connectorKind === 'news') return { kind: 'news', space_id: spaceId, query: newsQuery, topic: newsTopic, time_range: newsRange, search_depth: newsDepth, max_results: newsLimit, include_full_content: includeFullContent }
    return { kind: 'image_search', space_id: spaceId, query: imageQuery, source: imageSource, quantity: imageQuantity, image_type: imageType, order: imageOrder, safe_search: safeSearch }
  }

  const connector = useMutation({ mutationFn: () => nexusApi.syncConnector(connectorPayload()), onSuccess: (result) => { trackJobs(result.items.map((item) => item.job.id)); refreshSources() } })
  const filteredSources = useMemo(() => (sources.data?.items ?? []).filter((source) => `${source.display_name} ${source.mime_type} ${source.connector_kind}`.toLowerCase().includes(filter.toLowerCase())), [sources.data?.items, filter])
  const healthCounts = useMemo(() => {
    const items = sources.data?.items ?? []
    return {
      searchable: items.filter((source) => source.health.searchable).length,
      ready: items.filter((source) => source.health.outcome === 'ready').length,
      attention: items.filter((source) => ['warning', 'negative'].includes(source.health.severity)).length,
      processing: items.filter((source) => ['processing', 'refreshing_with_evidence'].includes(source.health.outcome)).length,
      exactOnly: items.filter((source) => source.health.outcome === 'searchable_exact_only').length,
    }
  }, [sources.data?.items])

  if (space.isLoading || sources.isLoading) return <LoadingState />

  const receiveFiles = (files: FileList | null) => { if (files?.length) upload.mutate(Array.from(files)) }
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => { receiveFiles(event.target.files); event.target.value = '' }
  const dropFiles = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); receiveFiles(event.dataTransfer.files) }
  const syncConnector = (event: FormEvent) => { event.preventDefault(); connector.mutate() }
  const selectedConnector = connectorOptions.find((item) => item.kind === connectorKind) ?? connectorOptions[0]
  const SelectedIcon = selectedConnector.icon
  const readiness = (kind: ConnectorKind) => {
    if (kind === 'news') return connectorReadiness.news_search_configured ? 'ready' : 'setup'
    if (kind === 'image_search') return connectorReadiness.internet_archive_configured ? 'ready' : 'setup'
    if (kind === 'folder') return connectorReadiness.allowed_folder_roots?.length ? 'ready' : 'setup'
    return 'ready'
  }
  const toggleSelected = (sourceId: string) => setSelectedSourceIds((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId])
  const sourceAction = (source: SourceVersion) => {
    const pending = materialAction.isPending && materialAction.variables?.source.source_id === source.source_id
    if (source.health.primary_action === 'retry_ingestion' && source.latest_job) return <button className="button primary" disabled={pending} onClick={() => materialAction.mutate({ action: 'retry', source })}><RotateCcw size={13} />{pending ? 'Retrying…' : 'Retry'}</button>
    if (source.health.primary_action === 'reprocess') return <button className="button primary" disabled={pending} onClick={() => materialAction.mutate({ action: 'reprocess', source })}><RotateCcw size={13} />{pending ? 'Reparsing…' : 'Reparse'}</button>
    if (source.sync.refreshable) return <button className="button" disabled={pending} title={source.sync.scope === 'source_set' ? 'Checks every item in this connected source set.' : 'Checks this upstream location for a new revision.'} onClick={() => materialAction.mutate({ action: 'refresh', source })}><RefreshCw size={13} />{pending ? 'Checking…' : 'Check upstream'}</button>
    return null
  }

  const renderConnectorFields = () => {
    if (connectorKind === 'url') return <>
      <label className="field-span-2">URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article-or-file" required /></label>
      <label>Import mode<select value={urlMode} onChange={(event) => setUrlMode(event.target.value as typeof urlMode)}><option value="auto">Auto detect</option><option value="webpage">Readable web page</option><option value="file">Original file</option></select></label>
      <label>Saved name <span>optional</span><input value={urlFilename} onChange={(event) => setUrlFilename(event.target.value)} placeholder="Use page title or URL name" /></label>
      <label className="check-field"><input type="checkbox" checked={includeLinks} onChange={(event) => setIncludeLinks(event.target.checked)} />Preserve links</label>
      <label className="check-field"><input type="checkbox" checked={includeImages} onChange={(event) => setIncludeImages(event.target.checked)} />Preserve image references</label>
    </>
    if (connectorKind === 'markdown') return <>
      <label>Document title<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} required /></label>
      <label className="field-span-2">Markdown content<textarea value={noteContent} onChange={(event) => setNoteContent(event.target.value)} placeholder="# A durable note" required /></label>
    </>
    if (connectorKind === 'rss') return <>
      <label className="field-span-2">Feed URL<input type="url" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://example.com/feed.xml" required /></label>
      <label>Recent entries<input type="number" min={1} max={200} value={maxEntries} onChange={(event) => setMaxEntries(Number(event.target.value))} /></label>
    </>
    if (connectorKind === 'folder') return <>
      <label className="field-span-2">Server path<input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="/imports/project" required /><span>Allowed: {connectorReadiness.allowed_folder_roots?.join(', ') || 'no roots configured'}</span></label>
      <label>Extensions<textarea value={extensions} onChange={(event) => setExtensions(event.target.value)} /></label>
      <label>Exclude patterns<textarea value={excludeGlobs} onChange={(event) => setExcludeGlobs(event.target.value)} /></label>
      <label className="check-field"><input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />Include subfolders</label>
      <label>Maximum files<input type="number" min={1} max={2000} value={folderLimit} onChange={(event) => setFolderLimit(Number(event.target.value))} /></label>
    </>
    if (connectorKind === 'git') return <>
      <label className="field-span-2">Public HTTPS repository<input type="url" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/org/repository.git" required /></label>
      <label>Branch <span>optional</span><input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Default branch" /></label>
      <label>Subdirectory <span>optional</span><input value={subdirectory} onChange={(event) => setSubdirectory(event.target.value)} placeholder="docs/" /></label>
      <label>Include patterns<textarea value={includeGlobs} onChange={(event) => setIncludeGlobs(event.target.value)} /></label>
      <label>Exclude patterns<textarea value={gitExcludeGlobs} onChange={(event) => setGitExcludeGlobs(event.target.value)} /></label>
      <label>Maximum files<input type="number" min={1} max={2000} value={gitLimit} onChange={(event) => setGitLimit(Number(event.target.value))} /></label>
    </>
    if (connectorKind === 'news') return <>
      <label className="field-span-2">Search query<input value={newsQuery} onChange={(event) => setNewsQuery(event.target.value)} placeholder="AI agent engineering" required /></label>
      <label>Topic<select value={newsTopic} onChange={(event) => setNewsTopic(event.target.value as typeof newsTopic)}><option value="news">News</option><option value="general">General</option><option value="finance">Finance</option></select></label>
      <label>Time range<select value={newsRange} onChange={(event) => setNewsRange(event.target.value as typeof newsRange)}><option value="day">Past day</option><option value="week">Past week</option><option value="month">Past month</option><option value="year">Past year</option></select></label>
      <label>Search depth<select value={newsDepth} onChange={(event) => setNewsDepth(event.target.value as typeof newsDepth)}><option value="fast">Fast</option><option value="basic">Basic</option><option value="advanced">Advanced</option><option value="ultra-fast">Ultra-fast</option></select></label>
      <label>Maximum results<input type="number" min={1} max={20} value={newsLimit} onChange={(event) => setNewsLimit(Number(event.target.value))} /></label>
      <label className="check-field field-span-2"><input type="checkbox" checked={includeFullContent} onChange={(event) => setIncludeFullContent(event.target.checked)} />Request full article content when Tavily can provide it</label>
    </>
    return <>
      <label className="field-span-2">Search query<input value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} placeholder="industrial design references" required /></label>
      <label>Provider<select value={imageSource} onChange={(event) => setImageSource(event.target.value as typeof imageSource)}><option value="internet_archive">Internet Archive · no key</option><option value="google_images" disabled={!connectorReadiness.google_images_configured}>Google Images · SerpAPI{connectorReadiness.google_images_configured ? '' : ' · not configured'}</option><option value="pixabay" disabled={!connectorReadiness.pixabay_configured}>Pixabay{connectorReadiness.pixabay_configured ? '' : ' · not configured'}</option></select></label>
      <label>Quantity<input type="number" min={1} max={20} value={imageQuantity} onChange={(event) => setImageQuantity(Number(event.target.value))} /></label>
      <label>Image type<select value={imageType} onChange={(event) => setImageType(event.target.value as typeof imageType)}><option value="photo">Photos</option><option value="illustration">Illustrations</option><option value="vector">Vectors</option><option value="all">All types</option></select></label>
      <label>Order<select value={imageOrder} onChange={(event) => setImageOrder(event.target.value as typeof imageOrder)}><option value="relevance">Relevance</option><option value="popular">Popular</option><option value="latest">Latest</option><option value="downloads">Downloads</option></select></label>
      <label className="check-field field-span-2"><input type="checkbox" checked={safeSearch} onChange={(event) => setSafeSearch(event.target.checked)} />Safe search</label>
    </>
  }

  return <div className="page-shell sources-workbench">
    <PageHeader eyebrow={`Space · ${space.data?.name ?? 'Sources'}`} title="Materials" description="Add originals, configure live sources, and inspect every published material from one traceable register." actions={<><input ref={fileInput} type="file" multiple hidden accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.md,.markdown,.txt,.csv,.xls,.xlsx,.xlsm" onChange={chooseFile} /><input ref={folderInput} type="file" multiple hidden onChange={chooseFile} {...({ webkitdirectory: '' } as Record<string, string>)} /><button className="button" onClick={() => folderInput.current?.click()} disabled={upload.isPending}><FolderOpen size={16} />Upload folder</button><button className="button primary" onClick={() => fileInput.current?.click()} disabled={upload.isPending}><FileUp size={16} />Add files</button></>} />

    <section className="ingestion-console">
      <div className="ingestion-direct">
        <header><div><p className="eyebrow">Direct intake</p><h2>Store the original first.</h2><p>Mixed media enters one durable pipeline; parsing and enrichment remain independently observable.</p></div><ShieldCheck size={22} /></header>
        <div className={`source-drop-zone${dragging ? ' dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={dropFiles}>
          <span><UploadCloud size={25} /></span><div><strong>{upload.isPending ? 'Storing originals…' : 'Drop files or a folder'}</strong><small>Documents · images · audio · video · tabular data</small></div><button className="text-button" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>Browse files <ChevronRight size={13} /></button>
        </div>
      </div>

      <div className="source-contracts">
        <div className="source-contract-group"><p>Quick import</p><div>{connectorOptions.filter((item) => item.group === 'direct').map(({ kind, label, description, icon: Icon }) => <button key={kind} type="button" className={connectorKind === kind ? 'selected' : ''} onClick={() => setConnectorKind(kind)}><Icon /><span><strong>{label}</strong><small>{description}</small></span><ChevronRight /></button>)}</div></div>
        <div className="source-contract-group"><p>Connected sources</p><div>{connectorOptions.filter((item) => item.group === 'connected').map(({ kind, label, description, icon: Icon }) => <button key={kind} type="button" className={connectorKind === kind ? 'selected' : ''} onClick={() => setConnectorKind(kind)}><Icon /><span><strong>{label}</strong><small>{description}</small></span><em className={`contract-readiness ${readiness(kind)}`}>{readiness(kind) === 'ready' ? 'available' : 'setup'}</em></button>)}</div></div>
      </div>

      <form className="connector-contract-sheet" onSubmit={syncConnector}>
        <header><span><SelectedIcon /></span><div><p className="eyebrow">Source contract</p><h3>{selectedConnector.label}</h3><p>{selectedConnector.description}</p></div><em>{connectorKind.replace('_', ' ')}</em></header>
        <div className="connector-fields">{renderConnectorFields()}</div>
        <footer><span><CheckCircle2 /> Original bytes and source metadata are retained before parsing.</span><button className="button primary" disabled={connector.isPending || readiness(connectorKind) === 'setup'}>{connector.isPending ? 'Importing…' : `Import ${selectedConnector.label}`}</button></footer>
      </form>

      {(upload.error || connector.error || upload.data || connector.data) && <div className="intake-feedback">
        {(upload.error || connector.error) && <div className="notice negative"><strong>Import failed</strong><span>{upload.error?.message ?? connector.error?.message}</span></div>}
        {upload.data && <div className="notice positive"><ShieldCheck size={17} /><strong>{upload.data.length} original(s) stored</strong><span>Parsing and projection are now running.</span></div>}
        {connector.data && <div className="notice positive"><ShieldCheck size={17} /><strong>{connector.data.items.length} item(s) stored</strong><span>Each item keeps its connector origin and external version.</span></div>}
      </div>}
      {trackedJobIds.length > 0 && <div className="notice"><RefreshCw className="spin" size={17} /><strong>Enriching {trackedJobIds.length} material{trackedJobIds.length === 1 ? '' : 's'}</strong><span>Status and evidence counts refresh automatically. <Link to={`/spaces/${spaceId}/jobs`}>Open ingestion timeline</Link></span></div>}
    </section>

    <section className="panel source-register">
      <div className="library-toolbar"><div><p className="eyebrow">Material library</p><h2>{sources.data?.items.length ?? 0} originals</h2></div><label><Search size={15} /><input aria-label="Search materials" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search name, type or source…" /></label><div className="view-switch"><button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} aria-label="Grid view"><LayoutGrid /></button><button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} aria-label="List view"><List /></button></div><button className="text-button" onClick={() => sources.refetch()}><RefreshCw size={14} />Refresh</button></div>
      <div className="source-health-ribbon" aria-label="Material health summary">
        <span className="positive"><SearchCheck /><strong>{healthCounts.searchable}</strong><small>searchable</small></span>
        <span><CheckCircle2 /><strong>{healthCounts.ready}</strong><small>fully ready</small></span>
        <span className={healthCounts.attention ? 'warning' : ''}><AlertTriangle /><strong>{healthCounts.attention}</strong><small>need attention</small></span>
        <span><Clock3 /><strong>{healthCounts.processing}</strong><small>processing</small></span>
        {healthCounts.exactOnly > 0 && <span className="exact"><Search /><strong>{healthCounts.exactOnly}</strong><small>exact-only</small></span>}
      </div>
      {materialAction.error && <div className="notice negative"><AlertTriangle size={16} /><strong>Material action failed</strong><span>{materialAction.error.message}</span></div>}
      {filteredSources.length ? <div className={`material-register-grid ${viewMode}`}>{filteredSources.map((source) => <article key={source.id} className={selectedSourceIds.includes(source.source_id) ? 'selected' : ''}>
        <button className="material-select" aria-label={`${selectedSourceIds.includes(source.source_id) ? 'Deselect' : 'Select'} ${source.display_name}`} onClick={() => toggleSelected(source.source_id)}>{selectedSourceIds.includes(source.source_id) ? <CheckSquare2 /> : <Square />}</button>
        <button className="material-open" onClick={() => setPreview(source)}><MaterialCover source={source} compact={viewMode === 'list'} /><span className="material-copy"><span className="material-title-row"><strong>{source.display_name}</strong><StatusMark status={source.status} /></span><small>{source.connector_kind.replace('_', ' ')} · {source.mime_type}</small><span><code>{source.modality}</code>{source.derived_image_count > 0 && <em>{source.derived_image_count} visuals</em>}<em>{source.published_evidence_count} evidence</em><em>{formatBytes(source.byte_size)}</em><em>{formatDate(source.created_at)}</em><em>v{source.version_no}</em>{activeScheduleFor(source, spaceId) && <em className="sync-schedule-chip">auto · {scheduleLabel(activeScheduleFor(source, spaceId)!.interval_minutes)}</em>}</span><span className={`material-health health-${source.health.severity}`}>{source.health.severity === 'positive' ? <CheckCircle2 /> : source.health.severity === 'neutral' ? <Clock3 /> : <AlertTriangle />}<small>{source.health.summary}</small></span></span></button>
        <div className="material-card-actions">{source.latest_job && <Link className="text-button" title="Open latest ingestion attempt" to={`/spaces/${spaceId}/jobs?job=${source.latest_job.id}`}><Clock3 size={13} />Timeline</Link>}{sourceAction(source)}<button className="icon-button danger-quiet" title="Delete material" aria-label={`Delete ${source.display_name}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete “${source.display_name}” from every Space and remove its retrieval projections? The tombstone remains for audit.`)) remove.mutate(source.source_id) }}><Trash2 size={15} /></button></div>
      </article>)}</div> : <EmptyState title={filter ? 'No matching materials' : 'Add a Source without losing the original'} body={filter ? 'Try another name, MIME type, or connector.' : 'Every import is stored before parsing, so it stays recoverable even when an enrichment capability is unavailable.'} action={!filter ? <button className="button" onClick={() => fileInput.current?.click()}><FileUp size={16} />Choose files</button> : undefined} />}
    </section>
    {selectedSourceIds.length > 0 && <aside className="material-batch-bar"><span><CheckSquare2 /><strong>{selectedSourceIds.length}</strong> material{selectedSourceIds.length === 1 ? '' : 's'} selected</span><button className="text-button" onClick={() => setSelectedSourceIds(filteredSources.map((source) => source.source_id))}>Select visible</button><button className="button" disabled={batch.isPending} onClick={() => batch.mutate('reprocess')}><RotateCcw size={14} />Reparse</button><button className="button danger-quiet" disabled={batch.isPending} onClick={() => { if (window.confirm(`Delete ${selectedSourceIds.length} selected material(s) from every Space? Tombstones remain for audit.`)) batch.mutate('delete') }}><Trash2 size={14} />Delete</button><button className="icon-button" aria-label="Clear selection" onClick={() => setSelectedSourceIds([])}>×</button></aside>}
    {preview && <SourcePreviewDrawer source={preview} spaceId={spaceId} onClose={() => setPreview(null)} />}
  </div>
}
