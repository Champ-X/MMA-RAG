import { X, Music2, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessageAttachment } from '@/store/useChatStore'

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 输入框内：图片仅缩略图；音频为横向卡片（紫粉渐变图标 + 文件名 + 音频 · 大小） */
export function ComposerAttachmentTile({
  item,
  onRemove,
}: {
  item: ChatMessageAttachment
  onRemove: () => void
}) {
  const imgSrc = item.kind === 'image' ? item.previewUrl || item.thumbDataUrl : undefined
  const attachmentSize = formatAttachmentSize(item.size)
  const attachmentLabel = `${item.kind === 'image' ? '图片' : '音频'}附件：${item.name}`
  const attachmentLabelWithSize = `${attachmentLabel}，${attachmentSize}`
  const removeLabel = `移除附件：${item.name}`

  if (item.kind === 'image' && imgSrc) {
    return (
      <div
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-100 shadow-sm dark:border-slate-600 dark:bg-slate-900/80"
      >
        <img src={imgSrc} alt={attachmentLabel} className="h-full w-full object-cover" />
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-[2px] transition hover:bg-black/60"
          aria-label={removeLabel}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    )
  }

  if (item.kind === 'image') {
    return (
      <div
        className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-100 dark:border-slate-600 dark:bg-slate-800"
        role="group"
        aria-label={`${attachmentLabelWithSize}，预览不可用`}
      >
        <ImageIcon className="h-6 w-6 text-slate-400" aria-hidden />
        <span className="sr-only">图片预览不可用</span>
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white"
          aria-label={removeLabel}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative flex h-14 max-h-14 min-h-14 min-w-0 max-w-[min(100%,16rem)] shrink-0 items-center gap-1.5 rounded-xl border pl-1 pr-8 shadow-sm transition-all duration-200',
        'border-purple-200/55 bg-white/90 ring-1 ring-purple-100/35 backdrop-blur-sm',
        'hover:border-purple-300/70 hover:shadow-md hover:ring-purple-200/45',
        'dark:border-purple-500/25 dark:bg-slate-800/95 dark:ring-purple-500/10',
        'dark:hover:border-purple-400/40 dark:hover:ring-purple-400/25'
      )}
      role="group"
      aria-label={attachmentLabelWithSize}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm shadow-fuchsia-500/20"
        aria-hidden
      >
        <Music2 className="h-5 w-5 opacity-95" strokeWidth={2} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
        <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100" title={item.name}>
          {item.name}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
          音频 · {attachmentSize}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-95 dark:text-slate-500 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
        aria-label={removeLabel}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}
