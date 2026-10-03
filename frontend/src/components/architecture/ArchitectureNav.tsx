import { useEffect, useRef } from 'react'
import { Boxes, Database, GitBranch, Layers3, Network, Play, ServerCog } from 'lucide-react'
import type { ArchitectureSection, ArchitectureSectionId } from '@/data/architectureData'

interface ArchitectureNavProps {
  sections: ArchitectureSection[]
  activeId: ArchitectureSectionId | null
  onNavigate: (id: ArchitectureSectionId) => void
  onTop: () => void
}

const sectionIcons = {
  overview: Layers3,
  'flow-lab': Play,
  'system-architecture': Network,
  'request-flow': GitBranch,
  modules: Boxes,
  'data-flow': Database,
  'tech-stack': ServerCog,
}

export function ArchitectureNav({ sections, activeId, onNavigate, onTop }: ArchitectureNavProps) {
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
      <button type="button" className="atlas-nav-label" onClick={onTop} aria-label="回到架构导览" aria-current={activeId === null ? 'location' : undefined}><Layers3 size={16} aria-hidden="true" />导览</button>
      <div ref={navScrollerRef} className="atlas-nav-scroller">
        {sections.map((section) => {
          const Icon = sectionIcons[section.id]
          return (
          <a key={section.id} ref={activeId === section.id ? activeLinkRef : undefined}
            href={`#${section.id}`} title={section.subtitle} aria-current={activeId === section.id ? 'location' : undefined}
            onClick={(event) => { event.preventDefault(); onNavigate(section.id) }}>
            <Icon size={16} aria-hidden="true" />
            {section.title}
          </a>
          )
        })}
      </div>
    </nav>
  )
}
