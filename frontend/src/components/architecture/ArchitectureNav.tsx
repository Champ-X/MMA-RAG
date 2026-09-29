import { useEffect, useRef } from 'react'
import { Layers3 } from 'lucide-react'
import type { ArchitectureSection, ArchitectureSectionId } from '@/data/architectureData'

interface ArchitectureNavProps {
  sections: ArchitectureSection[]
  activeId: ArchitectureSectionId
  onNavigate: (id: ArchitectureSectionId) => void
}

export function ArchitectureNav({ sections, activeId, onNavigate }: ArchitectureNavProps) {
  const activeLinkRef = useRef<HTMLAnchorElement>(null)
  const navScrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const link = activeLinkRef.current
    const scroller = navScrollerRef.current
    if (!link || !scroller) return
    // Scroll only the horizontal rail, not the enclosing reading viewport.
    const delta = link.getBoundingClientRect().left - scroller.getBoundingClientRect().left
    if (delta < 0 || delta + link.offsetWidth > scroller.clientWidth) {
      scroller.scrollTo({ left: scroller.scrollLeft + delta - (scroller.clientWidth - link.offsetWidth) / 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }, [activeId])
  return (
    <nav aria-label="架构页目录" className="atlas-nav">
      <span className="atlas-nav-label"><Layers3 size={16} aria-hidden="true" />导览</span>
      <div ref={navScrollerRef} className="atlas-nav-scroller">
        {sections.map((section) => (
          <a key={section.id} ref={activeId === section.id ? activeLinkRef : undefined}
            href={`#${section.id}`} aria-current={activeId === section.id ? 'location' : undefined}
            onClick={(event) => { event.preventDefault(); onNavigate(section.id) }}>
            {section.title}
          </a>
        ))}
      </div>
    </nav>
  )
}
