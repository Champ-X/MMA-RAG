import { useEffect, useId, useRef, useState } from 'react'
import { Image as ImageIcon, Music, Video, X } from 'lucide-react'
import type { CitationReference } from '@/types/sse'
import { getAttachmentBlob } from '@/lib/chatAttachmentBlobStore'
import { useChatStore } from '@/store/useChatStore'
import { cn } from '@/lib/utils'
import { piOriginalUrl } from '@/services/piAgent'

/** Resolve by stable identity within this conversation; never guess by filename or contact KB endpoints. */
export function AttachmentEvidence({ reference, displayNumber, onOpen, preview = false }: {
  reference: CitationReference
  displayNumber?: number | string
  onOpen?: (rect: DOMRect, target: HTMLElement) => void
  preview?: boolean
}) {
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
  const label = `本机${reference.type === 'image' ? '图片' : reference.type === 'audio' ? '音频' : '视频'}：${reference.file_name}`
  const Icon = reference.type === 'image' ? ImageIcon : reference.type === 'audio' ? Music : Video
  const header = <><Icon size={15} className="shrink-0 text-teal-600 dark:text-teal-300" aria-hidden />
    <span className="min-w-0 flex-1 truncate" title={reference.file_name}>{reference.file_name}</span>
    <span className="shrink-0 text-[11px] text-teal-700 dark:text-teal-300">本机附件{displayNumber != null && ` · [${displayNumber}]`}</span></>
  return (
    <figure data-attachment-evidence={reference.attachment_id} className={cn(
      'mx-auto w-full min-w-0 overflow-hidden rounded-xl border border-dashed border-teal-200 bg-teal-50/30 dark:border-teal-700/60 dark:bg-teal-950/20',
      preview ? '' : 'my-3 max-w-[38rem]'
    )}>
      {onOpen ? <button type="button" onClick={event => onOpen(event.currentTarget.getBoundingClientRect(), event.currentTarget)}
        aria-label={`查看附件引用：${reference.file_name}`}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-slate-600 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal-500 dark:text-slate-300 dark:hover:bg-teal-900/20">{header}</button>
        : <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-300">{header}</div>}
      {src && !failed ? (
        reference.type === 'image'
          ? <img src={src} alt={label} loading="lazy" onError={() => setFailed(true)}
              className={cn('mx-auto h-auto w-full object-contain bg-white/60 dark:bg-slate-950/50', preview ? 'max-h-[420px]' : 'max-h-[300px]')} />
          : reference.type === 'audio'
            ? <div className="px-3 pb-3"><audio src={src} controls preload="metadata" aria-label={label} onError={() => setFailed(true)} className="h-10 w-full [color-scheme:light] dark:[color-scheme:dark]" /></div>
            : <video src={src} controls playsInline preload="metadata" aria-label={label} onError={() => setFailed(true)} className="max-h-[360px] w-full bg-black" />
      ) : <p role="status" className="px-3 pb-3 text-xs text-slate-500 dark:text-slate-400">
        {!current.loaded ? '正在恢复附件…' : failed ? '当前浏览器无法预览此附件。' : '本机原文件已清理，无法预览。引用的解析内容仍保留。'}
      </p>}
      {src && !current.url && !savedOriginal && current.loaded && <p className="px-3 py-2 text-xs text-slate-500">原文件已清理，当前仅展示保存的缩略图。</p>}
    </figure>
  )
}

export function AttachmentCitationPopover({ item, rect, onClose }: {
  item: CitationReference; rect: DOMRect; onClose: () => void
}) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }) }, [item.attachment_id])
  const width = Math.min(520, window.innerWidth - 40)
  const height = Math.min(660, window.innerHeight - 40)
  const left = Math.max(20, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 20))
  const top = Math.max(20, Math.min(rect.bottom + 12, window.innerHeight - height - 20))
  return <div role="dialog" aria-modal="false" aria-labelledby={titleId}
    style={{ position: 'fixed', left, top, width, maxHeight: height }}
    className="z-40 flex flex-col overflow-hidden rounded-2xl border border-teal-200/80 bg-white shadow-xl dark:border-teal-800 dark:bg-slate-950">
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <div className="min-w-0 flex-1"><h2 id={titleId} className="truncate text-sm font-semibold" title={item.file_name}>{item.file_name}</h2>
        <p className="mt-1 text-xs text-teal-700 dark:text-teal-300">本机附件 · 来自此对话</p></div>
      <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭引用预览"
        className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-500 dark:hover:bg-slate-800"><X size={16} aria-hidden /></button>
    </div>
    <div className="min-h-0 overflow-y-auto p-4">
      <AttachmentEvidence reference={item} preview />
      <div className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">回答依据的附件解析</div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-200">{item.content || '没有保存的解析内容。'}</p>
      {item.media_info?.sampled_seconds && <p className="mt-3 text-xs text-slate-500">视频按 {item.media_info.sampled_seconds.map(second => `${second}s`).join('、')} 抽样解析。</p>}
    </div>
  </div>
}
