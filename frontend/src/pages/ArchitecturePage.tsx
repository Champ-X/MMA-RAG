import { translate as t, useTranslation } from '@/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, BookOpenText, ChevronDown, Layers3, ArrowUpRight, FileText, ScanLine, Network, Quote } from 'lucide-react'
import { ArchitecturePrinciples } from '@/components/architecture/ArchitecturePrinciples'
import { ArchitectureBlueprint } from '@/components/architecture/ArchitectureBlueprint'
import { ArchitectureMap } from '@/components/architecture/ArchitectureMap'
import { EvidenceJourney } from '@/components/architecture/EvidenceJourney'
import { ArchitectureDetails } from '@/components/architecture/ArchitectureDetails'
import { ArchitectureRuntime } from '@/components/architecture/ArchitectureRuntime'
import { architectureModes, architectureReviewDate, architectureSourceUrl, type ArchitectureMode } from '@/data/architectureExperience'
import '@/components/architecture/architecture.css'

const sections = [
  { id: 'overview', name: '设计思想' },
  { id: 'system', name: '架构全貌' },
  { id: 'paths', name: '执行路径' },
  { id: 'flow-lab', name: '证据之旅' },
  { id: 'modules', name: '模块实现' },
  { id: 'tech-stack', name: '运行边界' },
] as const
type SectionId = typeof sections[number]['id']
const legacySections: Record<string, SectionId> = { 'system-architecture': 'system', 'request-flow': 'flow-lab', 'data-flow': 'flow-lab' }
const isMode = (value: string | null): value is ArchitectureMode => architectureModes.some(mode => mode.id === value)
function readMode(): ArchitectureMode {
  const value = new URLSearchParams(window.location.search).get('path')
  return isMode(value) ? value : 'direct'
}

export function ArchitecturePage() {
  const { i18n } = useTranslation()
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
    const title = t("系统架构 · Tessmora")
    document.title = title
    return () => {
      if (document.title === title) document.title = oldTitle
    }
  }, [location.pathname, i18n.language])

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
      <nav ref={navRef} className="atlas-experience-nav" aria-label={t("架构页目录")}>
        <a className="atlas-nav-brand" href="#overview" onClick={event => { event.preventDefault(); navigate('overview') }} aria-label={t("回到系统全貌")}><Layers3 size={18} aria-hidden="true" /><span>{t("系统架构")}</span></a>
        <div className="atlas-experience-links">{sections.map(({ id, name }) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} onClick={event => { event.preventDefault(); navigate(id) }}>{t(name || '')}</a>)}</div>
        <label className="atlas-global-mode"><span className="sr-only">{t("全页执行路径")}</span><select value={mode} onChange={event => { if (isMode(event.target.value)) changeMode(event.target.value) }} aria-label={t("全页执行路径")}>{architectureModes.map(item => <option key={item.id} value={item.id}>{t(item.name || '')}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></label>
      </nav>
      <div className="atlas-experience-content">
        <section id="overview" className="atlas-experience-hero" tabIndex={-1}>
          <div className="atlas-cover">
            <div className="atlas-cover-copy">
              <h1>{t("知识各有形态，")}<br />{t("答案应有来处。")}</h1>
              <p>{t("Tessmora 的架构，围绕证据展开。")}<br />{t("以多模态索引组织资料，用分层检索与独立 Agent 推进问答和研究，让结论始终连接来源。")}</p>
              <div className="atlas-cover-actions"><button type="button" onClick={() => navigate('system')}>{t("探索系统架构")}<ArrowDown size={16} aria-hidden="true" /></button><a href={architectureSourceUrl('docs/MMA_ARCHITECTURE.md')} target="_blank" rel="noreferrer">{t("阅读技术文档")}<ArrowUpRight size={16} aria-hidden="true" /></a></div>
            </div>
            <div className="atlas-cover-art"><img src="/architecture/evidence-sculpture.webp" width="1280" height="960" alt="" loading="eager" decoding="async" /><span>{t("异构材料，沿证据连接。")}</span></div>
          </div>
          <div className="atlas-design-thread" aria-label={t("项目的设计主线")}>
            <span><FileText size={18} aria-hidden="true" /><strong>{t("保留原件")}</strong><small>{t("让来源可复读")}</small></span>
            <span><ScanLine size={18} aria-hidden="true" /><strong>{t("理解模态")}</strong><small>{t("保留模态线索")}</small></span>
            <span><Network size={18} aria-hidden="true" /><strong>{t("组织证据")}</strong><small>{t("让研究可推进")}</small></span>
            <span><Quote size={18} aria-hidden="true" /><strong>{t("回到来源")}</strong><small>{t("让结论可核对")}</small></span>
          </div>
          <ArchitecturePrinciples />
        </section>
        <section id="system" className="atlas-experience-section atlas-system-section" tabIndex={-1}>
          <div className="atlas-section-intro"><h2>{t("从资料入库，到有据可查的回答")}</h2><p>{t("资料入库形成可定位的索引；Direct、Agent 与 Pi 按各自的执行方式取证，共用原件与知识数据。")}</p></div>
          <ArchitectureBlueprint />
        </section>
        <section id="paths" className="atlas-experience-section" tabIndex={-1}>
          <div className="atlas-section-intro"><h2>{t("为不同问题，选择合适的取证深度")}</h2><p>{t("从一次检索到多轮补查，再到自主研究。切换路径，查看控制方式、生成职责与适用问题。")}</p></div>
          <ArchitectureMap mode={mode} onModeChange={changeMode} />
          <div className="atlas-hero-caption"><span>{t("常规 Auto 在 Direct 与 Agent 之间选择；Pi 单独开启。")}</span><button type="button" onClick={() => navigate('flow-lab')}>{t("跟随一次问答")}<ArrowDown size={15} aria-hidden="true" /></button></div>
        </section>
        <section id="flow-lab" className="atlas-experience-section" tabIndex={-1}><EvidenceJourney mode={mode} /></section>
        <section id="modules" className="atlas-experience-section" tabIndex={-1}><ArchitectureDetails mode={mode} /></section>
        <section id="tech-stack" className="atlas-experience-section" tabIndex={-1}><ArchitectureRuntime mode={mode} /></section>
        <footer className="atlas-experience-footer"><div><BookOpenText size={19} aria-hidden="true" /><span><strong>{t("读懂架构，也看清能力的边界。")}</strong><small>{t("内容核对")} <time dateTime={architectureReviewDate}>{t(architectureReviewDate.replace(/-/g, '.'))}</time>  {t("· 当前阅读")} {t(modeInfo.name || '')}</small></span></div><button type="button" onClick={() => navigate('overview')}>{t("回到顶部")}<ArrowUp size={15} aria-hidden="true" /></button></footer>
      </div>
    </div>
  </div>
}
