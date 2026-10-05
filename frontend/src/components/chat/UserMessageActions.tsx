import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

export function UserMessageActions({ content, contentId, onEdit, disabled = false }: {
  content: string
  contentId: string
  onEdit?: () => void
  disabled?: boolean
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copying = useRef(false)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])

  const copy = async () => {
    if (copying.current) return
    copying.current = true
    clearTimeout(timer.current)
    try {
      // Copy the original text, including full @names and line breaks, never the rendered chips.
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(content)
      if (mounted.current) setCopyState('copied')
    } catch {
      if (mounted.current) setCopyState('failed')
    } finally {
      copying.current = false
      if (mounted.current) timer.current = setTimeout(() => setCopyState('idle'), 3000)
    }
  }
  const actionClass = 'inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200/60 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-35 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100 motion-reduce:transition-none'

  return (
    <div className="pointer-events-none flex min-h-7 items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover/user-message:pointer-events-auto group-hover/user-message:opacity-100 group-[:has(:focus-visible)]/user-message:pointer-events-auto group-[:has(:focus-visible)]/user-message:opacity-100 motion-reduce:transition-none">
      <span role="status" className={cn('mr-1 text-xs', copyState === 'failed' ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400')}>
        {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败，请选中文字后复制' : ''}
      </span>
      <button type="button" className={actionClass} aria-label="复制消息" aria-describedby={contentId}
        title={copyState === 'copied' ? '已复制' : '复制'} onClick={() => { void copy() }}>
        {copyState === 'copied' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      </button>
      {onEdit && (
        <button type="button" className={actionClass} aria-label="编辑消息" aria-describedby={contentId}
          title={disabled ? '请等待当前请求结束后编辑' : '编辑'} onClick={onEdit} disabled={disabled}>
          <Pencil size={15} aria-hidden />
        </button>
      )}
    </div>
  )
}
