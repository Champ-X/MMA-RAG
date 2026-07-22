import { ChangeEvent, DragEvent, FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
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
import ReactMarkdown from 'react-markdown'
import { nexusApi, type ConnectorSync, type IngestionJob, type SourceVersion, type UploadResult } from '@/api/nexus'
import { ConfirmDialog } from '@/components/nexus/ConfirmDialog'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { LedgerSelect } from '@/components/nexus/LedgerSelect'
import { MaterialCover } from '@/components/nexus/MaterialCover'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { SegmentedControl } from '@/components/nexus/SegmentedControl'
import { StatusMark } from '@/components/nexus/StatusMark'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { readBrowserStorageItem, removeBrowserStorageItem, writeBrowserStorageItem } from '@/lib/browserStorage'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import {
  buildManualNoteDraftAutosaveBeacon,
  buildManualNoteDraftAutosaveKey,
  buildManualNoteDraftAutosaveNotice,
  buildManualNoteDraftAutosaveRecord,
  buildManualNoteDraftViewModel,
  buildMaterialBatchActionViewModel,
  buildMaterialDeleteActionViewModel,
  buildMaterialLibraryRefreshViewModel,
  buildSourceConnectorImportViewModel,
  buildSourceIntakeReceiptViewModel,
  buildSourceMaterialActionButtonGateViewModel,
  buildSourceMaterialActionViewModel,
  buildSourceTimelineAuditLinkViewModel,
  buildSourceUploadActionViewModel,
  parseRecoverableManualNoteDraftAutosaveRecord,
  type MaterialBatchAction,
  type ManualNoteDraftAutosaveRecord,
  type SourceConnectorKind,
  type SourceConnectorReadiness,
  type SourceMaterialAction,
} from './sourcesPageViewModel'
import './SourcesPage.css'

type ConnectorKind = SourceConnectorKind
type ViewMode = 'grid' | 'list'
const SourcePreviewDrawer = lazy(() => import('@/components/nexus/SourcePreviewDrawer').then((module) => ({
  default: module.SourcePreviewDrawer,
})))

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
const materialViewModeOptions = [
  { value: 'grid', label: 'Grid', detail: 'Show materials as visual cards.' },
  { value: 'list', label: 'List', detail: 'Show materials in a denser row layout.' },
] as const

const urlModeOptions = [
  { value: 'auto', label: 'Auto detect', description: 'Let Nexus inspect page vs file.' },
  { value: 'webpage', label: 'Readable web page', description: 'Preserve article text and links.' },
  { value: 'file', label: 'Original file', description: 'Treat the URL as a downloadable source.' },
]
const newsTopicOptions = [
  { value: 'news', label: 'News', description: 'General news ranking.' },
  { value: 'general', label: 'General', description: 'Broad web results.' },
  { value: 'finance', label: 'Finance', description: 'Financial news and markets.' },
]
const newsRangeOptions = [
  { value: 'day', label: 'Past day', description: 'Freshest results.' },
  { value: 'week', label: 'Past week', description: 'Balanced recency.' },
  { value: 'month', label: 'Past month', description: 'Wider context.' },
  { value: 'year', label: 'Past year', description: 'Long-range background.' },
]
const newsDepthOptions = [
  { value: 'fast', label: 'Fast', description: 'Lowest latency.' },
  { value: 'basic', label: 'Basic', description: 'Standard Tavily search.' },
  { value: 'advanced', label: 'Advanced', description: 'Higher recall.' },
  { value: 'ultra-fast', label: 'Ultra-fast', description: 'Minimal expansion.' },
]
const imageTypeOptions = [
  { value: 'photo', label: 'Photos', description: 'Photographic results.' },
  { value: 'illustration', label: 'Illustrations', description: 'Drawn and rendered images.' },
  { value: 'vector', label: 'Vectors', description: 'Vector-style graphics.' },
  { value: 'all', label: 'All types', description: 'Do not constrain media type.' },
]
const imageOrderOptions = [
  { value: 'relevance', label: 'Relevance', description: 'Best semantic match.' },
  { value: 'popular', label: 'Popular', description: 'Prioritize widely used assets.' },
  { value: 'latest', label: 'Latest', description: 'Newest indexed items.' },
  { value: 'downloads', label: 'Downloads', description: 'Download-count ranking.' },
]

const splitValues = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
const scheduleLabel = (minutes: number) => minutes === 60 ? 'hourly' : minutes === 1440 ? 'daily' : minutes === 10080 ? 'weekly' : `every ${minutes / 60}h`
const materialActionFeedbackId = 'material-action-feedback'
const materialBatchFeedbackId = 'material-batch-feedback'
const materialBatchGateId = (action: MaterialBatchAction) => `${materialBatchFeedbackId}-${action}-gate`
const materialDeleteFeedbackId = 'material-delete-feedback'
const materialDeleteGateId = 'material-delete-gate'
const materialLibraryRefreshFeedbackId = 'material-library-refresh-feedback'
const materialLibraryRefreshGateId = 'material-library-refresh-gate'
const materialActionGateId = (sourceId: string, action: SourceMaterialAction) => `${materialActionFeedbackId}-${sourceId}-${action}-gate`
const sourceImportFeedbackId = 'source-import-feedback'
const sourceImportGateId = 'source-import-gate'
const sourceUploadFeedbackId = 'source-upload-feedback'
const sourceUploadGateId = 'source-upload-gate'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const formatRefreshTimestamp = (timestamp?: number) => timestamp
  ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : undefined

const activeScheduleFor = (source: SourceVersion, spaceId: string | undefined) =>
  (source.sync.schedules ?? []).find((item) => item.space_id === spaceId && item.enabled)

export default function SourcesPage() {
  const { spaceId = '' } = useParams()
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const client = useQueryClient()
  const refreshSources = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['sources', spaceId] }),
      client.invalidateQueries({ queryKey: ['space', spaceId] }),
      client.invalidateQueries({ queryKey: ['spaces'] }),
      client.invalidateQueries({ queryKey: ['space-portrait', spaceId] }),
    ])
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
  const [deleteTarget, setDeleteTarget] = useState<SourceVersion | null>(null)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchActionReceipt, setBatchActionReceipt] = useState<{ action: MaterialBatchAction; affectedCount: number; jobCount?: number } | null>(null)
  const [deleteActionReceipt, setDeleteActionReceipt] = useState<{ sourceName: string } | null>(null)
  const [libraryRefreshState, setLibraryRefreshState] = useState<{ errorMessage?: string; lastSucceededAt?: number; pending: boolean }>({ pending: false })
  const [materialActionReceipt, setMaterialActionReceipt] = useState<{ action: SourceMaterialAction; jobCount: number; sourceName: string } | null>(null)
  const [latestIntake, setLatestIntake] = useState<{
    connectorLabel: string
    items: UploadResult[]
  } | null>(null)
  const [latestIntakeJobs, setLatestIntakeJobs] = useState<IngestionJob[]>([])
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
    setLatestIntakeJobs((current) => {
      let changed = false
      const next = current.map((job) => {
        const update = trackedJobs.data.find((item) => item.id === job.id)
        if (!update || update === job) return job
        changed = true
        return update
      })
      return changed ? next : current
    })
    void refreshSources()
    if (trackedJobs.data.every((job) => ['completed', 'failed', 'cancelled'].includes(job.status))) setTrackedJobIds([])
  }, [refreshSources, trackedJobs.data])

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const results = []
      for (const file of files) results.push(await nexusApi.uploadSource(spaceId, file))
      return results
    },
    onSuccess: (results) => {
      setLatestIntake({ connectorLabel: 'File upload', items: results })
      setLatestIntakeJobs(results.map((item) => item.job))
      trackJobs(results.map((item) => item.job.id))
      refreshSources()
    },
  })
  const remove = useMutation({
    mutationFn: (source: SourceVersion) => nexusApi.deleteSource(source.source_id),
    onMutate: () => setDeleteActionReceipt(null),
    onSuccess: async (_result, source) => {
      setDeleteActionReceipt({ sourceName: source.display_name })
      await refreshSources()
    },
  })
  const batch = useMutation({
    mutationFn: async (action: MaterialBatchAction) => {
      const jobs = []
      const affectedCount = selectedSourceIds.length
      for (const sourceId of selectedSourceIds) {
        if (action === 'reprocess') jobs.push(await nexusApi.reprocessSource(sourceId))
        else await nexusApi.deleteSource(sourceId)
      }
      return { action, affectedCount, jobs }
    },
    onMutate: () => setBatchActionReceipt(null),
    onSuccess: ({ action, affectedCount, jobs }) => {
      setBatchActionReceipt({
        action,
        affectedCount,
        jobCount: jobs.length,
      })
      trackJobs(jobs.map((job) => job.id))
      setSelectedSourceIds([])
      void refreshSources()
    },
  })
  const materialAction = useMutation({
    mutationFn: async ({ action, source }: { action: SourceMaterialAction; source: SourceVersion }) => {
      if (action === 'refresh') {
        const result = await nexusApi.refreshSource(spaceId, source.source_id)
        return result.items.map((item) => item.job)
      }
      if (action === 'retry' && source.latest_job) return [await nexusApi.retryIngestionJob(source.latest_job.id)]
      return [await nexusApi.reprocessSource(source.source_id)]
    },
    onMutate: () => setMaterialActionReceipt(null),
    onSuccess: (jobs, variables) => {
      setMaterialActionReceipt({
        action: variables.action,
        jobCount: jobs.length,
        sourceName: variables.source.display_name,
      })
      trackJobs(jobs.map((job) => job.id))
      void refreshSources()
    },
  })

  const [connectorKind, setConnectorKind] = useState<ConnectorKind>('url')
  const connectorRefs = useRef<Partial<Record<ConnectorKind, HTMLButtonElement | null>>>({})
  const [url, setUrl] = useState('')
  const [urlMode, setUrlMode] = useState<'auto' | 'webpage' | 'file'>('auto')
  const [urlFilename, setUrlFilename] = useState('')
  const [includeLinks, setIncludeLinks] = useState(true)
  const [includeImages, setIncludeImages] = useState(true)
  const [noteTitle, setNoteTitle] = useState('Manual note')
  const [noteContent, setNoteContent] = useState('')
  const [manualNoteAvailableRecord, setManualNoteAvailableRecord] = useState<ManualNoteDraftAutosaveRecord | null>(null)
  const [manualNoteRecoveryRecord, setManualNoteRecoveryRecord] = useState<ManualNoteDraftAutosaveRecord | null>(null)
  const [manualNoteRecoveryDismissed, setManualNoteRecoveryDismissed] = useState(false)
  const [manualNoteAutosaveHydratedSpace, setManualNoteAutosaveHydratedSpace] = useState('')
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
  const manualNoteDraft = buildManualNoteDraftViewModel(noteTitle, noteContent)
  const manualNoteRecovery = manualNoteRecoveryRecord && !manualNoteRecoveryDismissed
    ? {
        notice: buildManualNoteDraftAutosaveNotice(manualNoteRecoveryRecord),
        record: manualNoteRecoveryRecord,
      }
    : null
  const manualNoteRecoveryBeacon = manualNoteAvailableRecord
    ? buildManualNoteDraftAutosaveBeacon(manualNoteAvailableRecord)
    : null

  const clearManualNoteAutosave = useCallback(() => {
    if (!spaceId) return
    removeBrowserStorageItem('session', buildManualNoteDraftAutosaveKey(spaceId))
    setManualNoteAvailableRecord(null)
    setManualNoteRecoveryRecord(null)
    setManualNoteRecoveryDismissed(false)
  }, [spaceId])

  const updateManualNoteDraft = useCallback((nextTitle: string, nextContent: string) => {
    setNoteTitle(nextTitle)
    setNoteContent(nextContent)
    if (!spaceId || manualNoteAutosaveHydratedSpace !== spaceId) return
    const clean = nextTitle === 'Manual note' && !nextContent.trim()
    if (clean) {
      if (!manualNoteRecoveryRecord || manualNoteRecoveryDismissed) setManualNoteAvailableRecord(null)
      return
    }
    setManualNoteAvailableRecord(buildManualNoteDraftAutosaveRecord(spaceId, nextTitle, nextContent))
  }, [manualNoteAutosaveHydratedSpace, manualNoteRecoveryDismissed, manualNoteRecoveryRecord, spaceId])

  useEffect(() => {
    if (!spaceId) return
    const value = readBrowserStorageItem('session', buildManualNoteDraftAutosaveKey(spaceId))
    const record = parseRecoverableManualNoteDraftAutosaveRecord(value, spaceId)
    setManualNoteAvailableRecord(record)
    setManualNoteRecoveryRecord(record)
    setManualNoteRecoveryDismissed(false)
    setManualNoteAutosaveHydratedSpace(spaceId)
  }, [spaceId])

  useEffect(() => {
    if (!spaceId || manualNoteAutosaveHydratedSpace !== spaceId) return
    const clean = noteTitle === 'Manual note' && !noteContent.trim()
    if (clean) {
      if (manualNoteRecoveryRecord && !manualNoteRecoveryDismissed) return
      clearManualNoteAutosave()
      return
    }
    const record = buildManualNoteDraftAutosaveRecord(spaceId, noteTitle, noteContent)
    const stored = writeBrowserStorageItem(
      'session',
      buildManualNoteDraftAutosaveKey(spaceId),
      JSON.stringify(record),
    )
    if (stored) {
      setManualNoteAvailableRecord(record)
    }
  }, [clearManualNoteAutosave, manualNoteAutosaveHydratedSpace, manualNoteRecoveryDismissed, manualNoteRecoveryRecord, noteContent, noteTitle, spaceId])

  const connectorPayload = (): ConnectorSync => {
    if (connectorKind === 'markdown') return { kind: 'markdown', space_id: spaceId, title: noteTitle, content: noteContent }
    if (connectorKind === 'url') return { kind: 'url', space_id: spaceId, url, mode: urlMode, filename: urlFilename || null, include_links: includeLinks, include_images: includeImages }
    if (connectorKind === 'rss') return { kind: 'rss', space_id: spaceId, feed_url: feedUrl, max_entries: maxEntries }
    if (connectorKind === 'folder') return { kind: 'folder', space_id: spaceId, path: folderPath, recursive, extensions: splitValues(extensions), exclude_globs: splitValues(excludeGlobs), max_files: folderLimit }
    if (connectorKind === 'git') return { kind: 'git', space_id: spaceId, repository_url: repositoryUrl, branch: branch || null, subdirectory: subdirectory || null, include_globs: splitValues(includeGlobs), exclude_globs: splitValues(gitExcludeGlobs), max_files: gitLimit }
    if (connectorKind === 'news') return { kind: 'news', space_id: spaceId, query: newsQuery, topic: newsTopic, time_range: newsRange, search_depth: newsDepth, max_results: newsLimit, include_full_content: includeFullContent }
    return { kind: 'image_search', space_id: spaceId, query: imageQuery, source: imageSource, quantity: imageQuantity, image_type: imageType, order: imageOrder, safe_search: safeSearch }
  }

  const connector = useMutation({
    mutationFn: () => nexusApi.syncConnector(connectorPayload()),
    onSuccess: (result) => {
      const connectorLabel = connectorOptions.find((item) => item.kind === connectorKind)?.label ?? connectorKind
      setLatestIntake({ connectorLabel, items: result.items })
      setLatestIntakeJobs(result.items.map((item) => item.job))
      trackJobs(result.items.map((item) => item.job.id))
      if (connectorKind === 'markdown') {
        setNoteTitle('Manual note')
        setNoteContent('')
        clearManualNoteAutosave()
      }
      refreshSources()
    },
  })
  const filteredSources = useMemo(() => (sources.data?.items ?? []).filter((source) => `${source.display_name} ${source.mime_type} ${source.connector_kind}`.toLowerCase().includes(filter.toLowerCase())), [sources.data?.items, filter])
  const sourceIntakeReceipt = latestIntake
    ? buildSourceIntakeReceiptViewModel({
        connectorLabel: latestIntake.connectorLabel,
        jobs: latestIntakeJobs,
        storedCount: latestIntake.items.length,
      })
    : null
  const sourceIntakeAuditLink = sourceIntakeReceipt
    ? buildSourceTimelineAuditLinkViewModel({
        job: sourceIntakeReceipt.primaryJobId
          ? {
              id: sourceIntakeReceipt.primaryJobId,
              status: sourceIntakeReceipt.primaryJobStatus,
            }
          : null,
        sourceName: sourceIntakeReceipt.title,
        spaceId,
      })
    : null
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
  const materialLibraryRefresh = buildMaterialLibraryRefreshViewModel({
    attentionCount: healthCounts.attention,
    errorMessage: libraryRefreshState.errorMessage
      ?? (sources.error ? message(sources.error) : undefined)
      ?? (space.error ? message(space.error) : undefined),
    filteredCount: filteredSources.length,
    filterText: filter,
    lastRefreshLabel: formatRefreshTimestamp(libraryRefreshState.lastSucceededAt),
    pending: libraryRefreshState.pending,
    processingCount: healthCounts.processing,
    totalCount: sources.data?.items.length ?? 0,
  })
  const sourceMaterialAction = buildSourceMaterialActionViewModel({
    action: materialAction.variables?.action ?? materialActionReceipt?.action,
    errorMessage: materialAction.error ? message(materialAction.error) : undefined,
    jobCount: materialActionReceipt?.jobCount,
    pending: materialAction.isPending,
    sourceName: materialAction.variables?.source.display_name ?? materialActionReceipt?.sourceName,
  })
  const materialBatchAction = buildMaterialBatchActionViewModel({
    action: batch.variables ?? batchActionReceipt?.action,
    affectedCount: batchActionReceipt?.affectedCount,
    errorMessage: batch.error ? message(batch.error) : undefined,
    jobCount: batchActionReceipt?.jobCount,
    pending: batch.isPending,
    selectedCount: selectedSourceIds.length,
  })
  const materialDeleteAction = buildMaterialDeleteActionViewModel({
    deletedName: deleteActionReceipt?.sourceName,
    errorMessage: remove.error ? message(remove.error) : undefined,
    pending: remove.isPending,
    sourceName: remove.variables?.display_name,
  })
  const sourceUpload = buildSourceUploadActionViewModel({
    errorMessage: upload.error ? message(upload.error) : undefined,
    fileCount: upload.variables?.length,
    pending: upload.isPending,
  })
  const refreshMaterialLibrary = async () => {
    setLibraryRefreshState((current) => ({ ...current, errorMessage: undefined, pending: true }))
    try {
      await refreshSources()
      setLibraryRefreshState({ lastSucceededAt: Date.now(), pending: false })
    } catch (error) {
      setLibraryRefreshState((current) => ({ ...current, errorMessage: message(error), pending: false }))
    }
  }

  if (space.isLoading || sources.isLoading) return <LoadingState />
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: space.error, hasData: Boolean(space.data), label: 'Space', required: true },
    { error: sources.error, hasData: Boolean(sources.data), label: 'Sources', required: true },
  ])
  const retrySourceQueries = () => {
    void space.refetch()
    void sources.refetch()
  }

  const receiveFiles = (files: FileList | null) => { if (files?.length && sourceUpload.canChoose) upload.mutate(Array.from(files)) }
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => { receiveFiles(event.target.files); event.target.value = '' }
  const dropFiles = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); receiveFiles(event.dataTransfer.files) }
  const syncConnector = (event: FormEvent) => {
    event.preventDefault()
    if (!sourceImport.canSubmit) return
    connector.mutate()
  }
  const selectedConnector = connectorOptions.find((item) => item.kind === connectorKind) ?? connectorOptions[0]
  const SelectedIcon = selectedConnector.icon
  const readiness = (kind: ConnectorKind): SourceConnectorReadiness => {
    if (kind === 'news') return connectorReadiness.news_search_configured ? 'ready' : 'setup'
    if (kind === 'image_search') return connectorReadiness.internet_archive_configured ? 'ready' : 'setup'
    if (kind === 'folder') return connectorReadiness.allowed_folder_roots?.length ? 'ready' : 'setup'
    return 'ready'
  }
  const connectorRequirement = (() => {
    if (connectorKind === 'url') return { label: 'URL', ready: Boolean(url.trim()) }
    if (connectorKind === 'rss') return { label: 'feed URL', ready: Boolean(feedUrl.trim()) }
    if (connectorKind === 'folder') return { label: 'server path', ready: Boolean(folderPath.trim()) }
    if (connectorKind === 'git') return { label: 'repository URL', ready: Boolean(repositoryUrl.trim()) }
    if (connectorKind === 'news') return { label: 'search query', ready: Boolean(newsQuery.trim()) }
    if (connectorKind === 'image_search') return { label: 'search query', ready: Boolean(imageQuery.trim()) }
    return { label: 'manual note draft', ready: manualNoteDraft.canImport }
  })()
  const sourceImport = buildSourceConnectorImportViewModel({
    connectorKind,
    connectorLabel: selectedConnector.label,
    errorMessage: connector.error ? message(connector.error) : undefined,
    manualNote: connectorKind === 'markdown' ? manualNoteDraft : undefined,
    pending: connector.isPending,
    readiness: readiness(connectorKind),
    requiredLabel: connectorRequirement.label,
    requiredReady: connectorRequirement.ready,
  })
  const selectConnectorKind = (nextKind: ConnectorKind) => {
    setConnectorKind(nextKind)
  }
  const handleConnectorKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextKind = moveRadioGroupValue(connectorOptions.map((option) => option.kind), connectorKind, direction)
    selectConnectorKind(nextKind)
    window.requestAnimationFrame(() => connectorRefs.current[nextKind]?.focus({ preventScroll: true }))
  }
  const toggleSelected = (sourceId: string) => setSelectedSourceIds((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId])
  const sourceAction = (source: SourceVersion) => {
    const pending = materialAction.isPending && materialAction.variables?.source.source_id === source.source_id
    const renderAction = (action: SourceMaterialAction, label: string, pendingLabel: string, primary = false, title?: string) => {
      const gate = buildSourceMaterialActionButtonGateViewModel({
        action,
        pending: materialAction.isPending,
        sourceName: source.display_name,
      })
      const gateId = materialActionGateId(source.source_id, action)
      return <>
        <button
          type="button"
          className={`button${primary ? ' primary' : ''}`}
          aria-describedby={`${materialActionFeedbackId}${gate.detail ? ` ${gateId}` : ''}`}
          aria-disabled={gate.ariaDisabled || undefined}
          title={gate.detail ?? title}
          onClick={() => { if (gate.canSubmit) materialAction.mutate({ action, source }) }}
        >
          {action === 'refresh' ? <RefreshCw size={13} /> : <RotateCcw size={13} />}
          {pending ? pendingLabel : label}
        </button>
        {gate.detail && <span className="sr-only" id={gateId}>{gate.detail}</span>}
      </>
    }
    if (source.health.primary_action === 'retry_ingestion' && source.latest_job) return renderAction('retry', 'Retry', 'Retrying...', true)
    if (source.health.primary_action === 'reprocess') return renderAction('reprocess', 'Reparse', 'Reparsing...', true)
    if (source.sync.refreshable) return renderAction('refresh', 'Check upstream', 'Checking...', false, source.sync.scope === 'source_set' ? 'Checks every item in this connected source set.' : 'Checks this upstream location for a new revision.')
    return null
  }

  const renderConnectorFields = () => {
    if (connectorKind === 'url') return <>
      <label className="field-span-2">URL<input type="url" aria-describedby={sourceImportFeedbackId} aria-invalid={connectorKind === 'url' && sourceImport.requiredInvalid ? true : undefined} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article-or-file" required /></label>
      <label>Import mode<LedgerSelect ariaLabel="Import mode" value={urlMode} options={urlModeOptions} onChange={(next) => setUrlMode(next as typeof urlMode)} /></label>
      <label>Saved name <span>optional</span><input value={urlFilename} onChange={(event) => setUrlFilename(event.target.value)} placeholder="Use page title or URL name" /></label>
      <label className="check-field"><input type="checkbox" checked={includeLinks} onChange={(event) => setIncludeLinks(event.target.checked)} />Preserve links</label>
      <label className="check-field"><input type="checkbox" checked={includeImages} onChange={(event) => setIncludeImages(event.target.checked)} />Preserve image references</label>
    </>
    if (connectorKind === 'markdown') return <>
      <section className={`manual-note-composer field-span-2 ${manualNoteDraft.state}`}>
        <header>
          <div>
            <p className="eyebrow">{manualNoteDraft.stateLabel}</p>
            <h4>{manualNoteDraft.title}</h4>
            <p>{manualNoteDraft.detail}</p>
          </div>
          <dl aria-label="Manual note draft checks">
            {manualNoteDraft.signals.map((signal) => (
              <div key={signal.label} aria-label={`${signal.label}: ${signal.value}. ${signal.detail}`}>
                <dt>{signal.label}</dt>
                <dd>{signal.value}</dd>
                <small>{signal.detail}</small>
              </div>
            ))}
          </dl>
        </header>
        {manualNoteRecovery && <div className="manual-note-recovery" role="status">
          <ShieldCheck size={15} />
          <span>
            <strong>{manualNoteRecovery.notice.title}</strong>
            <small>{manualNoteRecovery.notice.detail}</small>
            <em>{manualNoteRecovery.notice.savedLabel}</em>
          </span>
          <div>
            <button className="button" type="button" onClick={() => {
              updateManualNoteDraft(manualNoteRecovery.record.title, manualNoteRecovery.record.content)
              setManualNoteRecoveryDismissed(true)
            }}>{manualNoteRecovery.notice.restoreLabel}</button>
            <button className="button danger-quiet" type="button" onClick={() => {
              updateManualNoteDraft('Manual note', '')
              clearManualNoteAutosave()
            }}>{manualNoteRecovery.notice.discardLabel}</button>
          </div>
        </div>}
        <div className="manual-note-grid">
          <label>Document title<input aria-describedby={sourceImportFeedbackId} aria-invalid={manualNoteDraft.state === 'missing_title' ? true : undefined} value={noteTitle} onChange={(event) => updateManualNoteDraft(event.target.value, noteContent)} required /></label>
          <label>Markdown content<textarea aria-describedby={sourceImportFeedbackId} aria-invalid={manualNoteDraft.state === 'empty' ? true : undefined} value={noteContent} onChange={(event) => updateManualNoteDraft(noteTitle, event.target.value)} placeholder="# A durable note" required /></label>
          <aside className="manual-note-preview" aria-label="Manual note Markdown preview">
            <p className="eyebrow">Live preview</p>
            {manualNoteDraft.previewMarkdown
              ? <ReactMarkdown>{manualNoteDraft.previewMarkdown}</ReactMarkdown>
              : <p className="manual-note-preview-empty">Preview appears after you write Markdown content.</p>}
          </aside>
        </div>
      </section>
    </>
    if (connectorKind === 'rss') return <>
      <label className="field-span-2">Feed URL<input type="url" aria-describedby={sourceImportFeedbackId} aria-invalid={connectorKind === 'rss' && sourceImport.requiredInvalid ? true : undefined} value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://example.com/feed.xml" required /></label>
      <label>Recent entries<input type="number" min={1} max={200} value={maxEntries} onChange={(event) => setMaxEntries(Number(event.target.value))} /></label>
    </>
    if (connectorKind === 'folder') return <>
      <label className="field-span-2">Server path<input aria-describedby={sourceImportFeedbackId} aria-invalid={connectorKind === 'folder' && sourceImport.requiredInvalid ? true : undefined} value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="/imports/project" required /><span>Allowed: {connectorReadiness.allowed_folder_roots?.join(', ') || 'no roots configured'}</span></label>
      <label>Extensions<textarea value={extensions} onChange={(event) => setExtensions(event.target.value)} /></label>
      <label>Exclude patterns<textarea value={excludeGlobs} onChange={(event) => setExcludeGlobs(event.target.value)} /></label>
      <label className="check-field"><input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />Include subfolders</label>
      <label>Maximum files<input type="number" min={1} max={2000} value={folderLimit} onChange={(event) => setFolderLimit(Number(event.target.value))} /></label>
    </>
    if (connectorKind === 'git') return <>
      <label className="field-span-2">Public HTTPS repository<input type="url" aria-describedby={sourceImportFeedbackId} aria-invalid={connectorKind === 'git' && sourceImport.requiredInvalid ? true : undefined} value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/org/repository.git" required /></label>
      <label>Branch <span>optional</span><input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="Default branch" /></label>
      <label>Subdirectory <span>optional</span><input value={subdirectory} onChange={(event) => setSubdirectory(event.target.value)} placeholder="docs/" /></label>
      <label>Include patterns<textarea value={includeGlobs} onChange={(event) => setIncludeGlobs(event.target.value)} /></label>
      <label>Exclude patterns<textarea value={gitExcludeGlobs} onChange={(event) => setGitExcludeGlobs(event.target.value)} /></label>
      <label>Maximum files<input type="number" min={1} max={2000} value={gitLimit} onChange={(event) => setGitLimit(Number(event.target.value))} /></label>
    </>
    if (connectorKind === 'news') return <>
      <label className="field-span-2">Search query<input aria-describedby={sourceImportFeedbackId} aria-invalid={connectorKind === 'news' && sourceImport.requiredInvalid ? true : undefined} value={newsQuery} onChange={(event) => setNewsQuery(event.target.value)} placeholder="AI agent engineering" required /></label>
      <label>Topic<LedgerSelect ariaLabel="News topic" value={newsTopic} options={newsTopicOptions} onChange={(next) => setNewsTopic(next as typeof newsTopic)} /></label>
      <label>Time range<LedgerSelect ariaLabel="News time range" value={newsRange} options={newsRangeOptions} onChange={(next) => setNewsRange(next as typeof newsRange)} /></label>
      <label>Search depth<LedgerSelect ariaLabel="News search depth" value={newsDepth} options={newsDepthOptions} onChange={(next) => setNewsDepth(next as typeof newsDepth)} /></label>
      <label>Maximum results<input type="number" min={1} max={20} value={newsLimit} onChange={(event) => setNewsLimit(Number(event.target.value))} /></label>
      <label className="check-field field-span-2"><input type="checkbox" checked={includeFullContent} onChange={(event) => setIncludeFullContent(event.target.checked)} />Request full article content when Tavily can provide it</label>
    </>
    const imageSourceOptions = [
      { value: 'internet_archive', label: 'Internet Archive', description: 'No API key required.' },
      { value: 'google_images', label: 'Google Images', description: connectorReadiness.google_images_configured ? 'SerpAPI configured.' : 'SerpAPI not configured.', disabled: !connectorReadiness.google_images_configured },
      { value: 'pixabay', label: 'Pixabay', description: connectorReadiness.pixabay_configured ? 'Pixabay configured.' : 'Pixabay not configured.', disabled: !connectorReadiness.pixabay_configured },
    ]
    return <>
      <label className="field-span-2">Search query<input aria-describedby={sourceImportFeedbackId} aria-invalid={connectorKind === 'image_search' && sourceImport.requiredInvalid ? true : undefined} value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} placeholder="industrial design references" required /></label>
      <label>Provider<LedgerSelect ariaLabel="Image provider" value={imageSource} options={imageSourceOptions} onChange={(next) => setImageSource(next as typeof imageSource)} /></label>
      <label>Quantity<input type="number" min={1} max={20} value={imageQuantity} onChange={(event) => setImageQuantity(Number(event.target.value))} /></label>
      <label>Image type<LedgerSelect ariaLabel="Image type" value={imageType} options={imageTypeOptions} onChange={(next) => setImageType(next as typeof imageType)} /></label>
      <label>Order<LedgerSelect ariaLabel="Image order" value={imageOrder} options={imageOrderOptions} onChange={(next) => setImageOrder(next as typeof imageOrder)} /></label>
      <label className="check-field field-span-2"><input type="checkbox" checked={safeSearch} onChange={(event) => setSafeSearch(event.target.checked)} />Safe search</label>
    </>
  }

  return <div className="page-shell sources-workbench">
    <PageHeader eyebrow={`Space · ${space.data?.name ?? 'Sources'}`} title="Materials" description="Add originals, configure live sources, and inspect every published material from one traceable register." actions={queryErrorNotice.tone === 'blocking' ? undefined : <><input ref={fileInput} type="file" multiple hidden accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.md,.markdown,.txt,.csv,.xls,.xlsx,.xlsm" onChange={chooseFile} /><input ref={folderInput} type="file" multiple hidden onChange={chooseFile} {...({ webkitdirectory: '' } as Record<string, string>)} /><button type="button" className="button" aria-describedby={`${sourceUploadFeedbackId}${sourceUpload.disabledDetail ? ` ${sourceUploadGateId}` : ''}`} aria-disabled={sourceUpload.ariaDisabled || undefined} onClick={() => { if (sourceUpload.canChoose) folderInput.current?.click() }}><FolderOpen size={16} />Upload folder</button><button type="button" className="button primary" aria-describedby={`${sourceUploadFeedbackId}${sourceUpload.disabledDetail ? ` ${sourceUploadGateId}` : ''}`} aria-disabled={sourceUpload.ariaDisabled || undefined} onClick={() => { if (sourceUpload.canChoose) fileInput.current?.click() }}><FileUp size={16} />Add files</button>{sourceUpload.disabledDetail && <span className="sr-only" id={sourceUploadGateId}>{sourceUpload.disabledDetail}</span>}</>} />
    <QueryErrorNotice model={queryErrorNotice} onRetry={retrySourceQueries} />
    {queryErrorNotice.tone === 'blocking' ? (
      <EmptyState title="Materials could not be loaded" body="Nexus could not verify this Space or its retained Source register. Retry before uploading replacement files or treating the library as empty." />
    ) : <>

    <section className="ingestion-console">
      <div className="ingestion-direct">
        <header><div><p className="eyebrow">Direct intake</p><h2>Store the original first.</h2><p>Mixed media enters one durable pipeline; parsing and enrichment remain independently observable.</p></div><ShieldCheck size={22} /></header>
        <div className={`source-drop-zone${dragging ? ' dragging' : ''}`} aria-describedby={sourceUploadFeedbackId} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={dropFiles}>
          <span><UploadCloud size={25} /></span><div><strong>{sourceUpload.dropzoneLabel}</strong><small>{sourceUpload.dropzoneDetail}</small></div><button type="button" className="text-button" aria-describedby={`${sourceUploadFeedbackId}${sourceUpload.disabledDetail ? ` ${sourceUploadGateId}` : ''}`} aria-disabled={sourceUpload.ariaDisabled || undefined} onClick={() => { if (sourceUpload.canChoose) fileInput.current?.click() }}>{sourceUpload.browseLabel} <ChevronRight size={13} /></button>
        </div>
        <SubmitReadinessCard className="source-upload-feedback" detail={sourceUpload.feedbackDetail} id={sourceUploadFeedbackId} label={sourceUpload.feedbackLabel} liveMode={sourceUpload.liveMode} pending={sourceUpload.feedbackTone === 'pending'} role={sourceUpload.role} tone={sourceUpload.feedbackTone} />
      </div>

      <div className="source-contracts" role="radiogroup" aria-label="Source connector type">
        <div className="source-contract-group"><p>Quick import</p><div>{connectorOptions.filter((item) => item.group === 'direct').map(({ kind, label, description, icon: Icon }) => {
          const draftBeacon = kind === 'markdown' ? manualNoteRecoveryBeacon : null
          return <button
            key={kind}
            type="button"
            ref={(node) => { connectorRefs.current[kind] = node }}
            role="radio"
            aria-checked={connectorKind === kind}
            aria-label={draftBeacon ? `${label}: ${description} ${draftBeacon.ariaLabel}` : undefined}
            tabIndex={connectorKind === kind ? 0 : -1}
            className={connectorKind === kind ? 'selected' : ''}
            title={draftBeacon?.detail}
            onKeyDown={handleConnectorKeyDown}
            onClick={() => selectConnectorKind(kind)}
          >
            <Icon />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
              {draftBeacon && <em className="source-draft-chip">{draftBeacon.label}</em>}
            </span>
            <ChevronRight />
          </button>
        })}</div></div>
        <div className="source-contract-group"><p>Connected sources</p><div>{connectorOptions.filter((item) => item.group === 'connected').map(({ kind, label, description, icon: Icon }) => <button key={kind} type="button" ref={(node) => { connectorRefs.current[kind] = node }} role="radio" aria-checked={connectorKind === kind} tabIndex={connectorKind === kind ? 0 : -1} className={connectorKind === kind ? 'selected' : ''} onKeyDown={handleConnectorKeyDown} onClick={() => selectConnectorKind(kind)}><Icon /><span><strong>{label}</strong><small>{description}</small></span><em className={`contract-readiness ${readiness(kind)}`}>{readiness(kind) === 'ready' ? 'available' : 'setup'}</em></button>)}</div></div>
      </div>

      <form className="connector-contract-sheet" onSubmit={syncConnector}>
        <header><span><SelectedIcon /></span><div><p className="eyebrow">Source contract</p><h3>{selectedConnector.label}</h3><p>{selectedConnector.description}</p></div><em>{connectorKind.replace('_', ' ')}</em></header>
        <div className="connector-fields">{renderConnectorFields()}</div>
        <SubmitReadinessCard className="source-import-feedback" detail={sourceImport.feedbackDetail} id={sourceImportFeedbackId} label={sourceImport.feedbackLabel} liveMode={sourceImport.liveMode} pending={sourceImport.feedbackTone === 'pending'} role={sourceImport.role} tone={sourceImport.feedbackTone} />
        <footer><span><CheckCircle2 /> Original bytes and source metadata are retained before parsing.</span><button type="submit" className="button primary" aria-describedby={`${sourceImportFeedbackId}${sourceImport.disabledDetail ? ` ${sourceImportGateId}` : ''}`} aria-disabled={sourceImport.ariaDisabled || undefined}>{sourceImport.submitLabel}</button>{sourceImport.disabledDetail && <span className="sr-only" id={sourceImportGateId}>{sourceImport.disabledDetail}</span>}</footer>
      </form>

      {sourceIntakeReceipt && <div className="intake-feedback">
        {sourceIntakeReceipt && <section className={`source-intake-receipt ${sourceIntakeReceipt.tone}`} role="status" aria-label={sourceIntakeReceipt.ariaLabel}>
          <span>{sourceIntakeReceipt.tone === 'failed' ? <AlertTriangle /> : sourceIntakeReceipt.tone === 'active' ? <RefreshCw className="spin" /> : <ShieldCheck />}</span>
          <div>
            <p className="eyebrow">{sourceIntakeReceipt.statusLabel}</p>
            <h3>{sourceIntakeReceipt.title}</h3>
            <p>{sourceIntakeReceipt.detail}</p>
          </div>
          <dl>
            {sourceIntakeReceipt.metrics.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>
            ))}
          </dl>
          {sourceIntakeAuditLink && <Link className="button" aria-label={sourceIntakeAuditLink.ariaLabel} title={sourceIntakeAuditLink.detail} to={sourceIntakeAuditLink.href}>
            {sourceIntakeAuditLink.label} <ChevronRight size={13} />
          </Link>}
        </section>}
      </div>}
    </section>

    <section className="panel source-register">
      <div className="library-toolbar"><div><p className="eyebrow">Material library</p><h2>{sources.data?.items.length ?? 0} originals</h2></div><label><Search size={15} /><input aria-label="Search materials" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search name, type or source…" /></label><SegmentedControl ariaLabel="Material view mode" className="view-switch" options={materialViewModeOptions} value={viewMode} onChange={setViewMode} /><div className="material-refresh-actions"><button type="button" className="text-button" aria-describedby={`${materialLibraryRefreshFeedbackId}${materialLibraryRefresh.disabledDetail ? ` ${materialLibraryRefreshGateId}` : ''}`} aria-disabled={materialLibraryRefresh.ariaDisabled || undefined} onClick={() => { if (materialLibraryRefresh.canRefresh) void refreshMaterialLibrary() }}><RefreshCw className={materialLibraryRefresh.feedbackTone === 'pending' ? 'spin' : undefined} size={14} />{materialLibraryRefresh.submitLabel}</button>{materialLibraryRefresh.disabledDetail && <span className="sr-only" id={materialLibraryRefreshGateId}>{materialLibraryRefresh.disabledDetail}</span>}<SubmitReadinessCard className="material-refresh-feedback" detail={materialLibraryRefresh.feedbackDetail} id={materialLibraryRefreshFeedbackId} label={materialLibraryRefresh.feedbackLabel} liveMode={materialLibraryRefresh.liveMode} pending={materialLibraryRefresh.feedbackTone === 'pending'} role={materialLibraryRefresh.role} tone={materialLibraryRefresh.feedbackTone} /></div></div>
      <div className="source-health-ribbon" aria-label="Material health summary">
        <span className="positive"><SearchCheck /><strong>{healthCounts.searchable}</strong><small>searchable</small></span>
        <span><CheckCircle2 /><strong>{healthCounts.ready}</strong><small>fully ready</small></span>
        <span className={healthCounts.attention ? 'warning' : ''}><AlertTriangle /><strong>{healthCounts.attention}</strong><small>need attention</small></span>
        <span><Clock3 /><strong>{healthCounts.processing}</strong><small>processing</small></span>
        {healthCounts.exactOnly > 0 && <span className="exact"><Search /><strong>{healthCounts.exactOnly}</strong><small>exact-only</small></span>}
      </div>
      <SubmitReadinessCard className="material-action-feedback" detail={sourceMaterialAction.feedbackDetail} id={materialActionFeedbackId} label={sourceMaterialAction.feedbackLabel} liveMode={sourceMaterialAction.liveMode} pending={sourceMaterialAction.feedbackTone === 'pending'} role={sourceMaterialAction.role} tone={sourceMaterialAction.feedbackTone} visible={sourceMaterialAction.visible} />
      <SubmitReadinessCard className="material-batch-feedback" detail={materialBatchAction.feedbackDetail} id={materialBatchFeedbackId} label={materialBatchAction.feedbackLabel} liveMode={materialBatchAction.liveMode} pending={materialBatchAction.feedbackTone === 'pending'} role={materialBatchAction.role} tone={materialBatchAction.feedbackTone} visible={materialBatchAction.visible} />
      <SubmitReadinessCard className="material-delete-feedback" detail={materialDeleteAction.feedbackDetail} id={materialDeleteFeedbackId} label={materialDeleteAction.feedbackLabel} liveMode={materialDeleteAction.liveMode} pending={materialDeleteAction.feedbackTone === 'pending'} role={materialDeleteAction.role} tone={materialDeleteAction.feedbackTone} visible={materialDeleteAction.visible} />
      {filteredSources.length ? <div className={`material-register-grid ${viewMode}`}>{filteredSources.map((source) => {
        const auditLink = source.latest_job
          ? buildSourceTimelineAuditLinkViewModel({
              job: source.latest_job,
              sourceName: source.display_name,
              spaceId,
            })
          : null
        return <article key={source.id} className={selectedSourceIds.includes(source.source_id) ? 'selected' : ''}>
          <button type="button" className="material-select" aria-label={`${selectedSourceIds.includes(source.source_id) ? 'Deselect' : 'Select'} ${source.display_name}`} onClick={() => toggleSelected(source.source_id)}>{selectedSourceIds.includes(source.source_id) ? <CheckSquare2 /> : <Square />}</button>
          <button type="button" className="material-open" onClick={() => setPreview(source)}><MaterialCover source={source} compact={viewMode === 'list'} /><span className="material-copy"><span className="material-title-row"><strong>{source.display_name}</strong><StatusMark status={source.status} /></span><small>{source.connector_kind.replace('_', ' ')} · {source.mime_type}</small><span><code>{source.modality}</code>{source.derived_image_count > 0 && <em>{source.derived_image_count} visuals</em>}<em>{source.published_evidence_count} evidence</em><em>{formatBytes(source.byte_size)}</em><em>{formatDate(source.created_at)}</em><em>v{source.version_no}</em>{activeScheduleFor(source, spaceId) && <em className="sync-schedule-chip">auto · {scheduleLabel(activeScheduleFor(source, spaceId)!.interval_minutes)}</em>}</span><span className={`material-health health-${source.health.severity}`}>{source.health.severity === 'positive' ? <CheckCircle2 /> : source.health.severity === 'neutral' ? <Clock3 /> : <AlertTriangle />}<small>{source.health.summary}</small></span></span></button>
          <div className="material-card-actions">{auditLink && <Link className="text-button material-audit-link" aria-label={auditLink.ariaLabel} title={auditLink.detail} to={auditLink.href}><Clock3 size={13} />{auditLink.label}</Link>}{sourceAction(source)}<button type="button" className="icon-button danger-quiet" title={materialDeleteAction.disabledDetail ?? 'Delete material'} aria-label={`Delete ${source.display_name}`} aria-describedby={`${materialDeleteFeedbackId}${materialDeleteAction.disabledDetail ? ` ${materialDeleteGateId}` : ''}`} aria-disabled={materialDeleteAction.ariaDisabled || undefined} onClick={() => { if (materialDeleteAction.canDelete) setDeleteTarget(source) }}><Trash2 size={15} /></button>{materialDeleteAction.disabledDetail && <span className="sr-only" id={materialDeleteGateId}>{materialDeleteAction.disabledDetail}</span>}</div>
        </article>
      })}</div> : <EmptyState title={filter ? 'No matching materials' : 'Add a Source without losing the original'} body={filter ? 'Try another name, MIME type, or connector.' : 'Every import is stored before parsing, so it stays recoverable even when an enrichment capability is unavailable.'} action={!filter ? <button type="button" className="button" onClick={() => fileInput.current?.click()}><FileUp size={16} />Choose files</button> : undefined} />}
    </section>
    {selectedSourceIds.length > 0 && <aside className="material-batch-bar" aria-describedby={materialBatchFeedbackId}><span aria-label={materialBatchAction.selectionLabel}><CheckSquare2 /><strong>{selectedSourceIds.length}</strong><small>{selectedSourceIds.length === 1 ? ' material selected' : ' materials selected'}</small></span><button type="button" className="text-button" onClick={() => setSelectedSourceIds(filteredSources.map((source) => source.source_id))}>Select visible</button><button type="button" className="button" aria-describedby={`${materialBatchFeedbackId}${materialBatchAction.reprocessDisabledDetail ? ` ${materialBatchGateId('reprocess')}` : ''}`} aria-disabled={materialBatchAction.reprocessAriaDisabled || undefined} onClick={() => { if (materialBatchAction.canReprocess) batch.mutate('reprocess') }}><RotateCcw size={14} />{materialBatchAction.reprocessLabel}</button><button type="button" className="button danger-quiet" aria-describedby={`${materialBatchFeedbackId}${materialBatchAction.deleteDisabledDetail ? ` ${materialBatchGateId('delete')}` : ''}`} aria-disabled={materialBatchAction.deleteAriaDisabled || undefined} onClick={() => { if (materialBatchAction.canDelete) setBatchDeleteOpen(true) }}><Trash2 size={14} />{materialBatchAction.deleteLabel}</button><button type="button" className="icon-button" aria-label="Clear selection" onClick={() => setSelectedSourceIds([])}>×</button>{materialBatchAction.reprocessDisabledDetail && <span className="sr-only" id={materialBatchGateId('reprocess')}>{materialBatchAction.reprocessDisabledDetail}</span>}{materialBatchAction.deleteDisabledDetail && <span className="sr-only" id={materialBatchGateId('delete')}>{materialBatchAction.deleteDisabledDetail}</span>}</aside>}
    {preview && <Suspense fallback={<LoadingState label="Opening material preview" />}><SourcePreviewDrawer source={preview} spaceId={spaceId} onClose={() => setPreview(null)} /></Suspense>}
    <ConfirmDialog
      open={Boolean(deleteTarget)}
      title={deleteTarget ? `Delete ${deleteTarget.display_name}?` : 'Delete material?'}
      body="This removes the material from every Space and clears retrieval projections. The tombstone remains in the audit ledger."
      confirmLabel="Delete material"
      busy={remove.isPending}
      onCancel={() => setDeleteTarget(null)}
      onConfirm={() => { if (deleteTarget) remove.mutate(deleteTarget); setDeleteTarget(null) }}
    />
    <ConfirmDialog
      open={batchDeleteOpen}
      title={`Delete ${selectedSourceIds.length} selected material${selectedSourceIds.length === 1 ? '' : 's'}?`}
      body="Selected materials will be removed from every Space. Tombstones remain for audit and existing Run snapshots keep their historical references."
      confirmLabel="Delete selected"
      busy={batch.isPending}
      onCancel={() => setBatchDeleteOpen(false)}
      onConfirm={() => { batch.mutate('delete'); setBatchDeleteOpen(false) }}
    />
    </>}
  </div>
}
