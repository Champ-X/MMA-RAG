import { translate as tr, useTranslation } from '@/i18n'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Image as ImageIcon, Music, Video } from 'lucide-react'
import type { CitationReference } from '@/types/sse'
import { getAttachmentBlob } from '@/lib/chatAttachmentBlobStore'
import { useChatStore } from '@/store/useChatStore'
import { cn } from '@/lib/utils'
import { piOriginalUrl } from '@/services/piAgent'

const AudioPreviewPlayer = lazy(() => import('@/components/ui/AudioPreviewPlayer').then(module => ({ default: module.AudioPreviewPlayer })))

/** Resolve by stable identity within this conversation; never guess by filename or contact KB endpoints. */
export function AttachmentEvidence({ reference, displayNumber, onOpen, preview = false }: {
  reference: CitationReference
  displayNumber?: number | string
  onOpen?: (rect: DOMRect, target: HTMLElement) => void
  preview?: boolean
}) {
  useTranslation()
  const attachment = useChatStore(state => state.getActiveSession()?.messages
    .flatMap(message => message.role === 'user' ? message.attachments ?? [] : [])
    .find(item => item.id === reference.attachment_id))
  const [media, setMedia] = useState<{ id?: string; url?: string; loaded: boolean }>({ loaded: false })
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    setFailed(false)
    setMedia({ id: reference.attachment_id, loaded: false })
    void (async () => {
      const blob = reference.attachment_id ? await getAttachmentBlob(reference.attachment_id) : undefined
      if (cancelled) return
      url = blob ? URL.createObjectURL(blob) : undefined
      setMedia({ id: reference.attachment_id, url, loaded: true })
    })()
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [reference.attachment_id])
  const current = media.id === reference.attachment_id ? media : { loaded: false, url: undefined }
  const savedOriginal = piOriginalUrl(reference)
  const src = current.url || savedOriginal || (reference.type === 'image' ? attachment?.thumbDataUrl : undefined)
  const label = tr("本机{{v0}}：{{v1}}", { v0: reference.type === 'image' ? tr("图片") : reference.type === 'audio' ? tr("音频") : tr("视频"), v1: reference.file_name })
  const Icon = reference.type === 'image' ? ImageIcon : reference.type === 'audio' ? Music : Video
  const header = <><Icon size={15} className="shrink-0 text-teal-600 dark:text-teal-300" aria-hidden />
    <span className="min-w-0 flex-1 truncate" title={reference.file_name}>{reference.file_name}</span>
    <span className="shrink-0 text-[11px] text-teal-700 dark:text-teal-300">{tr("本机附件")}{displayNumber != null && ` · [${displayNumber}]`}</span></>
  return (
    <figure data-attachment-evidence={reference.attachment_id} className={cn(
      'mx-auto w-full min-w-0 overflow-hidden rounded-xl border border-dashed border-teal-200 bg-teal-50/30 dark:border-teal-700/60 dark:bg-teal-950/20',
      preview ? '' : 'my-3 max-w-[38rem]'
    )}>
      {onOpen ? <button type="button" onClick={event => onOpen(event.currentTarget.getBoundingClientRect(), event.currentTarget)}
        aria-label={tr("查看附件引用：{{v0}}", { v0: reference.file_name })}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-slate-600 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal-500 dark:text-slate-300 dark:hover:bg-teal-900/20">{header}</button>
        : <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">{header}</div>}
      {src && !failed ? (
        reference.type === 'image'
          ? <img src={src} alt={label} loading="lazy" onError={() => setFailed(true)}
              className={cn('mx-auto h-auto w-full object-contain bg-white/60 dark:bg-slate-950/50', preview ? 'max-h-[420px]' : 'max-h-[300px]')} />
          : reference.type === 'audio'
            ? <div className="px-3 pb-3"><Suspense fallback={<p role="status" className="text-xs text-slate-500">{tr("正在恢复附件…")}</p>}><AudioPreviewPlayer src={src} compact ariaLabel={label} onError={() => setFailed(true)} /></Suspense></div>
            : <video src={src} controls playsInline preload="metadata" aria-label={label} onError={() => setFailed(true)} className="max-h-[360px] w-full bg-black" />
      ) : <p role="status" className="px-3 pb-3 text-xs text-slate-500 dark:text-slate-400">
        {!current.loaded ? tr("正在恢复附件…") : failed ? tr("当前浏览器无法预览此附件。") : tr("本机原文件已清理，无法预览。引用的解析内容仍保留。")}
      </p>}
      {src && !current.url && !savedOriginal && current.loaded && <p className="px-3 py-2 text-xs text-slate-500">{tr("原文件已清理，当前仅展示保存的缩略图。")}</p>}
    </figure>
  )
}
