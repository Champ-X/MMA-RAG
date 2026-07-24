import { cn } from '@/lib/utils'
import type { ArchitectureSection, ArchitectureSectionId } from '@/data/architectureData'

interface ArchitectureNavProps {
  sections: ArchitectureSection[]
  activeId: ArchitectureSectionId
  onNavigate: (id: ArchitectureSectionId) => void
}

export function ArchitectureNav({ sections, activeId, onNavigate }: ArchitectureNavProps) {
  return (
    <nav className="border-l border-slate-200 pl-4 text-xs dark:border-slate-800" aria-label="架构页目录">
      <div className="mb-3 font-mono text-[10px] font-semibold tracking-[0.16em] text-slate-400 dark:text-slate-500">
        阅读目录
      </div>
      <ul className="space-y-1">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onNavigate(section.id)}
              className={cn(
                'flex w-full flex-col gap-0.5 rounded-[6px] px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70',
                activeId === section.id
                  ? 'bg-slate-100 text-slate-950 dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-100'
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full transition-transform',
                    activeId === section.id
                      ? 'scale-110 bg-indigo-500'
                      : 'bg-slate-300 dark:bg-slate-600'
                  )}
                />
                <span className="font-medium leading-snug">{section.title}</span>
              </span>
              {section.subtitle && activeId === section.id && (
                <span className="line-clamp-2 pl-3.5 text-[10px] font-normal leading-snug text-slate-500 dark:text-slate-400">
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
