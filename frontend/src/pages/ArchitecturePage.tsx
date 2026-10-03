import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, BookOpenText, Layers3, Fingerprint, Waypoints, Compass } from 'lucide-react'
import { architectureSections, coreModules, type ArchitectureSectionId } from '@/data/architectureData'
import { ArchitectureNav } from '@/components/architecture/ArchitectureNav'
import { EvidenceCircuit } from '@/components/architecture/EvidenceCircuit'
import { OverviewSection } from '@/components/architecture/OverviewSection'
import { InteractiveFlowStudio } from '@/components/architecture/InteractiveFlowStudio'
import { ArchitectureDiagram } from '@/components/architecture/ArchitectureDiagram'
import { RequestFlowStepper } from '@/components/architecture/RequestFlowStepper'
import { ModuleExplorer } from '@/components/architecture/ModuleExplorer'
import { DataFlowDiagram } from '@/components/architecture/DataFlowDiagram'
import { TechStackSection } from '@/components/architecture/TechStackSection'
import '@/components/architecture/architecture.css'

export function ArchitecturePage() {
  const [activeSection, setActiveSection] = useState<ArchitectureSectionId | null>(null)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const stickyNavRef = useRef<HTMLDivElement>(null)

  const handleNavigate = useCallback((id: ArchitectureSectionId, options: { writeHistory?: boolean } = {}) => {
    setActiveSection(id)
    if (options.writeHistory !== false && window.location.hash !== `#${id}`) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#${id}`)
    }
    window.requestAnimationFrame(() => {
      const section = document.getElementById(id)
      const viewport = scrollViewportRef.current
      if (!section || !viewport) return
      const nextTop = viewport.scrollTop + section.getBoundingClientRect().top
        - viewport.getBoundingClientRect().top - (stickyNavRef.current?.offsetHeight ?? 0) - 28
      viewport.scrollTo({ top: Math.max(nextTop, 0), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    })
  }, [])

  const handleTop = useCallback(() => {
    window.history.pushState(null, '', window.location.pathname + window.location.search)
    setActiveSection(null)
    scrollViewportRef.current?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    let frame = 0
    // Measure all starts together; observer callbacks only contain changed entries.
    const updateSection = () => {
      frame = 0
      const readingLine = viewport.getBoundingClientRect().top + (stickyNavRef.current?.offsetHeight ?? 0) + 84
      let current: ArchitectureSectionId | null = null
      for (const { id } of architectureSections) {
        const section = document.getElementById(id)
        if (section && section.getBoundingClientRect().top <= readingLine) current = id
      }
      if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 8) current = 'tech-stack'
      setActiveSection(current)
    }
    const scheduleUpdate = () => { if (!frame) frame = window.requestAnimationFrame(updateSection) }
    viewport.addEventListener('scroll', scheduleUpdate, { passive: true })
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(viewport)
    if (viewport.lastElementChild) resizeObserver.observe(viewport.lastElementChild)
    return () => {
      viewport.removeEventListener('scroll', scheduleUpdate)
      resizeObserver.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    const readHash = () => {
      const candidate = window.location.hash.slice(1) as ArchitectureSectionId
      if (architectureSections.some(({ id }) => id === candidate)) handleNavigate(candidate, { writeHistory: false })
      else if (!candidate) scrollViewportRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    }
    readHash()
    window.addEventListener('popstate', readHash)
    window.addEventListener('hashchange', readHash)
    return () => {
      window.removeEventListener('popstate', readHash)
      window.removeEventListener('hashchange', readHash)
    }
  }, [handleNavigate])

  return (
    <div className="architecture-page h-full min-h-0">
      <div ref={scrollViewportRef} className="architecture-scroll-viewport atlas-viewport">
        <header className="atlas-hero">
          <div className="atlas-masthead">
            <span><span className="atlas-masthead-symbol"><Layers3 size={19} aria-hidden="true" /></span> TESSMORA <span className="atlas-masthead-divider" /> 系统架构图谱</span>
            <span className="atlas-masthead-caption"><span /> SYSTEM ATLAS <span className="atlas-masthead-edition">多模态检索 · 架构导读</span></span>
          </div>
          <div className="atlas-hero-grid">
            <div className="atlas-hero-copy">
              <p className="atlas-eyebrow"><span className="atlas-eyebrow-rule" /> THE EVIDENCE ATLAS</p>
              <h1>答案背后，<br />每份素材<br /><span>都有来处<span className="atlas-title-period">。</span></span></h1>
              <p className="atlas-hero-description">文档、图片、声音与镜头，<br />保留各自的表达，汇入共同的证据链。</p>
              <p className="atlas-hero-thesis">这里拆开一个回答，看看素材如何被理解、证据如何被找到，以及引用如何回到来源。</p>
              <div className="atlas-hero-actions">
                <button type="button" className="atlas-button atlas-button-primary" onClick={() => handleNavigate('flow-lab')}>沿着证据，探索系统 <ArrowDown size={16} aria-hidden="true" /></button>
                <button type="button" className="atlas-button atlas-button-text" onClick={() => handleNavigate('system-architecture')}>查看完整架构 <ArrowRight size={16} aria-hidden="true" /></button>
              </div>
              <div className="atlas-hero-colophon"><span className="atlas-colophon-line" /><Fingerprint size={16} aria-hidden="true" /><span>理解有层次，取证有边界，来源可追溯。</span></div>
            </div>
            <EvidenceCircuit />
          </div>
          <div className="atlas-reading-routes" role="group" aria-label="架构阅读路线">
            <div className="atlas-reading-label"><Compass size={17} aria-hidden="true" /><span>从你关心的地方开始</span></div>
            <button type="button" onClick={() => handleNavigate('overview')}><span><strong>为什么这样设计</strong><small>理解四个关键取舍</small></span><ArrowRight size={16} aria-hidden="true" /></button>
            <button type="button" onClick={() => handleNavigate('request-flow')}><span><strong>一个问题如何被回答</strong><small>对照 Direct 与 Agent</small></span><ArrowRight size={16} aria-hidden="true" /></button>
            <button type="button" onClick={() => handleNavigate('tech-stack')}><span><strong>实现走到了哪里</strong><small>运行依赖与当前边界</small></span><ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        </header>
        <div ref={stickyNavRef} className="atlas-sticky-nav"><ArchitectureNav sections={architectureSections} activeId={activeSection} onNavigate={handleNavigate} onTop={handleTop} /><span className="atlas-reading-progress" aria-hidden="true" /></div>
        <div className="atlas-content">
          <OverviewSection />
          <InteractiveFlowStudio />
          <ArchitectureDiagram />
          <RequestFlowStepper />
          <section id="modules" className="scroll-mt-24">
            <div className="atlas-section-intro"><div><p className="atlas-eyebrow">MODULE CONTRACTS / 模块边界</p><h2>六个模块，一条协作链。</h2></div><p>先看每个模块接收什么、交付什么，再按需展开代码入口。边界清楚，才能知道一次变化会影响哪里。</p></div>
            <ModuleExplorer modules={coreModules} />
          </section>
          <DataFlowDiagram />
          <TechStackSection />
          <footer className="atlas-footer">
            <div className="atlas-footer-signature"><Waypoints size={23} aria-hidden="true" /><span><strong>理解系统，从一份证据开始。</strong><small>TESSMORA · THE EVIDENCE ATLAS</small></span></div><div className="atlas-footer-document"><BookOpenText size={16} aria-hidden="true" /><span>实现文档<code>docs/MMA_ARCHITECTURE.md</code></span></div>
            <button type="button" onClick={handleTop}>回到顶部 <ArrowUp size={15} aria-hidden="true" /></button>
          </footer>
        </div>
      </div>
    </div>
  )
}
