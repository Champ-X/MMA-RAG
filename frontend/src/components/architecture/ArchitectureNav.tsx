import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { ArchitectureSection, ArchitectureSectionId } from '@/data/architectureData'

interface ArchitectureNavProps {
  sections: ArchitectureSection[]
  activeId: ArchitectureSectionId
  onNavigate: (id: ArchitectureSectionId) => void
}

export function ArchitectureNav({ sections, activeId, onNavigate }: ArchitectureNavProps) {
  const itemRefs = useRef<Partial<Record<ArchitectureSectionId, HTMLButtonElement | null>>>({})

  useEffect(() => {
    itemRefs.current[activeId]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeId])

  return (
    <nav className="sticky top-4 space-y-3 rounded-2xl border border-slate-200/80 bg-white/85 p-3 text-xs shadow-lg shadow-indigo-950/5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/75 dark:shadow-black/40">
      <div className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        本页导航
      </div>
      <ul className="max-h-[calc(100vh-8rem)] space-y-0.5 overflow-y-auto pr-0.5">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              ref={(node) => {
                itemRefs.current[section.id] = node
              }}
              onClick={() => onNavigate(section.id)}
              className={cn(
                'flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200',
                activeId === section.id
                  ? 'bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-900 shadow-sm ring-1 ring-indigo-200/60 dark:from-indigo-950/50 dark:to-violet-950/30 dark:text-indigo-100 dark:ring-indigo-800/50'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full transition-transform',
                    activeId === section.id
                      ? 'scale-125 bg-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.35)]'
                      : 'bg-slate-300 dark:bg-slate-600'
                  )}
                />
                <span className="line-clamp-2 font-medium leading-snug">{section.title}</span>
              </span>
              {section.subtitle && activeId === section.id && (
                <span className="line-clamp-2 pl-3.5 text-[10px] font-normal leading-snug text-indigo-600/85 dark:text-indigo-300/80">
                  {section.subtitle}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

