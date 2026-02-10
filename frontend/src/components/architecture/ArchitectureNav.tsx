import { cn } from '@/lib/utils'
import type { ArchitectureSection, ArchitectureSectionId } from '@/data/architectureData'

interface ArchitectureNavProps {
  sections: ArchitectureSection[]
  activeId: ArchitectureSectionId
  onNavigate: (id: ArchitectureSectionId) => void
}

export function ArchitectureNav({ sections, activeId, onNavigate }: ArchitectureNavProps) {
  return (
    <nav className="sticky top-4 space-y-3 rounded-xl border border-slate-200/70 bg-white/70 p-3 text-xs shadow-sm backdrop-blur dark:border-slate-800/70 dark:bg-slate-900/60">
      <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        架构导航
      </div>
      <ul className="space-y-1.5">
        {sections.map(section => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onNavigate(section.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                activeId === section.id
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200'
                  : 'text-slate-500 hover:bg-slate-100/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  activeId === section.id
                    ? 'bg-indigo-500 shadow-[0_0_0_4px_rgba(129,140,248,0.35)]'
                    : 'bg-slate-300 dark:bg-slate-600'
                )}
              />
              <span className="truncate">{section.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

