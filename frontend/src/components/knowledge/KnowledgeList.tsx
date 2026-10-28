import { translate as t, useTranslation, getLanguage } from '@/i18n'

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { Plus, Upload, Search, Trash2, FileText, Image as ImageIcon, X, Pencil, Link2, ImagePlus, Loader2, FolderOpen, Layers, Zap, Newspaper, Play, Music, Video, Eye, LayoutGrid, List, ChevronDown, ChevronRight, AlertCircle, RotateCcw } from 'lucide-react'
import { UploadPipeline, type UploadPipelineProgress, type UploadFileProgress } from './UploadPipeline'
import { UploadSourceGlyph } from './UploadSourceGlyph'
import { KnowledgeLibraryHeader } from './KnowledgeLibraryHeader'
import { KnowledgeSpaceCard } from './KnowledgeSpaceCard'
import { getKnowledgeDefaultCover } from './knowledgeDefaultCover'
import { KnowledgeLibraryEmpty } from './KnowledgeLibraryEmpty'
import { KnowledgeDetailHeader } from './KnowledgeDetailHeader'
import { KnowledgeDetailNavigation, type KnowledgeDetailSection } from './KnowledgeDetailNavigation'
import { FilePreviewNavigation, handleFilePreviewArrow, type FilePreviewNavigationProps } from './FilePreviewNavigation'
import { AudioPreviewPlayer } from '@/components/ui/AudioPreviewPlayer'
import { KnowledgeContentOverview } from './KnowledgeContentOverview'
import { KnowledgeFileEmptyState } from './KnowledgeFileEmptyState'
import { getKnowledgeFileKind, KNOWLEDGE_FILE_FILTERS, type KnowledgeFileFilter } from './knowledgeFileKinds'
import { VideoFileCover } from './VideoFileCover'
import { canRetryDocumentUpload, canRetryStoredUpload, canRetryVideoFromPreview, isUploadSourceUnavailable, readableUploadError, uploadFailureCopy, uploadFailureFields, uploadFailureKeys } from './uploadFailure'
import type { UploadFailureFields } from '@/types/upload'
import './knowledgeFileList.css'
import './filePreviewModal.css'
import { useKnowledgeUploadBatches, emptyUploadBatch, type KnowledgeUploadBatch, type UploadRemoval } from './useKnowledgeUploadBatches'
import './importDialogs.css'
import { WorkflowDialog } from '@/components/ui/WorkflowDialog'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import {
  knowledgeApi,
  importApi,
  type ImportUrlKind,
  type ImportUrlMode,
} from '@/services/api_client'
import { cn } from '@/lib/utils'
import {
  StatusBadge,
  FileThumb,
  FileHero,
  FileIcon,
  CreateKbModal,
  EditKbModal,
  isAudioType,
  isVideoType,
  type KnowledgeFileView,
} from './KnowledgeListHelpers'

const ManualInputModal = React.lazy(() => import('./ManualInputModal'))
const ExcelPreview = React.lazy(() =>
  import('./ExcelPreview').then((module) => ({ default: module.ExcelPreview }))
)
function formatFileDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(getLanguage())
}

const PortraitGraph = React.lazy(() =>
  import('./PortraitGraph').then((module) => ({ default: module.PortraitGraph }))
)
const KnowledgeMarkdownPreview = React.lazy(() =>
  import('./KnowledgeMarkdownPreview').then((module) => ({ default: module.KnowledgeMarkdownPreview }))
)

/** 预览区 / 分块区加载占位：居中、旋转指示与骨架，避免大片空白只有一行字 */
function PreviewPaneLoading({
  title,
  hint,
  variant,
}: {
  title: string
  hint?: string
  variant: 'document' | 'chunks'
}) {
  useTranslation()
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 dark:border-slate-800',
        'bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950',
        'flex flex-col items-center justify-center px-6 py-10',
        'min-h-[min(60vh,22rem)]'
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="relative mb-5 flex h-14 w-14 items-center justify-center">
        <span
          className="absolute inset-0 rounded-full bg-indigo-500/[0.12] dark:bg-indigo-400/10 animate-ping"
          style={{ animationDuration: '2s' }}
        />
        <span className="absolute inset-1 rounded-full border border-indigo-200/60 dark:border-indigo-500/25" />
        <Loader2 className="relative h-7 w-7 text-indigo-600 dark:text-indigo-400 animate-spin" aria-hidden />
      </div>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 text-center">{title}</p>
      {hint ? (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 text-center max-w-xs leading-relaxed">{hint}</p>
      ) : null}

      {variant === 'document' ? (
        <div className="mt-8 w-full max-w-sm space-y-3 opacity-90">
          <div className="relative h-36 rounded-lg bg-slate-200/70 dark:bg-slate-800/80 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/45 dark:via-white/10 to-transparent animate-shimmer"
              aria-hidden
            />
          </div>
          <div className="space-y-2 px-1">
            <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-700/80 animate-pulse w-[88%] mx-auto" />
            <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-700/80 animate-pulse w-[72%] mx-auto" />
            <div className="h-2 rounded-full bg-slate-200/60 dark:bg-slate-700/60 animate-pulse w-[56%] mx-auto" />
          </div>
        </div>
      ) : (
        <div className="mt-8 w-full max-w-md space-y-3">
          {[92, 100, 78, 88, 64].map((pct, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="mt-0.5 h-6 w-8 shrink-0 rounded-md bg-slate-200/90 dark:bg-slate-700/90 animate-pulse" />
              <div
                className="h-2.5 rounded-full bg-slate-200/80 dark:bg-slate-700/80 animate-pulse"
                style={{ width: `${pct}%`, animationDelay: `${i * 120}ms` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PortraitGraphLoading() {
  useTranslation()
  return (
    <div className="rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 px-6 py-10 text-center shadow-sm ring-1 ring-slate-100/80 dark:border-slate-800 dark:from-slate-950 dark:to-slate-900 dark:ring-slate-800/60">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-sm dark:bg-indigo-950/40 dark:text-indigo-300">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("正在载入知识库画像")}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("画像图表会在组件加载后继续使用当前知识库统计数据。")}</p>
    </div>
  )
}

/** 图片 / 音频 / 视频 共用的描述卡片：标题条 + 正文区层次 */
function MediaDescriptionPanel({
  title,
  icon: Icon,
  loading,
  hasContent,
  empty,
  children,
}: {
  title: string
  icon: React.ElementType
  loading: boolean
  hasContent: boolean
  empty: React.ReactNode
  children: React.ReactNode
}) {
  useTranslation()
  return (
    <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 overflow-hidden bg-gradient-to-b from-white via-slate-50/35 to-slate-50/95 dark:from-slate-900 dark:via-slate-950/90 dark:to-slate-950 shadow-sm ring-1 ring-slate-100/70 dark:ring-slate-800/80">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100/90 dark:border-slate-800 bg-gradient-to-r from-indigo-50/70 via-slate-50/90 to-transparent dark:from-indigo-950/35 dark:via-slate-900 dark:to-transparent">
        <Icon
          className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400 opacity-90"
          strokeWidth={2.25}
          aria-hidden
        />
        <span className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">{title}</span>
      </div>
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {loading ? (
          <div className="flex items-center gap-2.5 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500 dark:text-indigo-400" aria-hidden />
            <span>{t("加载描述中…")}</span>
          </div>
        ) : hasContent ? (
          <div className="space-y-4 text-sm text-slate-700 dark:text-slate-200 leading-[1.7]">{children}</div>
        ) : (
          empty
        )}
      </div>
    </div>
  )
}

function KnowledgeEmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'slate',
  compact = false,
}: {
  icon: React.ElementType
  title: string
  description: string
  action?: React.ReactNode
  tone?: 'slate' | 'indigo' | 'amber'
  compact?: boolean
}) {
  useTranslation()
  const toneClass = {
    slate: {
      icon: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
      glow: 'bg-slate-200/60 dark:bg-slate-700/30',
    },
    indigo: {
      icon: 'border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-300',
      glow: 'bg-indigo-200/50 dark:bg-indigo-500/15',
    },
    amber: {
      icon: 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300',
      glow: 'bg-amber-200/50 dark:bg-amber-500/15',
    },
  }[tone]

  return (
    <div
      className={cn(
        'relative mx-auto flex max-w-lg flex-col items-center overflow-hidden rounded-[1.75rem] border border-slate-200/75 bg-white/90 text-center shadow-[0_22px_52px_-40px_rgba(15,23,42,0.72)] ring-1 ring-white/70 backdrop-blur-sm dark:border-slate-800/75 dark:bg-slate-950/60 dark:ring-white/[0.04]',
        compact ? 'px-6 py-8' : 'px-8 py-12'
      )}
    >
      <div className={cn('pointer-events-none absolute -top-16 h-36 w-36 rounded-full blur-3xl', toneClass.glow)} />
      <div className="relative">
        <span className={cn('flex items-center justify-center rounded-2xl border shadow-sm', compact ? 'h-12 w-12' : 'h-14 w-14', toneClass.icon)}>
          <Icon className={compact ? 'h-5 w-5' : 'h-6 w-6'} strokeWidth={2.2} aria-hidden />
        </span>
      </div>
      <h3 className="relative mt-5 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
        {title}
      </h3>
      <p className="relative mt-2 max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {description}
      </p>
      {action ? <div className="relative mt-5">{action}</div> : null}
    </div>
  )
}

function FileListLoadingState({ knowledgeBaseName }: { knowledgeBaseName: string }) {
  useTranslation()
  return (
    <div
      className="flex min-h-[14rem] flex-col items-center justify-center px-6 text-center"
      role="status"
      aria-live="polite"
      aria-label={t("正在加载 {{knowledgeBaseName}} 的文件列表", { knowledgeBaseName: knowledgeBaseName })}
    >
      <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-sm dark:border-indigo-500/20 dark:bg-indigo-950/35 dark:text-indigo-300">
        <span className="absolute inset-0 rounded-2xl border border-indigo-300/50 animate-ping dark:border-indigo-400/20" aria-hidden />
        <Loader2 className="relative h-5 w-5 animate-spin" aria-hidden />
      </span>
      <p className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">{t("正在读取文件清单")}</p>
      <p className="mt-1.5 max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">{t("已切换到「")}{knowledgeBaseName}{t("」，上一知识库的内容不会继续显示。")}</p>
    </div>
  )
}

type FilePreviewDetails = {
  caption?: string
  chunks?: Array<{ index: number; text: string }>
  text_preview?: string
  transcript?: string
  description?: string
  editable?: boolean
  source_type?: string | null
}

type ManualInputDraft = {
  mode: 'create' | 'edit'
  fileId?: string
  initialFilename: string
  initialContent: string
}

type KnowledgeFileApiItem = UploadFailureFields & {
  id: string
  name: string
  size: number
  date: string
  type: string
  status?: string
  processing_id?: string
  stage?: string
  progress?: number
  message?: string
  error?: string
  updated_at?: string
  thumbnail_url?: string
  preview_url?: string
  cover_url?: string
  cover_timestamp?: number
  text_preview?: string
}

type DirectoryPickerFileHandle = FileSystemFileHandle & { kind: 'file' }
type DirectoryPickerDirectoryHandle = FileSystemDirectoryHandle & {
  kind: 'directory'
  values(): AsyncIterable<DirectoryPickerEntryHandle>
}
type DirectoryPickerEntryHandle = DirectoryPickerFileHandle | DirectoryPickerDirectoryHandle
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<DirectoryPickerDirectoryHandle>
}

type ApiErrorDetail = string | { msg?: string; message?: string } | null | undefined

type BackgroundUploadTask = {
  processingId: string
  filename: string
  isImage: boolean
  kbId: string
  fileId?: string
}

type BackgroundUploadTaskOutcome = 'completed' | 'failed'
type UploadProgressStatus = Awaited<ReturnType<typeof knowledgeApi.getUploadProgress>>
type BackgroundTaskPollResult = {
  task: BackgroundUploadTask
  status: UploadProgressStatus | null
  terminal?: BackgroundUploadTaskOutcome
  deleted?: boolean
  error?: string
  /** 仅代表暂时无法读取进度，不能把实际后台任务误判为失败。 */
  transient?: boolean
  retryDelayMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null
}

function getErrorMessage(error: unknown, fallback: string) {
  const detail = isRecord(error)
    && isRecord(error.response)
    && isRecord(error.response.data)
    ? (error.response.data.detail as ApiErrorDetail)
    : undefined
  if (typeof detail === 'string') return detail
  if (detail && typeof detail.message === 'string') return detail.message
  if (detail && typeof detail.msg === 'string') return detail.msg
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return fallback
}

function getErrorHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.response)) return undefined
  const status = error.response.status
  return typeof status === 'number' ? status : undefined
}

function normalizeProgress(value: unknown): number | undefined {
  const progress = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(progress)) return undefined
  return Math.max(0, Math.min(100, progress))
}

function isPendingFileStatus(status?: string): boolean {
  const normalized = String(status || '').toLowerCase()
  return normalized === 'queued' || normalized === 'processing'
}

function serviceTimestamp(value?: string): number {
  if (!value) return NaN
  // Upload task dates without an offset are UTC, just like their explicit-Z equivalents.
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`)
}

function isOlderServiceSnapshot(incoming?: string, current?: string): boolean {
  const incomingTime = serviceTimestamp(incoming)
  const currentTime = serviceTimestamp(current)
  return Number.isFinite(incomingTime) && Number.isFinite(currentTime) && incomingTime < currentTime
}

function isImageFileType(type?: string): boolean {
  const normalized = String(type || '').toLowerCase()
  return normalized.startsWith('image/')
    || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif'].includes(normalized)
}

function toPipelineStage(stage?: string): UploadPipelineProgress['stage'] {
  const normalized = String(stage || '').toLowerCase()
  if (['vectorizing', 'extracting_keyframes', 'embedding_keyframes', 'vectorizing_keyframes', 'dense_embedding', 'sparse_embedding'].includes(normalized)) return 'vectorizing'
  if (['storing', 'indexing', 'completed'].includes(normalized)) return 'portrait'
  if (['initializing', 'uploading', 'queued', 'fetching', 'reading_source'].includes(normalized)) return 'minio'
  if (['preparing_video', 'preparing_segment', 'parsing_segment'].includes(normalized)) return 'parsing'
  return 'parsing'
}

function getErrorName(error: unknown) {
  return isRecord(error) && typeof error.name === 'string' ? error.name : undefined
}

function getDirectoryPicker() {
  if (typeof window === 'undefined') return undefined
  return (window as DirectoryPickerWindow).showDirectoryPicker
}

/** The media stage exists before decoding, so an image cannot resize the reader. */
function FilePreviewImage({ src, name }: { src: string; name: string }) {
  const imageRef = React.useRef<HTMLImageElement>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'failed'>('loading')
  React.useLayoutEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) setState('ready')
  }, [src])
  return <div className="file-preview-media-stage" data-state={state} aria-busy={state === 'loading'}>
    <img ref={imageRef} src={src} alt={name} onLoad={() => setState('ready')} onError={() => setState('failed')} />
    {state !== 'ready' && <div className="file-preview-media-stage__placeholder" role="status">
      {state === 'loading' ? <Loader2 size={22} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ImageIcon size={26} aria-hidden />}
      <span>{t(state === 'loading' ? '加载预览中…' : '图片预览暂不可用')}</span>
    </div>}
  </div>
}

// 文件预览模态框（支持图片描述、文档分块、MD 预览）
function FilePreviewModal({
  file,
  kbId,
  onClose,
  onDelete,
  onEdit,
  onRetryFile,
  deleteError,
  navigation,
}: {
  navigation?: FilePreviewNavigationProps
  file: KnowledgeFileView
  kbId: string | null
  onClose: () => void
  onDelete: () => void
  onEdit?: (payload: { fileId: string; filename: string; content: string }) => void
  /** 可恢复任务复用已保存原文件，不要求用户再次选择本地文件。 */
  onRetryFile?: () => Promise<void>
  deleteError?: string
}) {
  useTranslation()
  const [tab, setTab] = React.useState<'preview' | 'chunks'>('preview')
  const previewTabRefs = React.useRef<Record<'preview' | 'chunks', HTMLButtonElement | null>>({
    preview: null,
    chunks: null,
  })
  const [details, setDetails] = React.useState<FilePreviewDetails | null>(null)
  const [rawContent, setRawContent] = React.useState<string | null>(null)
  /** /preview 接口（分块、图注、text_preview 等）；与文件流 /stream、/content 独立，避免分块被慢请求拖住 */
  const [loadingPreviewDetails, setLoadingPreviewDetails] = React.useState(false)
  /** md/txt 全文拉取；仅影响原文预览，不影响分块展示 */
  const [loadingRawText, setLoadingRawText] = React.useState(false)
  const [pdfObjectUrl, setPdfObjectUrl] = React.useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = React.useState(false)
  const [audioObjectUrl, setAudioObjectUrl] = React.useState<string | null>(null)
  const [audioLoading, setAudioLoading] = React.useState(false)
  const [videoObjectUrl, setVideoObjectUrl] = React.useState<string | null>(null)
  const [videoLoading, setVideoLoading] = React.useState(false)
  const [officePreviewError, setOfficePreviewError] = React.useState<string | null>(null)
  /** Excel/CSV 预览：通过 stream 获取 Blob 后交给 SheetJS 在前端渲染（不像 PDF 那样需要 object URL） */
  const [excelBlob, setExcelBlob] = React.useState<Blob | null>(null)
  const [excelLoading, setExcelLoading] = React.useState(false)
  const [excelError, setExcelError] = React.useState<string | null>(null)
  const [retryingFile, setRetryingFile] = React.useState(false)
  const [retryFileError, setRetryFileError] = React.useState<string | null>(null)
  const [previewOwner, setPreviewOwner] = React.useState<string | null>(null)
  const retryPendingRef = React.useRef(false)
  const previewContentRef = React.useRef<HTMLDivElement>(null)
  const currentPreviewIdRef = React.useRef(file.id)
  currentPreviewIdRef.current = file.id
  React.useLayoutEffect(() => {
    retryPendingRef.current = false
    if (previewContentRef.current) previewContentRef.current.scrollTop = 0
  }, [kbId, file.id])
  const navigatePreview = (callback?: () => void) => {
    if (!callback) return
    previewContentRef.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => {
      if (!media.paused) media.pause()
    })
    callback()
  }
  const onPreviousPreview = navigation?.onPrevious ? () => navigatePreview(navigation.onPrevious) : undefined
  const onNextPreview = navigation?.onNext ? () => navigatePreview(navigation.onNext) : undefined

  const rawFileType = String(file?.type || '').toLowerCase().split(';')[0].trim()
  const fileNameLower = String(file?.name || '').toLowerCase()
  const fileExtFromName = fileNameLower.includes('.') ? (fileNameLower.split('.').pop() || '') : ''
  const mimeTypeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'text/markdown': 'md',
  }
  // 统一文件类型：优先扩展名（name），其次 MIME；避免 docx/pptx 被误判导致“暂无预览”
  const fileTypeLower = (fileExtFromName || mimeTypeMap[rawFileType] || rawFileType).toLowerCase()
  const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif'].includes(fileTypeLower)
  /** PDF、PPTX、DOCX 均可通过 stream 接口以 PDF 形式在页内预览（后端对 PPTX/DOCX 会先转为 PDF） */
  const isPdfOrOfficeViewable = ['pdf', 'pptx', 'docx'].includes(fileTypeLower)
  /** 音频格式：通过 stream 接口获取 Blob 后使用 <audio> 播放 */
  const isAudio = fileTypeLower.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'opus'].includes(fileTypeLower)
  const isVideo = isVideoType(file?.type)
  const isMd = fileTypeLower === 'md'
  const isTxt = fileTypeLower === 'txt'
  const isTextFile = isMd || isTxt
  const isOfficeDocument = ['pptx', 'docx'].includes(fileTypeLower)
  /** Excel/CSV：通过 stream 拉取 Blob 后由 SheetJS 在前端渲染 */
  const isExcel = ['xlsx', 'xls', 'csv'].includes(fileTypeLower)
  const isDoc = ['pdf', 'docx', 'doc', 'pptx', 'txt', 'md', 'xlsx', 'xls', 'csv'].includes(fileTypeLower)
  const previewKey = `${kbId ?? ''}:${file.id}`
  // Reset before children commit: a new title must never briefly show the
  // previous file's text, chunks or media while its effects are starting.
  if (previewOwner !== previewKey) {
    setPreviewOwner(previewKey)
    setTab('preview')
    setDetails(null)
    setRawContent(null)
    setLoadingPreviewDetails(Boolean(kbId))
    setLoadingRawText(Boolean(kbId && isTextFile))
    setPdfObjectUrl(null)
    setPdfLoading(Boolean(kbId && isPdfOrOfficeViewable))
    setOfficePreviewError(null)
    setExcelBlob(null)
    setExcelLoading(Boolean(kbId && isExcel))
    setExcelError(null)
    setAudioObjectUrl(null)
    setAudioLoading(Boolean(kbId && isAudio))
    setVideoObjectUrl(null)
    setVideoLoading(Boolean(kbId && isVideo))
    setRetryFileError(null)
    setRetryingFile(false)
  }
  const canRetryFile = String(file.status || '').toLowerCase() === 'failed'
    && (isVideo ? canRetryVideoFromPreview(file) : canRetryDocumentUpload(file))
    && Boolean(file.processingId)
    && Boolean(onRetryFile)
  const failureCopy = String(file.status || '').toLowerCase() === 'failed' ? uploadFailureCopy(file) : undefined
  const hasChunks = (details?.chunks?.length ?? 0) > 0
  const visiblePreviewTabs: Array<'preview' | 'chunks'> = isDoc ? ['preview', 'chunks'] : ['preview']
  const modalDomId = React.useId().replace(/:/g, '')
  const titleId = `${modalDomId}-file-preview-title`
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const metaId = `${modalDomId}-file-preview-meta`
  const statusId = `${modalDomId}-file-preview-status`
  const previewTabId = `${modalDomId}-file-preview-tab`
  const chunksTabId = `${modalDomId}-file-chunks-tab`
  const activePanelId = `${modalDomId}-file-preview-active-panel`
  const hasPreviewTabs = isDoc
  const activeTabId = tab === 'chunks' && isDoc ? chunksTabId : previewTabId

  const handleRetryFile = async () => {
    if (!onRetryFile || retryPendingRef.current) return
    const retriedFileId = file.id
    retryPendingRef.current = true
    setRetryingFile(true)
    setRetryFileError(null)
    try {
      await onRetryFile()
    } catch (error) {
      if (currentPreviewIdRef.current !== retriedFileId) return
      setRetryFileError(readableUploadError(getErrorMessage(error, ''), t('未能重新入队，请确认服务状态后再试。')))
    } finally {
      if (currentPreviewIdRef.current === retriedFileId) {
        retryPendingRef.current = false
        setRetryingFile(false)
      }
    }
  }

  const focusPreviewTab = (nextTab: 'preview' | 'chunks') => {
    setTab(nextTab)
    requestAnimationFrame(() => previewTabRefs.current[nextTab]?.focus())
  }

  const handlePreviewTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentTab: 'preview' | 'chunks') => {
    const currentIndex = visiblePreviewTabs.indexOf(currentTab)
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusPreviewTab(visiblePreviewTabs[(currentIndex + 1) % visiblePreviewTabs.length])
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusPreviewTab(visiblePreviewTabs[(currentIndex - 1 + visiblePreviewTabs.length) % visiblePreviewTabs.length])
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusPreviewTab(visiblePreviewTabs[0])
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusPreviewTab(visiblePreviewTabs[visiblePreviewTabs.length - 1])
    }
  }

  React.useEffect(() => {
    let cancelled = false
    if (!file?.id || !kbId) return
    setLoadingPreviewDetails(true)
    setDetails(null)
    setRawContent(null)
    if (isTextFile) {
      setLoadingRawText(true)
      knowledgeApi
        .getFileTextContent(kbId, file.id)
        .then((r) => { if (!cancelled) setRawContent(r?.content ?? null) })
        .catch(() => { if (!cancelled) setRawContent(null) })
        .finally(() => { if (!cancelled) setLoadingRawText(false) })
    } else {
      setLoadingRawText(false)
    }
    knowledgeApi
      .getFilePreviewDetails(kbId, file.id, { timeoutMs: isDoc ? 120000 : 30000 })
      .then((d) => { if (!cancelled) setDetails(d ?? null) })
      .catch(() => { if (!cancelled) setDetails(null) })
      .finally(() => { if (!cancelled) setLoadingPreviewDetails(false) })
    return () => { cancelled = true }
  }, [file?.id, kbId, isDoc, isTextFile])

  // PDF / PPTX / DOCX 使用 stream 接口获取 Blob（PPTX/DOCX 后端会转为 PDF）并生成 object URL，在 iframe 内展示
  const pdfObjectUrlRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    if (!isPdfOrOfficeViewable || !kbId || !file?.id) {
      pdfObjectUrlRef.current = null
      setPdfObjectUrl(null)
      setOfficePreviewError(null)
      return
    }
    setPdfLoading(true)
    setPdfObjectUrl(null)
    setOfficePreviewError(null)
    pdfObjectUrlRef.current = null
    // Office 预览需服务端先转 PDF，耗时可能超过默认 30s，单独放宽超时避免误报“不可用”
    knowledgeApi.getFileStream(kbId, file.id, { timeoutMs: isOfficeDocument ? 180000 : 30000 })
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        pdfObjectUrlRef.current = url
        setPdfObjectUrl(url)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPdfObjectUrl(null)
        if (isOfficeDocument) {
          setOfficePreviewError(getErrorMessage(err, t("Office 文件页面内预览暂不可用")))
        }
      })
      .finally(() => { if (!cancelled) setPdfLoading(false) })
    return () => {
      cancelled = true
      const url = pdfObjectUrlRef.current
      if (url) {
        URL.revokeObjectURL(url)
        pdfObjectUrlRef.current = null
      }
      setPdfObjectUrl(null)
      setOfficePreviewError(null)
    }
  }, [isPdfOrOfficeViewable, isOfficeDocument, kbId, file?.id])

  // Excel/CSV 预览：通过 stream 获取 Blob，交给 SheetJS 在浏览器内渲染
  React.useEffect(() => {
    if (!isExcel || !kbId || !file?.id) {
      setExcelBlob(null)
      setExcelError(null)
      return
    }
    let cancelled = false
    setExcelLoading(true)
    setExcelBlob(null)
    setExcelError(null)
    knowledgeApi
      .getFileStream(kbId, file.id)
      .then((blob) => {
        if (!cancelled) setExcelBlob(blob)
      })
      .catch((err: unknown) => {
        if (!cancelled) setExcelError(getErrorMessage(err, t("加载表格文件失败")))
      })
      .finally(() => {
        if (!cancelled) setExcelLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isExcel, kbId, file?.id])

  // 音频预览：通过 stream 获取 Blob 并生成 object URL，供 <audio> 使用
  const audioObjectUrlRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    if (!isAudio || !kbId || !file?.id) {
      audioObjectUrlRef.current = null
      setAudioObjectUrl(null)
      return
    }
    setAudioLoading(true)
    setAudioObjectUrl(null)
    audioObjectUrlRef.current = null
    knowledgeApi.getFileStream(kbId, file.id)
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        audioObjectUrlRef.current = url
        setAudioObjectUrl(url)
      })
      .catch(() => { if (!cancelled) setAudioObjectUrl(null) })
      .finally(() => { if (!cancelled) setAudioLoading(false) })
    return () => {
      cancelled = true
      const url = audioObjectUrlRef.current
      if (url) {
        URL.revokeObjectURL(url)
        audioObjectUrlRef.current = null
      }
      setAudioObjectUrl(null)
    }
  }, [isAudio, kbId, file?.id])

  // 视频预览：通过 stream 获取 Blob 并生成 object URL，供 <video> 使用
  const videoObjectUrlRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    let cancelled = false
    if (!isVideo || !kbId || !file?.id) {
      videoObjectUrlRef.current = null
      setVideoObjectUrl(null)
      return
    }
    setVideoLoading(true)
    setVideoObjectUrl(null)
    videoObjectUrlRef.current = null
    knowledgeApi.getFileStream(kbId, file.id)
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        videoObjectUrlRef.current = url
        setVideoObjectUrl(url)
      })
      .catch(() => { if (!cancelled) setVideoObjectUrl(null) })
      .finally(() => { if (!cancelled) setVideoLoading(false) })
    return () => {
      cancelled = true
      const url = videoObjectUrlRef.current
      if (url) {
        URL.revokeObjectURL(url)
        videoObjectUrlRef.current = null
      }
      setVideoObjectUrl(null)
    }
  }, [isVideo, kbId, file?.id])

  // Markdown 预览仅使用原始文件内容（MinIO 中的原文），避免显示插入了图注后的分块文本导致重复/错乱
  const textPreview = isMd ? (rawContent ?? '') : (file?.textPreview ?? details?.text_preview ?? rawContent ?? '')
  const canEditManualInput = Boolean(details?.editable && isMd && file?.id)
  const previewStatusText =
    tab === 'chunks' && isDoc
      ? loadingPreviewDetails
        ? t("正在加载 {{value1}} 的文档分块", { value1: file.name })
        : hasChunks
          ? t("{{value1}} 共有 {{value2}} 个文档分块", { value1: file.name, value2: details?.chunks?.length ?? 0 })
          : t("{{value1}} 暂未获取到分块内容", { value1: file.name })
      : (pdfLoading || excelLoading || audioLoading || videoLoading || loadingPreviewDetails || loadingRawText)
        ? t("正在加载 {{value1}} 的预览内容", { value1: file.name })
        : t("正在显示 {{value1}} 的预览内容", { value1: file.name })

  const renderTextPreviewCard = (extraHint?: React.ReactNode) => (
    <div key={previewKey} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
        {isMd ? t("Markdown 预览") : t("文本预览")}
      </div>
      {extraHint}
      {isMd ? (
        <div className="rag-markdown max-h-[60vh] max-w-none overflow-y-auto">
          <Suspense fallback={<div className="text-sm text-slate-500 dark:text-slate-400">{t("正在载入 Markdown 预览…")}</div>}>
            <KnowledgeMarkdownPreview content={textPreview} kbId={kbId ?? undefined} fileId={file?.id ?? undefined} />
          </Suspense>
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <pre className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200 leading-relaxed font-sans">
            {textPreview}
          </pre>
        </div>
      )}
    </div>
  )

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
      <Dialog.Content
        className="file-preview-dialog fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white dark:bg-slate-950 rounded-2xl shadow-2xl w-[calc(100%_-_2rem)] max-w-3xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
        aria-labelledby={titleId}
        aria-describedby={`${metaId} ${statusId}`}
        onKeyDown={event => handleFilePreviewArrow(event, onPreviousPreview, onNextPreview)}
        onOpenAutoFocus={() => {
          returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current
          if (target?.isConnected) { event.preventDefault(); target.focus() }
        }}
      >
        {/* 顶栏：全类型预览共用，渐变底 + 类型图标 + 元信息标签 */}
        <div className="relative overflow-hidden flex-shrink-0 border-b border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-slate-50 via-white to-indigo-50/50 dark:from-slate-900 dark:via-slate-950 dark:to-indigo-950/25 px-6 py-4">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_80%_at_100%_-30%,rgba(99,102,241,0.11),transparent)] dark:bg-[radial-gradient(ellipse_90%_80%_at_100%_-30%,rgba(129,140,248,0.14),transparent)]"
            aria-hidden
          />
          {navigation && <FilePreviewNavigation {...navigation} onPrevious={onPreviousPreview} onNext={onNextPreview} />}
          <div className="relative flex justify-between items-start gap-4">
            <div className="min-w-0 flex gap-3.5">
              {isImg && file.previewUrl ? (
                <img
                  key={`${previewKey}:${file.previewUrl}`}
                  src={file.previewUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-xl object-cover border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"
                />
              ) : (
                <div
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800',
                    'bg-slate-50 dark:bg-slate-900 shadow-sm'
                  )}
                >
                  <FileIcon type={fileTypeLower} size={22} />
                </div>
              )}
              <div className="min-w-0 pt-0.5">
                <Dialog.Title
                  id={titleId}
                  className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50 truncate"
                  title={file.name}
                >
                  {file.name}
                </Dialog.Title>
                <div id={metaId} className="file-preview-dialog__meta mt-2 flex items-center gap-x-2 text-xs">
                  <span className="inline-flex items-center rounded-full border border-indigo-200/70 bg-white/60 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-indigo-800 shadow-[0_1px_2px_rgba(99,102,241,0.06)] backdrop-blur-[2px] dark:border-indigo-500/30 dark:bg-indigo-950/35 dark:text-indigo-200 dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
                    {fileTypeLower.toUpperCase() || 'FILE'}
                  </span>
                  <span className="hidden sm:inline text-slate-300 dark:text-slate-600" aria-hidden>
                    ·
                  </span>
                  <span className="text-slate-600 tabular-nums dark:text-slate-400">{file.size}</span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-slate-600 dark:text-slate-400">{formatFileDate(file.date)}</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className={cn(
                'shrink-0 rounded-xl p-2.5 text-slate-400 transition-all duration-200',
                'hover:bg-white/90 hover:text-slate-700 hover:shadow-md hover:ring-1 hover:ring-slate-200/90',
                'dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:hover:ring-slate-600',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950'
              )}
              type="button"
              aria-label={t("关闭文件预览：{{value1}}", { value1: file.name })}
            >
              <X size={18} strokeWidth={2.25} aria-hidden />
            </button>
          </div>
        </div>

        {hasPreviewTabs && (
          <div className="px-6 pt-3.5 pb-3 flex-shrink-0 bg-slate-50/95 dark:bg-slate-900/85 border-b border-slate-100 dark:border-slate-800/90">
            <div
              className="inline-flex items-center gap-0.5 rounded-xl bg-slate-200/50 dark:bg-slate-800/90 p-1 ring-1 ring-inset ring-slate-300/40 dark:ring-slate-700/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              role="tablist"
              aria-label={t("预览方式")}
            >
              <button
                id={previewTabId}
                ref={(node) => {
                  previewTabRefs.current.preview = node
                }}
                onClick={() => setTab('preview')}
                role="tab"
                aria-selected={tab === 'preview'}
                aria-controls={tab === 'preview' ? activePanelId : undefined}
                tabIndex={tab === 'preview' ? 0 : -1}
                onKeyDown={(event) => handlePreviewTabKeyDown(event, 'preview')}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-[0.65rem] px-3 py-2 text-xs font-semibold transition-all duration-200 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900',
                  tab === 'preview'
                    ? 'bg-white dark:bg-slate-950 text-indigo-700 dark:text-indigo-300 shadow-md shadow-slate-300/25 dark:shadow-black/40 ring-1 ring-slate-200/90 dark:ring-slate-600/80'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/75 dark:hover:bg-slate-700/45 active:scale-[0.98]'
                )}
                type="button"
              >
                <Eye className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                 {t("预览")} </button>
              {isDoc && (
                <button
                  id={chunksTabId}
                  ref={(node) => {
                    previewTabRefs.current.chunks = node
                  }}
                  onClick={() => setTab('chunks')}
                  role="tab"
                  aria-selected={tab === 'chunks'}
                  aria-controls={tab === 'chunks' ? activePanelId : undefined}
                  tabIndex={tab === 'chunks' ? 0 : -1}
                  onKeyDown={(event) => handlePreviewTabKeyDown(event, 'chunks')}
                  className={cn(
                    'relative flex items-center gap-1.5 rounded-[0.65rem] pl-3 pr-2 py-2 text-xs font-semibold transition-all duration-200 ease-out',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900',
                    tab === 'chunks'
                      ? 'bg-white dark:bg-slate-950 text-indigo-700 dark:text-indigo-300 shadow-md shadow-slate-300/25 dark:shadow-black/40 ring-1 ring-slate-200/90 dark:ring-slate-600/80'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/75 dark:hover:bg-slate-700/45 active:scale-[0.98]'
                  )}
                  type="button"
                >
                  <Layers className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                  <span className="whitespace-nowrap">{t("分块")}</span>
                  <span
                    className={cn(
                      'ml-0.5 inline-flex h-[1.375rem] min-w-[1.375rem] items-center justify-center rounded-full px-2 text-[11px] font-semibold tabular-nums leading-none',
                      'transition-all duration-200 ease-out',
                      tab === 'chunks'
                        ? 'bg-gradient-to-b from-indigo-100 to-indigo-50/90 text-indigo-700 shadow-[0_1px_2px_rgba(99,102,241,0.18)] border border-indigo-200/60 dark:from-indigo-950 dark:to-indigo-950/50 dark:text-indigo-200 dark:border-indigo-500/35 dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]'
                        : 'bg-slate-200/65 text-slate-600 border border-slate-300/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:bg-slate-700/65 dark:text-slate-300 dark:border-slate-500/25 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    )}
                    aria-label={
                      loadingPreviewDetails ? t("分块数量加载中") : t("共 {{value1}} 个分块", { value1: details?.chunks?.length ?? 0 })
                    }
                  >
                    {loadingPreviewDetails ? (
                      <Loader2
                        className={cn(
                          'h-3 w-3 animate-spin opacity-90',
                          tab === 'chunks'
                            ? 'text-indigo-600 dark:text-indigo-300'
                            : 'text-slate-500 dark:text-slate-400'
                        )}
                        aria-hidden
                      />
                    ) : (
                      details?.chunks?.length ?? 0
                    )}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        <div
          id={activePanelId}
          ref={previewContentRef}
          className="file-preview-dialog__body flex-1 overflow-y-auto p-6 min-h-0"
          role={hasPreviewTabs ? 'tabpanel' : 'region'}
          aria-labelledby={hasPreviewTabs ? activeTabId : titleId}
          aria-describedby={statusId}
        >
          <span id={statusId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {previewStatusText}
          </span>
          {tab === 'chunks' && isDoc ? (
            hasChunks ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-sm font-medium text-slate-800 dark:text-slate-100">
                   {t("文档分块")} </div>
                <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {details!.chunks!.map((c) => (
                    <div key={c.index} className="p-4">
                      <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mb-2">chunk #{c.index}</div>
                      <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                        {c.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : loadingPreviewDetails ? (
              <PreviewPaneLoading
                title={t("正在加载分块内容…")}
                hint={t("正在从知识库获取解析后的文本块，请稍候")}
                variant="chunks"
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 px-5 py-8 text-center">
                <Layers className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600 mb-3" aria-hidden />
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-sm mx-auto">
                   {t("暂未获取到分块内容。可先查看「预览」文本；若文件刚上传，稍后重试即可。")} </p>
              </div>
            )
          ) : isImg && file.previewUrl ? (
            <div className="space-y-4">
              <FilePreviewImage key={`${previewKey}:${file.previewUrl}`} src={file.previewUrl} name={file.name} />
              <MediaDescriptionPanel
                title={t("图片描述")}
                icon={ImageIcon}
                loading={loadingPreviewDetails}
                hasContent={!!(details?.caption ?? details?.description)}
                empty={
                  <p className="text-sm text-slate-400 italic leading-relaxed dark:text-slate-500">
                     {t("暂无描述（若为刚上传的图片，描述生成后刷新预览即可）")} </p>
                }
              >
                <p className="whitespace-pre-wrap text-[15px] leading-[1.75] text-slate-800 dark:text-slate-100">
                  {details?.caption ?? details?.description}
                </p>
              </MediaDescriptionPanel>
            </div>
          ) : isPdfOrOfficeViewable && pdfObjectUrl ? (
            <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <iframe
                title={file.name}
                src={pdfObjectUrl}
                className="w-full h-[60vh] min-h-[400px] max-h-[600px]"
              />
            </div>
          ) : isExcel && excelBlob ? (
            <Suspense fallback={<PreviewPaneLoading title={t("正在载入表格预览器…")} hint={t("表格文件已读取完成，正在准备浏览器端预览组件。")} variant="document" />}>
              <ExcelPreview
                blob={excelBlob}
                fileType={fileTypeLower as 'xlsx' | 'xls' | 'csv'}
                filename={file.name}
              />
            </Suspense>
          ) : isExcel && excelLoading ? (
            <PreviewPaneLoading
              title={t("表格加载中…")}
              hint={t("正在拉取文件流并由浏览器解析")}
              variant="document"
            />
          ) : isExcel && excelError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30" role="alert">
              <div className="text-sm font-medium text-amber-800 dark:text-amber-200">{t("表格预览暂不可用")}</div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-amber-700 dark:text-amber-300">
                {excelError}
              </div>
              <div className="mt-2 text-xs text-amber-700/90 dark:text-amber-300/90">
                 {t("可切换到「分块」查看后端解析后的表头摘要、行块与列画像。")} </div>
            </div>
          ) : isOfficeDocument && pdfLoading && !!textPreview ? (
            renderTextPreviewCard(
              <div className="mb-3 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
                 {t("正在生成页内预览（Office 转 PDF 可能耗时几秒），你可先查看文本预览或切到「分块」。")} </div>
            )
          ) : isPdfOrOfficeViewable && pdfLoading ? (
            <PreviewPaneLoading
              title={t("文档加载中…")}
              hint={
                isOfficeDocument
                  ? t("Office 文档需先转换为 PDF，可能需要数秒至一分钟")
                  : t("正在拉取文件流以生成预览")
              }
              variant="document"
            />
          ) : isOfficeDocument && officePreviewError ? (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4" role="alert">
              <div className="text-sm font-medium text-amber-800 dark:text-amber-200">{t("Office 页内预览暂不可用")}</div>
              <div className="mt-2 text-sm text-amber-700 dark:text-amber-300 leading-relaxed whitespace-pre-wrap">
                {officePreviewError}
              </div>
              <div className="mt-2 text-xs text-amber-700/90 dark:text-amber-300/90">
                 {t("若该文件已成功解析，可切换到「分块」查看内容；服务端安装 LibreOffice 后可恢复页内预览。")} </div>
            </div>
          ) : isAudio && audioObjectUrl ? (
            <div className="space-y-4">
              <AudioPreviewPlayer src={audioObjectUrl} title={file.name} ariaLabel={file.name} />
              <MediaDescriptionPanel
                title={t("音频描述")}
                icon={Music}
                loading={loadingPreviewDetails}
                hasContent={!!(details?.caption ?? details?.transcript ?? details?.description)}
                empty={
                  <p className="text-sm text-slate-400 italic leading-relaxed dark:text-slate-500">
                     {t("暂无描述（若为刚上传的音频，描述生成后刷新预览即可）")} </p>
                }
              >
                {details?.description ? (
                  <section>
                    <p className="whitespace-pre-wrap text-[15px] leading-[1.75] text-slate-800 dark:text-slate-100">
                      {details.description}
                    </p>
                  </section>
                ) : null}
                {details?.transcript ? (
                  <section
                    className={cn(
                      details?.description &&
                        'pt-4 mt-1 border-t border-slate-200/90 dark:border-slate-700/90'
                    )}
                  >
                    <div className="mb-2.5 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-violet-500/[0.12] px-2.5 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200/50 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-500/25">
                         {t("转写内容")} </span>
                    </div>
                    <p className="whitespace-pre-wrap rounded-lg bg-slate-50/90 px-3 py-3 text-[15px] leading-[1.75] text-slate-800 ring-1 ring-slate-200/60 dark:bg-slate-900/50 dark:text-slate-100 dark:ring-slate-700/80">
                      {details.transcript}
                    </p>
                  </section>
                ) : null}
                {!details?.description && !details?.transcript && details?.caption ? (
                  <p className="whitespace-pre-wrap text-[15px] leading-[1.75] text-slate-800 dark:text-slate-100">{details.caption}</p>
                ) : null}
              </MediaDescriptionPanel>
            </div>
          ) : isAudio && audioLoading ? (
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400" role="status" aria-live="polite">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-indigo-500 border-t-transparent" aria-hidden />
              <div className="mt-3 text-sm">{t("音频加载中…")}</div>
            </div>
          ) : isVideo && videoObjectUrl ? (
            <div className="space-y-4">
              <div className="file-preview-media-stage file-preview-media-stage--video">
                <video
                  controls
                  src={videoObjectUrl}
                  className="w-full h-full object-contain bg-black"
                  preload="metadata"
                >
                   {t("您的浏览器不支持视频播放。")} </video>
              </div>
              <MediaDescriptionPanel
                title={t("视频描述")}
                icon={Video}
                loading={loadingPreviewDetails}
                hasContent={!!(details?.caption ?? details?.description)}
                empty={
                  <p className="text-sm text-slate-400 italic leading-relaxed dark:text-slate-500">
                     {t("暂无描述（若为刚上传的视频，描述生成后刷新预览即可）")} </p>
                }
              >
                <p className="whitespace-pre-wrap text-[15px] leading-[1.75] text-slate-800 dark:text-slate-100">
                  {details?.caption ?? details?.description}
                </p>
              </MediaDescriptionPanel>
            </div>
          ) : isVideo && videoLoading ? (
            <div className="file-preview-media-stage file-preview-media-stage--loading" role="status" aria-live="polite">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-indigo-500 border-t-transparent" aria-hidden />
              <div className="mt-3 text-sm">{t("视频加载中…")}</div>
            </div>
          ) : textPreview ? (
            renderTextPreviewCard(
              officePreviewError && isOfficeDocument ? (
                <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {officePreviewError}  {t("已自动切换为解析文本预览；如需页内幻灯片预览，请在服务端安装 LibreOffice。")} </div>
              ) : null
            )
          ) : (loadingPreviewDetails || loadingRawText) && (isTextFile || isImg || isDoc) ? (
            <PreviewPaneLoading
              title={t("加载预览中…")}
              hint={t("正在获取文件详情与文本内容")}
              variant="document"
            />
          ) : (
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400" role="status">
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <FileText size={24} aria-hidden />
              </div>
              <div className="mt-3 text-sm">{t("该文件类型暂无预览")}</div>
            </div>
          )}
        </div>

        {(failureCopy || deleteError) && <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 text-xs leading-relaxed">
          {failureCopy && <><p className="text-red-600 dark:text-red-400">{failureCopy.message}</p>
          <p className="mt-1 text-slate-500 dark:text-slate-400">{failureCopy.source} {failureCopy.recovery}</p></>}
          {deleteError && <p className="text-red-600 dark:text-red-400" role="status">{deleteError}</p>}
        </div>}
        {/* 底部操作栏：与 Tab 区一致的浅底与分隔；次要 / 危险按钮分层 */}
        <div className="px-6 py-4 bg-slate-50/95 dark:bg-slate-900/85 border-t border-slate-100 dark:border-slate-800/90 flex justify-end gap-2.5 flex-shrink-0">
          {canRetryFile && (
            <div className="mr-auto min-w-0">
              <button
                onClick={() => { void handleRetryFile() }}
                disabled={retryingFile}
                aria-label={t(isVideo ? "重新解析视频：{{value1}}" : "重新处理文件：{{value1}}", { value1: file.name })}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
                  'border border-sky-200/90 bg-white text-sky-700 shadow-sm shadow-sky-100/40',
                  'dark:border-sky-900/50 dark:bg-slate-900 dark:text-sky-300 dark:shadow-none',
                  'hover:bg-sky-600 hover:border-sky-600 hover:text-white hover:shadow-md hover:shadow-sky-500/25',
                  'dark:hover:bg-sky-600 dark:hover:border-sky-500 dark:hover:text-white',
                  'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white disabled:hover:text-sky-700',
                  'dark:disabled:hover:bg-slate-900 dark:disabled:hover:text-sky-300',
                  'active:scale-[0.98] transition-all duration-200 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900'
                )}
                type="button"
              >
                <RotateCcw className={cn('h-4 w-4 shrink-0 opacity-90', retryingFile && 'animate-spin')} strokeWidth={2.25} aria-hidden />
                {retryingFile ? t("重新入队中…") : t(isVideo ? "重新解析视频" : "重新处理")}
              </button>
              {retryFileError ? (
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-red-600 dark:text-red-400" role="alert">
                  {retryFileError}
                </p>
              ) : null}
            </div>
          )}
          {canEditManualInput && (
            <button
              onClick={() => {
                if (!file?.id || rawContent == null || !onEdit) return
                onEdit({
                  fileId: file.id,
                  filename: file.name,
                  content: rawContent,
                })
              }}
              disabled={loadingRawText || !onEdit || rawContent == null}
              aria-label={loadingRawText ? t("正在加载 Markdown 内容：{{value1}}", { value1: file.name }) : t("编辑 Markdown 内容：{{value1}}", { value1: file.name })}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
                'border border-indigo-200/90 bg-white text-indigo-700 shadow-sm shadow-indigo-100/40',
                'dark:border-indigo-900/50 dark:bg-slate-900 dark:text-indigo-300 dark:shadow-none',
                'hover:bg-indigo-600 hover:border-indigo-600 hover:text-white hover:shadow-md hover:shadow-indigo-500/25',
                'dark:hover:bg-indigo-600 dark:hover:border-indigo-500 dark:hover:text-white',
                'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white disabled:hover:text-indigo-700',
                'dark:disabled:hover:bg-slate-900 dark:disabled:hover:text-indigo-300',
                'active:scale-[0.98] transition-all duration-200 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900'
              )}
              type="button"
            >
              <Pencil className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
              {loadingRawText ? t("加载内容中…") : t("编辑内容")}
            </button>
          )}
          <button
            onClick={onDelete}
            aria-label={t("删除文件：{{value1}}", { value1: file.name })}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
              'border border-red-200/90 bg-white text-red-600 shadow-sm shadow-red-100/40',
              'dark:border-red-900/50 dark:bg-slate-900 dark:text-red-400 dark:shadow-none',
              'hover:bg-red-600 hover:border-red-600 hover:text-white hover:shadow-md hover:shadow-red-500/25',
              'dark:hover:bg-red-600 dark:hover:border-red-500 dark:hover:text-white',
              'active:scale-[0.98] transition-all duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900'
            )}
            type="button"
          >
            <Trash2 className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
             {t("删除文件")} </button>
        </div>
      </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// 从 URL 导入弹窗（提交后先下载，再在后台处理；立即关闭弹窗并在上传流水线中展示进度）
// 现支持任意网页：自动按 Content-Type 识别，HTML 走「网页正文抽取 → Markdown」管道入库；非网页保持原文件下载行为
function ImportUrlModal({
  kbId,
  onClose,
  onSuccess,
  onStartImport,
  onSubmitStart,
  onSubmitSettled,
}: {
  kbId: string
  onSubmitStart?: () => boolean
  onSubmitSettled?: () => void
  onClose: () => void
  onSuccess: () => void
  /** 已开始后台导入时回调，用于在上传流水线中展示进度（轮询 processing_id） */
  onStartImport?: (payload: { processing_id: string; filename: string }) => void
}) {
  useTranslation()
  const [url, setUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // 默认按网页解析；飞书链接会在预检后建议切换到 Block 解析模式。
  const [mode, setMode] = useState<ImportUrlMode>('webpage')
  const [includeLinks, setIncludeLinks] = useState(true)
  const [includeImages, setIncludeImages] = useState(true)
  // 是否下载页面内图片到 KB（走多模态 VLM/CLIP 流水线，可被检索）；仅在保留图片时有效
  const [downloadImages, setDownloadImages] = useState(true)
  const [inspecting, setInspecting] = useState(false)
  const [inspectError, setInspectError] = useState<string | null>(null)
  const [inspectResult, setInspectResult] = useState<{
    original_url: string
    final_url: string
    kind: ImportUrlKind
    detected_kind: ImportUrlKind
    recommended_mode: ImportUrlMode
    suggested_filename: string
    content_type?: string | null
    content_length?: number | null
    title?: string | null
    site?: string | null
    warning?: string | null
  } | null>(null)
  const filenameRef = useRef('')
  const lastSuggestedFilenameRef = useRef<string | null>(null)
  const modalDomId = React.useId().replace(/:/g, '')
  const advancedOptionsId = `${modalDomId}-url-import-advanced-options`
  const errorId = `${modalDomId}-url-import-error`

  useEffect(() => {
    filenameRef.current = filename
  }, [filename])

  useEffect(() => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setInspecting(false)
      setInspectError(null)
      setInspectResult(null)
      lastSuggestedFilenameRef.current = null
      return
    }
    try {
      new URL(trimmedUrl)
    } catch {
      setInspecting(false)
      setInspectError(null)
      setInspectResult(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setInspecting(true)
      setInspectError(null)
      try {
        const result = await importApi.inspectUrl({ url: trimmedUrl, mode })
        if (cancelled) return
        setInspectResult(result)
        const currentFilename = filenameRef.current.trim()
        if (!currentFilename || (lastSuggestedFilenameRef.current && currentFilename === lastSuggestedFilenameRef.current)) {
          setFilename(result.suggested_filename)
        }
        lastSuggestedFilenameRef.current = result.suggested_filename
      } catch (err: unknown) {
        if (cancelled) return
        setInspectResult(null)
        setInspectError(getErrorMessage(err, t("URL 识别失败")))
      } finally {
        if (!cancelled) setInspecting(false)
      }
    }, 450)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [url, mode])

  const formatContentLength = (value?: number | null) => {
    if (value == null || Number.isNaN(value)) return null
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${value} B`
  }

  /** 始终携带 mode（前端默认与后端默认 auto 不同）；其余字段仅在偏离默认时附带，保持与旧后端兼容 */
  const buildExtraBody = () => {
    const extra: {
      mode: ImportUrlMode
      include_links?: boolean
      include_images?: boolean
      download_images?: boolean
    } = { mode }
    if (!includeLinks) extra.include_links = false
    if (!includeImages) extra.include_images = false
    if (!downloadImages) extra.download_images = false
    return extra
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) {
      setError(t("请输入 URL"))
      return
    }
    if (onSubmitStart && !onSubmitStart()) return
    setError(null)
    setLoading(true)
    try {
      const baseBody = {
        url: url.trim(),
        kb_id: kbId,
        ...(filename.trim() ? { filename: filename.trim() } : {}),
        ...buildExtraBody(),
      }
      const res = await importApi.importFromUrlStart(baseBody)
      const data = res as { processing_id?: string; filename?: string }
      if (data?.processing_id && data?.filename && onStartImport) {
        onStartImport({ processing_id: data.processing_id, filename: data.filename })
        onClose()
        return
      }
      await importApi.importFromUrl(baseBody)
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("导入失败")))
    } finally {
      onSubmitSettled?.()
      setLoading(false)
    }
  }

  const trimmedUrl = url.trim()
  const suggestedMode =
    inspectResult?.recommended_mode === 'auto'
      ? inspectResult.detected_kind === 'feishu_document'
        ? 'feishu'
        : inspectResult.detected_kind === 'webpage'
          ? 'webpage'
          : 'file'
      : inspectResult?.recommended_mode

  return (
    <WorkflowDialog
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      eyebrow={t("素材导入")}
      title={t("从 URL 导入")}
      description={t("把网页、文件或飞书文档，收进当前素材空间。")}
      icon={<Link2 size={20} />}
      size="md"
      sourceTheme="link"
      className="import-dialog import-dialog--link"
      busy={loading}
      onSubmit={handleSubmit}
      footer={(
        <>
          <span className="workflow-footer-summary">{t("导入后可在上传列表查看进度")}</span>
          <div className="workflow-footer-actions">
            <button type="button" disabled={loading} onClick={onClose} aria-label={t("取消 URL 导入")} className="workflow-button">{t("取消")}</button>
            <button type="submit" disabled={loading} aria-describedby={error ? errorId : undefined} aria-label={loading ? t("正在导入 URL") : t("导入 URL")} className="workflow-button workflow-button-primary">
              {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Link2 size={15} aria-hidden />}
              {loading ? t("正在导入…") : t("导入链接")}
            </button>
          </div>
        </>
      )}
    >
      <fieldset className="import-form" disabled={loading}>
        <div className="import-primary-field">
          <label htmlFor={`${modalDomId}-url`} className="workflow-label">{t("链接地址")} <span className="import-required">*</span></label>
          <div className="import-input-icon">
            <Link2 size={18} aria-hidden />
            <input data-autofocus id={`${modalDomId}-url`} name="url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" className="workflow-field" autoComplete="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={`${modalDomId}-url-help`} />
          </div>
          <p id={`${modalDomId}-url-help`} className="workflow-help">{t("粘贴链接后，自动识别类型、标题和文件名。")}</p>
          {(inspecting || inspectResult || inspectError) && (
            <div className="import-link-preview" role={inspectError ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">
              {inspecting ? (
                <div className="import-inline-status"><Loader2 size={15} className="animate-spin" aria-hidden />{t("正在识别链接…")}</div>
              ) : inspectResult ? (
                <>
                  <div className="import-preview-heading">
                    <span className="import-tag">{inspectResult.detected_kind === 'feishu_document' ? t("飞书文档") : inspectResult.detected_kind === 'webpage' ? t("网页正文") : t("文件直链")}</span>
                    {formatContentLength(inspectResult.content_length) && <span className="workflow-help">{formatContentLength(inspectResult.content_length)}</span>}
                    {suggestedMode && suggestedMode !== mode && <button type="button" onClick={() => setMode(suggestedMode)} className="import-inline-action">{t("使用建议模式")}</button>}
                  </div>
                  {inspectResult.title && <p className="import-preview-title">{inspectResult.title}</p>}
                  <div className="import-preview-meta">
                    {inspectResult.site && <span>{inspectResult.site}</span>}
                    {inspectResult.content_type && <span>{inspectResult.content_type}</span>}
                  </div>
                  <p className="workflow-help">{t("建议文件名：")}{inspectResult.suggested_filename}</p>
                  {inspectResult.final_url && inspectResult.final_url !== trimmedUrl && <p className="workflow-help import-wrap">{t("跳转地址：")}{inspectResult.final_url}</p>}
                  {inspectResult.warning && <p className="import-warning">{inspectResult.warning}</p>}
                </>
              ) : <p className="import-warning">{inspectError}</p>}
            </div>
          )}
        </div>
        <fieldset className="import-option-group">
          <legend className="workflow-label">{t("解析方式")}</legend>
          <div className="import-mode-grid">
            {([
              { v: 'webpage', label: t("网页正文"), hint: t("提取正文图片"), icon: FileText },
              { v: 'feishu', label: t("飞书文档"), hint: t("文档、表格等"), icon: Layers },
              { v: 'auto', label: t("自动识别"), hint: t("按类型选择"), icon: Zap },
              { v: 'file', label: t("原始文件"), hint: t("下载原始文件"), icon: FolderOpen },
            ] as const).map((opt) => (
              <label key={opt.v} className={cn('import-mode-option', mode === opt.v && 'is-selected')}>
                <input type="radio" name="url-import-mode" value={opt.v} checked={mode === opt.v} onChange={() => setMode(opt.v)} className="sr-only" />
                <opt.icon size={18} aria-hidden />
                <span><strong>{opt.label}</strong><small>{opt.hint}</small></span>
                <span className="import-radio-mark" aria-hidden />
              </label>
            ))}
          </div>
          <p className="workflow-help">
            {mode === 'webpage' && t("提取网页主要内容，保存为 Markdown 文档。")}
            {mode === 'feishu' && t("读取飞书文档内容，包含图片、表格、画板与嵌入数据。")}
            {mode === 'auto' && t("自动识别网页或文件，并使用对应方式导入。")}
            {mode === 'file' && t("保留原始文件，支持文档、图片、音频与视频。")}
          </p>
        </fieldset>
        <div className="import-disclosure">
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced} aria-controls={advancedOptionsId} className="import-disclosure-trigger">
            <span>{t("更多选项")}<small>{t("自定义文件名与正文内容")}</small></span><ChevronDown size={16} className={cn(showAdvanced && 'rotate-180')} aria-hidden />
          </button>
          {showAdvanced && (
            <div id={advancedOptionsId} className="import-disclosure-body">
              <div className="import-advanced-filename">
                <label htmlFor={`${modalDomId}-filename`} className="workflow-label">{t("文件名")} <span className="import-optional">{t("可选")}</span></label>
                <input id={`${modalDomId}-filename`} name="filename" type="text" value={filename} onChange={(e) => setFilename(e.target.value)} placeholder={t("留空时自动命名")} className="workflow-field" />
              </div>
              <label className="import-check-row"><input name="include-links" type="checkbox" checked={includeLinks} onChange={(e) => setIncludeLinks(e.target.checked)} disabled={mode === 'file'} /><span>{t("保留正文中的链接")}</span></label>
              <label className="import-check-row"><input name="include-images" type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} disabled={mode === 'file'} /><span>{t("保留正文中的图片引用")}</span></label>
              <label className="import-check-row"><input name="download-images" type="checkbox" checked={downloadImages && includeImages} onChange={(e) => setDownloadImages(e.target.checked)} disabled={mode === 'file' || !includeImages} /><span>{mode === 'feishu' ? t("同时导入图片与画板缩略图") : t("同时导入图片，供后续检索")}</span></label>
              {mode === 'file' && <p className="workflow-help">{t("原始文件模式无需配置正文选项。")}</p>}
            </div>
          )}
        </div>
      </fieldset>
      {error && <p id={errorId} className="import-error" role="alert"><AlertCircle size={16} aria-hidden />{error}</p>}
    </WorkflowDialog>
  )
}

// 热点资讯导入弹窗（关键词、主题、时间范围、条数均可选，不填用后端默认；支持异步启动后在上传流水线展示进度）
function ImportHotTopicsModal({
  kbId,
  onClose,
  onSuccess,
  onStartImport,
  onSubmitStart,
  onSubmitSettled,
}: {
  kbId: string
  onSubmitStart?: () => boolean
  onSubmitSettled?: () => void
  onClose: () => void
  onSuccess: () => void
  /** 异步导入已启动时回调，关闭弹窗并在上传流水线中展示进度（轮询 processing_id） */
  onStartImport?: (payload: { processing_id: string; filename: string }) => void
}) {
  useTranslation()
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<'' | 'general' | 'news' | 'finance'>('')
  const [timeRange, setTimeRange] = useState<'' | 'day' | 'week' | 'month' | 'year'>('')
  const [maxResults, setMaxResults] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const modalDomId = React.useId().replace(/:/g, '')
  const errorId = `${modalDomId}-hot-topics-error`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (onSubmitStart && !onSubmitStart()) return
    setError(null)
    setLoading(true)
    try {
      const body: {
        kb_id: string
        query?: string
        topic?: 'general' | 'news' | 'finance'
        time_range?: 'day' | 'week' | 'month' | 'year'
        max_results?: number
      } = { kb_id: kbId, max_results: Math.min(20, Math.max(1, maxResults)) }
      if (query.trim()) body.query = query.trim()
      if (topic) body.topic = topic
      if (timeRange) body.time_range = timeRange
      const res = await importApi.importHotTopicsStart(body)
      const data = res as { processing_id?: string; filename?: string }
      if (data?.processing_id && data?.filename && onStartImport) {
        onStartImport({ processing_id: data.processing_id, filename: data.filename })
        onClose()
        return
      }
      await importApi.importHotTopics(body)
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("热点导入失败")))
    } finally {
      onSubmitSettled?.()
      setLoading(false)
    }
  }


  return (
    <WorkflowDialog
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      eyebrow={t("素材导入")}
      title={t("热点资讯导入")}
      description={t("围绕你关注的话题，收集资讯并保存为可检索的文档。")}
      icon={<Newspaper size={20} />}
      size="md"
      className="import-dialog import-dialog--news"
      sourceTheme="news"
      busy={loading}
      onSubmit={handleSubmit}
      footer={(
        <>
          <span className="workflow-footer-summary">{t("最多导入")} {Math.min(20, Math.max(1, maxResults))}  {t("条资讯")}</span>
          <div className="workflow-footer-actions">
            <button type="button" disabled={loading} onClick={onClose} aria-label={t("取消热点资讯导入")} className="workflow-button">{t("取消")}</button>
            <button type="submit" disabled={loading} aria-describedby={error ? errorId : undefined} aria-label={loading ? t("正在导入热点资讯") : t("导入热点资讯")} className="workflow-button workflow-button-primary">
              {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Newspaper size={15} aria-hidden />}
              {loading ? t("正在收集…") : t("收集资讯")}
            </button>
          </div>
        </>
      )}
    >
      <fieldset className="import-form" disabled={loading}>
        <div className="import-primary-field">
          <label htmlFor={`${modalDomId}-query`} className="workflow-label">{t("关注关键词")} <span className="import-optional">{t("可选")}</span></label>
          <div className="import-input-icon">
            <Search size={18} aria-hidden />
            <input data-autofocus id={`${modalDomId}-query`} name="query" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("例如：人工智能、科技进展")} className="workflow-field" aria-describedby={`${modalDomId}-query-help`} />
          </div>
          <p id={`${modalDomId}-query-help`} className="workflow-help">{t("留空时收集默认热点资讯。")}</p>
        </div>
        <fieldset className="import-option-group">
          <legend className="workflow-label">{t("资讯主题")}</legend>
          <div className="import-segmented">
            {([{ value: '', label: t("默认") }, { value: 'general', label: t("综合") }, { value: 'news', label: t("新闻") }, { value: 'finance', label: t("财经") }] as const).map((item) => (
              <label key={item.value} className={cn('import-segment', topic === item.value && 'is-selected')}>
                <input type="radio" name="hot-topic" value={item.value} checked={topic === item.value} onChange={() => setTopic(item.value)} className="sr-only" />{item.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="import-field-grid">
          <div>
            <label htmlFor={`${modalDomId}-time`} className="workflow-label">{t("时间范围")}</label>
            <select id={`${modalDomId}-time`} name="time_range" value={timeRange} onChange={(e) => setTimeRange(e.target.value as typeof timeRange)} className="workflow-field">
              <option value="">{t("默认范围")}</option><option value="day">{t("近一天")}</option><option value="week">{t("近一周")}</option><option value="month">{t("近一月")}</option><option value="year">{t("近一年")}</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${modalDomId}-max`} className="workflow-label">{t("资讯条数")}</label>
            <input id={`${modalDomId}-max`} name="max_results" type="number" min={1} max={20} value={maxResults} onChange={(e) => setMaxResults(parseInt(e.target.value, 10) || 10)} className="workflow-field" aria-describedby={`${modalDomId}-max-help`} />
            <p id={`${modalDomId}-max-help`} className="workflow-help">{t("1–20 条，默认 10 条")}</p>
          </div>
        </div>
        <div className="workflow-note import-note"><Newspaper size={17} aria-hidden /><span>{t("资讯将保存为文档，可在导入完成后查看和检索。")}</span></div>
      </fieldset>
      {error && <p id={errorId} className="import-error" role="alert"><AlertCircle size={16} aria-hidden />{error}</p>}
    </WorkflowDialog>
  )
}

// 从文件夹导入弹窗（支持选择本地文件夹 + 输入服务端路径，共用一个导入按钮；本地导入走父组件上传流水线以显示进度）
function ImportFolderModal({
  kbId,
  onClose,
  onSuccess,
  onImportLocalFiles,
}: {
  kbId: string
  onClose: () => void
  onSuccess: () => void
  /** 本地已选文件列表：关闭弹窗并由父组件按「上传流水线」逐个上传，显示每文件进度 */
  onImportLocalFiles: (files: File[]) => void
}) {
  useTranslation()
  const [folderPath, setFolderPath] = useState('')
  const [recursive, setRecursive] = useState(true)
  const [extensionsStr, setExtensionsStr] = useState('')
  const [excludeStr, setExcludeStr] = useState('')
  const [maxFiles, setMaxFiles] = useState(500)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success_count: number; failed_count: number; total: number } | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[] | null>(null)
  const [pickingFolder, setPickingFolder] = useState(false)
  const [folderProgress, setFolderProgress] = useState<{
    stage: string
    current?: number
    total?: number
    message?: string
    success_count?: number
    failed_count?: number
  } | null>(null)

  const directoryPicker = getDirectoryPicker()
  const supportsFolderPicker = Boolean(directoryPicker)
  const modalDomId = React.useId().replace(/:/g, '')
  const errorId = `${modalDomId}-folder-import-error`
  const selectedFilesStatusId = `${modalDomId}-folder-selected-files`
  const resultId = `${modalDomId}-folder-import-result`
  const progressId = `${modalDomId}-folder-import-progress`

  const extensionsList = extensionsStr.trim()
    ? extensionsStr.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null
  const excludeList = excludeStr.trim()
    ? excludeStr.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    : null

  function matchesExclude(name: string, patterns: string[] | null): boolean {
    if (!patterns || patterns.length === 0) return false
    for (const p of patterns) {
      if (p.startsWith('*')) {
        if (name.toLowerCase().endsWith(p.slice(1).toLowerCase())) return true
      } else if (p.endsWith('*')) {
        if (name.toLowerCase().startsWith(p.slice(0, -1).toLowerCase())) return true
      } else if (name.includes(p)) return true
    }
    return false
  }

  function matchesExtension(fileName: string, exts: string[] | null): boolean {
    if (!exts || exts.length === 0) return true
    const lower = fileName.toLowerCase()
    return exts.some((e) => (e.startsWith('.') ? lower.endsWith(e) : lower.endsWith('.' + e)))
  }

  const SKIP_SYSTEM_FILES = ['.ds_store', 'thumbs.db', 'desktop.ini']
  function isSystemOrHiddenFile(name: string): boolean {
    const lower = name.toLowerCase()
    if (lower.startsWith('._')) return true
    return SKIP_SYSTEM_FILES.includes(lower)
  }

  async function collectFilesFromHandle(
    handle: DirectoryPickerDirectoryHandle,
    recursive: boolean,
    pathPrefix: string,
    extensions: string[] | null,
    exclude: string[] | null,
    maxFiles: number,
    collected: File[]
  ): Promise<void> {
    if (collected.length >= maxFiles) return
    for await (const entry of handle.values()) {
      if (collected.length >= maxFiles) break
      const name = entry.name
      const relPath = pathPrefix ? `${pathPrefix}/${name}` : name
      if (entry.kind === 'file') {
        if (isSystemOrHiddenFile(name)) continue
        if (matchesExclude(name, exclude)) continue
        if (!matchesExtension(name, extensions)) continue
        try {
          const file = await entry.getFile()
          const fileWithPath = new File([file], relPath, { type: file.type })
          collected.push(fileWithPath)
        } catch (_) {}
        continue
      }
      if (entry.kind === 'directory' && recursive) {
        if (matchesExclude(name, exclude)) continue
        await collectFilesFromHandle(entry, true, relPath, extensions, exclude, maxFiles, collected)
      }
    }
  }

  const handleSelectLocalFolder = async () => {
    if (!supportsFolderPicker) {
      setError(t("当前浏览器不支持选择文件夹，请使用 Chrome/Edge 或下方输入服务端路径"))
      return
    }
    setError(null)
    setResult(null)
    setSelectedFiles(null)
    setPickingFolder(true)
    try {
      const dirHandle = await directoryPicker?.()
      if (!dirHandle) {
        setError(t("当前浏览器不支持选择文件夹，请使用 Chrome/Edge 或下方输入服务端路径"))
        return
      }
      const files: File[] = []
      await collectFilesFromHandle(
        dirHandle,
        recursive,
        '',
        extensionsList,
        excludeList,
        maxFiles,
        files
      )
      setSelectedFiles(files)
      if (files.length === 0) setError(t("该文件夹下没有符合条件的文件"))
    } catch (err: unknown) {
      if (getErrorName(err) !== 'AbortError') setError(getErrorMessage(err, t("选择文件夹失败")))
    } finally {
      setPickingFolder(false)
    }
  }

  const handleImport = async () => {
    if (selectedFiles != null && selectedFiles.length > 0) {
      onImportLocalFiles(selectedFiles)
      onClose()
      return
    }
    if (folderPath.trim()) {
      setError(null)
      setResult(null)
      setFolderProgress(null)
      setLoading(true)
      try {
        await importApi.importFromFolderStream(
          {
            folder_path: folderPath.trim(),
            kb_id: kbId,
            recursive,
            extensions: extensionsList && extensionsList.length > 0 ? extensionsList : undefined,
            exclude_patterns: excludeList && excludeList.length > 0 ? excludeList : undefined,
            max_files: maxFiles,
          },
          (event) => {
            if (event.stage === 'scan_complete') {
              setFolderProgress({ stage: 'importing', current: 0, total: event.total ?? 0, message: t("开始导入…") })
            } else {
              setFolderProgress(event)
            }
            if (event.stage === 'done') {
              setResult({
                success_count: event.success_count ?? 0,
                failed_count: event.failed_count ?? 0,
                total: event.total ?? 0,
              })
              if ((event.success_count ?? 0) > 0) onSuccess()
            }
          }
        )
      } catch (err: unknown) {
        setError(getErrorMessage(err, t("导入失败")))
      } finally {
        setLoading(false)
        setFolderProgress(null)
      }
      return
    }
    setError(t("请先选择本地文件夹或输入服务端路径"))
  }

  const canImport = (selectedFiles != null && selectedFiles.length > 0) || folderPath.trim().length > 0
  const folderProgressCurrent = folderProgress?.current ?? 0
  const folderProgressTotal = folderProgress?.total ?? 0
  const folderProgressLabel = folderProgress
    ? folderProgress.stage === 'scanning'
      ? t("正在扫描文件夹…")
      : folderProgress.stage === 'importing'
        ? t("正在导入 {{folderProgressCurrent}}/{{folderProgressTotal}}", { folderProgressCurrent: folderProgressCurrent, folderProgressTotal: folderProgressTotal })
        : t("处理中…")
    : ''

  return (
    <WorkflowDialog
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      eyebrow={t("素材导入")}
      title={t("从文件夹导入")}
      description={t("一次添加整个文件夹，支持子文件夹与文件类型筛选。")}
      icon={<FolderOpen size={20} />}
      size="md"
      className="import-dialog import-dialog--folder"
      sourceTheme="folder"
      busy={loading || pickingFolder}
      onSubmit={(event) => { event.preventDefault(); void handleImport() }}
      footer={(
        <>
          <span className="workflow-footer-summary">{selectedFiles?.length ? t("已选 {{value1}} 个本地文件", { value1: selectedFiles.length }) : folderPath.trim() ? t("从服务端路径导入") : t("选择来源后开始导入")}</span>
          <div className="workflow-footer-actions">
            <button type="button" disabled={loading || pickingFolder} onClick={onClose} aria-label={t("取消文件夹导入")} className="workflow-button">{result ? t("关闭") : t("取消")}</button>
            <button type="submit" disabled={!canImport || loading || pickingFolder} aria-describedby={error ? errorId : loading && folderProgress ? progressId : result ? resultId : undefined} aria-label={loading ? t("正在导入文件夹") : t("导入文件夹")} className="workflow-button workflow-button-primary">
              {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FolderOpen size={15} aria-hidden />}{loading ? t("正在导入…") : t("开始导入")}
            </button>
          </div>
        </>
      )}
    >
      <fieldset className="import-form" disabled={loading || pickingFolder}>
        <div>
          <p className="workflow-label">{t("选择文件来源")}</p>
          <button type="button" data-autofocus onClick={handleSelectLocalFolder} disabled={pickingFolder || loading} aria-describedby={selectedFiles?.length ? selectedFilesStatusId : undefined} className={cn('import-folder-picker', Boolean(selectedFiles?.length) && 'has-selection')}>
            <span className="import-folder-symbol">{pickingFolder ? <Loader2 size={23} className="animate-spin" aria-hidden /> : <FolderOpen size={23} aria-hidden />}</span>
            <span><strong>{pickingFolder ? t("正在读取文件夹…") : selectedFiles?.length ? t("已选择 {{value1}} 个文件", { value1: selectedFiles.length }) : t("选择本地文件夹")}</strong><small>{selectedFiles?.length ? t("点击重新选择文件夹") : t("从电脑批量添加文档、图片等素材")}</small></span>
            <Plus size={17} aria-hidden />
          </button>
          {!supportsFolderPicker && <p className="workflow-help" role="note">{t("当前浏览器不支持文件夹选择，请使用 Chrome / Edge，或填写下方路径。")}</p>}
          {Boolean(selectedFiles?.length) && (
            <div id={selectedFilesStatusId} className="import-selection-status" role="status">
              <span>{t("将导入已选本地文件，并在上传列表显示进度。")}</span>
              <button type="button" onClick={() => setSelectedFiles(null)} className="import-inline-action">{t("清除")}</button>
            </div>
          )}
        </div>
        <details className="import-disclosure">
          <summary className="import-disclosure-trigger"><span>{t("使用服务端路径")}<small>{folderPath.trim() || t("素材已在服务器上时使用")}</small></span><ChevronDown size={16} aria-hidden /></summary>
          <div className="import-disclosure-body">
            <div>
              <label htmlFor={`${modalDomId}-path`} className="workflow-label">{t("服务端文件夹路径")}</label>
              <input id={`${modalDomId}-path`} name="folder_path" type="text" value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="/data/docs" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="workflow-field" aria-describedby={`${modalDomId}-path-help`} />
              <p id={`${modalDomId}-path-help`} className="workflow-help">{t("使用服务可访问的文件夹路径。")}{selectedFiles?.length ? t("当前将优先导入已选本地文件。") : ''}</p>
            </div>
          </div>
        </details>
        <details className="import-disclosure">
          <summary className="import-disclosure-trigger"><span>{t("文件筛选")} <small>{recursive ? t("包含子文件夹") : t("仅当前文件夹")}  {t("· 最多")} {maxFiles}  {t("个")}</small></span><ChevronDown size={16} aria-hidden /></summary>
          <div className="import-disclosure-body import-form">
            <label className="import-check-row"><input id={`${modalDomId}-recursive`} name="recursive" type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /><span>{t("包含子文件夹")}</span></label>
            <div className="import-field-grid">
              <div>
                <label htmlFor={`${modalDomId}-extensions`} className="workflow-label">{t("文件类型")} <span className="import-optional">{t("可选")}</span></label>
                <input id={`${modalDomId}-extensions`} name="extensions" type="text" value={extensionsStr} onChange={(e) => setExtensionsStr(e.target.value)} placeholder=".pdf, .txt, .md" className="workflow-field" />
              </div>
              <div>
                <label htmlFor={`${modalDomId}-max`} className="workflow-label">{t("最大文件数")}</label>
                <input id={`${modalDomId}-max`} name="max_files" type="number" min={1} max={2000} value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value) || 500)} className="workflow-field" />
              </div>
            </div>
            <div>
              <label htmlFor={`${modalDomId}-exclude`} className="workflow-label">{t("排除文件或目录")} <span className="import-optional">{t("可选")}</span></label>
              <input id={`${modalDomId}-exclude`} name="exclude_patterns" type="text" value={excludeStr} onChange={(e) => setExcludeStr(e.target.value)} placeholder="__pycache__, .git, *.tmp" className="workflow-field" />
            </div>
            <p className="workflow-help">{t("多项用逗号分隔；修改筛选后，请重新选择本地文件夹。")}</p>
          </div>
        </details>
      </fieldset>
      {loading && folderProgress && (
        <div id={progressId} className="import-progress" role="status" aria-live="polite" aria-atomic="true">
          <div className="import-progress-heading"><Loader2 size={15} className="animate-spin" aria-hidden /><strong>{folderProgressLabel}</strong>{folderProgressTotal > 0 && <span>{folderProgressCurrent} / {folderProgressTotal}</span>}</div>
          {folderProgressTotal > 0 && <div className="import-progress-track" role="progressbar" aria-label={folderProgressLabel} aria-valuemin={0} aria-valuemax={folderProgressTotal} aria-valuenow={folderProgressCurrent}><div style={{ width: `${Math.min(100, (folderProgressCurrent / folderProgressTotal) * 100)}%` }} /></div>}
          {folderProgress.message && folderProgress.stage === 'importing' && <p className="workflow-help import-wrap">{folderProgress.message}</p>}
        </div>
      )}
      {result && <p id={resultId} className="workflow-note" role="status">{t("成功")} {result.success_count}{t("，失败")} {result.failed_count}{t("，共")} {result.total}  {t("个文件。")}</p>}
      {error && <p id={errorId} className="import-error" role="alert"><AlertCircle size={16} aria-hidden />{error}</p>}
    </WorkflowDialog>
  )
}

// 搜索图片导入参数（与 importFromSearchStream 一致，用于关闭弹窗后在上传流水线中展示进度）
export type SearchImportParams = {
  kb_id: string
  query: string
  source: 'google_images' | 'pixabay' | 'internet_archive'
  quantity?: number
  pixabay_image_type?: string
  pixabay_order?: string
  archive_sort?: string
  randomize?: boolean
}

// 按关键词搜索图片导入弹窗（支持关闭弹窗后在上传流水线中展示进度）
function ImportSearchModal({
  kbId,
  onClose,
  onSuccess,
  onStartImport,
}: {
  kbId: string
  onClose: () => void
  onSuccess: () => void
  /** 开始导入时回调，关闭弹窗并由父组件在上传流水线中展示进度 */
  onStartImport?: (params: SearchImportParams) => void
}) {
  useTranslation()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'google_images' | 'pixabay' | 'internet_archive'>('pixabay')
  const [quantity, setQuantity] = useState(5)
  const [pixabayImageType, setPixabayImageType] = useState('photo')
  const [pixabayOrder, setPixabayOrder] = useState('popular')
  const [archiveSort, setArchiveSort] = useState('relevance')
  const [randomize, setRandomize] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success_count: number; failed_count: number; total: number; message: string } | null>(null)
  const [progress, setProgress] = useState<{
    stage: string
    current: number
    total: number
    message: string
  } | null>(null)
  const modalDomId = React.useId().replace(/:/g, '')
  const progressId = `${modalDomId}-search-import-progress`
  const errorId = `${modalDomId}-search-import-error`
  const resultId = `${modalDomId}-search-import-result`

  const buildParams = (): SearchImportParams => ({
    kb_id: kbId,
    query: query.trim(),
    source,
    quantity: Math.min(20, Math.max(1, quantity)),
    pixabay_image_type: source === 'pixabay' ? pixabayImageType : undefined,
    pixabay_order: source === 'pixabay' ? pixabayOrder : undefined,
    archive_sort: source === 'internet_archive' ? archiveSort : undefined,
    randomize,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) {
      setError(t("请输入搜索关键词"))
      return
    }
    setError(null)
    setResult(null)
    setProgress(null)
    const params = buildParams()
    if (onStartImport) {
      onStartImport(params)
      onClose()
      return
    }
    setLoading(true)
    try {
      await importApi.importFromSearchStream(params, (event) => {
        if (event.stage === 'done') {
          setResult({
            success_count: event.success_count ?? 0,
            failed_count: event.failed_count ?? 0,
            total: event.total ?? 0,
            message: event.message ?? '',
          })
          if ((event.success_count ?? 0) > 0) onSuccess()
          setProgress(null)
        } else if (event.stage === 'error') {
          setError(event.message ?? t("导入失败"))
          setProgress(null)
        } else {
          setProgress({
            stage: event.stage,
            current: event.current ?? 0,
            total: event.total ?? 0,
            message: event.message ?? '',
          })
        }
      })
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("导入失败")))
    } finally {
      setLoading(false)
    }
  }

  const stageLabel =
    progress?.stage === 'searching'
      ? t("搜索中…")
      : progress?.stage === 'downloading'
        ? t("下载 {{value1}}/{{value2}}", { value1: progress.current, value2: progress.total })
        : progress?.stage === 'importing'
          ? t("导入 {{value1}}/{{value2}}", { value1: progress.current, value2: progress.total })
          : progress?.stage
            ? progress.stage
            : ''

  const progressCurrent = progress?.current ?? 0
  const progressTotal = progress?.total ?? 0
  return (
    <WorkflowDialog
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      eyebrow={t("素材导入")}
      title={t("搜索图片导入")}
      description={t("按关键词查找图片，直接导入当前素材空间。")}
      icon={<ImagePlus size={20} />}
      size="md"
      className="import-dialog import-dialog--images"
      sourceTheme="images"
      busy={loading}
      onSubmit={handleSubmit}
      footer={(
        <>
          <span className="workflow-footer-summary">{t("最多导入")} {Math.min(20, Math.max(1, quantity))}  {t("张图片")}</span>
          <div className="workflow-footer-actions">
            <button type="button" disabled={loading} onClick={onClose} aria-label={result ? t("关闭图片搜索导入弹窗") : t("取消图片搜索导入")} className="workflow-button">{result ? t("关闭") : t("取消")}</button>
            <button type="submit" disabled={loading} aria-describedby={error ? errorId : progress ? progressId : result ? resultId : undefined} aria-label={loading ? t("正在导入图片搜索结果") : t("开始导入图片搜索结果")} className="workflow-button workflow-button-primary">
              {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}{loading ? t("正在处理…") : t("搜索并导入")}
            </button>
          </div>
        </>
      )}
    >
      <fieldset className="import-form" disabled={loading}>
        <div className="import-primary-field">
          <label htmlFor={`${modalDomId}-query`} className="workflow-label">{t("搜索关键词")} <span className="import-required">*</span></label>
          <div className="import-input-icon">
            <Search size={18} aria-hidden />
            <input data-autofocus id={`${modalDomId}-query`} name="query" type="text" required value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("例如：山间日出、建筑细节")} className="workflow-field" />
          </div>
        </div>
        <fieldset className="import-option-group">
          <legend className="workflow-label">{t("图片来源")}</legend>
          <div className="import-segmented import-source-options">
            {([{ value: 'pixabay', label: 'Pixabay', hint: t("素材图库") }, { value: 'google_images', label: 'Google', hint: t("全网图片") }, { value: 'internet_archive', label: 'Internet Archive', hint: t("数字馆藏") }] as const).map((item) => (
              <label key={item.value} className={cn('import-segment', source === item.value && 'is-selected')}>
                <input type="radio" name="image-source" value={item.value} checked={source === item.value} onChange={() => setSource(item.value)} className="sr-only" />
                <strong>{item.label}</strong><small>{item.hint}</small>
                <span className="import-radio-mark" aria-hidden />
              </label>
            ))}
          </div>
        </fieldset>
        {source === 'pixabay' && (
          <div className="import-field-grid">
            <div>
              <label htmlFor={`${modalDomId}-type`} className="workflow-label">{t("图片类型")}</label>
              <select id={`${modalDomId}-type`} name="pixabay_image_type" value={pixabayImageType} onChange={(e) => setPixabayImageType(e.target.value)} className="workflow-field"><option value="all">{t("全部类型")}</option><option value="photo">{t("照片")}</option><option value="illustration">{t("插画")}</option><option value="vector">{t("矢量图")}</option></select>
            </div>
            <div>
              <label htmlFor={`${modalDomId}-order`} className="workflow-label">{t("排序方式")}</label>
              <select id={`${modalDomId}-order`} name="pixabay_order" value={pixabayOrder} onChange={(e) => setPixabayOrder(e.target.value)} className="workflow-field"><option value="popular">{t("最受欢迎")}</option><option value="latest">{t("最新发布")}</option></select>
            </div>
          </div>
        )}
        {source === 'internet_archive' && (
          <div>
            <label htmlFor={`${modalDomId}-sort`} className="workflow-label">{t("排序方式")}</label>
            <select id={`${modalDomId}-sort`} name="archive_sort" value={archiveSort} onChange={(e) => setArchiveSort(e.target.value)} className="workflow-field"><option value="relevance">{t("相关度")}</option><option value="popular">{t("最受欢迎")}</option><option value="newest">{t("最新发布")}</option></select>
          </div>
        )}
        <div className="import-quantity-row">
          <div>
            <label htmlFor={`${modalDomId}-quantity`} className="workflow-label">{t("导入数量")}</label>
            <input id={`${modalDomId}-quantity`} name="quantity" type="number" min={1} max={20} value={quantity} onChange={(e) => setQuantity(Number(e.target.value) || 5)} className="workflow-field" aria-describedby={`${modalDomId}-quantity-help`} />
            <p id={`${modalDomId}-quantity-help`} className="workflow-help">{t("1–20 张")}</p>
          </div>
          <label className="import-check-row import-randomize"><input name="randomize" type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} /><span>{t("增加结果随机性")}<small>{t("相同关键词也能发现不同图片")}</small></span></label>
        </div>
      </fieldset>
      {progress && (
        <div id={progressId} className="import-progress" role="status" aria-live="polite" aria-atomic="true">
          <div className="import-progress-heading"><Loader2 size={15} className="animate-spin" aria-hidden /><strong>{stageLabel}</strong>{progressTotal > 0 && <span>{progressCurrent} / {progressTotal}</span>}</div>
          {progressTotal > 0 && <div className="import-progress-track" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={progressTotal} aria-valuenow={progressCurrent}><div style={{ width: `${Math.min(100, (progressCurrent / progressTotal) * 100)}%` }} /></div>}
          {progress.message && <p className="workflow-help import-wrap">{progress.message}</p>}
        </div>
      )}
      {error && <p id={errorId} className="import-error" role="alert"><AlertCircle size={16} aria-hidden />{error}</p>}
      {result && <p id={resultId} className="workflow-note" role="status">{result.message}</p>}
    </WorkflowDialog>
  )
}

interface KnowledgeListProps {
  /** 由应用路由提供；为空时显示知识库总览。 */
  routeKnowledgeBaseId?: string
  /** 让详情选择与浏览器前进/后退保持同一份状态。 */
  onRouteChange?: (knowledgeBaseId?: string) => void
}

const KnowledgeList: React.FC<KnowledgeListProps> = ({
  routeKnowledgeBaseId,
  onRouteChange,
}) => {
  const [viewState, setViewState] = useState<'list' | 'detail'>('list')
  const [activeKbId, setActiveKbId] = useState<string | null>(null)
  const [routeKb, setRouteKb] = useState<{ id: string; name: string; description: string } | null>(null)
  const activeKbIdRef = useRef<string | null>(null)
  const fileRequestVersionRef = useRef(0)
  const statsRequestVersionRef = useRef(0)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileFilter, setFileFilter] = useState<KnowledgeFileFilter>('all')
  const [detailSection, setDetailSection] = useState<KnowledgeDetailSection>('materials')
  const [topicsVisited, setTopicsVisited] = useState(false)
  const [uploadExpanded, setUploadExpanded] = useState(false)
  const detailScrollRef = useRef<HTMLDivElement>(null)
  const uploadButtonRef = useRef<HTMLButtonElement>(null)
  const allFileFilterRef = useRef<HTMLButtonElement>(null)
  const fileSearchRef = useRef<HTMLInputElement>(null)
  const [fileView, setFileView] = useState<'grid' | 'table'>('grid')
  const fileListDomId = React.useId().replace(/:/g, '')
  const fileSearchInputId = `${fileListDomId}-file-search`
  const fileResultsStatusId = `${fileListDomId}-file-results-status`
  const fileGridTabId = `${fileListDomId}-file-grid-tab`
  const fileTableTabId = `${fileListDomId}-file-table-tab`
  const fileViewTabRefs = useRef<Record<'grid' | 'table', HTMLButtonElement | null>>({
    grid: null,
    table: null,
  })
  const [previewFile, setPreviewFile] = useState<KnowledgeFileView | null>(null)
  const [dragOverlay, setDragOverlay] = useState(false)
  const [showImportUrlModal, setShowImportUrlModal] = useState(false)
  const [showImportSearchModal, setShowImportSearchModal] = useState(false)
  const [showImportFolderModal, setShowImportFolderModal] = useState(false)
  const [showImportHotTopicsModal, setShowImportHotTopicsModal] = useState(false)
  const [manualInputDraft, setManualInputDraft] = useState<ManualInputDraft | null>(null)
  const { batches: uploadBatches, batchesRef: uploadBatchesRef, updateBatch, claimBatch, removeUploads, isUploadRemoved } = useKnowledgeUploadBatches()
  const activeUploadBatch = activeKbId ? uploadBatches[activeKbId] : undefined
  const uploading = activeUploadBatch?.uploading ?? false
  const uploadProgress = activeUploadBatch?.progress
  const currentUploadFiles = activeUploadBatch?.currentFiles ?? null
  const [uploadRetryStates, setUploadRetryStates] = useState<Record<string, Record<string, { pending?: boolean; error?: string }>>>({})
  const [fileDeleteErrors, setFileDeleteErrors] = useState<Record<string, string>>({})
  const fileDeleteError = activeKbId ? fileDeleteErrors[activeKbId] : undefined
  const deletingFileKeys = useRef(new Set<string>())
  // Each callback closes over its own KB. A late A response must never write B's panel.
  const setUploadField = useCallback(<K extends keyof KnowledgeUploadBatch>(
    field: K, value: React.SetStateAction<KnowledgeUploadBatch[K]>,
  ) => {
    if (!activeKbId) return
    updateBatch(activeKbId, previous => ({
      ...previous,
      [field]: typeof value === 'function'
        ? (value as (current: KnowledgeUploadBatch[K]) => KnowledgeUploadBatch[K])(previous[field])
        : value,
    }))
  }, [activeKbId, updateBatch])
  const setUploadProgress = (value: React.SetStateAction<UploadPipelineProgress | undefined>) => setUploadField('progress', value)
  const setCurrentUploadFiles = (value: React.SetStateAction<File[] | null>) => setUploadField('currentFiles', value)
  const setUploading = (value: boolean) => setUploadField('uploading', value)
  const setBatchSubmissionFailed = (value: number) => setUploadField('submissionFailed', value)
  const setBackgroundUploadTasks = (value: React.SetStateAction<BackgroundUploadTask[]>) => setUploadField('tasks', value)
  const setBackgroundUploadTaskOutcomes = (value: React.SetStateAction<Record<string, BackgroundUploadTaskOutcome>>) => setUploadField('outcomes', value)
  const pendingUploadTaskKey = Object.values(uploadBatches)
    .flatMap(batch => batch.tasks.filter(task => !batch.outcomes[task.processingId]).map(task => task.processingId))
    .sort().join(',')
  const [files, setFiles] = useState<KnowledgeFileView[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  /** 文件列表临时不可用时保留上一帧数据，并以指数退避重新同步。 */
  const [fileListRetry, setFileListRetry] = useState<{ kbId: string; attempt: number } | null>(null)
  /** 进度接口短暂失败不能直接把服务端任务判死；仅用于控制下一次轮询间隔。 */
  const progressPollFailureCountRef = useRef<Record<string, number>>({})
  const [kbStats, setKbStats] = useState<{
    documents: number
    chunks: number
    images: number
    audio?: number
    video?: number
    video_shots?: number
    text_vector_dim?: number
    image_vector_dim?: number
    audio_vector_dim?: number
  } | null>(null)

  const {
    knowledgeBases,
    loading,
    error: listFetchError,
    fetchKnowledgeBases,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
  } = useKnowledgeStore()

  const activateKnowledgeBase = useCallback((knowledgeBaseId: string, syncRoute = true) => {
    // 先使所有旧请求失效并清空可见数据，再进入新库。这样不会让 A 库的慢响应写回 B 库。
    activeKbIdRef.current = knowledgeBaseId
    fileRequestVersionRef.current += 1
    statsRequestVersionRef.current += 1
    setRouteKb(null)
    setActiveKbId(knowledgeBaseId)
    setViewState('detail')
    setFiles([])
    setFilesLoading(true)
    setKbStats(null)
    setFileListRetry(null)
    setFileQuery('')
    setFileFilter('all')
    setDetailSection('materials')
    setTopicsVisited(false)
    setUploadExpanded(false)
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0
    setPreviewFile(null)
    setDragOverlay(false)
    setShowImportUrlModal(false)
    setShowImportSearchModal(false)
    setShowImportFolderModal(false)
    setShowImportHotTopicsModal(false)
    setManualInputDraft(null)
    if (syncRoute && routeKnowledgeBaseId !== knowledgeBaseId) {
      onRouteChange?.(knowledgeBaseId)
    }
  }, [onRouteChange, routeKnowledgeBaseId])

  const returnToKnowledgeList = useCallback((syncRoute = true) => {
    activeKbIdRef.current = null
    fileRequestVersionRef.current += 1
    statsRequestVersionRef.current += 1
    setActiveKbId(null)
    setViewState('list')
    setFiles([])
    setFilesLoading(false)
    setKbStats(null)
    setFileListRetry(null)
    setFileQuery('')
    setFileFilter('all')
    setDetailSection('materials')
    setTopicsVisited(false)
    setUploadExpanded(false)
    if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0
    setPreviewFile(null)
    if (syncRoute && routeKnowledgeBaseId) {
      onRouteChange?.()
    }
  }, [onRouteChange, routeKnowledgeBaseId])

  // 处理地址栏、浏览器前进/后退和卡片点击三种入口。状态只以 URL 对应的知识库为准。
  useEffect(() => {
    const nextKnowledgeBaseId = routeKnowledgeBaseId?.trim() || null
    if (!nextKnowledgeBaseId) {
      if (viewState === 'detail' || activeKbId) returnToKnowledgeList(false)
      return
    }
    if (viewState !== 'detail' || activeKbId !== nextKnowledgeBaseId) {
      activateKnowledgeBase(nextKnowledgeBaseId, false)
    }
  }, [activateKnowledgeBase, activeKbId, returnToKnowledgeList, routeKnowledgeBaseId, viewState])

  useEffect(() => {
    activeKbIdRef.current = activeKbId
  }, [activeKbId])

  const [menuOpenKbId, setMenuOpenKbId] = useState<string | null>(null)
  const [editKb, setEditKb] = useState<{ id: string; name: string; description: string } | null>(null)

  const focusFileViewTab = (nextView: 'grid' | 'table') => {
    setFileView(nextView)
    requestAnimationFrame(() => fileViewTabRefs.current[nextView]?.focus())
  }

  const handleFileViewTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      focusFileViewTab(fileView === 'grid' ? 'table' : 'grid')
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusFileViewTab('grid')
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusFileViewTab('table')
    }
  }

  useEffect(() => {
    if (menuOpenKbId == null) return
    const close = () => setMenuOpenKbId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpenKbId])

  const removeDeletedUpload = useCallback((kbId: string, removal: UploadRemoval) => {
    removeUploads(kbId, removal)
    setUploadRetryStates(previous => ({
      ...previous,
      [kbId]: Object.fromEntries(Object.entries(previous[kbId] ?? {}).filter(([processingId]) => !isUploadRemoved(kbId, undefined, processingId))),
    }))
    if (activeKbIdRef.current === kbId) {
      setFiles(previous => previous.filter(file => !isUploadRemoved(kbId, file.id, file.processingId)))
      setPreviewFile(previous => previous && isUploadRemoved(kbId, previous.id, previous.processingId) ? null : previous)
    }
  }, [removeUploads, isUploadRemoved])

  // Terminal sessions no longer poll. Reconcile tombstones when returning to a
  // space/tab so another tab's deletion cannot survive in local batch feedback.
  const reconcileDeletedUploads = useCallback(async (kbId: string) => {
    const batch = uploadBatchesRef.current[kbId]
    const ids = batch?.tasks.filter(task => batch.outcomes[task.processingId]).map(task => task.processingId) ?? []
    const groups: string[][] = []
    for (let start = 0; start < ids.length; start += 1000) groups.push(ids.slice(start, start + 1000))
    await Promise.all(groups.map(async group => {
      try {
        const snapshot = await knowledgeApi.getUploadProgressBatch(group)
        for (const status of snapshot.statuses) {
          if (status.status === 'deleted' && group.includes(status.processing_id)) {
            removeDeletedUpload(kbId, { fileId: status.file_id, processingIds: [status.processing_id] })
          }
        }
      } catch { /* A temporarily unavailable status service is not proof of deletion. */ }
    }))
  }, [uploadBatchesRef, removeDeletedUpload])

  useEffect(() => {
    if (viewState !== 'detail' || !activeKbId) return
    const reconcile = () => { void reconcileDeletedUploads(activeKbId) }
    const onVisibility = () => { if (document.visibilityState === 'visible') reconcile() }
    reconcile()
    window.addEventListener('focus', reconcile)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', reconcile)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [viewState, activeKbId, reconcileDeletedUploads])

  const fetchFiles = useCallback(async (knowledgeBaseId = activeKbId) => {
    if (!knowledgeBaseId || activeKbIdRef.current !== knowledgeBaseId) return
    const requestVersion = ++fileRequestVersionRef.current
    try {
      const res = await knowledgeApi.getKnowledgeBaseFiles(knowledgeBaseId)
      const list: KnowledgeFileView[] = (res?.files || []).map((f: KnowledgeFileApiItem) => ({
        id: f.id,
        name: f.name,
        size: f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`,
        date: f.date || '-',
        type: f.type,
        status: f.status || 'ready',
        processingId: f.processing_id,
        stage: f.stage,
        progress: normalizeProgress(f.progress),
        message: f.message,
        error: f.error,
        ...uploadFailureFields(f),
        ...(isUploadSourceUnavailable(f) ? { storage_persisted: false } : {}),
        updatedAt: f.updated_at,
        previewUrl: f.preview_url,
        thumbnailUrl: f.thumbnail_url,
        coverUrl: f.cover_url,
        coverTimestamp: f.cover_timestamp,
        textPreview: f.text_preview,
      }))
      // 一个请求只允许写回它发起时所对应的知识库；切换或后续刷新都会使它失效。
      if (
        activeKbIdRef.current !== knowledgeBaseId
        || requestVersion !== fileRequestVersionRef.current
      ) return
      list.filter(file => file.status === 'deleted').forEach(file => removeDeletedUpload(knowledgeBaseId, { fileId: file.id, processingIds: file.processingId ? [file.processingId] : [] }))
      setFiles(list.filter(file => file.status !== 'deleted' && !isUploadRemoved(knowledgeBaseId, file.id, file.processingId)).map(file => {
        const latest = uploadBatchesRef.current[knowledgeBaseId]?.progress?.files?.find(entry => entry.id === file.processingId)
        if (!latest || !isOlderServiceSnapshot(file.updatedAt, latest.updated_at)) return file
        return {
          ...file, status: latest.status === 'completed' ? 'ready' : latest.status,
          stage: latest.stage, progress: latest.progress, message: latest.message, error: latest.error,
          ...Object.fromEntries(uploadFailureKeys.map(key => [key, latest[key]])), updatedAt: latest.updated_at,
        }
      }))
      setFilesLoading(false)
      setFileListRetry(null)
    } catch (error) {
      if (
        activeKbIdRef.current !== knowledgeBaseId
        || requestVersion !== fileRequestVersionRef.current
      ) return
      // 网络波动或后端暂时繁忙时，不能抹掉已经显示的待处理视频，否则轮询条件也会随之丢失。
      console.warn(t("获取文件列表失败，将保留当前列表并重试"), error)
      setFilesLoading(false)
      setFileListRetry((previous) => ({
        kbId: knowledgeBaseId,
        attempt: previous?.kbId === knowledgeBaseId ? Math.min(previous.attempt + 1, 6) : 1,
      }))
    }
  }, [activeKbId, isUploadRemoved, removeDeletedUpload, uploadBatchesRef])

  const fetchKbStats = useCallback(async (knowledgeBaseId = activeKbId) => {
    if (!knowledgeBaseId || activeKbIdRef.current !== knowledgeBaseId) return
    const requestVersion = ++statsRequestVersionRef.current
    try {
      const stats = await knowledgeApi.getKnowledgeBaseStats(knowledgeBaseId)
      if (
        activeKbIdRef.current !== knowledgeBaseId
        || requestVersion !== statsRequestVersionRef.current
      ) return
      setKbStats(stats)
    } catch {
      if (
        activeKbIdRef.current !== knowledgeBaseId
        || requestVersion !== statsRequestVersionRef.current
      ) return
      setKbStats(null)
    }
  }, [activeKbId])

  const refreshKbDetail = useCallback(async () => {
    if (!activeKbId) return
    await Promise.all([
      fetchKnowledgeBases(),
      fetchFiles(),
      fetchKbStats(),
    ])
  }, [activeKbId, fetchFiles, fetchKbStats, fetchKnowledgeBases])

  useEffect(() => {
    if (viewState === 'detail' && activeKbId) void fetchFiles()
  }, [viewState, activeKbId, fetchFiles])

  // 文件列表失败后在 1/2/4/8/16/30 秒退避重试；成功时由 fetchFiles 清除 retry 状态。
  useEffect(() => {
    if (!fileListRetry || viewState !== 'detail' || fileListRetry.kbId !== activeKbId) return
    const delay = Math.min(30000, 1000 * (2 ** Math.max(0, fileListRetry.attempt - 1)))
    const timer = window.setTimeout(() => { void fetchFiles() }, delay)
    return () => window.clearTimeout(timer)
  }, [fileListRetry, viewState, activeKbId, fetchFiles])

  useEffect(() => {
    if (viewState === 'detail' && activeKbId) {
      setKbStats(null)
      void fetchKbStats()
    }
  }, [viewState, activeKbId, fetchKbStats])

  // 本地批量上传：接口只负责“提交全部文件”，解析在服务端后台队列继续。这里必须
  // 轮询全部任务，不能按当前打开的知识库过滤；用户切换 KB 后，原批次仍应继续收敛。
  // 每个 KB 独立收敛并保存反馈；切换空间不会取消其他空间的传输或轮询。
  useEffect(() => {
    if (!pendingUploadTaskKey) return
    let disposed = false
    let timer: number | undefined

    const poll = async () => {
      const pendingTasks = Object.values(uploadBatchesRef.current)
        .flatMap(batch => batch.tasks.filter(task => !batch.outcomes[task.processingId]))
      if (!pendingTasks.length) return
      const snapshotById = new Map<string, UploadProgressStatus>()
      const snapshotErrors = new Map<string, unknown>()
      // Each space may have a full batch; the server bounds each status request to 1000 IDs.
      const groups: BackgroundUploadTask[][] = []
      for (let start = 0; start < pendingTasks.length; start += 1000) groups.push(pendingTasks.slice(start, start + 1000))
      await Promise.all(groups.map(async group => {
        try {
          const snapshot = await knowledgeApi.getUploadProgressBatch(group.map(task => task.processingId))
          snapshot.statuses.forEach(status => snapshotById.set(status.processing_id, status))
        } catch (error) { group.forEach(task => snapshotErrors.set(task.processingId, error)) }
      }))
      let taskStates: BackgroundTaskPollResult[] = await Promise.all(pendingTasks.map(async (task) => {
        try {
          if (snapshotErrors.has(task.processingId)) throw snapshotErrors.get(task.processingId)
          let status = snapshotById.get(task.processingId)
          if (!status || status.status === 'error') throw new Error(status?.error || t("进度状态暂不可用"))
          const latest = uploadBatchesRef.current[task.kbId]?.progress?.files?.find(file => file.id === task.processingId)
          if (latest && isOlderServiceSnapshot(status.updated_at, latest.updated_at)) {
            status = { ...latest, processing_id: task.processingId }
          }
          const normalizedStatus = String(status?.status || '').toLowerCase()
          if (normalizedStatus === 'deleted') {
            delete progressPollFailureCountRef.current[task.processingId]
            return { task, status, deleted: true }
          }
          if (normalizedStatus === 'completed') {
            delete progressPollFailureCountRef.current[task.processingId]
            return { task, status, terminal: 'completed' as const }
          }
          // 明确失败或任务已过期时结束轮询；服务异常和空响应在上方进入重试。
          if (normalizedStatus === 'failed' || normalizedStatus === 'not_found') {
            delete progressPollFailureCountRef.current[task.processingId]
            return {
              task,
              status,
              terminal: 'failed' as const,
              error: status?.error || status?.message || t("上传任务已过期，请查看文件列表确认结果"),
            }
          }
          delete progressPollFailureCountRef.current[task.processingId]
          return { task, status }
        } catch (error) {
          const message = getErrorMessage(error, t("无法获取上传任务状态"))
          const httpStatus = getErrorHttpStatus(error)
          // 404 表示后端明确找不到任务；其余网络/超时错误可能只是服务繁忙，不能把仍在
          // 运行的长视频误标失败。
          if (httpStatus === 404) {
            delete progressPollFailureCountRef.current[task.processingId]
            return {
              task,
              status: {
                processing_id: task.processingId,
                status: 'failed',
                stage: 'error',
                message,
                error: message,
              },
              terminal: 'failed' as const,
              error: message,
            }
          }
          const failureCount = (progressPollFailureCountRef.current[task.processingId] || 0) + 1
          progressPollFailureCountRef.current[task.processingId] = failureCount
          const retryDelayMs = Math.min(30000, 1500 * (2 ** Math.min(failureCount - 1, 4)))
          return {
            task,
            status: {
              processing_id: task.processingId,
              status: 'processing',
              stage: 'processing',
              message: t("进度服务暂不可用，{{value1}} 秒后重试。", { value1: Math.ceil(retryDelayMs / 1000) }),
            },
            transient: true,
            error: message,
            retryDelayMs,
          }
        }
      }))
      if (disposed) return
      taskStates.filter(item => item.deleted).forEach(item => removeDeletedUpload(item.task.kbId, {
        fileId: item.status?.file_id || item.task.fileId,
        processingIds: [item.task.processingId],
      }))
      taskStates = taskStates.filter(item => !item.deleted && !isUploadRemoved(item.task.kbId, item.status?.file_id || item.task.fileId, item.task.processingId))
      if (!taskStates.length) return

      // 成功读取到的服务端任务态立即合并进文件卡片。这样不必等下一轮文件列表刷新，
      // 阶段、百分比和失败原因就能在当前页面呈现。
      const statusesByProcessingId = new Map<string, BackgroundTaskPollResult>()
      const statusesByFileId = new Map<string, BackgroundTaskPollResult>()
      taskStates.forEach((item) => {
        if (!item.status || item.transient) return
        statusesByProcessingId.set(item.task.processingId, item)
        const fileId = item.status.file_id || item.status.result?.file_id
        if (fileId) statusesByFileId.set(fileId, item)
      })
      if (statusesByProcessingId.size > 0 || statusesByFileId.size > 0) {
        setFiles((previous) => {
          let changed = false
          const next = previous.map((file) => {
            const item = (file.processingId ? statusesByProcessingId.get(file.processingId) : undefined)
              || statusesByFileId.get(file.id)
            if (!item?.status || item.task.kbId !== activeKbIdRef.current) return file

            const status = item.status
            if (isOlderServiceSnapshot(status.updated_at, file.updatedAt)) return file
            const normalizedStatus = String(status.status || '').toLowerCase()
            const nextStatus = normalizedStatus === 'completed'
              ? 'ready'
              : ['failed', 'not_found', 'error'].includes(normalizedStatus)
                ? 'failed'
                : normalizedStatus || file.status
            const nextProgress = normalizeProgress(status.progress) ?? file.progress
            const nextFile: KnowledgeFileView = {
              ...file,
              processingId: file.processingId || status.processing_id,
              status: nextStatus,
              stage: status.stage ?? file.stage,
              progress: nextProgress,
              message: status.message ?? file.message,
              error: status.updated_at ? status.error ?? item.error : status.error ?? item.error ?? file.error,
              ...(status.updated_at ? Object.fromEntries(uploadFailureKeys.map(key => [key, status[key]])) : uploadFailureFields(status)),
              updatedAt: status.updated_at ?? file.updatedAt,
            }
            if (
              nextFile.processingId === file.processingId
              && nextFile.status === file.status
              && nextFile.stage === file.stage
              && nextFile.progress === file.progress
              && nextFile.message === file.message
              && nextFile.error === file.error
              && nextFile.updatedAt === file.updatedAt
              && uploadFailureKeys.every(key => nextFile[key] === file[key])
            ) {
              return file
            }
            changed = true
            return nextFile
          })
          return changed ? next : previous
        })
      }

      const finishedKbIds: string[] = []
      for (const kbId of new Set(taskStates.map(item => item.task.kbId))) {
        const states = taskStates.filter(item => item.task.kbId === kbId)
        updateBatch(kbId, previous => {
          const nextOutcomes = { ...previous.outcomes }
          states.forEach(item => {
            if (item.terminal) nextOutcomes[item.task.processingId] = item.terminal
          })
          const tasks = previous.tasks.map(task => {
            const fileId = states.find(item => item.task.processingId === task.processingId)?.status?.file_id
            return fileId && fileId !== task.fileId ? { ...task, fileId } : task
          })
          const completed = tasks.filter(task => nextOutcomes[task.processingId] === 'completed').length
          const failed = tasks.filter(task => nextOutcomes[task.processingId] === 'failed').length
          const allTerminal = completed + failed === tasks.length
          const active = states.find(item => !item.terminal && !item.transient && item.status?.status === 'processing')
            ?? states.find(item => !item.terminal && !item.transient && item.status)
            ?? states.find(item => !item.terminal && item.status)
          const prev = previous.progress
          if (allTerminal) finishedKbIds.push(kbId)
          return {
            ...previous, tasks, outcomes: nextOutcomes,
            uploading: !allTerminal, currentFiles: null,
            progress: {
              ...prev,
              total: tasks.length + previous.submissionFailed,
              stage: allTerminal ? 'done' : toPipelineStage(active?.status?.stage),
              stageProgress: active?.status?.progress ?? (allTerminal ? 100 : prev?.stageProgress),
              currentFile: active?.task.filename ?? prev?.currentFile,
              currentFileIsImage: active?.task.isImage ?? prev?.currentFileIsImage,
              submitted: true,
              message: states.some(item => item.transient) ? t("进度同步暂时中断，正在重试；后台任务仍会继续。") : undefined,
              files: tasks.map<UploadFileProgress>(task => {
                const item = states.find(item => item.task.processingId === task.processingId)
                const last = prev?.files?.find(file => file.id === task.processingId)
                return {
                  ...last, id: task.processingId, name: task.filename,
                  ...(item?.status && !item.transient ? {
                    ...(item.status.updated_at ? Object.fromEntries(uploadFailureKeys.map(key => [key, item.status![key]])) : {}),
                    ...item.status, error: item.status.error,
                  } : {}),
                  status: nextOutcomes[task.processingId] ?? (item?.transient ? last?.status : item?.status?.status) ?? last?.status ?? 'queued',
                }
              }).concat((prev?.files ?? []).filter(file => !tasks.some(task => task.processingId === file.id))),
              completed, failed: previous.submissionFailed + failed,
            },
          }
        })
      }
      if (finishedKbIds.length) {
        void fetchKnowledgeBases({ silent: true })
        const visibleKbId = activeKbIdRef.current
        if (visibleKbId && finishedKbIds.includes(visibleKbId)) {
          void fetchFiles(visibleKbId)
          void fetchKbStats(visibleKbId)
        }
      }
      const retryDelayMs = taskStates.reduce(
        (delay, item) => Math.max(delay, item.retryDelayMs || 0),
        1500,
      )
      timer = window.setTimeout(poll, retryDelayMs)
    }
    void poll()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [pendingUploadTaskKey, uploadBatchesRef, updateBatch, fetchFiles, fetchKbStats, fetchKnowledgeBases, removeDeletedUpload, isUploadRemoved])

  // Session handles restore all spaces on mount. The server list also recovers tasks
  // started elsewhere, without replacing an in-flight local submission or its failures.
  useEffect(() => {
    if (viewState !== 'detail' || !activeKbId) return
    updateBatch(activeKbId, saved => {
      let previous = saved
      // A completed session snapshot is no longer polled. Refresh its failure
      // classification from the file list without reviving any terminal task.
      if (saved.progress?.files) {
        let changed = false
        const refreshed = saved.progress.files.map(entry => {
          const file = files.find(file => file.processingId === entry.id && file.status === 'failed')
          if (entry.status !== 'failed' || !file) return entry
          const oldTime = serviceTimestamp(entry.updated_at)
          const newTime = serviceTimestamp(file.updatedAt)
          if (Number.isFinite(oldTime) && Number.isFinite(newTime) && newTime < oldTime) return entry
          const authoritative = Number.isFinite(newTime)
          const next: UploadFileProgress = {
            ...entry,
            // The file API omits null fields. A current, dated snapshot therefore
            // also clears a previous attempt's classification and diagnostics.
            ...(authoritative ? Object.fromEntries(uploadFailureKeys.map(key => [key, file[key]])) : uploadFailureFields(file)),
            error: authoritative ? file.error : file.error ?? entry.error,
            message: authoritative ? file.message : file.message ?? entry.message,
            updated_at: authoritative ? file.updatedAt : entry.updated_at,
          }
          if (next.error === entry.error && next.message === entry.message && next.updated_at === entry.updated_at && uploadFailureKeys.every(key => next[key] === entry[key])) return entry
          changed = true
          return next
        })
        if (changed) previous = { ...saved, progress: { ...saved.progress, files: refreshed } }
      }
      const existingIds = new Set(previous.tasks.map(task => task.processingId))
      const recoverableFiles = files.filter(file => {
        if (!isPendingFileStatus(file.status) || !file.processingId) return false
        if (!previous.outcomes[file.processingId]) return !existingIds.has(file.processingId)
        const old = previous.progress?.files?.find(item => item.id === file.processingId)
        const previousTime = serviceTimestamp(old?.updated_at)
        const serverTime = serviceTimestamp(file.updatedAt)
        // Another tab may retry the same processing_id. Only a newer service timestamp
        // can revive it; a delayed pending list response must not undo a terminal poll.
        return Number.isFinite(serverTime) && Number.isFinite(previousTime) && serverTime > previousTime
      })
      if (!recoverableFiles.length || (previous.uploading && !previous.progress?.submitted)) return previous
      // A list refresh can see a retry before its POST receipt arrives. A newer
      // attempt of an existing task remains part of the same batch and history.
      const ongoing = previous.progress?.stage !== 'done' || recoverableFiles.some(file => existingIds.has(file.processingId!))
      const recoveredIds = new Set(recoverableFiles.map(file => file.processingId))
      const tasks = (ongoing ? previous.tasks.filter(task => !recoveredIds.has(task.processingId)) : []).concat(recoverableFiles.map(file => ({
        processingId: file.processingId!, filename: file.name,
        isImage: isImageFileType(file.type), kbId: activeKbId, fileId: file.id,
      })))
      const oldFiles = ongoing ? previous.progress?.files?.filter(file => !recoveredIds.has(file.id)) ?? [] : []
      const outcomes = { ...previous.outcomes }
      recoverableFiles.forEach(file => delete outcomes[file.processingId!])
      const submissionFailed = ongoing ? previous.submissionFailed : 0
      const active = recoverableFiles.find(file => file.status === 'processing') ?? recoverableFiles[0]
      return {
        ...previous, uploading: true, tasks,
        outcomes, submissionFailed,
        progress: {
          ...previous.progress, stage: toPipelineStage(active.stage), submitted: true,
          files: oldFiles.concat(recoverableFiles.map(file => ({
            id: file.processingId!, name: file.name, status: file.status ?? 'queued',
            file_id: file.id,
            stage: file.stage, progress: file.progress, message: file.message, error: file.error, updated_at: file.updatedAt,
            ...uploadFailureFields(file),
          }))),
          stageProgress: active.progress ?? 0, total: tasks.length + submissionFailed,
          completed: tasks.filter(task => outcomes[task.processingId] === 'completed').length,
          failed: submissionFailed + tasks.filter(task => outcomes[task.processingId] === 'failed').length,
          currentFile: active.name, currentFileIsImage: isImageFileType(active.type),
        },
      }
    })
  }, [viewState, activeKbId, files, updateBatch])

  const hasPendingFiles = files.some((file) => isPendingFileStatus(file.status))
  useEffect(() => {
    if (viewState !== 'detail' || !activeKbId || fileListRetry || !hasPendingFiles) return
    let disposed = false
    let timer: number
    const refresh = async () => {
      await fetchFiles()
      if (!disposed) timer = window.setTimeout(refresh, 10000)
    }
    timer = window.setTimeout(refresh, 10000)
    return () => { disposed = true; window.clearTimeout(timer) }
  }, [viewState, activeKbId, hasPendingFiles, fetchFiles, fileListRetry])

  // 获取当前选中的 KB 对象
  const activeKb = knowledgeBases.find((k) => k.id === activeKbId)
    ?? (routeKb?.id === activeKbId ? { ...routeKb, stats: undefined } : undefined)
  useEffect(() => {
    if (!activeKbId) return
    let disposed = false
    knowledgeApi.getKnowledgeBaseMetadata(activeKbId).then(kb => {
      // Keep the requested alias for file/progress APIs; metadata resolves its bucket.
      if (!disposed) setRouteKb({ ...kb, id: activeKbId })
    }).catch(() => { /* Existing list/error handling remains available. */ })
    return () => { disposed = true }
  }, [activeKbId])

  // 全局拖拽上传遮罩（仅 detail 页可用）
  useEffect(() => {
    let counter = 0
    const isFileDrag = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const isLocalDropTarget = (e: DragEvent) => e.target instanceof Element && Boolean(e.target.closest('.upload-drop'))
    const resetDragOverlay = () => {
      counter = 0
      setDragOverlay(false)
    }
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e) || uploading) return
      e.preventDefault()
      counter += 1
      setDragOverlay(!isLocalDropTarget(e))
    }
    const onDragLeave = (e: DragEvent) => {
      if (!counter) return
      e.preventDefault()
      counter = Math.max(0, counter - 1)
      if (counter === 0) resetDragOverlay()
    }
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = uploading ? 'none' : 'copy'
      if (!uploading) setDragOverlay(!isLocalDropTarget(e))
    }
    const onDrop = (e: DragEvent) => {
      resetDragOverlay()
      // The local drop zone owns handled drops; always clear the page overlay.
      if (e.defaultPrevented) return
      const fileList = e.dataTransfer?.files
      if (!fileList || fileList.length === 0) return
      e.preventDefault()
      if (viewState !== 'detail' || !activeKbId || uploading) return
      const fileArray = Array.from(fileList)
      handleFileUpload(fileArray)
    }

    if (viewState === 'detail') {
      window.addEventListener('dragenter', onDragEnter)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('drop', onDrop)
      window.addEventListener('dragend', resetDragOverlay)
    }

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', resetDragOverlay)
    }
  }, [viewState, activeKbId, uploading])

  // 处理创建 KB
  const handleCreateKb = async (name: string, desc: string) => {
    try {
      await createKnowledgeBase({ name, description: desc })
      setShowCreateModal(false)
    } catch (error) {
      console.error(t("创建知识库失败:"), error)
      throw error
    }
  }

  // 处理文件上传：先把本次所有文件提交给服务端，再由后台队列执行解析。
  // 过去这里逐个 await 完整的 NDJSON 解析链路，第二个视频直到第一个完成才会发出；
  // 刷新时它仍只存在于浏览器内存，因而会“消失”。
  const handleFileUpload = async (fileList: File[], options?: { sourceType?: string }) => {
    if (!activeKbId || fileList.length === 0 || !claimBatch(activeKbId)) return
    const uploadKbId = activeKbId
    setCurrentUploadFiles(fileList)
    setUploading(true)
    setBatchSubmissionFailed(0)
    setUploadProgress({
      stage: 'minio',
      stageProgress: 0,
      total: fileList.length,
      completed: 0,
      failed: 0,
      currentFile: fileList[0]?.name,
      currentFileIsImage: fileList[0]?.type.startsWith('image/'),
      transferProgress: 0, submitted: false,
      files: fileList.map((file, index) => ({ id: `selected:${index}`, name: file.name, status: 'uploading' })),
    })

    try {
      const submitted = await knowledgeApi.startBatchUpload(uploadKbId, fileList, {
        sourceType: options?.sourceType,
        onProgress: transferProgress => setUploadProgress(prev => prev ? { ...prev, transferProgress } : prev),
      })
      const byName = new Map(fileList.map((file) => [file.name, file]))
      const tasks = submitted.results
        .filter((result) => result.status === 'queued' && result.processing_id)
        .map((result) => {
          const original = byName.get(result.filename)
          return {
            processingId: result.processing_id as string,
            filename: result.filename,
            isImage: Boolean(original?.type.startsWith('image/')),
            kbId: uploadKbId,
          }
        })
      const initialFailed = submitted.failed_count || 0
      setBatchSubmissionFailed(initialFailed)
      setUploadProgress((prev) => prev ? {
        ...prev,
        stage: tasks.length > 0 ? 'minio' : 'done',
        stageProgress: tasks.length > 0 ? 5 : 100,
        completed: 0,
        submitted: true, transferProgress: 100,
        files: submitted.results.map((result, index) => ({
          id: result.processing_id ?? `rejected:${index}`, name: result.filename,
          status: result.status, error: result.error,
        })),
        failed: initialFailed,
        currentFile: tasks[0]?.filename ?? prev.currentFile,
        currentFileIsImage: tasks[0]?.isImage ?? prev.currentFileIsImage,
      } : prev)
      void fetchFiles(uploadKbId)
      void fetchKnowledgeBases({ silent: true })

      if (tasks.length > 0) {
        // 不覆盖已有后台任务：即使用户已切到别的 KB，先前提交的任务也必须继续被轮询。
        // fetchFiles 可能已先把本批任务 hydrate 进来，这里按 processing_id 去重。
        setBackgroundUploadTasks((prev) => {
          const existingIds = new Set(prev.map((task) => task.processingId))
          const additions = tasks.filter((task) => !existingIds.has(task.processingId))
          return additions.length > 0 ? [...prev, ...additions] : prev
        })
        setBackgroundUploadTaskOutcomes((prev) => {
          const next = { ...prev }
          tasks.forEach((task) => delete next[task.processingId])
          return next
        })
        return
      }

      setUploading(false)
      setCurrentUploadFiles(null)

    } catch (error) {
      console.error(t("批量上传提交失败"), error)
      setUploadProgress((prev) => prev ? {
        ...prev,
        stage: 'done',
        stageProgress: 100,
        failed: prev.total,
        message: getErrorMessage(error, t("上传提交失败，请重试。")),
        files: prev.files?.map(file => ({ ...file, status: 'failed', error: getErrorMessage(error, t("上传提交失败")) })),
      } : prev)
      setUploading(false)
      setCurrentUploadFiles(null)

    }
  }

  const registerImportTask = (kbId: string, processingId: string, filename: string) => {
    updateBatch(kbId, previous => {
      const ongoing = previous.tasks.length > 0 && previous.progress?.stage !== 'done'
      const tasks = ongoing ? previous.tasks.filter(task => task.processingId !== processingId) : []
      tasks.push({ processingId, filename, isImage: false, kbId })
      const outcomes = { ...previous.outcomes }
      delete outcomes[processingId]
      const priorFiles = ongoing ? previous.progress?.files?.filter(file => file.id !== processingId) ?? [] : []
      return {
        ...previous, uploading: true, currentFiles: null, tasks, outcomes,
        submissionFailed: ongoing ? previous.submissionFailed : 0,
        progress: {
          stage: 'minio', stageProgress: 0, submitted: true,
          total: tasks.length + (ongoing ? previous.submissionFailed : 0),
          completed: ongoing ? previous.progress?.completed ?? 0 : 0,
          failed: ongoing ? previous.progress?.failed ?? 0 : 0,
          currentFile: filename,
          files: [...priorFiles, { id: processingId, name: filename, status: 'queued' }],
        },
      }
    })
  }

  const handleCreateManualInput = async ({
    filename,
    content,
  }: {
    filename: string
    content: string
  }) => {
    if (!activeKbId) throw new Error(t("请先选择知识库"))
    const file = new File([content], filename, { type: 'text/markdown' })
    setManualInputDraft(null)
    await handleFileUpload([file], { sourceType: 'manual_input' })
  }

  const handleOpenManualEditor = ({
    fileId,
    filename,
    content,
  }: {
    fileId: string
    filename: string
    content: string
  }) => {
    setManualInputDraft({
      mode: 'edit',
      fileId,
      initialFilename: filename,
      initialContent: content,
    })
  }

  const handleReplaceManualInput = async ({
    filename,
    content,
  }: {
    filename: string
    content: string
  }) => {
    if (!activeKbId || manualInputDraft?.mode !== 'edit' || !manualInputDraft.fileId) {
      throw new Error(t("缺少待编辑的手动文档信息"))
    }
    await knowledgeApi.replaceManualFileContent(activeKbId, manualInputDraft.fileId, {
      filename,
      content,
    })
    setManualInputDraft(null)
    setPreviewFile(null)
    await refreshKbDetail()
  }

  const handleDeleteKb = async (kbId: string) => {
    setMenuOpenKbId(null)
    const kb = knowledgeBases.find((k) => k.id === kbId)
    const ok = window.confirm(t("确定删除知识库「{{value1}}」？此操作不可撤销。", { value1: kb?.name || kbId }))
    if (!ok) return
    try {
      await deleteKnowledgeBase(kbId)
      if (activeKbId === kbId) {
        returnToKnowledgeList()
      }
    } catch (error) {
      console.error(t("删除知识库失败:"), error)
    }
  }

  const handleSaveEdit = async (id: string, name: string, description: string) => {
    try {
      await updateKnowledgeBase(id, { name, description })
      setEditKb(null)
    } catch (error) {
      console.error(t("更新知识库失败:"), error)
    }
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!activeKbId) return
    const deleteKbId = activeKbId
    const deleteKey = JSON.stringify([deleteKbId, fileId])
    if (deletingFileKeys.current.has(deleteKey)) return
    const ok = window.confirm(t("确定删除该文件？"))
    if (!ok) return
    const file = files.find(item => item.id === fileId)
    const processingId = file?.processingId || (fileId.startsWith('processing:') ? fileId.slice('processing:'.length) : undefined)
    const processingIds = processingId ? [processingId] : []
    deletingFileKeys.current.add(deleteKey)
    setFileDeleteErrors(previous => ({ ...previous, [deleteKbId]: '' }))
    try {
      await knowledgeApi.deleteKnowledgeBaseFile(deleteKbId, fileId)
      removeDeletedUpload(deleteKbId, { fileId, processingIds })
      await fetchKnowledgeBases({ silent: true })
    } catch (e) {
      setFileDeleteErrors(previous => ({ ...previous, [deleteKbId]: readableUploadError(getErrorMessage(e, ''), t('删除文件失败')) }))
    } finally {
      deletingFileKeys.current.delete(deleteKey)
    }
  }

  const retryUploadTask = async (
    processingId: string, filename: string, failure: UploadFailureFields & { id?: string; file_id?: string },
    video: boolean, fileId?: string,
  ) => {
    if (!activeKbId || !processingId) throw new Error(t("缺少可恢复的文件任务信息"))
    if (!(video ? canRetryVideoFromPreview(failure) : canRetryDocumentUpload(failure))) {
      throw new Error(uploadFailureCopy(failure).recovery)
    }
    const retryKbId = activeKbId
    const previousBatch = uploadBatchesRef.current[retryKbId] ?? emptyUploadBatch()
    const beforeRetry = previousBatch.progress?.files?.find(item => item.id === processingId)
    // Keep the failed rows visible while synchronously reserving this space's lock.
    if (previousBatch.uploading) return
    updateBatch(retryKbId, previous => ({ ...previous, uploading: true }))
    const setRetryState = (state: { pending?: boolean; error?: string }) => setUploadRetryStates(previous => ({
      ...previous, [retryKbId]: { ...previous[retryKbId], [processingId]: state },
    }))
    setRetryState({ pending: true })
    try {
      const response = await (video ? knowledgeApi.retryVideoUpload(processingId) : knowledgeApi.retryUpload(processingId))
      const taskId = response.processing_id || processingId
      const originalId = response.file_id || fileId
      if (isUploadRemoved(retryKbId, originalId, processingId) || isUploadRemoved(retryKbId, originalId, taskId)) {
        setRetryState({})
        return
      }
      const queued: UploadFileProgress = {
        id: taskId, file_id: originalId, name: filename,
        status: 'queued', stage: 'queued', progress: 0, storage_persisted: true,
        retry_supported: response.retry_supported ?? failure.retry_supported,
        message: response.message || t("已从原文件重新入队，等待处理…"),
        // Only server dates order attempts; a browser clock may be ahead or behind.
        updated_at: response.updated_at,
      }
      let accepted = queued
      updateBatch(retryKbId, previous => {
        const current = previous.progress?.files?.find(item => item.id === taskId)
        const currentTime = serviceTimestamp(current?.updated_at)
        const receiptTime = serviceTimestamp(response.updated_at)
        const beforeTime = serviceTimestamp(beforeRetry?.updated_at)
        const progressedWhileWaiting = current && (Number.isFinite(receiptTime)
          ? Number.isFinite(currentTime) && (currentTime > receiptTime || (currentTime === receiptTime && current.status !== 'queued'))
          : current !== beforeRetry && (current.status !== 'failed' || (Number.isFinite(currentTime) && currentTime > beforeTime)))
        if (progressedWhileWaiting) accepted = { ...current, file_id: originalId ?? current.file_id }
        const outcomes = { ...previous.outcomes }
        delete outcomes[processingId]
        delete outcomes[taskId]
        if (accepted.status === 'completed' || accepted.status === 'failed') outcomes[taskId] = accepted.status
        const task = { processingId: taskId, fileId: originalId, filename, isImage: false, kbId: retryKbId }
        const tasks = previous.tasks.filter(item => item.processingId !== processingId && item.processingId !== taskId).concat(task)
        const previousFiles = previous.progress?.files ?? []
        const progressFiles = previousFiles.filter(item => item.id !== processingId && item.id !== taskId).concat(accepted)
        const submissionFailed = progressFiles.filter(item => item.status === 'failed' && !tasks.some(task => task.processingId === item.id)).length
        const pending = tasks.some(task => !outcomes[task.processingId])
        return {
          ...previous, uploading: pending, outcomes, tasks, submissionFailed,
          progress: {
            ...previous.progress,
            stage: pending ? toPipelineStage(accepted.stage) : 'done', stageProgress: accepted.progress ?? 0,
            submitted: true, total: progressFiles.length,
            completed: tasks.filter(task => outcomes[task.processingId] === 'completed').length,
            failed: submissionFailed + tasks.filter(task => outcomes[task.processingId] === 'failed').length,
            currentFile: filename, currentFileIsImage: false, files: progressFiles,
          },
        }
      })
      if (activeKbIdRef.current === retryKbId) {
        const applyReceipt = (item: KnowledgeFileView): KnowledgeFileView => {
          if (item.processingId !== processingId || isOlderServiceSnapshot(accepted.updated_at, item.updatedAt)) return item
          return {
            ...item, processingId: taskId, status: accepted.status === 'completed' ? 'ready' : accepted.status,
            stage: accepted.stage, progress: accepted.progress, message: accepted.message, error: accepted.error,
            ...Object.fromEntries(uploadFailureKeys.map(key => [key, accepted[key]])), updatedAt: accepted.updated_at,
          }
        }
        setFiles(previous => previous.map(applyReceipt))
        setPreviewFile(previous => previous ? applyReceipt(previous) : previous)
      }
      setRetryState({})
    } catch (error) {
      // Do not roll back server progress observed while awaiting the receipt.
      updateBatch(retryKbId, current => ({
        ...current, uploading: current.tasks.some(task => !current.outcomes[task.processingId]),
      }))
      const message = readableUploadError(getErrorMessage(error, ''), t('未能重新入队，请确认服务状态后再试。'))
      setRetryState({ error: message })
      throw new Error(message)
    }
  }

  const handleRetryFile = async (file: KnowledgeFileView) => {
    if (!file.processingId || String(file.status || '').toLowerCase() !== 'failed') {
      throw new Error(t("仅支持重新处理已失败的文件"))
    }
    await retryUploadTask(file.processingId, file.name, file, isVideoType(file.type), file.id)
  }

  const handleRetryUploadFile = async (file: UploadFileProgress) => {
    const video = isVideoType(file.name.split('.').pop() || '')
    if (file.status !== 'failed' || !(video ? canRetryStoredUpload(file) : canRetryDocumentUpload(file))) return
    try { await retryUploadTask(file.id, file.name, file, video, file.file_id) } catch { /* Feedback belongs to this space and task. */ }
  }

  const livePreviewFile = previewFile ? files.find(file => file.id === previewFile.id) ?? previewFile : null

  // --- KB 列表视图 ---
  if (viewState === 'list') {
    const emptyLibrary = !loading && !listFetchError && knowledgeBases.length === 0

    return (
      <div className={cn("flex-1 bg-slate-50 dark:bg-slate-950 flex flex-col h-full relative", emptyLibrary && 'knowledge-library--empty')}>
        <KnowledgeLibraryHeader
          knowledgeBases={knowledgeBases}
          loading={loading && knowledgeBases.length === 0}
          unavailable={Boolean(listFetchError) && knowledgeBases.length === 0}
          onCreate={() => setShowCreateModal(true)}
        />

        {/* Content */}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', emptyLibrary ? 'knowledge-library-empty-content' : 'p-5 sm:p-8')}>
          {loading ? (
            <div className="grid auto-rows-[11rem] grid-cols-1 items-stretch md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded mb-2"></div>
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                </div>
              ))}
            </div>
          ) : emptyLibrary ? (
            <KnowledgeLibraryEmpty onCreate={() => setShowCreateModal(true)} />
          ) : knowledgeBases.length === 0 ? (
            <div className="flex min-h-[26rem] items-center justify-center">
              <KnowledgeEmptyState
                icon={AlertCircle}
                title={t("知识库列表加载失败")}
                description={t("当前仍停留在本地视图。{{listFetchError}} 请确认后端代理可用后重试。", { listFetchError: listFetchError })}
                tone="amber"
                action={
                  <button
                    type="button"
                    onClick={() => fetchKnowledgeBases()}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-amber-200 bg-white px-4 text-sm font-semibold text-amber-700 shadow-sm transition-colors hover:bg-amber-50 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950/30"
                  >
                    {t("重试")}
                  </button>
                }
              />
            </div>
          ) : (
            <div className="grid auto-rows-[11rem] grid-cols-1 items-stretch md:grid-cols-2 lg:grid-cols-3 gap-6">
              {knowledgeBases.map((kb) => {
                return (
                  <KnowledgeSpaceCard
                    key={kb.id}
                    knowledgeBase={kb}
                    fallbackSrc={getKnowledgeDefaultCover(kb.stats)}
                    menuOpen={menuOpenKbId === kb.id}
                    onOpen={() => activateKnowledgeBase(kb.id)}
                    onToggleMenu={() => setMenuOpenKbId(id => id === kb.id ? null : kb.id)}
                    onEdit={() => {
                      setEditKb({ id: kb.id, name: kb.name, description: kb.description ?? '' })
                      setMenuOpenKbId(null)
                    }}
                    onDelete={() => handleDeleteKb(kb.id)}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* Create Modal */}
        {showCreateModal && (
          <CreateKbModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateKb}
          />
        )}

        {/* Edit Modal */}
        {editKb && (
          <EditKbModal
            kb={editKb}
            onClose={() => setEditKb(null)}
            onSave={handleSaveEdit}
          />
        )}

        {dragOverlay && (
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-40"
            role="status"
            aria-live="polite"
            aria-label={t("拖拽上传，进入知识库详情页后松手即可上传")}
          >
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-5 shadow-xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto">
                <Upload size={22} aria-hidden />
              </div>
              <div className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{t("拖拽上传")}</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                 {t("进入某个知识库详情页后松手即可上传")} </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- KB 详情视图 ---
  if (viewState === 'detail' && activeKb) {
    const trimmedFileQuery = fileQuery.trim()
    const normalizedFileQuery = trimmedFileQuery.toLowerCase()
    const fileFilterLabel = t(KNOWLEDGE_FILE_FILTERS.find(({ key }) => key === fileFilter)!.label)
    const filteredFiles = files.filter((f) => {
      if (fileFilter !== 'all' && getKnowledgeFileKind(f) !== fileFilter) return false
      if (!trimmedFileQuery) return true
      return f.name.toLowerCase().includes(normalizedFileQuery)
    })
    const previewFiles = filteredFiles.filter(file => !isUploadSourceUnavailable(file))
    const previewIndex = livePreviewFile ? previewFiles.findIndex(file => file.id === livePreviewFile.id) : -1
    // Keep the browsing layout stable while existing materials are loading.
    const hasMaterials = files.length > 0 || filesLoading
    const currentFileViewLabel = fileView === 'grid' ? t("画廊视图") : t("列表视图")
    const activeFilePanelId = `${fileListDomId}-file-active-panel`
    const fileResultBaseText = filesLoading
      ? t("{{currentFileViewLabel}}，正在读取「{{value2}}」的文件清单。", { currentFileViewLabel: currentFileViewLabel, value2: activeKb.name })
      : trimmedFileQuery
      ? t("{{currentFileViewLabel}}，搜索“{{trimmedFileQuery}}”命中 {{value3}} 个文件，共 {{value4}} 个文件。", { currentFileViewLabel: currentFileViewLabel, trimmedFileQuery: trimmedFileQuery, value3: filteredFiles.length, value4: files.length })
      : fileFilter !== 'all'
      ? t("{{fileFilterLabel}}，显示 {{count}} 个文件。", { fileFilterLabel, count: filteredFiles.length })
      : t("{{currentFileViewLabel}}，显示全部 {{value2}} 个文件。", { currentFileViewLabel: currentFileViewLabel, value2: files.length })
    const fileListRetryDelaySeconds = fileListRetry?.kbId === activeKbId
      ? Math.ceil(Math.min(30000, 1000 * (2 ** Math.max(0, fileListRetry.attempt - 1))) / 1000)
      : undefined
    const fileResultWithFilter = trimmedFileQuery && fileFilter !== 'all' ? `${fileFilterLabel} · ${fileResultBaseText}` : fileResultBaseText
    const fileResultStatusText = fileDeleteError || (fileListRetryDelaySeconds != null
      ? t("{{fileResultBaseText}} 文件状态同步暂不可用，将在约 {{fileListRetryDelaySeconds}} 秒后重试。", { fileResultBaseText: fileResultWithFilter, fileListRetryDelaySeconds: fileListRetryDelaySeconds })
      : fileResultWithFilter)
    const documentCount = kbStats?.documents ?? activeKb.stats?.documents ?? 0
    const textChunkCount = kbStats?.chunks ?? activeKb.stats?.chunks ?? 0
    const imageCount = kbStats?.images ?? activeKb.stats?.images ?? 0
    const audioCount = kbStats?.audio ?? (activeKb.stats as { audio?: number })?.audio ?? 0
    const videoShotCount = kbStats?.video_shots ?? (activeKb.stats as { video_shots?: number })?.video_shots ?? 0
    const textVectorDim = kbStats?.text_vector_dim ?? 4096
    const imageVectorDim = kbStats?.image_vector_dim ?? 768
    const audioVectorDim = kbStats?.audio_vector_dim ?? 512
    const emptyFileContent = fileListRetry && files.length === 0 ? (
      <div className="px-6 py-8">
        <KnowledgeEmptyState compact icon={AlertCircle}
          title={t("暂时无法读取素材")}
          description={t("服务暂时繁忙，正在自动重试；这不表示素材已丢失。")}
          tone="amber"
        />
      </div>
    ) : (
      <KnowledgeFileEmptyState
        emptyLibrary={files.length === 0}
        filter={fileFilter}
        query={trimmedFileQuery}
        onAdd={() => uploadButtonRef.current?.click()}
        addDisabled={uploading}
        onShowAll={() => {
          setFileFilter('all')
          setFileQuery('')
          allFileFilterRef.current?.focus()
        }}
        onClearSearch={() => {
          setFileQuery('')
          fileSearchRef.current?.focus()
        }}
      />
    )

    return (
      <div className="knowledge-detail-layout flex-1 bg-slate-50 dark:bg-slate-950 flex flex-col h-full relative">
        <KnowledgeDetailHeader
          key={activeKb.id}
          name={activeKb.name}
          description={activeKb.description}
          coverUrl={activeKb.cover_url}
          fileCount={filesLoading ? undefined : files.length}
          updatedAt={activeKb.updated_at}
          onBack={returnToKnowledgeList}
        />

        <div className="flex-1 flex overflow-hidden">
          {/* Main Area */}
          <div ref={detailScrollRef} className="knowledge-detail-content min-w-0 flex-1 overflow-y-auto py-4 space-y-4">
            <KnowledgeDetailNavigation id={fileListDomId} section={detailSection}
              onSectionChange={section => { setDetailSection(section); if (section === 'topics') setTopicsVisited(true) }} collapsibleUpload={hasMaterials}
              uploadExpanded={uploadExpanded} onToggleUpload={() => setUploadExpanded(value => !value)} />
            <div className="knowledge-upload-disclosure" id={`${fileListDomId}-upload`} hidden={hasMaterials && !uploadExpanded && !uploadProgress}>
            {/* 上传与导入：拖拽/选择上传与自动导入同框 */}
            <UploadPipeline
              key={activeKbId}
              sourcesCollapsed={hasMaterials && !uploadExpanded}
              uploadButtonRef={uploadButtonRef}
              onFileSelect={handleFileUpload}
              onRetryFile={handleRetryUploadFile}
              retryStates={activeKbId ? uploadRetryStates[activeKbId] : undefined}
              onDismissProgress={() => {
                setUploadProgress(undefined)
              }}
              isUploading={uploading}
              uploadProgress={uploadProgress}
              externalFiles={currentUploadFiles}
            >
              <div className="upload-sources">
                <div className="upload-source-group" role="group" aria-label={t("直接添加")}>
                  <h4>{t("直接添加")}</h4>
                  <div className="upload-source-group__items">
                    <button type="button" className="upload-source" data-source="document" disabled={uploading}
                      onClick={() => setManualInputDraft({ mode: 'create', initialFilename: t("未命名文档.md"), initialContent: '' })}
                      aria-label={t("新建 Markdown 文档，输入文本后直接分块、向量化并入库")}>
                      <span className="upload-source__icon"><UploadSourceGlyph name="document" size={32} /></span>
                      <span className="upload-source__copy"><strong>{t("新建文档")}</strong><small>{t("编写或粘贴内容")}</small></span>
                      <ChevronRight className="upload-source__arrow" size={14} aria-hidden />
                    </button>
                    <button type="button" className="upload-source" data-source="folder" disabled={uploading}
                      onClick={() => setShowImportFolderModal(true)} aria-label={t("从文件夹导入，支持本地或服务端路径")}>
                      <span className="upload-source__icon"><UploadSourceGlyph name="folder" size={32} /></span>
                      <span className="upload-source__copy"><strong>{t("文件夹导入")}</strong><small>{t("批量添加目录素材")}</small></span>
                      <ChevronRight className="upload-source__arrow" size={14} aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="upload-source-group" role="group" aria-label={t("从网络导入")}>
                  <h4>{t("从网络导入")}</h4>
                  <div className="upload-source-group__items upload-source-group__items--web">
                    <button type="button" className="upload-source" data-source="link" disabled={uploading}
                      onClick={() => setShowImportUrlModal(true)} aria-label={t("从 URL 导入，支持网页或文件直链")}>
                      <span className="upload-source__icon"><UploadSourceGlyph name="link" size={28} /></span>
                      <span className="upload-source__copy"><strong>{t("链接导入")}</strong><small>{t("网页 / 文件")}</small></span>
                      <ChevronRight className="upload-source__arrow" size={14} aria-hidden />
                    </button>
                    <button type="button" className="upload-source" data-source="image" disabled={uploading}
                      onClick={() => setShowImportSearchModal(true)} aria-label={t("打开图片搜索导入，按关键词批量导入")}>
                      <span className="upload-source__icon"><UploadSourceGlyph name="image" size={28} /></span>
                      <span className="upload-source__copy"><strong>{t("图片搜索")}</strong><small>{t("按关键词搜图")}</small></span>
                      <ChevronRight className="upload-source__arrow" size={14} aria-hidden />
                    </button>
                    <button type="button" className="upload-source" data-source="news" disabled={uploading}
                      onClick={() => setShowImportHotTopicsModal(true)} aria-label={t("导入热点资讯，自动抓取新闻素材")}>
                      <span className="upload-source__icon"><UploadSourceGlyph name="news" size={28} /></span>
                      <span className="upload-source__copy"><strong>{t("热点资讯")}</strong><small>{t("按话题收集")}</small></span>
                      <ChevronRight className="upload-source__arrow" size={14} aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            </UploadPipeline>
            </div>

            {/* File List */}
            <div className="resource-files knowledge-detail-materials" id={`${fileListDomId}-materials-panel`}
              role="tabpanel" aria-labelledby={`${fileListDomId}-materials-tab`} hidden={detailSection !== 'materials'}>
              <KnowledgeContentOverview
                key={activeKb.id}
                files={files}
                loading={filesLoading}
                activeFilter={fileFilter}
                onFilterChange={setFileFilter}
                resultsId={activeFilePanelId}
                allFilterRef={allFileFilterRef}
                controls={
                  <div className="resource-files__controls">
                    <div
                      className="resource-files__view-switch"
                      role="tablist"
                      aria-label={t("文件视图")}
                      aria-describedby={fileResultsStatusId}
                    >
                      <button
                        id={fileGridTabId}
                        ref={(node) => {
                          fileViewTabRefs.current.grid = node
                        }}
                        onClick={() => setFileView('grid')}
                        role="tab"
                        aria-selected={fileView === 'grid'}
                        aria-controls={fileView === 'grid' ? activeFilePanelId : undefined}
                        aria-label={t("切换到画廊视图，{{value1}} 个结果", { value1: filteredFiles.length })}
                        tabIndex={fileView === 'grid' ? 0 : -1}
                        onKeyDown={handleFileViewTabKeyDown}
                        className="resource-files__view-tab"
                        type="button"
                        title={t("画廊视图")}
                      >
                        <LayoutGrid size={14} strokeWidth={1.7} aria-hidden />
                         {t("画廊")} </button>
                      <button
                        id={fileTableTabId}
                        ref={(node) => {
                          fileViewTabRefs.current.table = node
                        }}
                        onClick={() => setFileView('table')}
                        role="tab"
                        aria-selected={fileView === 'table'}
                        aria-controls={fileView === 'table' ? activeFilePanelId : undefined}
                        aria-label={t("切换到列表视图，{{value1}} 个结果", { value1: filteredFiles.length })}
                        tabIndex={fileView === 'table' ? 0 : -1}
                        onKeyDown={handleFileViewTabKeyDown}
                        className="resource-files__view-tab"
                        type="button"
                        title={t("列表视图")}
                      >
                        <List size={14} strokeWidth={1.7} aria-hidden />
                         {t("列表")} </button>
                    </div>
                    <label className="resource-files__search">
                      <Search size={15} strokeWidth={1.7} aria-hidden />
                      <input
                        ref={fileSearchRef}
                        id={fileSearchInputId}
                        value={fileQuery}
                        onChange={(e) => setFileQuery(e.target.value)}
                        type="search"
                        placeholder={t("搜索文件名称")}
                        autoComplete="off"
                        aria-label={t("搜索文件")}
                        aria-describedby={fileResultsStatusId}
                        aria-controls={activeFilePanelId}
                      />
                    </label>
                  </div>
                }
                index={{
                  documents: documentCount,
                  chunks: textChunkCount,
                  images: imageCount,
                  audio: audioCount,
                  videoShots: videoShotCount,
                  dimensions: { text: textVectorDim, image: imageVectorDim, audio: audioVectorDim },
                }}
              />
              <p
                id={fileResultsStatusId}
                className={cn('resource-files__summary', !fileDeleteError && !trimmedFileQuery && fileFilter === 'all' && !filesLoading && fileListRetryDelaySeconds == null && 'sr-only')}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {fileResultStatusText}
              </p>

              {fileView === 'table' ? (
                <div
                  className="resource-files__table-panel"
                  id={activeFilePanelId}
                  role="tabpanel"
                  aria-labelledby={fileTableTabId}
                  aria-describedby={fileResultsStatusId}
                >
                  <table className="resource-files__table" role="table">
                    <caption className="sr-only">{fileResultStatusText}</caption>
                    <colgroup>
                      <col className="resource-files__col-name" />
                      <col className="resource-files__col-size" />
                      <col className="resource-files__col-status" />
                      <col className="resource-files__col-date" />
                      <col className="resource-files__col-actions" />
                    </colgroup>
                    <thead role="rowgroup">
                      <tr role="row">
                        <th scope="col">{t("文件名")}</th>
                        <th scope="col" className="resource-files__size">{t("大小")}</th>
                        <th scope="col" className="resource-files__status">{t("状态")}</th>
                        <th scope="col" className="resource-files__date">{t("日期")}</th>
                        <th scope="col" className="resource-files__actions"><span className="sr-only">{t("操作")}</span></th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      {filesLoading ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-6">
                            <FileListLoadingState knowledgeBaseName={activeKb.name} />
                          </td>
                        </tr>
                      ) : filteredFiles.length === 0 ? (
                        <tr>
                          <td colSpan={5}>
                            {emptyFileContent}
                          </td>
                        </tr>
                      ) : (
                        filteredFiles.map((file) => {
                          const previewUnavailable = isUploadSourceUnavailable(file)
                          const previewHintId = `${fileListDomId}-preview-unavailable-${file.id}`
                          return (
                          <tr
                            key={file.id}
                            className="resource-files__row"
                            role="row"
                          >
                            <th scope="row" className="resource-files__name-cell" role="rowheader">
                              <button
                                onClick={() => { if (!previewUnavailable) setPreviewFile(file) }}
                                disabled={previewUnavailable}
                                aria-describedby={previewUnavailable ? previewHintId : undefined}
                                className="resource-files__open disabled:cursor-not-allowed"
                                type="button"
                                title={previewUnavailable ? t('原文件尚未保存，暂时无法预览。') : file.name}
                                aria-label={t("预览文件：{{value1}}", { value1: file.name })}
                              >
                                <FileThumb file={file} />
                                <span className="resource-files__file-copy">
                                  <span className="resource-files__file-name">{file.name}</span>
                                  <span className="resource-files__file-meta">
                                    <span className="resource-files__format">{String(file.type || 'FILE').split('/').pop()?.toUpperCase()}</span>
                                  </span>
                                </span>
                              </button>
                              {previewUnavailable && <p id={previewHintId} className="mt-1 text-xs font-normal text-slate-500 dark:text-slate-400">{t('原文件尚未保存，暂时无法预览。')}</p>}
                              <div className="resource-files__mobile-meta">
                                <span><span className="sr-only">{t("大小：")}</span>{file.size}</span>
                                <span><span className="sr-only">{t("日期：")}</span>{formatFileDate(file.date)}</span>
                                <span className="resource-files__inline-status">
                                  <StatusBadge status={file.status} stage={file.stage} progress={file.progress} message={file.message} error={file.error} updatedAt={file.updatedAt} {...uploadFailureFields(file)} variant="subtle" />
                                </span>
                              </div>
                            </th>
                            <td className="resource-files__size" role="cell">
                              {file.size}
                            </td>
                            <td className="resource-files__status" role="cell">
                              <StatusBadge
                                {...uploadFailureFields(file)}
                                status={file.status}
                                stage={file.stage}
                                progress={file.progress}
                                message={file.message}
                                error={file.error}
                                updatedAt={file.updatedAt}
                                variant="subtle"
                              />
                            </td>
                            <td className="resource-files__date" role="cell">
                              {formatFileDate(file.date)}
                            </td>
                            <td className="resource-files__actions" role="cell">
                              <button
                                onClick={() => handleDeleteFile(file.id)}
                                className="resource-files__delete"
                                title={t("删除文件")}
                                type="button"
                                aria-label={t("删除文件：{{value1}}", { value1: file.name })}
                                aria-describedby={previewUnavailable ? previewHintId : undefined}
                              >
                                <Trash2 size={16} aria-hidden />
                              </button>
                            </td>
                          </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  className="pt-2"
                  id={activeFilePanelId}
                  role="tabpanel"
                  aria-labelledby={fileGridTabId}
                  aria-describedby={fileResultsStatusId}
                >
                  {filesLoading ? (
                    <FileListLoadingState knowledgeBaseName={activeKb.name} />
                  ) : filteredFiles.length === 0 ? (
                    emptyFileContent
                  ) : (
                    <div className="resource-files__gallery">
                      {filteredFiles.map((file) => {
                        const isAudio = isAudioType(file?.type)
                        const isVideo = isVideoType(file?.type)
                        const isMedia = isAudio || isVideo
                        const isDocument = getKnowledgeFileKind(file) === 'documents'
                        const previewUnavailable = isUploadSourceUnavailable(file)
                        const previewHintId = `${fileListDomId}-preview-unavailable-${file.id}`
                        return (
                          <div key={file.id} className="resource-file-card relative flex min-w-0">
                          <button
                            onClick={() => { if (!previewUnavailable) setPreviewFile(file) }}
                            disabled={previewUnavailable}
                            aria-describedby={previewUnavailable ? previewHintId : undefined}
                            className={cn(
                              'flex w-full flex-col min-w-0 text-left rounded-xl border transition-[border-color,box-shadow] overflow-hidden group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 motion-reduce:transition-none disabled:cursor-not-allowed',
                              isAudio
                                ? 'bg-gradient-to-b from-violet-50/80 to-white dark:from-violet-950/30 dark:to-slate-900 border-violet-200/80 dark:border-violet-800/60 hover:border-violet-400 dark:hover:border-violet-500 hover:shadow-md hover:shadow-violet-500/10'
                                : isVideo
                                  ? 'bg-gradient-to-b from-sky-50/80 to-white dark:from-sky-950/30 dark:to-slate-900 border-sky-200/80 dark:border-sky-800/60 hover:border-sky-400 dark:hover:border-sky-500 hover:shadow-md hover:shadow-sky-500/10'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-fuchsia-300 dark:hover:border-fuchsia-500 hover:shadow-sm'
                            )}
                            type="button"
                            title={previewUnavailable ? t('原文件尚未保存，暂时无法预览。') : isMedia ? t("点击播放或查看详情") : t("点击预览")}
                            aria-label={t("{{value1}}：{{value2}}", { value1: isMedia ? t("播放或查看文件详情") : t("预览文件"), value2: file.name })}
                          >
                            <div className="relative w-full shrink-0">
                              <div className={cn(
                                'overflow-hidden flex items-center justify-center',
                                'aspect-[4/3] w-full',
                                isAudio ? 'bg-violet-50/50 dark:bg-violet-950/30' : isVideo ? 'bg-sky-50/50 dark:bg-sky-950/30' : 'bg-slate-50 dark:bg-slate-900'
                              )}>
                                {isVideo ? (
                                  <VideoFileCover src={file.coverUrl} name={file.name} timestamp={file.coverTimestamp} className="h-full aspect-auto" />
                                ) : <FileHero file={file} />}
                              </div>
                              {isAudio && (
                                <div className={cn(
                                  'absolute bottom-3 right-3 flex items-center justify-center w-9 h-9 rounded-full text-white shadow-lg opacity-80 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity motion-reduce:transition-none',
                                  isVideo ? 'bg-sky-500/90 dark:bg-sky-600/90' : 'bg-violet-500/90 dark:bg-violet-600/90'
                                )}>
                                  <Play size={18} className="ml-0.5" fill="currentColor" aria-hidden />
                                </div>
                              )}
                              {isDocument && !previewUnavailable && (
                                <span className="resource-file-card__document-preview" aria-hidden>
                                  <Eye size={16} strokeWidth={1.75} />
                                </span>
                              )}
                              <span className="resource-file-card__status">
                                <StatusBadge
                                  {...uploadFailureFields(file)}
                                  status={file.status}
                                  stage={file.stage}
                                  progress={file.progress}
                                  message={file.message}
                                  error={file.error}
                                  updatedAt={file.updatedAt}
                                  variant="indicator"
                                />
                              </span>
                            </div>
                            <div className="resource-file-card__caption">
                              <span className="resource-file-card__name" title={file.name}>{file.name}</span>
                            </div>
                            {previewUnavailable && <p id={previewHintId} className="resource-file-card__unavailable">{t('原文件尚未保存，暂时无法预览。')}</p>}
                          </button>
                          {previewUnavailable && <button
                            type="button"
                            onClick={() => { void handleDeleteFile(file.id) }}
                            className="absolute left-2 top-2 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-red-600 shadow-sm hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950"
                            aria-label={t('删除文件：{{value1}}', { value1: file.name })}
                            aria-describedby={previewHintId}
                            title={t('删除文件')}
                          ><Trash2 size={16} aria-hidden /></button>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Portrait Graph（使用从向量库获取的统计） */}
            <div className="knowledge-detail-topics" id={`${fileListDomId}-topics-panel`}
              role="tabpanel" tabIndex={0} aria-labelledby={`${fileListDomId}-topics-tab`} hidden={detailSection !== 'topics'}>
            {topicsVisited && <Suspense fallback={<PortraitGraphLoading />}>
              <PortraitGraph
                knowledgeBaseId={activeKb.id}
                documentCount={documentCount}
                textCount={textChunkCount}
                imageCount={imageCount}
                audioCount={audioCount}
                videoShotCount={videoShotCount}
                onClusterSelect={() => {}}
              />
            </Suspense>}
            </div>
          </div>
        </div>

        {editKb && (
          <EditKbModal
            kb={editKb}
            onClose={() => setEditKb(null)}
            onSave={handleSaveEdit}
          />
        )}

        {/* 预览弹窗 */}
        {livePreviewFile && !isUploadSourceUnavailable(livePreviewFile) && (
          <FilePreviewModal
            file={livePreviewFile}
            navigation={{
              position: previewIndex >= 0 ? previewIndex + 1 : 1,
              total: previewIndex >= 0 ? previewFiles.length : 1,
              onPrevious: previewIndex > 0 ? () => setPreviewFile(previewFiles[previewIndex - 1]) : undefined,
              onNext: previewIndex >= 0 && previewIndex < previewFiles.length - 1 ? () => setPreviewFile(previewFiles[previewIndex + 1]) : undefined,
            }}
            kbId={activeKbId}
            onClose={() => setPreviewFile(null)}
            onEdit={handleOpenManualEditor}
            onRetryFile={() => handleRetryFile(livePreviewFile)}
            deleteError={fileDeleteError}
            onDelete={() => { void handleDeleteFile(livePreviewFile.id) }}
          />
        )}

        {manualInputDraft && (
          <Suspense fallback={null}>
            <ManualInputModal
              open={!!manualInputDraft}
              mode={manualInputDraft.mode}
              initialFilename={manualInputDraft.initialFilename}
              initialContent={manualInputDraft.initialContent}
              onClose={() => setManualInputDraft(null)}
              onSubmit={
                manualInputDraft.mode === 'create'
                  ? handleCreateManualInput
                  : handleReplaceManualInput
              }
            />
          </Suspense>
        )}

        {/* 从 URL 导入弹窗 */}
        {showImportUrlModal && activeKbId && (
          <ImportUrlModal
            kbId={activeKbId}
            onSubmitStart={() => claimBatch(activeKbId)}
            onSubmitSettled={() => updateBatch(activeKbId, previous => ({
              ...previous, uploading: previous.tasks.some(task => !previous.outcomes[task.processingId]),
            }))}
            onClose={() => { if (activeKbIdRef.current === activeKbId) setShowImportUrlModal(false) }}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
            onStartImport={({ processing_id, filename: urlFilename }) => {
              if (activeKbIdRef.current === activeKbId) setShowImportUrlModal(false)
              registerImportTask(activeKbId, processing_id, urlFilename)
            }}
          />
        )}

        {/* 搜索图片导入弹窗：开始导入后关闭弹窗，在上传流水线中展示进度 */}
        {showImportSearchModal && activeKbId && (
          <ImportSearchModal
            kbId={activeKbId}
            onClose={() => { if (activeKbIdRef.current === activeKbId) setShowImportSearchModal(false) }}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
            onStartImport={(params) => {
              if (!claimBatch(activeKbId)) return
              if (activeKbIdRef.current === activeKbId) setShowImportSearchModal(false)
              const total = params.quantity ?? 5
              setCurrentUploadFiles(null)
              setUploading(true)
              setUploadProgress({
                stage: 'minio',
                stageProgress: 0,
                submitted: true,
                files: [],
                message: t("正在搜索图片，请保持页面打开。"),
                total,
                completed: 0,
                failed: 0,
                currentFile: t("搜索中…"),
                currentFileIsImage: true,
              })
              importApi
                .importFromSearchStream(params, (event) => {
                  if (event.stage === 'done') {
                    flushSync(() => {
                      setUploadProgress((prev) =>
                        prev
                          ? {
                              ...prev,
                              stage: 'done',
                              stageProgress: 100,
                              total: event.total ?? total,
                              message: event.message,
                              completed: event.success_count ?? 0,
                              failed: event.failed_count ?? 0,
                            }
                          : prev
                      )
                    })
                    fetchFiles()
                    fetchKnowledgeBases()
                    setUploading(false)
                    setCurrentUploadFiles(null)
                    return
                  }
                  if (event.stage === 'error') {
                    flushSync(() => {
                      setUploadProgress((prev) =>
                        prev ? { ...prev, stage: 'done', failed: prev.total, completed: 0, message: event.message || t("图片导入失败，请重试。") } : prev
                      )
                    })
                    setUploading(false)
                    setCurrentUploadFiles(null)
                    return
                  }
                  const cur = event.current ?? 0
                  const tot = event.total ?? total
                  const progressPct = tot > 0 ? Math.round((cur / tot) * 100) : 0
                  const frontStage: UploadPipelineProgress['stage'] =
                    event.stage === 'searching'
                      ? 'minio'
                      : event.stage === 'downloading'
                        ? 'minio'
                        : event.stage === 'importing'
                          ? 'parsing'
                          : 'minio'
                  flushSync(() => {
                    setUploadProgress((prev) => {
                      if (!prev) return prev
                      const next = {
                        ...prev,
                        stage: frontStage,
                        stageProgress: progressPct,
                        message: t("{{value1}}，请保持页面打开。", { value1: event.message || t("正在导入图片") }),
                        total: tot,
                      }
                      return next
                    })
                  })
                })
                .catch((error) => {
                  setUploading(false)
                  setCurrentUploadFiles(null)
                  setUploadProgress((prev) => (prev ? { ...prev, stage: 'done', failed: prev.total, message: getErrorMessage(error, t("图片导入失败，请重试。")) } : undefined))
                })
            }}
          />
        )}

        {/* 从文件夹导入弹窗 */}
        {showImportFolderModal && activeKbId && (
          <ImportFolderModal
            kbId={activeKbId}
            onClose={() => setShowImportFolderModal(false)}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
            onImportLocalFiles={(files) => {
              setShowImportFolderModal(false)
              handleFileUpload(files)
            }}
          />
        )}

        {/* 热点资讯导入弹窗：异步启动后在上传流水线展示进度 */}
        {showImportHotTopicsModal && activeKbId && (
          <ImportHotTopicsModal
            kbId={activeKbId}
            onSubmitStart={() => claimBatch(activeKbId)}
            onSubmitSettled={() => updateBatch(activeKbId, previous => ({
              ...previous, uploading: previous.tasks.some(task => !previous.outcomes[task.processingId]),
            }))}
            onClose={() => { if (activeKbIdRef.current === activeKbId) setShowImportHotTopicsModal(false) }}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
            onStartImport={({ processing_id, filename: hotTopicsFilename }) => {
              if (activeKbIdRef.current === activeKbId) setShowImportHotTopicsModal(false)
              registerImportTask(activeKbId, processing_id, hotTopicsFilename)
            }}
          />
        )}

        {dragOverlay && (
          <div className="pointer-events-none absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-40" role="status" aria-live="polite" data-file-drop-overlay>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-5 shadow-xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto">
                <Upload size={22} />
              </div>
              <div className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{t("松手上传到当前知识库")}</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("支持批量上传，逐个显示解析进度")}</div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center text-slate-400 bg-slate-50 dark:bg-slate-950">
       {t("未找到该知识库，可能已被删除。")} </div>
  )
}

export default KnowledgeList
