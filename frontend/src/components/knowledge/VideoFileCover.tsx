import { useState } from 'react'
import { Film, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

type VideoFileCoverProps = {
  src?: string
  name: string
  timestamp?: number
  className?: string
}

function formatFrameTime(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

/** Presentation only: the parent file card continues to open the original video. */
export function VideoFileCover({ src, name, timestamp, className }: VideoFileCoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>()
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>()
  const hasCover = Boolean(src && failedSrc !== src)
  const ready = hasCover && loadedSrc === src

  return (
    <div className={cn('relative isolate aspect-video w-full overflow-hidden bg-slate-900', className)}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 text-slate-400" aria-hidden>
        <Film className="h-9 w-9" strokeWidth={1.25} />
        <span className="text-[11px] tracking-[0.12em]">视频素材</span>
      </div>
      {hasCover && (
        <img
          src={src}
          alt={`${name}的视频封面`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 motion-reduce:transition-none motion-safe:group-hover:scale-[1.035]',
            ready ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-slate-950/10" aria-hidden />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/55 bg-slate-950/20 text-white shadow-lg backdrop-blur-sm transition-[opacity,background-color] duration-200 group-hover:bg-white/20 group-focus-visible:bg-white/20 motion-reduce:transition-none',
          ready ? 'opacity-90' : 'opacity-0',
        )}
      >
        <Play className="ml-0.5 h-[18px] w-[18px] fill-current" strokeWidth={1.5} />
      </span>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 text-white">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-black/25 px-2 py-1 text-[10px] font-medium tracking-wide backdrop-blur-sm">
          <Film className="h-3 w-3" aria-hidden /> 视频
        </span>
        {ready && typeof timestamp === 'number' && Number.isFinite(timestamp) && (
          <span className="rounded-md bg-black/35 px-2 py-1 text-[10px] tabular-nums backdrop-blur-sm" title="封面画面在原视频中的时间">
            画面 · {formatFrameTime(timestamp)}
          </span>
        )}
      </div>
    </div>
  )
}
