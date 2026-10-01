import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, BookOpenText, Layers3 } from 'lucide-react'
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
  const [activeSection, setActiveSection] = useState<ArchitectureSectionId>('overview')
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

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    let frame = 0
    // Measure all starts together; observer callbacks only contain changed entries.
    const updateSection = () => {
      frame = 0
      const readingLine = viewport.getBoundingClientRect().top + (stickyNavRef.current?.offsetHeight ?? 0) + 84
      let current = architectureSections[0].id
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
            <span><span className="atlas-masthead-symbol"><Layers3 size={19} aria-hidden="true" /></span> TESSMORA <span className="atlas-masthead-divider" /> 系统架构</span>
            <span className="atlas-masthead-caption">MULTIMODAL · AGENTIC RETRIEVAL</span>
          </div>
          <div className="atlas-hero-grid">
            <div className="atlas-hero-copy">
              <p className="atlas-eyebrow">THE ARCHITECTURE OF AN ANSWER</p>
              <h1>让零散的素材，<br />成为<span>有据可循</span>的回答。</h1>
            </div>
            <div className="atlas-hero-aside">
              <p className="atlas-hero-description">文档、图片、音频与视频，被各自理解，汇入同一条证据主线。<br />从素材入库到答案送达，看看 Tessmora 如何连接这些片段。</p>
              <div className="atlas-hero-actions">
                <button type="button" className="atlas-button atlas-button-primary" onClick={() => handleNavigate('flow-lab')}>探索检索过程 <ArrowDown size={16} aria-hidden="true" /></button>
                <button type="button" className="atlas-button atlas-button-text" onClick={() => handleNavigate('system-architecture')}>查看完整架构 <ArrowRight size={16} aria-hidden="true" /></button>
              </div>
            </div>
          </div>
          <EvidenceCircuit />
          <div className="atlas-summary-strip">
            <p><span>输入</span> 四种模态，保留各自语义</p><ArrowRight aria-hidden="true" size={15} />
            <p><span>推理</span> Direct / Agent，按需取证</p><ArrowRight aria-hidden="true" size={15} />
            <p><span>输出</span> 一个回答，关联原始来源</p>
          </div>
        </header>
        <div ref={stickyNavRef} className="atlas-sticky-nav"><ArchitectureNav sections={architectureSections} activeId={activeSection} onNavigate={handleNavigate} /></div>
        <div className="atlas-content">
          <OverviewSection />
          <InteractiveFlowStudio />
          <ArchitectureDiagram />
          <RequestFlowStepper />
          <section id="modules" className="scroll-mt-24">
            <div className="atlas-section-intro"><div><p className="atlas-eyebrow">MODULE CONTRACTS / 模块边界</p><h2>各司其职，围绕证据协作</h2></div><p>探索六个领域模块的输入、职责与交付物，以及它们对应的代码入口。</p></div>
            <ModuleExplorer modules={coreModules} />
          </section>
          <DataFlowDiagram />
          <TechStackSection />
          <footer className="atlas-footer">
            <div><BookOpenText size={17} aria-hidden="true" /><span>实现文档 <code>docs/MMA_ARCHITECTURE.md</code></span></div>
            <button type="button" onClick={() => {
              window.history.pushState(null, '', window.location.pathname + window.location.search)
              scrollViewportRef.current?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
            }}>回到顶部 <ArrowUp size={15} aria-hidden="true" /></button>
          </footer>
        </div>
      </div>
    </div>
  )
}
