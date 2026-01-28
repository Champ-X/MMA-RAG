import { useState, useRef } from 'react'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          上传管道
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className={cn(
            'cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/30 hover:border-muted-foreground/50'
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
          <Upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="mb-2 font-medium">拖拽文件到此处或点击上传</p>
          <p className="text-sm text-muted-foreground">
            支持 PDF, DOCX, TXT, Markdown, PNG, JPG
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
              <h4 className="mb-3 font-medium">
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
                        'flex items-center justify-between rounded-lg border p-3',
                        isCurrent && 'border-primary/50 bg-primary/5'
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{f.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(f.size)}
                          </p>
                        </div>
                      </div>
                      {isUploading ? (
                        isCurrent ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        ) : done ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : null
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
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
                          active && 'border-primary bg-primary/10',
                          past && 'border-green-500/50 bg-green-500/5',
                          !active && !past && 'border-muted bg-muted/30'
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-5 w-5',
                            active && 'text-primary',
                            past && 'text-green-600',
                            !active && !past && 'text-muted-foreground'
                          )}
                        />
                        <span
                          className={cn(
                            'text-xs font-medium',
                            active && 'text-primary',
                            past && 'text-green-600',
                            !active && !past && 'text-muted-foreground'
                          )}
                        >
                          {s.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <p className="text-sm text-muted-foreground">
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
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {uploadProgress.completed}/{uploadProgress.total}
                  </span>
                  {uploadProgress.failed > 0 && (
                    <span className="text-destructive">
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
                  onClick={() => {
                    setSelectedFiles([])
                    onFileSelect([])
                  }}
                >
                  清空
                </Button>
                <Button onClick={() => onFileSelect(selectedFiles)}>
                  开始上传
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default UploadPipeline
