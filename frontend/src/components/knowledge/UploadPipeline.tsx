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
}: UploadPipelineProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const displayFiles = externalFiles && externalFiles.length > 0 ? externalFiles : selectedFiles
  const hasFilesToShow = displayFiles.length > 0

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

  return (
    <div className={cn('bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm', className)}>
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-tr from-indigo-50 to-fuchsia-50 dark:from-indigo-600/25 dark:to-fuchsia-600/15 text-indigo-600 dark:text-indigo-200 rounded-lg">
            <Upload className="h-4 w-4" />
          </div>
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
          <div className="w-12 h-12 bg-gradient-to-tr from-indigo-50 to-fuchsia-50 dark:from-indigo-600/25 dark:to-fuchsia-600/15 text-indigo-600 dark:text-indigo-200 rounded-full flex items-center justify-center mx-auto mb-3 border border-indigo-100/80 dark:border-slate-700">
            <Upload size={24} />
          </div>
          <p className="mb-2 font-medium text-slate-700 dark:text-slate-200">拖拽文件到此处或点击上传</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            支持 PDF / DOCX / MD / JPG / PNG（≤ 50MB）
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg"
            onChange={(e) => handleFileSelect(e.target.files)}
            className="hidden"
          />
        </div>

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
                <h4 className="mb-3 font-medium text-slate-800 dark:text-slate-100">
                  已选文件 ({displayFiles.length})
                </h4>
              )}
              <div className="space-y-3">
                {isUploading && !isAllDone && (
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    处理中
                  </div>
                )}
                {displayFiles.map((f, i) => {
                  const isImage = f.type.startsWith('image/')
                  const Icon = isImage ? Image : f.type.includes('pdf') ? FileText : File
                  const isCurrent =
                    isUploading &&
                    uploadProgress?.currentFile === (f as File).name
                  const done =
                    isUploading &&
                    uploadProgress &&
                    i < uploadProgress.completed + uploadProgress.failed
                  const isPending = isUploading && !isCurrent && !done

                  return (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center justify-between rounded-lg border p-3',
                        isCurrent && 'border-indigo-400 dark:border-fuchsia-500 bg-indigo-50/50 dark:bg-fuchsia-500/10',
                        done && !isCurrent && 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10',
                        isPending && 'border-slate-200 dark:border-slate-800'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        <div>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{(f as File).name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {formatFileSize((f as File).size)}
                          </p>
                        </div>
                      </div>
                      {isUploading || isAllDone ? (
                        isCurrent ? (
                          <div className="flex items-center gap-2 text-indigo-600 dark:text-fuchsia-400">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-xs font-medium">处理中</span>
                          </div>
                        ) : done ? (
                          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                            <CheckCircle className="h-4 w-4 shrink-0" />
                            <span className="text-xs font-medium">已完成</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">待处理</span>
                        )
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400"
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
                  )
                })}
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
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  className="border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => {
                    setSelectedFiles([])
                  }}
                >
                  清空
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
