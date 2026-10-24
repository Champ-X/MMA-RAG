import { translate as t, useTranslation } from '@/i18n'
import { useId, useRef, useState } from 'react'
import { Upload, FileUp, FileText, Image, Music2, Film, CheckCircle2, AlertCircle, Loader2, ChevronDown, Clock3, X, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { uploadBatchPercent, uploadProgressMessage, uploadStageLabel } from './uploadProgress'
import { canRetryStoredUpload, readableUploadError, uploadFailureCopy } from './uploadFailure'
import type { UploadFailureFields } from '@/types/upload'
import './uploadPipeline.css'

export type PipelineStage = 'idle' | 'minio' | 'parsing' | 'vectorizing' | 'portrait' | 'done'

export interface UploadFileProgress extends UploadFailureFields {
  id: string
  file_id?: string
  name: string
  status: string
  stage?: string
  progress?: number
  message?: string
  error?: string
  updated_at?: string
}

export interface UploadPipelineProgress {
  stage: PipelineStage
  stageProgress?: number
  total: number
  completed: number
  failed: number
  currentFile?: string
  currentFileIsImage?: boolean
  /** Transport progress is independent from server processing progress. */
  transferProgress?: number
  submitted?: boolean
  message?: string
  files?: UploadFileProgress[]
}

interface UploadPipelineProps {
  onFileSelect: (files: File[]) => void
  isUploading?: boolean
  uploadProgress?: UploadPipelineProgress
  externalFiles?: File[] | null
  onDismissProgress?: () => void
  onRetryFile?: (file: UploadFileProgress) => Promise<void>
  retryStates?: Record<string, { pending?: boolean; error?: string }>
  className?: string
  children?: React.ReactNode
}

function fileKind(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff'].includes(extension)) return { Icon: Image, kind: 'image' }
  if (['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus'].includes(extension)) return { Icon: Music2, kind: 'audio' }
  if (['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', 'flv', 'wmv'].includes(extension)) return { Icon: Film, kind: 'video' }
  return { Icon: FileText, kind: 'document' }
}

function UploadFileTile({ file, onRetry, retryState, retryDisabled }: {
  file: UploadFileProgress
  onRetry?: (file: UploadFileProgress) => Promise<void>
  retryState?: { pending?: boolean; error?: string }
  retryDisabled?: boolean
}) {
  useTranslation()
  const { Icon, kind } = fileKind(file.name)
  const complete = file.status === 'completed'
  const failed = file.status === 'failed'
  const active = file.status === 'processing' || file.status === 'uploading'
  const failure = failed ? uploadFailureCopy(file) : undefined
  const canRetry = failed && kind === 'video' && canRetryStoredUpload(file) && Boolean(onRetry)
  const percent = complete ? 100 : file.progress == null ? undefined : Math.max(0, Math.min(100, Math.round(file.progress)))
  return (
    <li className="upload-file" data-status={file.status}>
      <span className="upload-file__icon" data-kind={kind}><Icon size={20} strokeWidth={1.6} aria-hidden /></span>
      <div className="upload-file__content">
        <div className="upload-file__name" title={file.name}>{file.name}</div>
        <div className="upload-file__status">
          <span>{uploadStageLabel(file.status, file.stage)}</span>
          {active && percent != null && <span className="upload-file__percent">{percent}%</span>}
        </div>
        {!complete && !failed && file.message && <p className="upload-file__message">{uploadProgressMessage(file.message)}</p>}
        {failure ? <div className="upload-file__failure">
          <p className="upload-file__error">{failure.message}</p>
          <p className="upload-file__recovery">{failure.source} {failure.recovery}</p>
          {canRetry && <button type="button" className="upload-file__retry"
            disabled={retryDisabled || retryState?.pending}
            aria-label={t('重新解析视频：{{value1}}', { value1: file.name })}
            onClick={() => { void onRetry?.(file) }}>
            <RotateCcw size={13} className={retryState?.pending ? 'upload-spin' : undefined} aria-hidden />
            {retryState?.pending ? t('重新入队中…') : t('重新解析')}
          </button>}
          {retryState?.error && <p className="upload-file__error" role="status">{readableUploadError(retryState.error, t('未能重新入队，请确认服务状态后再试。'))}</p>}
        </div>
          : <progress className="upload-file__track" max={100} value={percent ?? (active ? undefined : 0)} aria-label={file.name + t(" 处理进度")} />}
      </div>
      <span className="upload-file__state" aria-hidden>
        {complete ? <CheckCircle2 size={17} /> : failed ? <AlertCircle size={17} /> : active ? <Loader2 size={16} className="upload-spin" /> : <Clock3 size={16} />}
      </span>
    </li>
  )
}

export function UploadPipeline({ onFileSelect, isUploading = false, uploadProgress: progress,
  externalFiles, onDismissProgress, onRetryFile, retryStates, className, children }: UploadPipelineProps) {
  useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const detailsId = useId()
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const finished = (progress?.completed ?? 0) + (progress?.failed ?? 0)
  const done = progress?.stage === 'done'
  const entries: UploadFileProgress[] = progress?.files ?? (externalFiles ?? []).map((file, i) => ({ id: String(i), name: file.name, status: 'uploading' }))
  const pending = entries.filter(file => file.status === 'queued').length
  const processing = entries.filter(file => file.status === 'processing').length
  const displayedPercent = progress ? uploadBatchPercent(progress) : 0
  const select = (files: FileList | null) => {
    if (isUploading || !files?.length) return
    setExpanded(true)
    onFileSelect(Array.from(files))
  }
  const hint = (progress?.message && (done && progress.failed ? readableUploadError(progress.message, t('请查看各文件的失败原因和处理建议。')) : progress.message)) || (done
    ? progress?.failed ? t("请查看各文件的失败原因和处理建议。") : t("素材已准备好，可以开始检索与探索。")
    : progress?.submitted ? t("已由服务端接收，刷新或离开页面后仍会继续处理。")
      : progress?.transferProgress === 100 ? t("文件传输完成，正在确认接收。") : t("正在传输文件，请保持页面打开。"))

  return (
    <section className={cn('upload-panel', className)} aria-label={t("上传与导入")} data-busy={isUploading}>
      <header className="upload-panel__header">
        <h3><Upload size={17} strokeWidth={1.8} aria-hidden />{t("添加素材")}</h3>
        <span className="upload-panel__caption">{t("支持批量上传 · 自动解析")}</span>
      </header>

      {progress && (
        <div className="upload-batch" data-failed={progress.failed > 0} data-done={done} data-expanded={expanded && entries.length > 0}>
          <div className="upload-batch__summary">
            <div className="upload-batch__heading">
              <strong role="status" aria-live="polite" aria-atomic="true">
                {done ? (progress.failed ? t("处理结束，部分文件未完成") : t("全部处理完成")) : progress.submitted ? t("正在处理素材") : t("正在上传文件")}
              </strong>
              {done && !isUploading && onDismissProgress && <button className="upload-batch__dismiss" type="button" onClick={onDismissProgress} aria-label={t("收起本次上传结果")}><X size={15} aria-hidden /></button>}
            </div>
            <div className="upload-batch__meter">
              <div className="upload-batch__fraction"><b>{finished}</b><span>/ {progress.total}</span><small>{t("个已处理")}</small></div>
              <span className="upload-batch__percentage">{displayedPercent}%</span>
            </div>
            <progress className="upload-batch__progress" max={100} value={displayedPercent} aria-label={progress.submitted || done ? t("整批文件处理进度") : t("文件传输进度")} />
            <div className="upload-batch__counts">
              <span data-state="ready"><i />{t("已就绪")} <b>{progress.completed}</b></span>
              {processing > 0 && <span data-state="processing"><i />{t("处理中")} <b>{processing}</b></span>}
              {pending > 0 && <span data-state="queued"><i />{t("排队")} <b>{pending}</b></span>}
              {progress.failed > 0 && <span data-state="failed"><i />{t("失败")} <b>{progress.failed}</b></span>}
            </div>
            {done && <span className="sr-only">{progress.completed + t(" 个成功") + (progress.failed ? ' · ' + progress.failed + t(" 个失败") : '')}</span>}
          </div>
          {entries.length > 0 && expanded && (
            <div className="upload-batch__detail" id={detailsId}>
              <div className="upload-batch__detail-heading"><span>{t("本次上传")}</span><span>{t("逐个解析，完成后即可使用")}</span></div>
              <ul className="upload-batch__files" aria-label={t("本次上传文件状态")}>
                {entries.map(file => <UploadFileTile key={file.id} file={file} onRetry={onRetryFile} retryState={retryStates?.[file.id]} retryDisabled={isUploading} />)}
              </ul>
            </div>
          )}
          <div className="upload-batch__footer">
            <p className="upload-batch__hint">{hint}</p>
            {entries.length > 0 && <button className="upload-batch__toggle" type="button" aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} onClick={() => setExpanded(!expanded)}>
               {t("文件明细")} <span>{entries.length}</span><ChevronDown size={14} aria-hidden />
            </button>}
          </div>
        </div>
      )}

      <div className="upload-panel__body" data-has-sources={Boolean(children)}>
        {!isUploading && <button type="button" className="upload-drop" data-dragging={dragging}
          aria-label={t("选择本地文件，支持批量上传；也可拖拽文件到此处")}
          onClick={() => input.current?.click()}
          onDragEnter={event => {
            if (isUploading || !event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            dragDepth.current += 1
            setDragging(true)
          }}
          onDragOver={event => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDragging(false)
          }}
          onDrop={event => {
            event.preventDefault()
            dragDepth.current = 0
            setDragging(false)
            select(event.dataTransfer.files)
          }}>
          <span className="upload-drop__art" aria-hidden>
            <span className="upload-sheet upload-sheet--audio"><Music2 size={24} strokeWidth={1.5} /><i /><i /></span>
            <span className="upload-sheet upload-sheet--text"><FileText size={22} strokeWidth={1.5} /><i /><i /></span>
            <span className="upload-sheet upload-sheet--front"><FileUp size={31} strokeWidth={1.3} /></span>
          </span>
          <span className="upload-drop__copy">
            <strong>{dragging ? t("松开即可添加") : t("上传本地文件")}</strong>
            <span>{dragging ? t("文件将添加到当前素材空间") : t("拖拽文件到这里，或点击选择")}</span>
          </span>
          <span className="upload-drop__action"><Upload size={16} aria-hidden />{t("选择文件")}</span>
          <span className="upload-drop__formats" aria-hidden>
            <span><FileText size={12} />{t("文档与表格")}</span><span><Image size={12} />{t("图片")}</span><span><Music2 size={12} />{t("音频")}</span><span><Film size={12} />{t("视频")}</span>
          </span>
        </button>}
        <input ref={input} type="file" multiple disabled={isUploading} className="hidden" aria-label={t("选择知识库上传文件")}
          accept=".pdf,.docx,.doc,.pptx,.txt,.md,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.tiff,.tif,.mp3,.wav,.m4a,.flac,.aac,.ogg,.wma,.opus,.mp4,.avi,.mov,.mkv,.webm,.flv,.wmv,.m4v"
          onChange={event => { select(event.target.files); event.target.value = '' }} />
        {children && !isUploading && <div className="upload-panel__sources">{children}</div>}
      </div>
    </section>
  )
}
export default UploadPipeline
