import { useState, useRef, useEffect } from 'react'
import {
  Upload,
  File,
  Image,
  FileText,
  CheckCircle,
  FileSearch,
  Box,
  Palette,
  Loader2,
  ImageIcon,
  Type,
  Music,
  Video,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export type PipelineStage =
  | 'idle'
  | 'minio'
  | 'parsing'
  | 'vectorizing'
  | 'portrait'
  | 'done'

export interface UploadPipelineProgress {
  stage: PipelineStage
  /** 当前阶段进度 0–100 */
  stageProgress?: number
  total: number
  completed: number
  failed: number
  currentFile?: string
  /** 当前文件是否为图片（Parsing 时显示 VLM Captioning） */
  currentFileIsImage?: boolean
}

interface UploadPipelineProps {
  onFileSelect: (files: File[]) => void
  isUploading?: boolean
  uploadProgress?: UploadPipelineProgress
  /** 外部传入的文件列表（如从文件夹导入），有值时与 uploadProgress 一起展示进度 */
  externalFiles?: File[] | null
  className?: string
  /** 卡片底部插槽，如「自动导入」入口，与上传区域同框展示 */
  children?: React.ReactNode
}

const STAGES_DOC: { id: PipelineStage; label: string; icon: typeof Upload }[] = [
  { id: 'minio', label: 'MinIO 上传', icon: Upload },
  { id: 'parsing', label: '解析分块', icon: FileSearch },
  { id: 'vectorizing', label: '文本向量化', icon: Box },
  { id: 'portrait', label: '画像更新', icon: Palette },
]

const STAGES_IMAGE: { id: PipelineStage; label: string; icon: typeof Upload }[] = [
  { id: 'minio', label: 'MinIO 上传', icon: Upload },
  { id: 'parsing', label: 'VLM 描述', icon: ImageIcon },
  { id: 'vectorizing', label: 'CLIP·文本向量化', icon: Type },
  { id: 'portrait', label: '画像更新', icon: Palette },
]

/** 超过该数量时使用紧凑可折叠列表，避免占满整屏 */
const COLLAPSE_THRESHOLD = 6
/** 折叠时展示的文件条数 */
const COLLAPSED_VISIBLE = 5

function getStageMessage(p: UploadPipelineProgress): string {
  switch (p.stage) {
    case 'minio':
      return '上传中…'
    case 'parsing':
      return p.currentFileIsImage ? 'VLM Captioning…' : '解析分块…'
    case 'vectorizing':
      return p.currentFileIsImage ? 'CLIP·Embedding…' : 'Embedding…'
    case 'portrait':
      return '正在更新知识库画像聚类…'
    case 'done':
      return '处理完成'
    default:
      return '等待中'
  }
}

function getStageIndex(stage: PipelineStage): number {
  const i = STAGES_DOC.findIndex((s) => s.id === stage)
  return i >= 0 ? i : 0
}

export function UploadPipeline({
  onFileSelect,
  isUploading = false,
  uploadProgress,
  externalFiles = null,
  className,
  children,
}: UploadPipelineProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [showAllFiles, setShowAllFiles] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const displayFiles = externalFiles && externalFiles.length > 0 ? externalFiles : selectedFiles
  const hasFilesToShow = displayFiles.length > 0
  const useCompactList = displayFiles.length > COLLAPSE_THRESHOLD
  const isExpanded = showAllFiles || !useCompactList
  const visibleFiles = useCompactList && !showAllFiles
    ? displayFiles.slice(0, COLLAPSED_VISIBLE)
    : displayFiles
  const hasMoreHidden = useCompactList && !showAllFiles && displayFiles.length > COLLAPSED_VISIBLE

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return
    const arr = Array.from(files)
    setSelectedFiles(arr)
    onFileSelect(arr)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFileSelect(e.dataTransfer.files)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  const currentStageIndex =
    uploadProgress && isUploading
      ? getStageIndex(uploadProgress.stage)
      : -1

  const isImagePipeline = Boolean(uploadProgress?.currentFileIsImage)
  const STAGES = isImagePipeline ? STAGES_IMAGE : STAGES_DOC

  const isAllDone = Boolean(uploadProgress?.stage === 'done')
  const completedCount = uploadProgress?.completed ?? 0
  const failedCount = uploadProgress?.failed ?? 0
  const totalCount = uploadProgress?.total ?? 0

  // 上传成功后延迟清空已选文件，便于用户看到完成摘要（仅内部选择，外部传入由父组件清空）
  useEffect(() => {
    if (uploadProgress?.stage !== 'done' || (externalFiles && externalFiles.length > 0)) return
    const t = setTimeout(() => setSelectedFiles([]), 2500)
    return () => clearTimeout(t)
  }, [uploadProgress?.stage, externalFiles])

  // 文件列表清空时收起展开状态，下次多选时默认折叠
  useEffect(() => {
    if (displayFiles.length === 0) setShowAllFiles(false)
  }, [displayFiles.length])

  return (
    <div className={cn('bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm', className)}>
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <h3 className="flex items-center gap-3 font-semibold tracking-tight text-slate-800 dark:text-slate-100">
          <Upload
            className="h-5 w-5 shrink-0 text-indigo-600 opacity-90 drop-shadow-[0_1px_2px_rgba(99,102,241,0.15)] dark:text-indigo-400 dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
            strokeWidth={2.25}
            aria-hidden
          />
          上传文件
        </h3>
      </div>
      <div className="p-6 space-y-6">
        <div
          className={cn(
            'cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors',
            isDragging
              ? 'border-indigo-400 dark:border-fuchsia-500 bg-indigo-50/50 dark:bg-fuchsia-500/10'
              : 'border-slate-300 dark:border-slate-700 hover:border-fuchsia-400 dark:hover:border-fuchsia-500 hover:bg-slate-50 dark:hover:bg-slate-900/60'
          )}
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setIsDragging(false)
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload
            className="mx-auto mb-3 block h-10 w-10 text-indigo-600 opacity-90 drop-shadow-[0_1px_3px_rgba(99,102,241,0.2)] dark:text-indigo-400 dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
            strokeWidth={2}
            aria-hidden
          />
          <p className="mb-2 font-medium text-slate-700 dark:text-slate-200">拖拽文件到此处或点击上传</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            支持 PDF / DOCX / PPTX / MD / 图片 / 音频（MP3/WAV/M4A 等）/ 视频（MP4/AVI/MOV 等）（≤ 50MB）
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.pptx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp,.tiff,.tif,.mp3,.wav,.m4a,.flac,.aac,.ogg,.wma,.opus,.mp4,.avi,.mov,.mkv,.webm,.flv,.wmv,.m4v"
            onChange={(e) => handleFileSelect(e.target.files)}
            className="hidden"
          />
        </div>

        {children != null && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            {children}
          </div>
        )}

        {hasFilesToShow && (
          <>
            <div>
              {isAllDone ? (
                <div className="mb-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50/80 dark:bg-green-900/20 px-4 py-3">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    本次上传完成：成功 {completedCount}，{failedCount > 0 ? `失败 ${failedCount}` : '无失败'}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                    {totalCount} 个文件已处理
                  </p>
                </div>
              ) : (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="font-medium text-slate-800 dark:text-slate-100">
                    已选文件 ({displayFiles.length})
                  </h4>
                  {useCompactList && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 -mr-1"
                      onClick={() => setShowAllFiles((v) => !v)}
                    >
                      {showAllFiles ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5 mr-0.5" />
                          收起
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5 mr-0.5" />
                          展开全部
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
              <div
                className={cn(
                  'space-y-2',
                  useCompactList && isExpanded && 'max-h-[260px] overflow-y-auto overscroll-contain rounded-lg border border-slate-100 dark:border-slate-800 p-1'
                )}
              >
                {isUploading && !isAllDone && (
                  <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 border border-slate-100 dark:border-slate-700/80">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75 dark:bg-fuchsia-400" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500 dark:bg-fuchsia-500" />
                    </span>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300 tracking-wide">处理中</span>
                  </div>
                )}
                {visibleFiles.map((f) => {
                  const i = displayFiles.indexOf(f)
                  const isImage = f.type.startsWith('image/')
                  const isAudio = f.type.startsWith('audio/')
                  const isVideo = f.type.startsWith('video/')
                  const Icon = isImage ? Image : isAudio ? Music : isVideo ? Video : f.type.includes('pdf') ? FileText : File
                  const isCurrent =
                    isUploading &&
                    uploadProgress?.currentFile === (f as File).name
                  const done =
                    isUploading &&
                    uploadProgress &&
                    i < uploadProgress.completed + uploadProgress.failed
                  const isPending = isUploading && !isCurrent && !done
                  const compact = useCompactList
                  const stageProgress = isCurrent && uploadProgress?.stage !== 'done' ? (uploadProgress?.stageProgress ?? 0) : null

                  return (
                    <div
                      key={i}
                      className={cn(
                        'relative flex flex-col rounded-xl border gap-2 overflow-hidden transition-all duration-200 ease-out',
                        compact ? 'px-2.5 py-1.5' : 'p-3',
                        isCurrent && 'border-indigo-300 dark:border-fuchsia-500/80 bg-indigo-50/60 dark:bg-fuchsia-500/10 shadow-sm shadow-indigo-100/50 dark:shadow-fuchsia-900/10',
                        done && !isCurrent && 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/50 dark:bg-emerald-900/10 shadow-sm shadow-emerald-100/30 dark:shadow-emerald-900/5',
                        isPending && 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/30 hover:bg-slate-50/80 dark:hover:bg-slate-800/60'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className={cn('flex items-center gap-2 min-w-0 flex-1', compact ? 'gap-2' : 'gap-3')}>
                          <div className={cn(
                            'flex shrink-0 items-center justify-center rounded-lg transition-colors',
                            compact ? 'p-1' : 'p-1.5',
                            isCurrent && 'bg-indigo-100/80 dark:bg-fuchsia-500/20',
                            done && !isCurrent && 'bg-emerald-100/80 dark:bg-emerald-500/20',
                            isPending && 'bg-slate-100 dark:bg-slate-700/50'
                          )}>
                            <Icon className={cn(
                              compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
                              isCurrent && 'text-indigo-600 dark:text-fuchsia-400',
                              done && !isCurrent && 'text-emerald-600 dark:text-emerald-400',
                              isPending && 'text-slate-500 dark:text-slate-400'
                            )} />
                          </div>
                          <div className="min-w-0 flex-1">
                            {compact ? (
                              <p className="text-xs font-medium text-slate-800 dark:text-slate-100 flex items-baseline gap-1.5 min-w-0" title={(f as File).name}>
                                <span className="truncate min-w-0">{(f as File).name}</span>
                                <span className="text-slate-400 dark:text-slate-500 font-normal shrink-0">{formatFileSize((f as File).size)}</span>
                              </p>
                            ) : (
                              <>
                                <p className={cn(
                                  'font-medium text-slate-800 dark:text-slate-100 truncate',
                                  isCurrent && 'text-indigo-900 dark:text-fuchsia-100',
                                  done && !isCurrent && 'text-emerald-900 dark:text-emerald-100',
                                  isPending && 'text-slate-800 dark:text-slate-200'
                                )} title={(f as File).name}>
                                  {(f as File).name}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {formatFileSize((f as File).size)}
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                        {isUploading || isAllDone ? (
                          isCurrent ? (
                            <div className="flex items-center gap-1.5 shrink-0 rounded-full bg-indigo-100 dark:bg-fuchsia-500/20 px-2.5 py-1 text-indigo-700 dark:text-fuchsia-300">
                              <Loader2 className={cn('animate-spin shrink-0', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                              <span className={cn('font-medium', compact ? 'text-[10px]' : 'text-xs')}>处理中</span>
                            </div>
                          ) : done ? (
                            <div className="flex items-center gap-1.5 shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-500/20 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
                              <CheckCircle className={cn('shrink-0', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                              <span className={cn('font-medium', compact ? 'text-[10px]' : 'text-xs')}>已完成</span>
                            </div>
                          ) : (
                            <span className={cn('shrink-0 rounded-full bg-slate-100 dark:bg-slate-700/60 px-2.5 py-1 text-slate-500 dark:text-slate-400 font-medium', compact ? 'text-[10px]' : 'text-xs')}>待处理</span>
                          )
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn('shrink-0 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors', compact ? 'h-6 w-6 p-0' : 'h-8 w-8 p-0')}
                            onClick={(e) => {
                              e.stopPropagation()
                              const next = selectedFiles.filter((_, j) => j !== i)
                              setSelectedFiles(next)
                              onFileSelect(next)
                            }}
                          >
                            ×
                          </Button>
                        )}
                      </div>
                      {stageProgress != null && !compact && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100 dark:bg-slate-700/80 rounded-b-xl overflow-hidden">
                          <div
                            className="h-full rounded-r-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 dark:from-fuchsia-500 dark:to-indigo-400 transition-all duration-500 ease-out"
                            style={{ width: `${Math.min(100, Math.max(0, stageProgress))}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
                {hasMoreHidden && (
                  <button
                    type="button"
                    className="w-full rounded-lg border border-dashed border-slate-200 dark:border-slate-700 py-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-800/50 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setShowAllFiles(true)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    展开显示全部 {displayFiles.length} 个文件
                  </button>
                )}
              </div>
            </div>

            {/* 四阶段管道：步骤条 + 连接线 + 当前状态 */}
            {isUploading && uploadProgress && (
              <div className="space-y-5">
                <div className="relative flex items-start justify-between px-1">
                  {/* 底部连接线（背景） */}
                  <div
                    className="absolute left-4 right-4 top-5 h-0.5 -translate-y-1/2 rounded-full bg-slate-200 dark:bg-slate-700"
                    aria-hidden
                  />
                  {/* 已完成的连接线（渐变填充） */}
                  <div
                    className="absolute left-4 top-5 h-0.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 dark:from-emerald-500 dark:to-emerald-400 transition-all duration-500 ease-out"
                    style={{
                      width: currentStageIndex <= 0 ? '0%' : `calc((100% - 2rem) * ${currentStageIndex / Math.max(STAGES.length - 1, 1)})`,
                    }}
                    aria-hidden
                  />
                  {STAGES.map((s, i) => {
                    const active = i === currentStageIndex
                    const past = i < currentStageIndex || uploadProgress.stage === 'done'
                    const Icon = s.icon
                    return (
                      <div key={s.id} className="relative z-10 flex flex-1 flex-col items-center">
                        <div
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300',
                            active &&
                              'border-indigo-500 dark:border-fuchsia-400 bg-white dark:bg-slate-900 shadow-md shadow-indigo-200/50 dark:shadow-fuchsia-500/20 ring-4 ring-indigo-100 dark:ring-fuchsia-500/20',
                            past &&
                              'border-emerald-500 dark:border-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/10',
                            !active && !past && 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/80'
                          )}
                        >
                          {past && !active ? (
                            <CheckCircle className="h-5 w-5 text-emerald-500 dark:text-emerald-400" />
                          ) : (
                            <Icon
                              className={cn(
                                'h-5 w-5 transition-colors',
                                active && 'text-indigo-600 dark:text-fuchsia-400',
                                !active && !past && 'text-slate-400 dark:text-slate-500'
                              )}
                            />
                          )}
                          {active && uploadProgress.stage !== 'done' && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75 dark:bg-fuchsia-400" />
                              <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-500 dark:bg-fuchsia-500" />
                            </span>
                          )}
                        </div>
                        <span
                          className={cn(
                            'mt-2 text-center text-xs font-medium transition-colors',
                            active && 'text-indigo-600 dark:text-fuchsia-400',
                            past && 'text-emerald-600 dark:text-emerald-400',
                            !active && !past && 'text-slate-500 dark:text-slate-400'
                          )}
                        >
                          {s.label}
                        </span>
                      </div>
                    )
                  })}
                </div>

                {/* 当前阶段说明 + 文件名 */}
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3 border border-slate-100 dark:border-slate-700/80">
                  <p className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-fuchsia-400 font-medium">
                      {uploadProgress.stage === 'done' ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-500 dark:text-fuchsia-400" />
                      )}
                      {getStageMessage(uploadProgress)}
                    </span>
                    {uploadProgress.currentFile && (
                      <span className="text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={uploadProgress.currentFile}>
                        {uploadProgress.currentFile}
                      </span>
                    )}
                  </p>
                  <Progress
                    value={
                      uploadProgress.stage === 'done'
                        ? 100
                        : uploadProgress.stageProgress ?? 50
                    }
                    className="h-1.5 mt-2 rounded-full bg-slate-200 dark:bg-slate-700 [&>div]:rounded-full [&>div]:bg-gradient-to-r [&>div]:from-indigo-500 [&>div]:to-fuchsia-500 dark:[&>div]:from-fuchsia-500 dark:[&>div]:to-indigo-400 [&>div]:transition-all [&>div]:duration-500"
                  />
                </div>

                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    已处理 {uploadProgress.completed}/{uploadProgress.total} 个文件
                  </span>
                  {uploadProgress.failed > 0 && (
                    <span className="text-red-600 dark:text-red-400 font-medium">
                      {uploadProgress.failed} 失败
                    </span>
                  )}
                </div>
              </div>
            )}

            {!isUploading && (
              <div className="flex justify-end pt-1">
                <Button
                  variant="outline"
                  className={cn(
                    'rounded-xl border-2 px-4 py-2.5 font-medium transition-all duration-200 ease-out shadow-sm',
                    isAllDone
                      ? 'border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-800/30 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-md hover:shadow-emerald-100/50 dark:hover:shadow-emerald-900/20'
                      : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-500 hover:shadow-md'
                  )}
                  onClick={() => {
                    setSelectedFiles([])
                  }}
                >
                  {isAllDone ? (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                      清空列表
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4 opacity-80" />
                      清空
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default UploadPipeline
