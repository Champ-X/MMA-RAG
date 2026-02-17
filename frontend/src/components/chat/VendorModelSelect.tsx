import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VendorModelSelectProps {
  value: string
  list: string[]
  isActive: boolean
  onSelect: (model: string) => void
  className?: string
  buttonClassName?: string
  ariaLabel?: string
}

/**
 * 自定义厂商模型下拉：未选时显示第一个模型名，列表中每项只出现一次，任意项（含第一个）均可选中。
 */
export function VendorModelSelect({
  value,
  list,
  isActive,
  onSelect,
  className,
  buttonClassName,
  ariaLabel,
}: VendorModelSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const displayText = value || list[0] || ''

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const baseClass =
    'w-full min-h-[44px] rounded-xl border-2 pl-4 pr-10 py-2.5 text-sm font-medium transition-all duration-200 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 text-left flex items-center justify-between'
  const btnClass = cn(
    baseClass,
    isActive
      ? 'border-indigo-400 bg-indigo-50/80 text-indigo-800 dark:border-indigo-500/80 dark:bg-indigo-950/50 dark:text-indigo-200 focus:ring-indigo-500/50'
      : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 hover:border-indigo-300 dark:hover:border-indigo-500/60 focus:ring-indigo-500/50',
    buttonClassName
  )

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={btnClass}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown
          className={cn('ml-2 h-5 w-5 flex-shrink-0 text-slate-400 dark:text-slate-500 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border-2 border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
        >
          {list.map((m) => (
            <li
              key={m}
              role="option"
              aria-selected={value === m}
              onClick={() => {
                onSelect(m)
                setOpen(false)
              }}
              className={cn(
                'cursor-pointer px-4 py-2.5 text-sm transition-colors',
                value === m
                  ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'
              )}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
