import React, { useState, useEffect, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { Plus, Upload, Search, MoreVertical, Trash2, ArrowLeft, ChevronRight, Database, FileText, Image as ImageIcon, X, Pencil, Link2, ImagePlus, Loader2, FolderOpen, Layers, Box, Zap, Newspaper, Play, Music, Video, Eye, LayoutGrid, List, HardDrive, Calendar, Activity, MoreHorizontal } from 'lucide-react'
import { PortraitGraph } from './PortraitGraph'
import { UploadPipeline, type UploadPipelineProgress } from './UploadPipeline'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { knowledgeApi, importApi } from '@/services/api_client'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import { StatusBadge, FileThumb, FileHero, FileIcon, CreateKbModal, EditKbModal, isAudioType, isVideoType } from './KnowledgeListHelpers'

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
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 dark:border-slate-800',
        'bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-950',
        'flex flex-col items-center justify-center px-6 py-10',
        'min-h-[min(60vh,22rem)]'
      )}
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
            <span>加载描述中…</span>
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

// 文件预览模态框（支持图片描述、文档分块、MD 预览）
function FilePreviewModal({
  file,
  kbId,
  onClose,
  onDelete,
}: {
  file: any
  kbId: string | null
  onClose: () => void
  onDelete: () => void
}) {
  const [tab, setTab] = React.useState<'preview' | 'chunks'>('preview')
  const [details, setDetails] = React.useState<{
    caption?: string
    chunks?: Array<{ index: number; text: string }>
    text_preview?: string
    transcript?: string
    description?: string
  } | null>(null)
  const [rawContent, setRawContent] = React.useState<string | null>(null)
  const [loadingDetails, setLoadingDetails] = React.useState(false)
  const [pdfObjectUrl, setPdfObjectUrl] = React.useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = React.useState(false)
  const [audioObjectUrl, setAudioObjectUrl] = React.useState<string | null>(null)
  const [audioLoading, setAudioLoading] = React.useState(false)
  const [videoObjectUrl, setVideoObjectUrl] = React.useState<string | null>(null)
  const [videoLoading, setVideoLoading] = React.useState(false)
  const [officePreviewError, setOfficePreviewError] = React.useState<string | null>(null)

  const rawFileType = String(file?.type || '').toLowerCase().split(';')[0].trim()
  const fileNameLower = String(file?.name || '').toLowerCase()
  const fileExtFromName = fileNameLower.includes('.') ? (fileNameLower.split('.').pop() || '') : ''
  const mimeTypeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
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
  const isDoc = ['pdf', 'docx', 'doc', 'pptx', 'txt', 'md'].includes(fileTypeLower)
  const hasChunks = (details?.chunks?.length ?? 0) > 0

  React.useEffect(() => {
    if (!file?.id || !kbId) return
    setLoadingDetails(true)
    setDetails(null)
    setRawContent(null)
    Promise.allSettled([
      knowledgeApi.getFilePreviewDetails(kbId, file.id, { timeoutMs: isDoc ? 120000 : 30000 }),
      isTextFile ? knowledgeApi.getFileTextContent(kbId, file.id).then((r) => r?.content ?? null) : Promise.resolve(null),
    ])
      .then(([previewRes, contentRes]) => {
        setDetails(previewRes.status === 'fulfilled' ? (previewRes.value ?? null) : null)
        setRawContent(contentRes.status === 'fulfilled' ? (contentRes.value ?? null) : null)
      })
      .finally(() => setLoadingDetails(false))
  }, [file?.id, kbId, isDoc, isTextFile])

  // PDF / PPTX / DOCX 使用 stream 接口获取 Blob（PPTX/DOCX 后端会转为 PDF）并生成 object URL，在 iframe 内展示
  const pdfObjectUrlRef = React.useRef<string | null>(null)
  React.useEffect(() => {
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
        const url = URL.createObjectURL(blob)
        pdfObjectUrlRef.current = url
        setPdfObjectUrl(url)
      })
      .catch((err: any) => {
        setPdfObjectUrl(null)
        if (isOfficeDocument) {
          setOfficePreviewError(err?.message || 'Office 文件页面内预览暂不可用')
        }
      })
      .finally(() => setPdfLoading(false))
    return () => {
      const url = pdfObjectUrlRef.current
      if (url) {
        URL.revokeObjectURL(url)
        pdfObjectUrlRef.current = null
      }
      setPdfObjectUrl(null)
      setOfficePreviewError(null)
    }
  }, [isPdfOrOfficeViewable, isOfficeDocument, kbId, file?.id])

  // 音频预览：通过 stream 获取 Blob 并生成 object URL，供 <audio> 使用
  const audioObjectUrlRef = React.useRef<string | null>(null)
  React.useEffect(() => {
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
        const url = URL.createObjectURL(blob)
        audioObjectUrlRef.current = url
        setAudioObjectUrl(url)
      })
      .catch(() => setAudioObjectUrl(null))
      .finally(() => setAudioLoading(false))
    return () => {
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
        const url = URL.createObjectURL(blob)
        videoObjectUrlRef.current = url
        setVideoObjectUrl(url)
      })
      .catch(() => setVideoObjectUrl(null))
      .finally(() => setVideoLoading(false))
    return () => {
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

  const renderTextPreviewCard = (extraHint?: React.ReactNode) => (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
        {isMd ? 'Markdown 预览' : '文本预览'}
      </div>
      {extraHint}
      {isMd ? (
        <div className="max-h-[60vh] overflow-y-auto prose prose-slate dark:prose-invert prose-sm max-w-none">
          <ReactMarkdown
            components={{
              img: ({ src, alt, ...rest }) => {
                const isLocalPath = typeof src === 'string' && (src.startsWith('/') || src.toLowerCase().startsWith('file://'))
                const imgSrc = isLocalPath && kbId && file?.id
                  ? knowledgeApi.getFilePreviewAssetUrl(kbId, file.id, src)
                  : src
                return <img src={imgSrc} alt={alt ?? ''} {...rest} className="max-w-full h-auto rounded border border-slate-200 dark:border-slate-700" />
              },
            }}
          >
            {textPreview}
          </ReactMarkdown>
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-950 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
        {/* 顶栏：全类型预览共用，渐变底 + 类型图标 + 元信息标签 */}
        <div className="relative overflow-hidden flex-shrink-0 border-b border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-slate-50 via-white to-indigo-50/50 dark:from-slate-900 dark:via-slate-950 dark:to-indigo-950/25 px-6 py-4">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_80%_at_100%_-30%,rgba(99,102,241,0.11),transparent)] dark:bg-[radial-gradient(ellipse_90%_80%_at_100%_-30%,rgba(129,140,248,0.14),transparent)]"
            aria-hidden
          />
          <div className="relative flex justify-between items-start gap-4">
            <div className="min-w-0 flex gap-3.5">
              {isImg && file.previewUrl ? (
                <img
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
                <h2
                  className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50 truncate"
                  title={file.name}
                >
                  {file.name}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                  <span className="inline-flex items-center rounded-full border border-indigo-200/70 bg-white/60 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-indigo-800 shadow-[0_1px_2px_rgba(99,102,241,0.06)] backdrop-blur-[2px] dark:border-indigo-500/30 dark:bg-indigo-950/35 dark:text-indigo-200 dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
                    {String(file.type || '').toUpperCase() || 'FILE'}
                  </span>
                  <span className="hidden sm:inline text-slate-300 dark:text-slate-600" aria-hidden>
                    ·
                  </span>
                  <span className="text-slate-600 tabular-nums dark:text-slate-400">{file.size}</span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-slate-600 dark:text-slate-400">{file.date}</span>
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
              aria-label="关闭"
            >
              <X size={18} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        {(hasChunks || isDoc) && (
          <div className="px-6 pt-3.5 pb-3 flex-shrink-0 bg-slate-50/95 dark:bg-slate-900/85 border-b border-slate-100 dark:border-slate-800/90">
            <div
              className="inline-flex items-center gap-0.5 rounded-xl bg-slate-200/55 dark:bg-slate-800/90 p-1 ring-1 ring-inset ring-slate-300/35 dark:ring-slate-700/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              role="tablist"
              aria-label="预览方式"
            >
              <button
                onClick={() => setTab('preview')}
                role="tab"
                aria-selected={tab === 'preview'}
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
                预览
              </button>
              {isDoc && (
                <button
                  onClick={() => setTab('chunks')}
                  role="tab"
                  aria-selected={tab === 'chunks'}
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
                  <span className="whitespace-nowrap">分块</span>
                  <span
                    className={cn(
                      'ml-0.5 inline-flex h-[1.375rem] min-w-[1.375rem] items-center justify-center rounded-full px-2 text-[11px] font-semibold tabular-nums leading-none',
                      'transition-all duration-200 ease-out',
                      tab === 'chunks'
                        ? 'bg-gradient-to-b from-indigo-100 to-indigo-50/90 text-indigo-700 shadow-[0_1px_2px_rgba(99,102,241,0.18)] border border-indigo-200/60 dark:from-indigo-950 dark:to-indigo-950/50 dark:text-indigo-200 dark:border-indigo-500/35 dark:shadow-[0_1px_3px_rgba(0,0,0,0.35)]'
                        : 'bg-slate-200/65 text-slate-600 border border-slate-300/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:bg-slate-700/65 dark:text-slate-300 dark:border-slate-500/25 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    )}
                    aria-label={
                      loadingDetails ? '分块数量加载中' : `共 ${details?.chunks?.length ?? 0} 个分块`
                    }
                  >
                    {loadingDetails ? (
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

        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {tab === 'chunks' && isDoc ? (
            hasChunks ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-sm font-medium text-slate-800 dark:text-slate-100">
                  文档分块
                </div>
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
            ) : loadingDetails ? (
              <PreviewPaneLoading
                title="正在加载分块内容…"
                hint="正在从知识库获取解析后的文本块，请稍候"
                variant="chunks"
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 px-5 py-8 text-center">
                <Layers className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600 mb-3" aria-hidden />
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-sm mx-auto">
                  暂未获取到分块内容。可先查看「预览」文本；若文件刚上传，稍后重试即可。
                </p>
              </div>
            )
          ) : isImg && file.previewUrl ? (
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                <img src={file.previewUrl} alt={file.name} className="w-full h-auto max-h-[50vh] object-contain" />
              </div>
              <MediaDescriptionPanel
                title="图片描述"
                icon={ImageIcon}
                loading={loadingDetails}
                hasContent={!!(details?.caption ?? details?.description)}
                empty={
                  <p className="text-sm text-slate-400 italic leading-relaxed dark:text-slate-500">
                    暂无描述（若为刚上传的图片，描述生成后刷新预览即可）
                  </p>
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
          ) : isOfficeDocument && pdfLoading && !!textPreview ? (
            renderTextPreviewCard(
              <div className="mb-3 rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
                正在生成页内预览（Office 转 PDF 可能耗时几秒），你可先查看文本预览或切到「分块」。
              </div>
            )
          ) : isPdfOrOfficeViewable && pdfLoading ? (
            <PreviewPaneLoading
              title="文档加载中…"
              hint={
                isOfficeDocument
                  ? 'Office 文档需先转换为 PDF，可能需要数秒至一分钟'
                  : '正在拉取文件流以生成预览'
              }
              variant="document"
            />
          ) : isOfficeDocument && officePreviewError ? (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
              <div className="text-sm font-medium text-amber-800 dark:text-amber-200">Office 页内预览暂不可用</div>
              <div className="mt-2 text-sm text-amber-700 dark:text-amber-300 leading-relaxed whitespace-pre-wrap">
                {officePreviewError}
              </div>
              <div className="mt-2 text-xs text-amber-700/90 dark:text-amber-300/90">
                若该文件已成功解析，可切换到「分块」查看内容；服务端安装 LibreOffice 后可恢复页内预览。
              </div>
            </div>
          ) : isAudio && audioObjectUrl ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-6">
                <audio
                  controls
                  src={audioObjectUrl}
                  className="w-full max-w-md mx-auto"
                  preload="metadata"
                >
                  您的浏览器不支持音频播放。
                </audio>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 text-center">{file.name}</p>
              </div>
              <MediaDescriptionPanel
                title="音频描述"
                icon={Music}
                loading={loadingDetails}
                hasContent={!!(details?.caption ?? details?.transcript ?? details?.description)}
                empty={
                  <p className="text-sm text-slate-400 italic leading-relaxed dark:text-slate-500">
                    暂无描述（若为刚上传的音频，描述生成后刷新预览即可）
                  </p>
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
                        转写内容
                      </span>
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
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
              <div className="mt-3 text-sm">音频加载中…</div>
            </div>
          ) : isVideo && videoObjectUrl ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-6">
                <video
                  controls
                  src={videoObjectUrl}
                  className="w-full max-w-full rounded-lg bg-black"
                  preload="metadata"
                >
                  您的浏览器不支持视频播放。
                </video>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 text-center">{file.name}</p>
              </div>
              <MediaDescriptionPanel
                title="视频描述"
                icon={Video}
                loading={loadingDetails}
                hasContent={!!(details?.caption ?? details?.description)}
                empty={
                  <p className="text-sm text-slate-400 italic leading-relaxed dark:text-slate-500">
                    暂无描述（若为刚上传的视频，描述生成后刷新预览即可）
                  </p>
                }
              >
                <p className="whitespace-pre-wrap text-[15px] leading-[1.75] text-slate-800 dark:text-slate-100">
                  {details?.caption ?? details?.description}
                </p>
              </MediaDescriptionPanel>
            </div>
          ) : isVideo && videoLoading ? (
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
              <div className="mt-3 text-sm">视频加载中…</div>
            </div>
          ) : textPreview ? (
            renderTextPreviewCard(
              officePreviewError && isOfficeDocument ? (
                <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {officePreviewError} 已自动切换为解析文本预览；如需页内幻灯片预览，请在服务端安装 LibreOffice。
                </div>
              ) : null
            )
          ) : loadingDetails && (isTextFile || isImg || isDoc) ? (
            <PreviewPaneLoading
              title="加载预览中…"
              hint="正在获取文件详情与文本内容"
              variant="document"
            />
          ) : (
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-slate-400">
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <FileText size={24} />
              </div>
              <div className="mt-3 text-sm">该文件类型暂无预览</div>
            </div>
          )}
        </div>

        {/* 底部操作栏：与 Tab 区一致的浅底与分隔；次要 / 危险按钮分层 */}
        <div className="px-6 py-4 bg-slate-50/95 dark:bg-slate-900/85 border-t border-slate-100 dark:border-slate-800/90 flex justify-end gap-2.5 flex-shrink-0">
          <button
            onClick={onClose}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
              'border border-slate-200/95 bg-white text-slate-700 shadow-sm shadow-slate-200/50',
              'dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:shadow-black/25',
              'hover:bg-slate-50 hover:border-slate-300/90 hover:shadow-md dark:hover:bg-slate-700/90 dark:hover:border-slate-500',
              'active:scale-[0.98] transition-all duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900'
            )}
            type="button"
          >
            <X className="h-4 w-4 shrink-0 opacity-80" strokeWidth={2.25} aria-hidden />
            关闭
          </button>
          <button
            onClick={onDelete}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
              'border border-red-200/90 bg-white text-red-600 shadow-sm shadow-red-100/40',
              'dark:border-red-900/55 dark:bg-slate-900 dark:text-red-400 dark:shadow-none',
              'hover:bg-red-600 hover:border-red-600 hover:text-white hover:shadow-md hover:shadow-red-500/25',
              'dark:hover:bg-red-600 dark:hover:border-red-500 dark:hover:text-white',
              'active:scale-[0.98] transition-all duration-200 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900'
            )}
            type="button"
          >
            <Trash2 className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
            删除文件
          </button>
        </div>
      </div>
    </div>
  )
}

// 从 URL 导入弹窗（提交后先下载，再在后台处理；立即关闭弹窗并在上传流水线中展示进度）
function ImportUrlModal({
  kbId,
  onClose,
  onSuccess,
  onStartImport,
}: {
  kbId: string
  onClose: () => void
  onSuccess: () => void
  /** 已开始后台导入时回调，用于在上传流水线中展示进度（轮询 processing_id） */
  onStartImport?: (payload: { processing_id: string; filename: string }) => void
}) {
  const [url, setUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) {
      setError('请输入 URL')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await importApi.importFromUrlStart({
        url: url.trim(),
        kb_id: kbId,
        ...(filename.trim() ? { filename: filename.trim() } : {}),
      })
      const data = res as { processing_id?: string; filename?: string }
      if (data?.processing_id && data?.filename && onStartImport) {
        onStartImport({ processing_id: data.processing_id, filename: data.filename })
        onClose()
        return
      }
      // 若未返回 processing_id（如旧后端）， fallback 为同步等待
      await importApi.importFromUrl({
        url: url.trim(),
        kb_id: kbId,
        ...(filename.trim() ? { filename: filename.trim() } : {}),
      })
      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? err?.message ?? '导入失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-xl shadow-slate-900/10 dark:shadow-black/30 border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-gradient-to-r from-blue-50/80 to-indigo-50/60 dark:from-blue-950/30 dark:to-indigo-950/20">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 dark:bg-blue-400/20 text-blue-600 dark:text-blue-400 shadow-sm">
              <Link2 size={20} />
            </span>
            从 URL 导入
          </h3>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">URL <span className="text-red-500">*</span></label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/file.pdf"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400 dark:focus:ring-blue-400/20 dark:focus:border-blue-500 transition-shadow"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">文件名 <span className="text-slate-400 font-normal">(可选)</span></label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="留空则使用 URL 中的文件名"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-400 dark:focus:ring-blue-400/20 dark:focus:border-blue-500 transition-shadow"
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-xl">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors">
              取消
            </button>
            <button type="submit" disabled={loading} className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-blue-500/25 disabled:opacity-50 disabled:shadow-none flex items-center gap-2 transition-all">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              导入
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// 热点资讯导入弹窗（关键词、主题、时间范围、条数均可选，不填用后端默认；支持异步启动后在上传流水线展示进度）
function ImportHotTopicsModal({
  kbId,
  onClose,
  onSuccess,
  onStartImport,
}: {
  kbId: string
  onClose: () => void
  onSuccess: () => void
  /** 异步导入已启动时回调，关闭弹窗并在上传流水线中展示进度（轮询 processing_id） */
  onStartImport?: (payload: { processing_id: string; filename: string }) => void
}) {
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<'' | 'general' | 'news' | 'finance'>('')
  const [timeRange, setTimeRange] = useState<'' | 'day' | 'week' | 'month' | 'year'>('')
  const [maxResults, setMaxResults] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : detail?.msg ?? err?.message ?? '热点导入失败')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-400 dark:focus:ring-emerald-400/20 dark:focus:border-emerald-500 transition-shadow'
  const selectClass = inputClass

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-xl shadow-slate-900/10 dark:shadow-black/30 border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-gradient-to-r from-emerald-50/80 to-teal-50/60 dark:from-emerald-950/30 dark:to-teal-950/20">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 dark:bg-emerald-400/20 text-emerald-600 dark:text-emerald-400 shadow-sm">
              <Newspaper size={20} />
            </span>
            热点资讯导入
          </h3>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">关键词 <span className="text-slate-400 font-normal">(可选)</span></label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="如：科技热点 今日要闻、AI 大模型 融资"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">主题 <span className="text-slate-400 font-normal">(可选)</span></label>
            <select value={topic} onChange={(e) => setTopic(e.target.value as '' | 'general' | 'news' | 'finance')} className={selectClass}>
              <option value="">使用默认</option>
              <option value="general">综合 (general)</option>
              <option value="news">新闻 (news)</option>
              <option value="finance">财经 (finance)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">时间范围 <span className="text-slate-400 font-normal">(可选)</span></label>
            <select value={timeRange} onChange={(e) => setTimeRange(e.target.value as '' | 'day' | 'week' | 'month' | 'year')} className={selectClass}>
              <option value="">使用默认</option>
              <option value="day">近一天 (day)</option>
              <option value="week">近一周 (week)</option>
              <option value="month">近一月 (month)</option>
              <option value="year">近一年 (year)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">条数上限</label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxResults}
              onChange={(e) => setMaxResults(parseInt(e.target.value, 10) || 10)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">1–20 条，默认 10</p>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-xl">{error}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors">
              取消
            </button>
            <button type="submit" disabled={loading} className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:shadow-none flex items-center gap-2 transition-all">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              导入
            </button>
          </div>
        </form>
      </div>
    </div>
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

  const supportsFolderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window

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
    handle: FileSystemDirectoryHandle,
    recursive: boolean,
    pathPrefix: string,
    extensions: string[] | null,
    exclude: string[] | null,
    maxFiles: number,
    collected: File[]
  ): Promise<void> {
    if (collected.length >= maxFiles) return
    for await (const entry of (handle as any).values()) {
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
      setError('当前浏览器不支持选择文件夹，请使用 Chrome/Edge 或下方输入服务端路径')
      return
    }
    setError(null)
    setResult(null)
    setSelectedFiles(null)
    setPickingFolder(true)
    try {
      const dirHandle = await (window as any).showDirectoryPicker()
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
      if (files.length === 0) setError('该文件夹下没有符合条件的文件')
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err?.message ?? '选择文件夹失败')
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
              setFolderProgress({ stage: 'importing', current: 0, total: event.total ?? 0, message: '开始导入…' })
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
      } catch (err: any) {
        setError(err?.response?.data?.detail ?? err?.message ?? '导入失败')
      } finally {
        setLoading(false)
        setFolderProgress(null)
      }
      return
    }
    setError('请先选择本地文件夹或输入服务端路径')
  }

  const canImport = (selectedFiles != null && selectedFiles.length > 0) || folderPath.trim().length > 0

  const inputClass =
    'w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/25 focus:border-amber-400 dark:focus:ring-amber-400/20 dark:focus:border-amber-500 transition-shadow'
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-xl shadow-slate-900/10 dark:shadow-black/30 border border-slate-200/80 dark:border-slate-700/80 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-gradient-to-r from-amber-50/80 to-orange-50/60 dark:from-amber-950/30 dark:to-orange-950/20 sticky top-0 z-10">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 dark:bg-amber-400/20 text-amber-600 dark:text-amber-400 shadow-sm">
              <FolderOpen size={20} />
            </span>
            从文件夹导入
          </h3>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {/* 筛选条件 */}
          <div className="space-y-4 pb-5 border-b border-slate-200 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">筛选条件 <span className="text-slate-400 font-normal">（对下方两种方式均生效）</span></p>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                id="folder-recursive"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600 text-amber-600 focus:ring-amber-500/20"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">递归子目录</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">文件类型 <span className="text-slate-400 font-normal">(可选，逗号分隔)</span></label>
              <input type="text" value={extensionsStr} onChange={(e) => setExtensionsStr(e.target.value)} placeholder=".pdf, .txt, .md" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">排除模式 <span className="text-slate-400 font-normal">(可选，逗号分隔)</span></label>
              <input type="text" value={excludeStr} onChange={(e) => setExcludeStr(e.target.value)} placeholder="__pycache__, .git, *.tmp" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">最大文件数</label>
              <input type="number" min={1} max={2000} value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value) || 500)} className={inputClass} />
            </div>
          </div>

          {/* 选择本地文件夹 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">选择本机文件夹</label>
            <button
              type="button"
              onClick={handleSelectLocalFolder}
              disabled={pickingFolder || loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30 text-slate-700 dark:text-slate-200 hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors disabled:opacity-50"
            >
              {pickingFolder ? <Loader2 size={18} className="animate-spin" /> : <FolderOpen size={18} />}
              {pickingFolder ? '正在打开…' : '选择本地文件夹'}
            </button>
            {!supportsFolderPicker && (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">需使用 Chrome、Edge 等支持 File System Access 的浏览器</p>
            )}
            {selectedFiles != null && selectedFiles.length > 0 && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-800/50 px-3 py-2 rounded-xl">已选择 {selectedFiles.length} 个文件，点击下方「导入」将关闭弹窗并在本页显示每文件处理进度。</p>
            )}
          </div>

          {/* 或输入服务端路径 */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">或输入服务端路径</label>
            <input type="text" value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="/data/docs 或白名单内的路径" className={inputClass} />
          </div>

          {/* 服务端路径导入进度 */}
          {loading && folderProgress && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {folderProgress.stage === 'scanning' ? '正在扫描文件夹…' : folderProgress.stage === 'importing' ? `正在导入 ${folderProgress.current ?? 0}/${folderProgress.total ?? 0}` : '处理中…'}
                </span>
                {folderProgress.total != null && folderProgress.total > 0 && (
                  <span className="text-sm tabular-nums text-slate-500 dark:text-slate-400">{folderProgress.current ?? 0} / {folderProgress.total}</span>
                )}
              </div>
              {folderProgress.total != null && folderProgress.total > 0 && (
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full bg-amber-500 dark:bg-amber-500 transition-all duration-300" style={{ width: `${Math.min(100, ((folderProgress.current ?? 0) / folderProgress.total) * 100)}%` }} />
                </div>
              )}
              {folderProgress.message && folderProgress.stage === 'importing' && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={folderProgress.message}>{folderProgress.message}</p>
              )}
            </div>
          )}

          {/* 共用导入按钮 */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button type="button" onClick={onClose} className="px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors">
              取消
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport || loading}
              className="px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-amber-500/25 disabled:opacity-50 disabled:shadow-none flex items-center gap-2 transition-all"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              导入
            </button>
          </div>

          {result != null && (
            <p className="text-sm text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-800/50 px-3 py-2 rounded-xl">
              成功 {result.success_count}，失败 {result.failed_count}，共 {result.total} 个文件。
            </p>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-xl">{error}</p>}
        </div>
      </div>
    </div>
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
      setError('请输入搜索关键词')
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
          setError(event.message ?? '导入失败')
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
    } catch (err: any) {
      setError(err?.message ?? '导入失败')
    } finally {
      setLoading(false)
    }
  }

  const stageLabel =
    progress?.stage === 'searching'
      ? '搜索中…'
      : progress?.stage === 'downloading'
        ? `下载 ${progress.current}/${progress.total}`
        : progress?.stage === 'importing'
          ? `导入 ${progress.current}/${progress.total}`
          : progress?.stage
            ? progress.stage
            : ''

  // 按阶段区分样式：搜索 / 下载 / 导入
  const progressStageStyle =
    progress?.stage === 'searching'
      ? { border: 'border-l-4 border-l-slate-400', bg: 'bg-slate-50 dark:bg-slate-900', bar: 'bg-slate-500 dark:bg-slate-400', tag: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300', tagLabel: '搜索' }
      : progress?.stage === 'downloading'
        ? { border: 'border-l-4 border-l-blue-500', bg: 'bg-blue-50/50 dark:bg-blue-950/30', bar: 'bg-blue-500 dark:bg-blue-500', tag: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300', tagLabel: '下载' }
        : progress?.stage === 'importing'
          ? { border: 'border-l-4 border-l-emerald-500', bg: 'bg-emerald-50/50 dark:bg-emerald-950/30', bar: 'bg-emerald-500 dark:bg-emerald-500', tag: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300', tagLabel: '导入' }
          : { border: '', bg: 'bg-slate-50 dark:bg-slate-900', bar: 'bg-indigo-500 dark:bg-indigo-600', tag: '', tagLabel: '' }

  const inputClass =
    'w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/25 focus:border-violet-400 dark:focus:ring-violet-400/20 dark:focus:border-violet-500 transition-shadow'
  const selectClass = inputClass
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-xl shadow-slate-900/10 dark:shadow-black/30 border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-gradient-to-r from-violet-50/80 to-fuchsia-50/60 dark:from-violet-950/30 dark:to-fuchsia-950/20">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 dark:bg-violet-400/20 text-violet-600 dark:text-violet-400 shadow-sm">
              <ImagePlus size={20} />
            </span>
            搜索图片导入
          </h3>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">搜索关键词 <span className="text-red-500">*</span></label>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：猫、风景" className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">渠道</label>
            <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={selectClass}>
              <option value="google_images">Google 图片 (SerpAPI)</option>
              <option value="pixabay">Pixabay</option>
              <option value="internet_archive">Internet Archive</option>
            </select>
          </div>
          {source === 'pixabay' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Pixabay 图片类型</label>
                <select value={pixabayImageType} onChange={(e) => setPixabayImageType(e.target.value)} className={selectClass}>
                  <option value="all">全部</option>
                  <option value="photo">照片</option>
                  <option value="illustration">插画</option>
                  <option value="vector">矢量</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Pixabay 排序</label>
                <select value={pixabayOrder} onChange={(e) => setPixabayOrder(e.target.value)} className={selectClass}>
                  <option value="popular">最受欢迎</option>
                  <option value="latest">最新</option>
                </select>
              </div>
            </>
          )}
          {source === 'internet_archive' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Archive 排序</label>
              <select value={archiveSort} onChange={(e) => setArchiveSort(e.target.value)} className={selectClass}>
                <option value="relevance">相关度</option>
                <option value="popular">最受欢迎</option>
                <option value="newest">最新</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">数量 (1–20)</label>
            <input type="number" min={1} max={20} value={quantity} onChange={(e) => setQuantity(Number(e.target.value) || 5)} className={inputClass} />
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} className="rounded border-slate-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500/20" />
            <span className="text-sm text-slate-700 dark:text-slate-200">增加随机性（同关键词多次搜索得到不同图片）</span>
          </label>
          {progress && (
            <div className={cn('rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2', progressStageStyle.border, progressStageStyle.bg)}>
              <div className="flex items-center justify-between gap-2">
                {progressStageStyle.tagLabel && (
                  <span className={cn('inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium', progressStageStyle.tag)}>{progressStageStyle.tagLabel}</span>
                )}
                <span className="text-sm text-slate-600 dark:text-slate-300 flex-1 truncate">{stageLabel}</span>
                {progress.total > 0 && <span className="text-sm font-medium text-slate-500 dark:text-slate-400 tabular-nums">{progress.current} / {progress.total}</span>}
              </div>
              {progress.total > 0 && (
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div className={cn('h-full transition-all duration-300', progressStageStyle.bar)} style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }} />
                </div>
              )}
              {progress.message && <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={progress.message}>{progress.message}</p>}
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-xl">{error}</p>}
          {result && <p className="text-sm text-slate-600 dark:text-slate-300 bg-slate-100/80 dark:bg-slate-800/50 px-3 py-2 rounded-xl">{result.message}</p>}
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-sm font-medium transition-colors">
              {result ? '关闭' : '取消'}
            </button>
            <button type="submit" disabled={loading} className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-violet-500/25 disabled:opacity-50 disabled:shadow-none flex items-center gap-2 transition-all">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? (progress ? '处理中…' : '连接中…') : '开始导入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const KnowledgeList: React.FC = () => {
  const [viewState, setViewState] = useState<'list' | 'detail'>('list')
  const [activeKbId, setActiveKbId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [fileView, setFileView] = useState<'grid' | 'table'>('grid')
  const [previewFile, setPreviewFile] = useState<any>(null)
  const [dragOverlay, setDragOverlay] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadPipelineProgress | undefined>()
  const [currentUploadFiles, setCurrentUploadFiles] = useState<File[] | null>(null)
  const [showImportUrlModal, setShowImportUrlModal] = useState(false)
  const [showImportSearchModal, setShowImportSearchModal] = useState(false)
  const [showImportFolderModal, setShowImportFolderModal] = useState(false)
  const [showImportHotTopicsModal, setShowImportHotTopicsModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  /** URL 异步导入的 processing_id，用于轮询进度并在上传流水线中展示 */
  const [urlImportProcessingId, setUrlImportProcessingId] = useState<string | null>(null)
  const [files, setFiles] = useState<any[]>([])
  const [kbStats, setKbStats] = useState<{
    documents: number
    chunks: number
    images: number
    audio?: number
    video?: number
    text_vector_dim?: number
    image_vector_dim?: number
    audio_vector_dim?: number
  } | null>(null)

  const {
    knowledgeBases,
    loading,
    fetchKnowledgeBases,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
  } = useKnowledgeStore()

  const [menuOpenKbId, setMenuOpenKbId] = useState<string | null>(null)
  const [editKb, setEditKb] = useState<{ id: string; name: string; description: string } | null>(null)

  useEffect(() => {
    fetchKnowledgeBases()
  }, [fetchKnowledgeBases])

  useEffect(() => {
    if (menuOpenKbId == null) return
    const close = () => setMenuOpenKbId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpenKbId])

  const fetchFiles = useCallback(async () => {
    if (!activeKbId) return
    try {
      const res = await knowledgeApi.getKnowledgeBaseFiles(activeKbId)
      const list = (res?.files || []).map((f: { id: string; name: string; size: number; date: string; type: string; preview_url?: string; text_preview?: string }) => ({
        id: f.id,
        name: f.name,
        size: f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`,
        date: f.date ? new Date(f.date).toLocaleDateString() : '-',
        type: f.type,
        status: 'ready',
        previewUrl: f.preview_url,
        textPreview: f.text_preview,
      }))
      setFiles(list)
    } catch {
      setFiles([])
    }
  }, [activeKbId])

  useEffect(() => {
    if (viewState === 'detail' && activeKbId) fetchFiles()
  }, [viewState, activeKbId, fetchFiles])

  useEffect(() => {
    if (viewState === 'detail' && activeKbId) {
      setKbStats(null)
      knowledgeApi.getKnowledgeBaseStats(activeKbId).then(setKbStats).catch(() => setKbStats(null))
    }
  }, [viewState, activeKbId])

  // URL 异步导入：轮询进度并更新上传流水线展示（与普通上传同一套进度样式）
  useEffect(() => {
    if (!urlImportProcessingId) return
    const stageOrder: Record<UploadPipelineProgress['stage'], number> = {
      idle: -1,
      minio: 0,
      parsing: 1,
      vectorizing: 2,
      portrait: 3,
      done: 4,
    }
    const poll = async () => {
      try {
        const status = await knowledgeApi.getUploadProgress(urlImportProcessingId)
        if (!status) return
        const stage = status.stage
        const progress = status.progress ?? 0
        const frontStage: UploadPipelineProgress['stage'] | null =
          stage === 'initializing' || stage === 'uploading' || stage === 'fetching' || stage === 'summarizing'
            ? 'minio'
            : stage === 'parsing' || stage === 'processing'
              ? 'parsing'
              : stage === 'vectorizing'
                ? 'vectorizing'
                : stage === 'completed'
                  ? 'portrait'
                  : null
        if (status.status === 'completed') {
          flushSync(() => {
            setUploadProgress((prev) =>
              prev
                ? { ...prev, stage: 'done', stageProgress: 100, completed: 1, failed: prev.failed }
                : prev
            )
          })
          setUrlImportProcessingId(null)
          fetchFiles()
          fetchKnowledgeBases()
          setTimeout(() => {
            setUploading(false)
            setCurrentUploadFiles(null)
            setTimeout(() => setUploadProgress(undefined), 500)
          }, 2500)
          return
        }
        if (status.status === 'failed') {
          flushSync(() => {
            setUploadProgress((prev) =>
              prev
                ? { ...prev, stage: 'done', failed: (prev.failed || 0) + 1, completed: prev.completed }
                : prev
            )
          })
          setUrlImportProcessingId(null)
          setTimeout(() => {
            setUploading(false)
            setCurrentUploadFiles(null)
            setTimeout(() => setUploadProgress(undefined), 500)
          }, 2500)
          return
        }
        if (frontStage !== null) {
          flushSync(() => {
            setUploadProgress((prev) => {
              if (!prev) return prev
              const currentIndex = stageOrder[prev.stage] ?? -1
              const newIndex = stageOrder[frontStage]
              if (newIndex < currentIndex) return prev
              const next: UploadPipelineProgress = { ...prev, stage: frontStage, stageProgress: progress }
              if (stage === 'fetching' || stage === 'summarizing') next.currentFile = status.message || prev.currentFile
              return next
            })
          })
        }
      } catch {
        // 轮询出错可忽略，下次再试
      }
    }
    poll()
    const interval = setInterval(poll, 1500)
    return () => clearInterval(interval)
  }, [urlImportProcessingId])

  // 获取当前选中的 KB 对象
  const activeKb = knowledgeBases.find((k) => k.id === activeKbId)

  // 全局拖拽上传遮罩（仅 detail 页可用）
  useEffect(() => {
    let counter = 0
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault()
      counter += 1
      setDragOverlay(true)
    }
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault()
      counter -= 1
      if (counter <= 0) {
        counter = 0
        setDragOverlay(false)
      }
    }
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      counter = 0
      setDragOverlay(false)
      const fileList = e.dataTransfer?.files
      if (!fileList || fileList.length === 0) return
      if (viewState !== 'detail' || !activeKbId) return
      const fileArray = Array.from(fileList).slice(0, 10)
      handleFileUpload(fileArray)
    }

    if (viewState === 'detail') {
      window.addEventListener('dragenter', onDragEnter)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('drop', onDrop)
    }

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [viewState, activeKbId])

  // 处理创建 KB
  const handleCreateKb = async (name: string, desc: string) => {
    try {
      await createKnowledgeBase({ name, description: desc })
      setShowCreateModal(false)
    } catch (error) {
      console.error('创建知识库失败:', error)
    }
  }

  const getFileType = (file: File) => {
    const name = file.name.toLowerCase()
    const ext = name.includes('.') ? name.split('.').pop() || '' : ''
    if (ext) return ext
    if (file.type.startsWith('image/')) return 'jpg'
    if (file.type.startsWith('audio/')) return 'mp3'
    if (file.type.startsWith('video/')) return 'mp4'
    return 'txt'
  }

  // 处理文件上传（逐个上传，保证进度正确）
  const handleFileUpload = async (fileList: File[]) => {
    if (!activeKbId || fileList.length === 0) return
    setCurrentUploadFiles(fileList)
    setUploading(true)
    setUploadProgress({
      stage: 'minio',
      stageProgress: 0,
      total: fileList.length,
      completed: 0,
      failed: 0,
      currentFile: fileList[0]?.name,
      currentFileIsImage: fileList[0]?.type.startsWith('image/'),
    })

    let completed = 0
    let failed = 0

    try {
      for (const file of fileList) {
        const isImage = file.type.startsWith('image/')
        const fileType = getFileType(file)

        flushSync(() => {
          setUploadProgress((prev) => ({
            ...(prev || {
              total: fileList.length,
              completed: 0,
              failed: 0,
              stageProgress: 0,
              stage: 'minio',
            }),
            currentFile: file.name,
            currentFileIsImage: isImage,
            stage: 'minio',
            stageProgress: 0,
          }))
        })
        await new Promise((r) => setTimeout(r, 0))

        try {
          await knowledgeApi.uploadSingleFileStream(activeKbId, file, fileType, (status) => {
            // 流式进度：后端 stage 映射到前端，且只前进不后退，与真实流程一致
            const stage = status.stage
            const progress = status.progress ?? 0
            const frontStage: UploadPipelineProgress['stage'] | null =
              stage === 'initializing' || stage === 'uploading'
                ? 'minio'
                : stage === 'parsing' || stage === 'processing'
                  ? 'parsing'
                  : stage === 'vectorizing'
                    ? 'vectorizing'
                    : stage === 'completed'
                      ? 'portrait'
                      : null
            if (frontStage === null) return
            const stageOrder: Record<UploadPipelineProgress['stage'], number> = {
              idle: -1,
              minio: 0,
              parsing: 1,
              vectorizing: 2,
              portrait: 3,
              done: 4,
            }
            flushSync(() => {
              setUploadProgress((prev) => {
                if (!prev) return prev
                const currentIndex = stageOrder[prev.stage] ?? -1
                const newIndex = stageOrder[frontStage]
                if (newIndex < currentIndex) return prev
                return {
                  ...prev,
                  stage: frontStage,
                  stageProgress: progress,
                  currentFile: file.name,
                  currentFileIsImage: isImage,
                }
              })
            })
          })
          completed += 1
          flushSync(() => {
            setUploadProgress((prev) => ({
              ...(prev || {
                total: fileList.length,
                completed,
                failed,
              }),
              completed,
              failed,
              stage: 'portrait',
              stageProgress: 100,
            }))
          })
          await new Promise((r) => setTimeout(r, 0))
        } catch (e) {
          console.error('上传失败', e)
          failed += 1
          flushSync(() => {
            setUploadProgress((prev) => (prev ? { ...prev, failed } : prev))
          })
        }
      }

      setUploadProgress((prev) => ({
        ...(prev || {
          total: fileList.length,
          completed,
          failed,
        }),
        stage: 'done',
        stageProgress: 100,
        completed,
        failed,
      }))
      await fetchKnowledgeBases()
      await fetchFiles()
    } finally {
      setUploading(false)
      setCurrentUploadFiles(null)
      setTimeout(() => setUploadProgress(undefined), 2000)
    }
  }

  const handleDeleteKb = async (kbId: string) => {
    setMenuOpenKbId(null)
    const kb = knowledgeBases.find((k) => k.id === kbId)
    const ok = window.confirm(`确定删除知识库「${kb?.name || kbId}」？此操作不可撤销。`)
    if (!ok) return
    try {
      await deleteKnowledgeBase(kbId)
      if (activeKbId === kbId) {
        setActiveKbId(null)
        setViewState('list')
      }
    } catch (error) {
      console.error('删除知识库失败:', error)
    }
  }

  const handleSaveEdit = async (id: string, name: string, description: string) => {
    try {
      await updateKnowledgeBase(id, { name, description })
      setEditKb(null)
    } catch (error) {
      console.error('更新知识库失败:', error)
    }
  }

  const handleDeleteFile = async (fileId: string) => {
    if (!activeKbId) return
    const ok = window.confirm('确定删除该文件？')
    if (!ok) return
    try {
      await knowledgeApi.deleteKnowledgeBaseFile(activeKbId, fileId)
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
      await fetchKnowledgeBases()
    } catch (e) {
      console.error('删除文件失败', e)
    }
  }

  // --- KB 列表视图 ---
  if (viewState === 'list') {
    return (
      <div className="flex-1 bg-slate-50 dark:bg-slate-950 flex flex-col h-full relative">
        {/* Header */}
        <div className="relative -mt-0 overflow-visible border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 md:-mt-1">
          <div className="relative z-10 px-5 pb-3.5 pt-2.5 sm:px-8 sm:pb-4 sm:pt-3">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex flex-1 flex-col gap-3 xl:flex-row xl:items-center xl:gap-5">
                  <div className="shrink-0">
                    <div className="flex items-center gap-4 sm:gap-5">
                      {/* 高度占位保持顶栏不高；宽度与图标一致，避免绝对定位大图压到标题 */}
                      <div className="relative flex h-10 w-[4.5rem] shrink-0 items-center justify-center sm:h-11 sm:w-[5.25rem]">
                        <img
                          src="/MMKB.png"
                          alt=""
                          className="pointer-events-none absolute left-1/2 top-1/2 h-[4.5rem] w-[4.5rem] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain object-center sm:h-[5.25rem] sm:w-[5.25rem]"
                        />
                      </div>
                      <h1 className="relative z-10 min-w-0 text-[2.05rem] font-bold leading-none tracking-tight text-slate-950 dark:text-slate-50 sm:text-[2.2rem]">
                        知识库
                      </h1>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-400 sm:text-[15px]">
                      集中管理文档、图片与音视频内容，自动完成索引、解析与主题画像，支撑 RAG 检索和多轮对话。
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/90 px-3 py-1.5 text-slate-600 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-300">
                        <span aria-hidden>📄</span>
                        文档
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-200/80 bg-fuchsia-50/90 px-3 py-1.5 text-fuchsia-700 shadow-sm dark:border-fuchsia-500/25 dark:bg-fuchsia-500/10 dark:text-fuchsia-200">
                        <span aria-hidden>🖼️</span>
                        图片
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200/80 bg-violet-50/90 px-3 py-1.5 text-violet-700 shadow-sm dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-200">
                        <span aria-hidden>🎵</span>
                        音频
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1.5 text-emerald-700 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200">
                        <span aria-hidden>🎥</span>
                        视频
                      </span>
                      <span className="inline-flex items-center rounded-full border border-indigo-200/80 bg-indigo-50/90 px-3 py-1.5 text-indigo-700 shadow-sm dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200">
                        自动索引
                      </span>
                      <span className="inline-flex items-center rounded-full border border-indigo-200/80 bg-indigo-50/90 px-3 py-1.5 text-indigo-700 shadow-sm dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200">
                        主题画像
                      </span>
                      <span className="inline-flex items-center rounded-full border border-indigo-200/80 bg-indigo-50/90 px-3 py-1.5 text-indigo-700 shadow-sm dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-200">
                        检索增强
                      </span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 xl:pl-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className="group inline-flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_-10px_rgba(99,102,241,0.5),inset_0_1px_0_rgba(255,255,255,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:from-indigo-500 hover:via-violet-500 hover:to-fuchsia-500 hover:shadow-[0_18px_34px_-10px_rgba(168,85,247,0.42),inset_0_1px_0_rgba(255,255,255,0.22)] active:translate-y-0 sm:w-auto sm:min-w-[9.5rem]"
                  >
                    <Plus size={18} strokeWidth={2.8} className="shrink-0 transition-transform duration-200 group-hover:rotate-90" />
                    新建知识库
                  </button>
                </div>
              </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 animate-pulse">
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded mb-2"></div>
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                </div>
              ))}
            </div>
          ) : knowledgeBases.length === 0 ? (
            <div className="col-span-full text-center py-20 text-slate-500 dark:text-slate-400">
              <Database size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-base">暂无知识库</p>
              <p className="mt-1 text-sm">点击上方「新建知识库」创建第一个知识库，开始上传与管理多模态数据。</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {knowledgeBases.map((kb) => {
                const kbCardTitleClass = 'text-lg font-bold mb-1 leading-snug'
                return (
                <div
                  key={kb.id}
                  onClick={() => {
                    setActiveKbId(kb.id)
                    setViewState('detail')
                  }}
                  className={cn(
                    'relative rounded-xl border border-slate-200 dark:border-slate-800 hover:shadow-md hover:border-fuchsia-300 dark:hover:border-fuchsia-500 transition-all cursor-pointer group overflow-hidden min-h-[180px] h-full flex flex-col',
                    kb.cover_url ? 'p-0' : 'bg-white dark:bg-slate-900 pt-5 px-5 pb-3.5'
                  )}
                >
                  {/* 有封面时：图片铺满整卡作为背景 */}
                  {kb.cover_url ? (
                    <>
                      <div className="absolute inset-0">
                        <img
                          src={kb.cover_url}
                          alt=""
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent rounded-xl" />
                      <div className="relative z-10 flex flex-col h-full min-h-0 p-3.5">
                        {/* 顶部弹性空间，把标题/描述与统计条整体压到底部 */}
                        <div className="min-h-0 flex-1" />
                        <div className="flex-shrink-0 pt-4 pb-1">
                          <h3 className={cn(kbCardTitleClass, 'text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.7)]')}>
                            {kb.name}
                          </h3>
                          <p className="text-white text-sm h-9 overflow-hidden text-ellipsis leading-relaxed line-clamp-2 [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_6px_rgba(0,0,0,0.6)]">
                            {kb.description || '暂无描述'}
                          </p>
                          <div className="mt-2 pt-2.5 border-t border-white/30 flex items-center justify-between gap-2 text-xs text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
                            <div className="flex items-center gap-2 min-h-[1rem] min-w-0 flex-1 flex-wrap">
                              <span className="inline-flex items-center gap-1 shrink-0">
                                <span className="text-[13px] leading-none" aria-hidden>
                                  📄
                                </span>
                                {kb.stats?.documents ?? 0} 个文件
                              </span>
                              <span className="opacity-80 shrink-0">·</span>
                              <span className="inline-flex items-center gap-1 shrink-0">
                                <span className="text-[13px] leading-none" aria-hidden>
                                  🖼️
                                </span>
                                {kb.stats?.images ?? 0} 张图片
                              </span>
                              <span className="opacity-80 shrink-0">·</span>
                              <span className="inline-flex items-center gap-1 shrink-0">
                                <span className="text-[13px] leading-none" aria-hidden>
                                  🎵
                                </span>
                                {kb.stats?.audio ?? 0} 条音频
                              </span>
                              <span className="opacity-80 shrink-0">·</span>
                              <span className="inline-flex items-center gap-1 shrink-0">
                                <span className="text-[13px] leading-none" aria-hidden>
                                  🎥
                                </span>
                                {kb.stats?.video ?? 0} 个视频
                              </span>
                            </div>
                            <span className="shrink-0">{kb.updated_at ? new Date(kb.updated_at).toLocaleDateString() : '未知'}</span>
                            <div className="relative shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMenuOpenKbId((id) => (id === kb.id ? null : kb.id))
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white/90 shadow-md backdrop-blur-sm transition-all hover:bg-white/25 hover:text-white hover:border-white/40 active:scale-95"
                                title="更多操作"
                              >
                                <MoreVertical size={14} strokeWidth={2} />
                              </button>
                              {menuOpenKbId === kb.id && (
                                <div
                                  className="absolute right-0 bottom-full mb-1.5 py-1 min-w-[120px] rounded-xl bg-white/95 dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 shadow-xl backdrop-blur-sm z-50"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditKb({ id: kb.id, name: kb.name, description: kb.description ?? '' })
                                      setMenuOpenKbId(null)
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 rounded-t-xl first:pt-2.5"
                                  >
                                    <Pencil size={14} /> 编辑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteKb(kb.id)}
                                    className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 rounded-b-xl last:pb-2.5"
                                  >
                                    <Trash2 size={14} /> 删除
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="min-h-0 flex-1 flex flex-col">
                        <div className="mb-3 flex items-center">
                          <Database
                            size={28}
                            strokeWidth={2}
                            className="shrink-0 text-indigo-600 transition-all duration-200 ease-out group-hover:text-fuchsia-600 group-hover:scale-[1.06] dark:text-indigo-400 dark:group-hover:text-fuchsia-400 drop-shadow-[0_1px_1px_rgba(99,102,241,0.12)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                            aria-hidden
                          />
                        </div>
                        <h3 className={cn(kbCardTitleClass, 'text-slate-800 dark:text-slate-100')}>{kb.name}</h3>
                        <p className="text-slate-500 dark:text-slate-400 text-sm h-10 overflow-hidden text-ellipsis leading-relaxed line-clamp-2 flex-1 min-h-0">
                          {kb.description || '暂无描述'}
                        </p>
                      </div>
                      <div className="flex-shrink-0 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-xs text-slate-400">
                        <div className="flex items-center gap-2 min-h-[1rem] min-w-0 flex-1 flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[13px] leading-none" aria-hidden>
                              📄
                            </span>
                            {kb.stats?.documents ?? 0} 个文件
                          </span>
                          <span className="opacity-70">·</span>
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[13px] leading-none" aria-hidden>
                              🖼️
                            </span>
                            {kb.stats?.images ?? 0} 张图片
                          </span>
                          <span className="opacity-70">·</span>
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[13px] leading-none" aria-hidden>
                              🎵
                            </span>
                            {kb.stats?.audio ?? 0} 条音频
                          </span>
                          <span className="opacity-70">·</span>
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[13px] leading-none" aria-hidden>
                              🎥
                            </span>
                            {kb.stats?.video ?? 0} 个视频
                          </span>
                        </div>
                        <span className="shrink-0">{kb.updated_at ? new Date(kb.updated_at).toLocaleDateString() : '未知'}</span>
                        <div className="relative shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuOpenKbId((id) => (id === kb.id ? null : kb.id))
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 shadow-sm transition-all hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-500 active:scale-95"
                            title="更多操作"
                          >
                            <MoreVertical size={14} strokeWidth={2} />
                          </button>
                          {menuOpenKbId === kb.id && (
                            <div
                              className="absolute right-0 bottom-full mb-1.5 py-1 min-w-[120px] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl z-50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditKb({ id: kb.id, name: kb.name, description: kb.description ?? '' })
                                  setMenuOpenKbId(null)
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 rounded-t-xl first:pt-2.5"
                              >
                                <Pencil size={14} /> 编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteKb(kb.id)}
                                className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 rounded-b-xl last:pb-2.5"
                              >
                                <Trash2 size={14} /> 删除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
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
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-40">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-5 shadow-xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto">
                <Upload size={22} />
              </div>
              <div className="mt-3 font-semibold text-slate-900 dark:text-slate-100">拖拽上传</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                进入某个知识库详情页后松手即可上传
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // --- KB 详情视图 ---
  if (viewState === 'detail' && activeKb) {
    const filteredFiles = files.filter((f) => {
      if (!fileQuery.trim()) return true
      return f.name.toLowerCase().includes(fileQuery.trim().toLowerCase())
    })

    return (
      <div className="flex-1 bg-slate-50 dark:bg-slate-950 flex flex-col h-full relative">
        {/* Header with Breadcrumb */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center gap-4">
          <button
            onClick={() => setViewState('list')}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-900 rounded-full text-slate-500 dark:text-slate-300 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span className="cursor-pointer hover:text-blue-600" onClick={() => setViewState('list')}>
                知识库
              </span>
              <ChevronRight size={12} />
              <span>详情</span>
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-3">
              {activeKb.name}
              <span className="text-xs font-normal px-2 py-0.5 bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-full border border-green-200 dark:border-green-800">
                可用
              </span>
            </h2>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 上传与导入：拖拽/选择上传与自动导入同框 */}
            <UploadPipeline
              onFileSelect={handleFileUpload}
              isUploading={uploading}
              uploadProgress={uploadProgress}
              externalFiles={currentUploadFiles}
            >
              <div className="mb-4 flex items-center gap-3">
                <Zap
                  className="h-5 w-5 shrink-0 text-amber-600 opacity-90 drop-shadow-[0_1px_2px_rgba(245,158,11,0.22)] dark:text-amber-400 dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
                  strokeWidth={2.25}
                  aria-hidden
                />
                <span className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">自动导入</span>
              </div>
              <div className="flex flex-wrap gap-4">
                <button
                  type="button"
                  onClick={() => setShowImportUrlModal(true)}
                  className="group flex-1 min-w-[140px] inline-flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200/80 dark:border-slate-600/80 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-all duration-200 hover:border-blue-300 dark:hover:border-blue-500/80 hover:bg-gradient-to-br hover:from-blue-50 hover:to-indigo-50 dark:hover:from-blue-950/40 dark:hover:to-indigo-950/30 hover:shadow-md hover:shadow-blue-500/10 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/12 dark:bg-blue-400/20 text-blue-600 dark:text-blue-400 shadow-inner group-hover:bg-blue-500/20 dark:group-hover:bg-blue-400/30 transition-colors">
                    <Link2 size={20} />
                  </span>
                  <span className="text-left">从 URL 导入</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowImportSearchModal(true)}
                  className="group flex-1 min-w-[140px] inline-flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200/80 dark:border-slate-600/80 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-all duration-200 hover:border-violet-300 dark:hover:border-violet-500/80 hover:bg-gradient-to-br hover:from-violet-50 hover:to-fuchsia-50 dark:hover:from-violet-950/40 dark:hover:to-fuchsia-950/30 hover:shadow-md hover:shadow-violet-500/10 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/12 dark:bg-violet-400/20 text-violet-600 dark:text-violet-400 shadow-inner group-hover:bg-violet-500/20 dark:group-hover:bg-violet-400/30 transition-colors">
                    <ImagePlus size={20} />
                  </span>
                  <span className="text-left">搜索图片导入</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowImportFolderModal(true)}
                  className="group flex-1 min-w-[140px] inline-flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200/80 dark:border-slate-600/80 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-all duration-200 hover:border-amber-300 dark:hover:border-amber-500/80 hover:bg-gradient-to-br hover:from-amber-50 hover:to-orange-50 dark:hover:from-amber-950/40 dark:hover:to-orange-950/30 hover:shadow-md hover:shadow-amber-500/10 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 dark:bg-amber-400/20 text-amber-600 dark:text-amber-400 shadow-inner group-hover:bg-amber-500/20 dark:group-hover:bg-amber-400/30 transition-colors">
                    <FolderOpen size={20} />
                  </span>
                  <span className="text-left">从文件夹导入</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowImportHotTopicsModal(true)}
                  className="group flex-1 min-w-[140px] inline-flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-200/80 dark:border-slate-600/80 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm transition-all duration-200 hover:border-emerald-300 dark:hover:border-emerald-500/80 hover:bg-gradient-to-br hover:from-emerald-50 hover:to-teal-50 dark:hover:from-emerald-950/40 dark:hover:to-teal-950/30 hover:shadow-md hover:shadow-emerald-500/10 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 dark:bg-emerald-400/20 text-emerald-600 dark:text-emerald-400 shadow-inner group-hover:bg-emerald-500/20 dark:group-hover:bg-emerald-400/30 transition-colors">
                    <Newspaper size={20} />
                  </span>
                  <span className="text-left">热点资讯导入</span>
                </button>
              </div>
            </UploadPipeline>

            {/* File List */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
                <h3 className="flex items-center gap-3 font-semibold tracking-tight text-slate-800 dark:text-slate-100 shrink-0">
                  <Layers
                    className="h-5 w-5 shrink-0 text-indigo-600 opacity-90 drop-shadow-[0_1px_2px_rgba(99,102,241,0.15)] dark:text-indigo-400 dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                    strokeWidth={2.25}
                    aria-hidden
                  />
                  <span>
                    文件列表
                    <span className="ml-1.5 text-sm font-normal text-slate-500 dark:text-slate-400 tabular-nums">（{files.length}）</span>
                  </span>
                </h3>
                <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                  <div
                    className="hidden sm:inline-flex items-center gap-0.5 rounded-xl bg-slate-200/55 dark:bg-slate-800/90 p-1 ring-1 ring-inset ring-slate-300/35 dark:ring-slate-700/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                    role="tablist"
                    aria-label="文件视图"
                  >
                    <button
                      onClick={() => setFileView('grid')}
                      role="tab"
                      aria-selected={fileView === 'grid'}
                      className={cn(
                        'flex items-center gap-1.5 rounded-[0.65rem] px-3 py-2 text-xs font-semibold transition-all duration-200 ease-out',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900',
                        fileView === 'grid'
                          ? 'bg-white dark:bg-slate-950 text-indigo-700 dark:text-indigo-300 shadow-md shadow-slate-300/25 dark:shadow-black/40 ring-1 ring-slate-200/90 dark:ring-slate-600/80'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/75 dark:hover:bg-slate-700/45 active:scale-[0.98]'
                      )}
                      type="button"
                      title="画廊视图"
                    >
                      <LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                      画廊
                    </button>
                    <button
                      onClick={() => setFileView('table')}
                      role="tab"
                      aria-selected={fileView === 'table'}
                      className={cn(
                        'flex items-center gap-1.5 rounded-[0.65rem] px-3 py-2 text-xs font-semibold transition-all duration-200 ease-out',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-900',
                        fileView === 'table'
                          ? 'bg-white dark:bg-slate-950 text-indigo-700 dark:text-indigo-300 shadow-md shadow-slate-300/25 dark:shadow-black/40 ring-1 ring-slate-200/90 dark:ring-slate-600/80'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/75 dark:hover:bg-slate-700/45 active:scale-[0.98]'
                      )}
                      type="button"
                      title="列表视图"
                    >
                      <List className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2.25} aria-hidden />
                      列表
                    </button>
                  </div>
                  <label className="flex min-w-0 flex-1 sm:flex-initial sm:min-w-[11rem] items-center gap-2 rounded-xl border border-slate-200/95 bg-white px-3 py-2 shadow-sm shadow-slate-200/40 ring-slate-200/80 transition-shadow dark:border-slate-600 dark:bg-slate-800/90 dark:shadow-black/20 dark:ring-slate-600/40 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-500/35 dark:focus-within:border-indigo-500/50">
                    <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" strokeWidth={2.25} aria-hidden />
                    <input
                      value={fileQuery}
                      onChange={(e) => setFileQuery(e.target.value)}
                      type="search"
                      placeholder="搜索文件..."
                      autoComplete="off"
                      aria-label="搜索文件"
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </label>
                </div>
              </div>

              {fileView === 'table' ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm text-left border-collapse">
                    <thead>
                      <tr
                        className={cn(
                          'border-b-2 border-indigo-200/50 dark:border-indigo-900/40',
                          'bg-gradient-to-r from-slate-100/95 via-indigo-50/25 to-slate-50/95',
                          'dark:from-slate-800 dark:via-indigo-950/35 dark:to-slate-950',
                          'shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                        )}
                      >
                        <th
                          scope="col"
                          className="px-6 py-3.5 text-left text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200 whitespace-nowrap"
                        >
                          <span className="inline-flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400 opacity-90" strokeWidth={2.25} aria-hidden />
                            文件名
                          </span>
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3.5 text-left text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200 whitespace-nowrap border-l border-slate-200/80 dark:border-slate-700/90"
                        >
                          <span className="inline-flex items-center gap-2">
                            <HardDrive className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400 opacity-90" strokeWidth={2.25} aria-hidden />
                            大小
                          </span>
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3.5 text-left text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200 whitespace-nowrap border-l border-slate-200/80 dark:border-slate-700/90"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Activity className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400 opacity-90" strokeWidth={2.25} aria-hidden />
                            状态
                          </span>
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3.5 text-left text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200 whitespace-nowrap border-l border-slate-200/80 dark:border-slate-700/90"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Calendar className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400 opacity-90" strokeWidth={2.25} aria-hidden />
                            日期
                          </span>
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3.5 text-right text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-200 whitespace-nowrap border-l border-slate-200/80 dark:border-slate-700/90"
                        >
                          <span className="inline-flex w-full items-center justify-end gap-2">
                            <MoreHorizontal className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400 opacity-90" strokeWidth={2.25} aria-hidden />
                            操作
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/90">
                      {filteredFiles.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-14 text-center">
                            <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500">
                                <FolderOpen className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                              </span>
                              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                                {files.length === 0 ? '暂无文件，先上传一个。' : '没有匹配的搜索结果。'}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredFiles.map((file, rowIdx) => (
                          <tr
                            key={file.id}
                            className={cn(
                              'transition-colors duration-200',
                              rowIdx % 2 === 1 ? 'bg-slate-50/40 dark:bg-slate-900/40' : 'bg-white dark:bg-slate-900',
                              'hover:bg-indigo-50/50 dark:hover:bg-indigo-950/25'
                            )}
                          >
                            <td className="px-6 py-3.5 font-medium text-slate-700 dark:text-slate-200 align-middle">
                              <button
                                onClick={() => setPreviewFile(file)}
                                className="group/fn flex w-full min-w-0 items-center gap-3 rounded-lg py-0.5 -mx-1 px-1 text-left transition-colors hover:bg-indigo-100/60 dark:hover:bg-indigo-950/40"
                                type="button"
                                title="预览"
                              >
                                <FileThumb file={file} />
                                <span className="truncate max-w-[420px] group-hover/fn:text-indigo-700 dark:group-hover/fn:text-indigo-300">
                                  {file.name}
                                </span>
                              </button>
                            </td>
                            <td className="px-6 py-3.5 text-slate-600 dark:text-slate-400 tabular-nums align-middle border-l border-slate-100 dark:border-slate-800/90">
                              {file.size}
                            </td>
                            <td className="px-6 py-3.5 align-middle border-l border-slate-100 dark:border-slate-800/90">
                              <StatusBadge status={file.status} />
                            </td>
                            <td className="px-6 py-3.5 text-slate-600 dark:text-slate-400 tabular-nums align-middle border-l border-slate-100 dark:border-slate-800/90">
                              {file.date}
                            </td>
                            <td className="px-6 py-3.5 text-right align-middle border-l border-slate-100 dark:border-slate-800/90">
                              <button
                                onClick={() => handleDeleteFile(file.id)}
                                className="inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-all duration-200 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                title="删除文件"
                                type="button"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6">
                  {filteredFiles.length === 0 ? (
                    <div className="py-10 text-center text-slate-400">
                      {files.length === 0 ? '暂无文件，先上传一个。' : '没有匹配的搜索结果。'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredFiles.map((file) => {
                        const isAudio = isAudioType(file?.type)
                        const isVideo = isVideoType(file?.type)
                        const isMedia = isAudio || isVideo
                        return (
                          <button
                            key={file.id}
                            onClick={() => setPreviewFile(file)}
                            className={cn(
                              'text-left rounded-xl border transition-all overflow-hidden group',
                              isAudio
                                ? 'bg-gradient-to-b from-violet-50/80 to-white dark:from-violet-950/30 dark:to-slate-900 border-violet-200/80 dark:border-violet-800/60 hover:border-violet-400 dark:hover:border-violet-500 hover:shadow-md hover:shadow-violet-500/10'
                                : isVideo
                                  ? 'bg-gradient-to-b from-sky-50/80 to-white dark:from-sky-950/30 dark:to-slate-900 border-sky-200/80 dark:border-sky-800/60 hover:border-sky-400 dark:hover:border-sky-500 hover:shadow-md hover:shadow-sky-500/10'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-fuchsia-300 dark:hover:border-fuchsia-500 hover:shadow-sm'
                            )}
                            type="button"
                            title={isMedia ? '点击播放或查看详情' : '点击预览'}
                          >
                            <div className="relative">
                              <div className={cn(
                                'h-36 overflow-hidden flex items-center justify-center',
                                isAudio ? 'bg-violet-50/50 dark:bg-violet-950/30' : isVideo ? 'bg-sky-50/50 dark:bg-sky-950/30' : 'bg-slate-50 dark:bg-slate-900'
                              )}>
                                <FileHero file={file} />
                              </div>
                              <div className="absolute top-3 left-3">
                                <StatusBadge status={file.status} />
                              </div>
                              {isMedia && (
                                <div className={cn(
                                  'absolute bottom-3 right-3 flex items-center justify-center w-9 h-9 rounded-full text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity',
                                  isVideo ? 'bg-sky-500/90 dark:bg-sky-600/90' : 'bg-violet-500/90 dark:bg-violet-600/90'
                                )}>
                                  <Play size={18} className="ml-0.5" fill="currentColor" />
                                </div>
                              )}
                            </div>
                            <div className="p-4">
                              <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">{file.name}</div>
                              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                                <span>{file.size}</span>
                                <span>{file.date}</span>
                              </div>
                              <div className="mt-3 flex justify-end">
                                <span className={cn(
                                  'text-xs inline-flex items-center gap-1 transition-colors',
                                  isAudio ? 'text-violet-500 dark:text-violet-400 group-hover:text-violet-600 dark:group-hover:text-violet-300' : isVideo ? 'text-sky-500 dark:text-sky-400 group-hover:text-sky-600 dark:group-hover:text-sky-300' : 'text-slate-400 group-hover:text-fuchsia-600'
                                )}>
                                  {isMedia && <Play size={12} className="opacity-80" />}
                                  点击查看详情
                                </span>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Portrait Graph（使用从向量库获取的统计） */}
            <PortraitGraph
              knowledgeBaseId={activeKb.id}
              documentCount={kbStats?.documents ?? activeKb.stats?.documents ?? 0}
              textCount={kbStats?.chunks ?? activeKb.stats?.chunks ?? 0}
              imageCount={kbStats?.images ?? activeKb.stats?.images ?? 0}
              audioCount={kbStats?.audio ?? (activeKb.stats as { audio?: number })?.audio ?? 0}
              videoCount={kbStats?.video ?? (activeKb.stats as { video?: number })?.video ?? 0}
              onClusterSelect={() => {}}
            />
          </div>

          {/* Detail Sidebar (Stats，结合向量库数据) */}
          <div className="w-72 border-l border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-6 hidden xl:block flex flex-col">
            <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100/80 dark:border-slate-800 dark:bg-slate-950 dark:ring-slate-800/60">
              <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50/90 via-white to-indigo-50/40 px-4 py-3 dark:border-slate-800 dark:from-slate-900/60 dark:via-slate-950 dark:to-indigo-950/25">
                <div className="flex items-center gap-3">
                  <Database
                    className="h-5 w-5 shrink-0 text-indigo-600 opacity-90 drop-shadow-[0_1px_2px_rgba(99,102,241,0.15)] dark:text-indigo-400 dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                    strokeWidth={2.25}
                    aria-hidden
                  />
                  <h4 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">知识库统计</h4>
                </div>
              </div>
              <div className="space-y-2 p-3">
                <div className="group flex items-center justify-between gap-2 rounded-xl border border-blue-100/80 bg-gradient-to-r from-blue-50/70 to-transparent px-3 py-2.5 transition-all hover:border-blue-200/90 hover:shadow-sm dark:border-blue-900/40 dark:from-blue-950/35 dark:to-transparent dark:hover:border-blue-800/50">
                  <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <FileText className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={2.25} aria-hidden />
                    文档数
                  </span>
                  <span className="text-sm font-semibold tabular-nums tracking-tight text-blue-700 dark:text-blue-300">
                    {kbStats?.documents ?? activeKb.stats?.documents ?? 0}
                  </span>
                </div>
                <div className="group flex items-center justify-between gap-2 rounded-xl border border-indigo-100/80 bg-gradient-to-r from-indigo-50/70 to-transparent px-3 py-2.5 transition-all hover:border-indigo-200/90 hover:shadow-sm dark:border-indigo-900/40 dark:from-indigo-950/35 dark:to-transparent dark:hover:border-indigo-800/50">
                  <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <Layers className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" strokeWidth={2.25} aria-hidden />
                    文本块数
                  </span>
                  <span className="text-sm font-semibold tabular-nums tracking-tight text-indigo-700 dark:text-indigo-300">
                    {kbStats?.chunks ?? activeKb.stats?.chunks ?? 0}
                  </span>
                </div>
                <div className="group flex items-center justify-between gap-2 rounded-xl border border-fuchsia-100/80 bg-gradient-to-r from-fuchsia-50/70 to-transparent px-3 py-2.5 transition-all hover:border-fuchsia-200/90 hover:shadow-sm dark:border-fuchsia-900/40 dark:from-fuchsia-950/35 dark:to-transparent dark:hover:border-fuchsia-800/50">
                  <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <ImageIcon className="h-4 w-4 shrink-0 text-fuchsia-600 dark:text-fuchsia-400" strokeWidth={2.25} aria-hidden />
                    图片数
                  </span>
                  <span className="text-sm font-semibold tabular-nums tracking-tight text-fuchsia-700 dark:text-fuchsia-300">
                    {kbStats?.images ?? activeKb.stats?.images ?? 0}
                  </span>
                </div>
                <div className="group flex items-center justify-between gap-2 rounded-xl border border-violet-100/80 bg-gradient-to-r from-violet-50/70 to-transparent px-3 py-2.5 transition-all hover:border-violet-200/90 hover:shadow-sm dark:border-violet-900/40 dark:from-violet-950/35 dark:to-transparent dark:hover:border-violet-800/50">
                  <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <Music className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" strokeWidth={2.25} aria-hidden />
                    音频数
                  </span>
                  <span className="text-sm font-semibold tabular-nums tracking-tight text-violet-700 dark:text-violet-300">
                    {kbStats?.audio ?? (activeKb.stats as { audio?: number })?.audio ?? 0}
                  </span>
                </div>
                <div className="group flex items-center justify-between gap-2 rounded-xl border border-emerald-100/80 bg-gradient-to-r from-emerald-50/70 to-transparent px-3 py-2.5 transition-all hover:border-emerald-200/90 hover:shadow-sm dark:border-emerald-900/40 dark:from-emerald-950/35 dark:to-transparent dark:hover:border-emerald-800/50">
                  <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <Video className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={2.25} aria-hidden />
                    视频数
                  </span>
                  <span className="text-sm font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-300">
                    {kbStats?.video ?? (activeKb.stats as { video?: number })?.video ?? 0}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200/90 bg-gradient-to-r from-slate-50/80 to-transparent px-3 py-2.5 dark:border-slate-700/80 dark:from-slate-900/50 dark:to-transparent">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                      <Box className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" strokeWidth={2.25} aria-hidden />
                      向量维度
                    </span>
                    <dl className="grid min-w-0 [grid-template-columns:auto_1fr] gap-x-2 gap-y-0.5 text-[11px] leading-tight tabular-nums">
                      <dt className="text-right font-medium text-slate-500 dark:text-slate-400">文本</dt>
                      <dd className="text-right font-semibold tracking-tight text-indigo-600 dark:text-indigo-400">
                        {kbStats?.text_vector_dim ?? 4096}
                      </dd>
                      <dt className="text-right font-medium text-slate-500 dark:text-slate-400">图片</dt>
                      <dd className="text-right font-semibold tracking-tight text-fuchsia-600 dark:text-fuchsia-400">
                        {kbStats?.image_vector_dim ?? 768}
                      </dd>
                      <dt className="text-right font-medium text-slate-500 dark:text-slate-400">音频</dt>
                      <dd className="text-right font-semibold tracking-tight text-violet-600 dark:text-violet-400">
                        {kbStats?.audio_vector_dim ?? 512}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => handleDeleteKb(activeKbId!)}
                className="w-full py-2.5 px-4 flex items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 bg-white dark:bg-slate-950 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-medium transition-all hover:border-red-300 dark:hover:border-red-700 shadow-sm"
              >
                <Trash2 size={16} />
                删除知识库
              </button>
            </div>
          </div>
        </div>

        {/* 预览弹窗 */}
        {previewFile && (
          <FilePreviewModal
            file={previewFile}
            kbId={activeKbId}
            onClose={() => setPreviewFile(null)}
            onDelete={() => {
              handleDeleteFile(previewFile.id)
              setPreviewFile(null)
            }}
          />
        )}

        {/* 从 URL 导入弹窗 */}
        {showImportUrlModal && activeKbId && (
          <ImportUrlModal
            kbId={activeKbId}
            onClose={() => setShowImportUrlModal(false)}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
            onStartImport={({ processing_id, filename: urlFilename }) => {
              setShowImportUrlModal(false)
              setCurrentUploadFiles([new File([], urlFilename, { type: 'application/octet-stream' })])
              setUploading(true)
              setUploadProgress({
                stage: 'minio',
                stageProgress: 0,
                total: 1,
                completed: 0,
                failed: 0,
                currentFile: urlFilename,
              })
              setUrlImportProcessingId(processing_id)
            }}
          />
        )}

        {/* 搜索图片导入弹窗：开始导入后关闭弹窗，在上传流水线中展示进度 */}
        {showImportSearchModal && activeKbId && (
          <ImportSearchModal
            kbId={activeKbId}
            onClose={() => setShowImportSearchModal(false)}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
            onStartImport={(params) => {
              setShowImportSearchModal(false)
              const total = params.quantity ?? 5
              setCurrentUploadFiles(
                Array.from({ length: total }, (_, i) => new File([], `搜索图片 ${i + 1}`, { type: 'image/jpeg' }))
              )
              setUploading(true)
              setUploadProgress({
                stage: 'minio',
                stageProgress: 0,
                total,
                completed: 0,
                failed: 0,
                currentFile: '搜索中…',
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
                              completed: event.success_count ?? 0,
                              failed: event.failed_count ?? 0,
                            }
                          : prev
                      )
                    })
                    fetchFiles()
                    fetchKnowledgeBases()
                    setTimeout(() => {
                      setUploading(false)
                      setCurrentUploadFiles(null)
                      setTimeout(() => setUploadProgress(undefined), 500)
                    }, 2500)
                    return
                  }
                  if (event.stage === 'error') {
                    flushSync(() => {
                      setUploadProgress((prev) =>
                        prev ? { ...prev, stage: 'done', failed: prev.total, completed: 0 } : prev
                      )
                    })
                    setTimeout(() => {
                      setUploading(false)
                      setCurrentUploadFiles(null)
                      setTimeout(() => setUploadProgress(undefined), 500)
                    }, 2500)
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
                  // 导入阶段：用占位名「搜索图片 N」匹配列表项，使上面文件列表能正确高亮当前/已完成；并随当前文件数更新 completed
                  const listCurrentFile =
                    event.stage === 'importing' && cur >= 1 ? `搜索图片 ${cur}` : event.message ?? undefined
                  const completedSoFar =
                    event.stage === 'importing' && cur >= 1 ? Math.max(0, cur - 1) : undefined
                  flushSync(() => {
                    setUploadProgress((prev) => {
                      if (!prev) return prev
                      const next = {
                        ...prev,
                        stage: frontStage,
                        stageProgress: progressPct,
                        currentFile: listCurrentFile ?? prev.currentFile,
                        total: tot,
                      }
                      if (completedSoFar !== undefined) next.completed = completedSoFar
                      return next
                    })
                  })
                })
                .catch(() => {
                  setUploading(false)
                  setCurrentUploadFiles(null)
                  setUploadProgress((prev) => (prev ? { ...prev, stage: 'done', failed: prev.total } : undefined))
                  setTimeout(() => setUploadProgress(undefined), 500)
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
            onClose={() => setShowImportHotTopicsModal(false)}
            onSuccess={() => {
              fetchFiles()
              fetchKnowledgeBases()
            }}
            onStartImport={({ processing_id, filename: hotTopicsFilename }) => {
              setShowImportHotTopicsModal(false)
              setCurrentUploadFiles([new File([], hotTopicsFilename, { type: 'application/octet-stream' })])
              setUploading(true)
              setUploadProgress({
                stage: 'minio',
                stageProgress: 0,
                total: 1,
                completed: 0,
                failed: 0,
                currentFile: hotTopicsFilename,
              })
              setUrlImportProcessingId(processing_id)
            }}
          />
        )}

        {dragOverlay && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-40">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-6 py-5 shadow-xl text-center">
              <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto">
                <Upload size={22} />
              </div>
              <div className="mt-3 font-semibold text-slate-900 dark:text-slate-100">松手上传到当前知识库</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">最多一次 10 个文件</div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center text-slate-400 bg-slate-50 dark:bg-slate-950">
      未找到该知识库，可能已被删除。
    </div>
  )
}

export default KnowledgeList
