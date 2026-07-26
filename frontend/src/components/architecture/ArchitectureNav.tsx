import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { ArchitectureSection, ArchitectureSectionId } from '@/data/architectureData'

interface ArchitectureNavProps {
  sections: ArchitectureSection[]
  activeId: ArchitectureSectionId
  onNavigate: (id: ArchitectureSectionId) => void
}

export function ArchitectureNav({ sections, activeId, onNavigate }: ArchitectureNavProps) {
  const activeLinkRef = useRef<HTMLButtonElement | null>(null)
  const navScrollerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const link = activeLinkRef.current
    const scroller = navScrollerRef.current
    if (!link || !scroller) return

    // 只横向居中当前目录项。scrollIntoView 会连带滚动架构页的纵向 viewport，
    // 从而打断 handleNavigate 对目标章节的定位。
    const nextLeft = link.offsetLeft - (scroller.clientWidth - link.offsetWidth) / 2
    scroller.scrollTo({
      left: Math.max(0, nextLeft),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [activeId])

  return (
    <nav aria-label="架构页目录" className="min-w-0">
      <div ref={navScrollerRef} className="scrollbar-hide flex min-w-0 items-center gap-1.5 overflow-x-auto py-2.5">
        {sections.map((section) => {
          const isActive = activeId === section.id

          return (
            <button
              key={section.id}
              type="button"
              ref={isActive ? activeLinkRef : undefined}
              aria-current={isActive ? 'location' : undefined}
              aria-label={section.subtitle ? `${section.title}：${section.subtitle}` : section.title}
              title={section.subtitle}
              onClick={() => onNavigate(section.id)}
              className={cn(
                'relative flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93]/70',
                isActive
                  ? 'border-[#102d42] bg-[#102d42] text-white shadow-sm dark:border-[#dbe9e5] dark:bg-[#dbe9e5] dark:text-[#102d42]'
                  : 'border-transparent text-[#647a7e] hover:border-[#bfd0ca] hover:bg-white/50 hover:text-[#17384a] dark:text-[#91aaac] dark:hover:border-[#31525e] dark:hover:bg-white/[0.04] dark:hover:text-white'
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-[#7fc2cf] dark:bg-[#2f7f93]' : 'bg-[#b0c4bf] dark:bg-[#3e606a]')} />
              {section.title}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
