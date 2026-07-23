import { useEffect, useId, useRef, useState } from 'react'
import { Music2, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessageAttachment } from '@/store/useChatStore'
import { getAttachmentBlob } from '@/lib/chatAttachmentBlobStore'
import { formatAttachmentSize } from './ComposerAttachmentTile'
export { ComposerAttachmentTile } from './ComposerAttachmentTile'

/** 用户消息上方：从 IndexedDB 恢复二进制后可用原图/播放器；无库内数据时图片用 thumbDataUrl，音频仅展示元信息 */
export function UserMessageAttachmentTile({ item }: { item: ChatMessageAttachment }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [restoreStatus, setRestoreStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const urlRef = useRef<string | null>(null)
  const attachmentId = useId().replace(/:/g, '')
  const restoreStatusId = `${attachmentId}-restore-status`
  const attachmentName = item.name || '未命名附件'
  const attachmentSize = formatAttachmentSize(item.size)
  const attachmentLabel = `${item.kind === 'image' ? '图片' : '音频'}附件：${attachmentName}，${attachmentSize}`
  const restoreStatusText =
    restoreStatus === 'ready'
      ? '已恢复原始附件数据'
      : restoreStatus === 'missing'
        ? '未找到本地原始附件数据，使用可用预览或文件信息'
        : '正在恢复原始附件数据'

  useEffect(() => {
    let cancelled = false
    urlRef.current = null
    setBlobUrl(null)
    setRestoreStatus('loading')
    ;(async () => {
      const b = await getAttachmentBlob(item.id)
      if (cancelled) return
      if (!b) {
        setRestoreStatus('missing')
        return
      }
      const u = URL.createObjectURL(b)
      if (cancelled) {
        URL.revokeObjectURL(u)
        return
      }
      urlRef.current = u
      setBlobUrl(u)
      setRestoreStatus('ready')
    })()
    return () => {
      cancelled = true
      const u = urlRef.current
      if (u) {
        URL.revokeObjectURL(u)
        urlRef.current = null
      }
      setBlobUrl(null)
    }
  }, [item.id])

  if (item.kind === 'image') {
    const src = blobUrl || item.previewUrl || item.thumbDataUrl
    return (
      <div
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-100 shadow-sm dark:border-slate-600 dark:bg-slate-900/80"
        role="group"
        aria-label={attachmentLabel}
        aria-describedby={restoreStatusId}
      >
        <span id={restoreStatusId} className="sr-only" aria-live="polite">
          {restoreStatusText}
        </span>
        {src ? (
          <img src={src} alt={`附件图片：${attachmentName}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center" role="status" aria-label="图片附件预览不可用">
            <ImageIcon className="h-6 w-6 text-slate-400" aria-hidden />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex min-w-0 max-w-[min(100%,20rem)] shrink-0 flex-col gap-1 rounded-xl border px-1.5 py-1.5 shadow-sm',
        'border-purple-200/55 bg-white/90 ring-1 ring-purple-100/35 backdrop-blur-sm dark:border-purple-500/25',
        'dark:bg-slate-800/95 dark:ring-purple-500/10'
      )}
      role="group"
      aria-label={attachmentLabel}
      aria-describedby={restoreStatusId}
    >
      <span id={restoreStatusId} className="sr-only" aria-live="polite">
        {restoreStatusText}
      </span>
      <div className="flex min-h-11 items-center gap-1.5">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm shadow-fuchsia-500/20"
          aria-hidden
        >
          <Music2 className="h-5 w-5 opacity-95" strokeWidth={2} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
          <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100" title={item.name}>
            {attachmentName}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
            音频 · {attachmentSize}
          </p>
        </div>
      </div>
      {blobUrl ? (
        <audio
          src={blobUrl}
          controls
          aria-label={`播放音频附件：${attachmentName}`}
          aria-describedby={restoreStatusId}
          className="h-8 w-full min-w-[200px] max-w-full"
          preload="metadata"
        />
      ) : (
        <span className="sr-only" role="status">
          音频播放器暂不可用，已显示附件文件信息
        </span>
      )}
    </div>
  )
}

export function UserMessageAttachmentStrip({
  attachments,
  className,
}: {
  attachments: ChatMessageAttachment[]
  className?: string
}) {
  if (!attachments.length) return null
  return (
    <div
      className={cn('flex flex-wrap justify-end gap-2', className)}
      role="list"
      aria-label={`消息附件，共 ${attachments.length} 个`}
    >
      {attachments.map((item) => (
        <div key={item.id} role="listitem">
          <UserMessageAttachmentTile item={item} />
        </div>
      ))}
    </div>
  )
}
