import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, BookOpenText, Bot, ChevronDown, ExternalLink, Layers3, Search, Waypoints } from 'lucide-react'
import { ArchitectureMap } from '@/components/architecture/ArchitectureMap'
import { EvidenceJourney } from '@/components/architecture/EvidenceJourney'
import { ArchitectureDetails } from '@/components/architecture/ArchitectureDetails'
import { ArchitectureRuntime } from '@/components/architecture/ArchitectureRuntime'
import { architectureModes, architectureReviewDate, architectureSourceUrl, type ArchitectureMode } from '@/data/architectureExperience'
import '@/components/architecture/architecture.css'

const sections = [
  { id: 'overview', name: '系统全貌', icon: Layers3 },
  { id: 'flow-lab', name: '跟随一次任务', icon: Waypoints },
  { id: 'modules', name: '深入关键机制', icon: Search },
  { id: 'tech-stack', name: '运行与实现', icon: Bot },
] as const
type SectionId = typeof sections[number]['id']
const legacySections: Record<string, SectionId> = { 'system-architecture': 'overview', 'request-flow': 'flow-lab', 'data-flow': 'flow-lab' }
const isMode = (value: string | null): value is ArchitectureMode => architectureModes.some(mode => mode.id === value)
function readMode(): ArchitectureMode {
  const value = new URLSearchParams(window.location.search).get('path')
  return isMode(value) ? value : 'direct'
}

export function ArchitecturePage() {
  const location = useLocation()
  const navigateRouter = useNavigate()
  const [mode, setMode] = useState<ArchitectureMode>(readMode)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const viewportRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const modeInfo = architectureModes.find(item => item.id === mode)!

  const navigate = useCallback((id: SectionId, updateHistory = true, focus = true) => {
    if (updateHistory) {
      const url = new URL(window.location.href)
      url.hash = id === 'overview' ? '' : id
      navigateRouter(url.pathname + url.search + url.hash)
    }
    setActiveSection(id)
    window.requestAnimationFrame(() => {
      const section = document.getElementById(id)
      const viewport = viewportRef.current
      if (!section || !viewport) return
      const top = id === 'overview' ? 0 : viewport.scrollTop + section.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (navRef.current?.offsetHeight ?? 0) - 24
      viewport.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      if (focus) section.focus({ preventScroll: true })
    })
  }, [navigateRouter])

  const changeMode = useCallback((next: ArchitectureMode) => {
    setMode(next)
    const url = new URL(window.location.href)
    if (next === 'direct') url.searchParams.delete('path')
    else url.searchParams.set('path', next)
    navigateRouter(url.pathname + url.search + url.hash, { replace: true })
  }, [navigateRouter])

  useEffect(() => {
    if (location.pathname !== '/architecture') return
    const oldTitle = document.title
    document.title = '系统架构 · Tessmora'
    return () => {
      if (document.title === '系统架构 · Tessmora') document.title = oldTitle
    }
  }, [location.pathname])

  useEffect(() => {
    if (location.pathname === '/architecture') setMode(readMode())
  }, [location.pathname, location.search])

  useEffect(() => {
    if (location.pathname !== '/architecture') return
    const hash = location.hash.slice(1)
    const id = sections.find(item => item.id === hash)?.id ?? legacySections[hash] ?? 'overview'
    navigate(id, false, false)
  }, [location.pathname, location.hash, navigate])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    const update = () => {
      frame = 0
      const line = viewport.getBoundingClientRect().top + (navRef.current?.offsetHeight ?? 0) + 64
      let current: SectionId = 'overview'
      for (const section of sections) {
        const element = document.getElementById(section.id)
        if (element && element.getBoundingClientRect().top <= line) current = section.id
      }
      setActiveSection(current)
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    viewport.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport)
    if (viewport.lastElementChild) observer.observe(viewport.lastElementChild)
    return () => {
      viewport.removeEventListener('scroll', schedule)
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [])

  return <div className="architecture-page architecture-experience h-full min-h-0" data-mode={mode}>
    <div ref={viewportRef} className="architecture-scroll-viewport atlas-viewport">
      <nav ref={navRef} className="atlas-experience-nav" aria-label="架构页目录">
        <a className="atlas-nav-brand" href="#overview" onClick={event => { event.preventDefault(); navigate('overview') }} aria-label="回到系统全貌"><Layers3 size={18} aria-hidden="true" /><span>架构图谱</span></a>
        <div className="atlas-experience-links">{sections.map(({ id, name }) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} onClick={event => { event.preventDefault(); navigate(id) }}>{name}</a>)}</div>
        <label className="atlas-global-mode"><span className="sr-only">全页执行路径</span><select value={mode} onChange={event => { if (isMode(event.target.value)) changeMode(event.target.value) }} aria-label="全页执行路径">{architectureModes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></label>
      </nav>
      <div className="atlas-experience-content">
        <section id="overview" className="atlas-experience-hero" tabIndex={-1}>
          <div className="atlas-hero-masthead"><span>TESSMORA / 架构</span><a href={architectureSourceUrl('docs/MMA_ARCHITECTURE.md')} target="_blank" rel="noreferrer">架构文档<ExternalLink size={12} aria-hidden="true" /></a></div>
          <div className="atlas-hero-introduction">
            <div><h1>从多模态资料，<br />到<span>可追溯回答。</span></h1></div>
            <div className="atlas-hero-context"><p>文档、表格、图片、声音与镜头，<br className="atlas-desktop-break" />在各自的轨道上被理解，成为可定位的证据。</p><button type="button" onClick={() => navigate('flow-lab')}>跟随一份证据<ArrowDown size={15} aria-hidden="true" /></button></div>
          </div>
          <div className="atlas-mode-options" role="group" aria-label="选择架构执行路径">{architectureModes.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} data-mode={item.id} onClick={() => changeMode(item.id)}><span className="atlas-mode-symbol" aria-hidden="true">{item.id === 'pi' ? 'π' : item.id === 'agent' ? <Bot size={18} /> : <Search size={18} />}</span><span><strong>{item.name}<small>{item.label}</small></strong><span>{item.summary}</span></span><span className="atlas-mode-dot" aria-hidden="true" /></button>)}</div>
          <ArchitectureMap mode={mode} />
          <div className="atlas-hero-caption"><span>架构说明 · 非实时运行状态</span><span>原件保留 / 索引复用 / 来源回溯</span></div>
        </section>
        <section id="flow-lab" className="atlas-experience-section" tabIndex={-1}><EvidenceJourney mode={mode} /></section>
        <section id="modules" className="atlas-experience-section" tabIndex={-1}><ArchitectureDetails mode={mode} /></section>
        <section id="tech-stack" className="atlas-experience-section" tabIndex={-1}><ArchitectureRuntime mode={mode} /></section>
        <footer className="atlas-experience-footer"><div><BookOpenText size={19} aria-hidden="true" /><span><strong>答案背后，每份素材都有来处。</strong><small>内容核对 <time dateTime={architectureReviewDate}>{architectureReviewDate.replace(/-/g, '.')}</time> · 当前阅读 {modeInfo.name}</small></span></div><button type="button" onClick={() => navigate('overview')}>回到顶部<ArrowUp size={15} aria-hidden="true" /></button></footer>
      </div>
    </div>
  </div>
}
