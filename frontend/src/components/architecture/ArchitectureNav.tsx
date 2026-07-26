import { cn } from '@/lib/utils'
import type { ArchitectureSection, ArchitectureSectionId } from '@/data/architectureData'

interface ArchitectureNavProps {
  sections: ArchitectureSection[]
  activeId: ArchitectureSectionId
  onNavigate: (id: ArchitectureSectionId) => void
}

export function ArchitectureNav({ sections, activeId, onNavigate }: ArchitectureNavProps) {
  return (
    <nav aria-label="架构页目录" className="min-w-0">
      <div className="scrollbar-hide flex min-w-0 items-stretch gap-1 overflow-x-auto px-1">
        {sections.map((section) => {
          const isActive = activeId === section.id

          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={isActive ? 'location' : undefined}
              title={section.subtitle}
              onClick={(event) => {
                event.preventDefault()
                onNavigate(section.id)
              }}
              className={cn(
                'relative flex min-h-11 shrink-0 items-center px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500/70 sm:px-4',
                isActive
                  ? 'text-teal-800 dark:text-teal-200'
                  : 'text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100'
              )}
            >
              {section.title}
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-teal-600 transition-transform duration-200 dark:bg-teal-400 sm:inset-x-4',
                  isActive ? 'scale-x-100' : 'scale-x-0'
                )}
              />
            </a>
          )
        })}
      </div>
    </nav>
  )
}
