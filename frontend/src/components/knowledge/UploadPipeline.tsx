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
  className?: string
}

const STAGES: { id: PipelineStage; label: string; icon: typeof Upload }[] = [
  { id: 'minio', label: 'MinIO 上传', icon: Upload },
  { id: 'parsing', label: '解析', icon: FileSearch },
  { id: 'vectorizing', label: '向量化', icon: Box },
  { id: 'portrait', label: '画像更新', icon: Palette },
]

function getStageMessage(p: UploadPipelineProgress): string {
  switch (p.stage) {
    case 'minio':
      return '上传中…'
    case 'parsing':
      return p.currentFileIsImage ? 'VLM Captioning…' : '识别中…'
    case 'vectorizing':
      return 'Embedding…'
    case 'portrait':
      return '正在更新知识库画像聚类…'
    case 'done':
      return '处理完成'
    default:
      return '等待中'
  }
}

function getStageIndex(stage: PipelineStage): number {
  const i = STAGES.findIndex((s) => s.id === stage)
  return i >= 0 ? i : 0
}

export function UploadPipeline({
  onFileSelect,
  isUploading = false,
  uploadProgress,
  className,
}: UploadPipelineProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // 上传成功后清空已选文件，避免重复上传
  useEffect(() => {
    if (uploadProgress?.stage === 'done') {
      setSelectedFiles([])
    }
  }, [uploadProgress?.stage])

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

        {selectedFiles.length > 0 && (
          <>
            <div>
              <h4 className="mb-3 font-medium text-slate-800 dark:text-slate-100">
                已选文件 ({selectedFiles.length})
              </h4>
              <div className="space-y-2">
                {selectedFiles.map((f, i) => {
                  const isImage = f.type.startsWith('image/')
                  const Icon = isImage ? Image : f.type.includes('pdf') ? FileText : File
                  const isCurrent =
                    isUploading &&
                    uploadProgress?.currentFile === f.name
                  const done =
                    isUploading &&
                    uploadProgress &&
                    i < uploadProgress.completed + uploadProgress.failed

                  return (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3',
                        isCurrent && 'border-indigo-400 dark:border-fuchsia-500 bg-indigo-50/50 dark:bg-fuchsia-500/10'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        <div>
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{f.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {formatFileSize(f.size)}
                          </p>
                        </div>
                      </div>
                      {isUploading ? (
                        isCurrent ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 dark:border-fuchsia-500 border-t-transparent" />
                        ) : done ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : null
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

            {/* 四阶段管道 */}
            {isUploading && uploadProgress && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {STAGES.map((s, i) => {
                    const active = i === currentStageIndex
                    const past = i < currentStageIndex || uploadProgress.stage === 'done'
                    const Icon = s.icon
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          'flex flex-1 flex-col items-center gap-1 rounded-lg border py-2 transition-colors',
                          active && 'border-indigo-400 dark:border-fuchsia-500 bg-indigo-50/50 dark:bg-fuchsia-500/10',
                          past && 'border-green-500/50 bg-green-500/5 dark:border-green-600/50 dark:bg-green-600/10',
                          !active && !past && 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-5 w-5',
                            active && 'text-indigo-600 dark:text-fuchsia-400',
                            past && 'text-green-600 dark:text-green-400',
                            !active && !past && 'text-slate-400 dark:text-slate-500'
                          )}
                        />
                        <span
                          className={cn(
                            'text-xs font-medium',
                            active && 'text-indigo-600 dark:text-fuchsia-400',
                            past && 'text-green-600 dark:text-green-400',
                            !active && !past && 'text-slate-500 dark:text-slate-400'
                          )}
                        >
                          {s.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {getStageMessage(uploadProgress)}
                  {uploadProgress.currentFile && (
                    <span className="ml-2 font-medium">
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
                  className="h-2"
                />
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>
                    {uploadProgress.completed}/{uploadProgress.total}
                  </span>
                  {uploadProgress.failed > 0 && (
                    <span className="text-red-600 dark:text-red-400">
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
