import { useCallback, useEffect, useRef, useState } from 'react'
import { chatApi } from '@/services/api_client'
import { isReferenceMediaUrlFresh } from '@/services/reference_media_url'

/** One automatic URL refresh per attempt; failures remain visible and can be retried. */
export function ReferenceImage({
  url, kbId, filePath, label, onOpen,
}: {
  url?: string
  kbId?: string
  filePath?: string
  label: string
  onOpen: (rect: DOMRect) => void
}) {
  const [src, setSrc] = useState<string>()
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const refreshed = useRef(false)

  const refresh = useCallback(async () => {
    const current = generation.current
    if (refreshed.current || !kbId || !filePath) {
      setStatus('error')
      return
    }
    refreshed.current = true
    setSrc(undefined)
    setStatus('loading')
    try {
      const result = await chatApi.getReferenceImageUrl({ kb_id: kbId, file_path: filePath })
      if (current !== generation.current) return
      if (!result.img_url) throw new Error('图片地址为空')
      setSrc(result.img_url)
    } catch {
      if (current === generation.current) setStatus('error')
    }
  }, [kbId, filePath])

  useEffect(() => {
    generation.current += 1
    refreshed.current = false
    setStatus('loading')
    setSrc(undefined)
    if (attempt === 0 && isReferenceMediaUrlFresh(url)) {
      setSrc(url)
    } else if (kbId && filePath) {
      void refresh()
    } else if (url) {
      setSrc(url)
    } else {
      setStatus('error')
    }
    return () => { generation.current += 1 }
  }, [url, kbId, filePath, attempt, refresh])

  useEffect(() => {
    if (status !== 'loading') return
    const timer = window.setTimeout(() => {
      if (refreshed.current) {
        // Ignore a slow response arriving after this attempt has timed out.
        generation.current += 1
        setStatus('error')
      } else {
        void refresh()
      }
    }, 15000)
    return () => window.clearTimeout(timer)
  }, [src, status, refresh])

  if (status === 'error') {
    return (
      <div className="max-w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
        <p role="status">图片暂时无法加载</p>
        <p className="max-w-sm break-all text-xs text-slate-500">{label}</p>
        <div className="flex gap-3">
          <button type="button" className="min-h-11 text-indigo-600 dark:text-indigo-300" onClick={() => setAttempt((n) => n + 1)}>重试加载</button>
          <button type="button" className="min-h-11 text-indigo-600 dark:text-indigo-300" onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}>查看引用</button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      className={`relative max-w-full overflow-hidden rounded-lg p-0 hover:ring-2 ring-primary/40 ${status === 'loading' ? 'min-h-32 min-w-48 bg-slate-100 dark:bg-slate-800' : ''}`}
      aria-label={`查看图片引用：${label}`}
    >
      {status === 'loading' && <span role="status" className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">正在加载图片…</span>}
      {src && (
        <img
          key={`${attempt}:${src}`}
          src={src}
          alt={label}
          className={`block max-h-64 max-w-full object-contain m-0 ${status === 'loaded' ? 'visible' : 'invisible'}`}
          onLoad={() => setStatus('loaded')}
          onError={() => { void refresh() }}
        />
      )}
    </button>
  )
}
