import '@/components/architecture/architecture.css'
import { translate as t, useTranslation } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { EditorialArtwork } from '@/components/architecture/EditorialFigures'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { ArchitectureBlueprint } from '@/components/architecture/ArchitectureBlueprint'
import { ArchitectureDetails } from '@/components/architecture/ArchitectureDetails'
import { ArchitectureRuntime } from '@/components/architecture/ArchitectureRuntime'
import { ParsingChapter } from '@/components/architecture/ParsingChapter'
import { StorageChapter } from '@/components/architecture/StorageChapter'
import { RetrievalChapter } from '@/components/architecture/RetrievalChapter'
import { PathsChapter } from '@/components/architecture/PathsChapter'
import { DesignChapter, EvidenceChapter, RuntimeChapter } from '@/components/architecture/NarrativeChapters'
import { architectureModes, architectureSourceUrl, type ArchitectureMode } from '@/data/architectureExperience'
import '@/components/architecture/architectureFonts.css'
import '@/components/architecture/architectureBook.css'
import '@/components/architecture/architectureIllustrated.css'

type BookText = (zh: string, en: string) => string
const chapters = [
  { id: 'overview', name: ['总览', 'Overview'], title: ['', ''], lead: ['', ''] },
  { id: 'idea', name: ['设计出发点', 'Design principles'], title: ['资料很多，然后呢？', 'Plenty of material. Now what?'], lead: ['从保存资料，到组织可以核对的证据。', 'From stored material to evidence we can inspect.'] },
  { id: 'materials', name: ['分模态解析', 'Parsing by modality'], title: ['每一种资料，都有自己的语言。', 'Every medium has a language.'], lead: ['从文档结构到视频镜头，理解内容，也保留它发生的位置。', 'From document structure to video shots: understand the content and retain its location.'] },
  { id: 'storage', name: ['存储与索引', 'Storage & indexes'], title: ['保存原件，也保存找到它的路。', 'Keep the original. Keep a way to find it.'], lead: ['原文件、派生素材、搜索表示和运行记录，各自承担不同的职责。', 'Originals, derived assets, searchable representations and run records have distinct responsibilities.'] },
  { id: 'retrieval', name: ['多路检索', 'Retrieval channels'], title: ['一个问题，需要不止一种线索。', 'One question. Several kinds of clues.'], lead: ['理解不同召回方式能找到什么，再看它们如何被选择、合并和排序。', 'Understand what each channel can find, then how results are selected, combined and ranked.'] },
  { id: 'paths', name: ['问答与研究', 'Answers & research'], title: ['有些问题，值得多走一步。', 'Some questions deserve another step.'], lead: ['聚焦回答、有界补查与自主研究，采用不同的执行方式。', 'Focused answers, bounded follow-up and independent research take different execution paths.'] },
  { id: 'evidence', name: ['回答与引用', 'Answers & citations'], title: ['一个答案，应该经得起回看。', 'An answer worth looking into.'], lead: ['从候选材料，到模型上下文，再到真正出现在回答中的引用。', 'From candidate material to model context and the citations actually used in an answer.'] },
  { id: 'system', name: ['运行与边界', 'Runtime & boundaries'], title: ['把这些想法，变成一个系统。', 'Turning these ideas into a system.'], lead: ['服务分工、模型接入与恢复行为，决定这些设计怎样运行。', 'Service responsibilities, model integrations and recovery behavior bring the design into operation.'] },
] as const
const legacyChapters: Record<string, string> = { 'flow-lab': 'evidence', 'request-flow': 'evidence', 'data-flow': 'evidence', 'system-architecture': 'system', modules: 'system', 'tech-stack': 'system' }

function SourceLink({ path, children }: { path: string; children: React.ReactNode }) {
  return <a className="book-source-link" href={architectureSourceUrl(path)} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14} aria-hidden="true" /></a>
}

export function ArchitecturePage() {
  const { i18n } = useTranslation()
  const text: BookText = (zh, en) => i18n.language.startsWith('en') ? en : zh
  const location = useLocation()
  const navigate = useNavigate()
  const hash = location.hash.slice(1)
  const chapterId = legacyChapters[hash] ?? hash
  const chapterIndex = Math.max(0, chapters.findIndex(chapter => chapter.id === chapterId))
  const chapter = chapters[chapterIndex]
  const path = new URLSearchParams(location.search).get('path')
  const mode: ArchitectureMode = architectureModes.some(item => item.id === path) ? path as ArchitectureMode : 'direct'
  const viewportRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [outline, setOutline] = useState<{ id: string; title: string }[]>([])
  const [activeSection, setActiveSection] = useState('')
  const previousChapter = useRef(chapterIndex)
  const focusOnNavigation = useRef(false)
  const direction = chapterIndex >= previousChapter.current ? 'forward' : 'backward'
  const href = (id: string) => `${location.pathname}${location.search}${id === 'overview' ? '' : `#${id}`}`
  const go = (index: number) => {
    focusOnNavigation.current = true
    viewportRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    navigate(href(chapters[index].id))
  }
  const changeMode = (next: ArchitectureMode) => {
    const params = new URLSearchParams(location.search)
    if (next === 'direct') params.delete('path')
    else params.set('path', next)
    navigate(`${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`, { replace: true })
  }

  useEffect(() => {
    if (location.pathname !== '/architecture') return
    const previous = document.title
    const title = t('系统架构 · Tessmora')
    document.title = title
    return () => { if (document.title === title) document.title = previous }
  }, [location.pathname, i18n.language])

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    if (focusOnNavigation.current || previousChapter.current !== chapterIndex) headingRef.current?.focus({ preventScroll: true })
    focusOnNavigation.current = false
    previousChapter.current = chapterIndex
  }, [chapterIndex])

  useEffect(() => {
    const headings = [...(viewportRef.current?.querySelectorAll<HTMLElement>('h2') ?? [])].filter(heading => !heading.closest('.book-appendix'))
    setOutline(headings.map((heading, index) => {
      heading.id = `section-${chapter.id}-${index}`
      heading.tabIndex = -1
      return { id: heading.id, title: heading.textContent ?? '' }
    }))
    setActiveSection('')
  }, [chapter.id, i18n.language, mode])

  const jumpToSection = (id: string) => {
    const viewport = viewportRef.current
    const target = viewport?.querySelector<HTMLElement>(`#${id}`)
    if (!viewport || !target) return
    viewport.scrollTo({ top: target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 28,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    target.focus({ preventScroll: true })
    setActiveSection(id)
  }
  const trackSection = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const threshold = viewport.getBoundingClientRect().top + 160
    const headings = [...viewport.querySelectorAll<HTMLElement>('h2')].filter(heading => !heading.closest('.book-appendix'))
    const passed = headings.filter(heading => heading.getBoundingClientRect().top <= threshold)
    const current = passed[passed.length - 1]
    setActiveSection(current?.id ?? '')
  }

  useEffect(() => {
    if (!['modules', 'tech-stack', 'system-architecture'].includes(hash)) return
    const frame = window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }))
    return () => window.cancelAnimationFrame(frame)
  }, [hash])

  return <div className="architecture-page architecture-experience architecture-book h-full min-h-0">
    <header className="book-masthead">
      <a className="book-masthead-title" href={href('overview')} onClick={event => { event.preventDefault(); go(0) }}>
        <strong>{text('设计与实现', 'Design & implementation')}</strong>
      </a>
      <div className="book-header-actions">
        <SourceLink path="README.md">GitHub</SourceLink>
      </div>
    </header>
    <div className="book-mobile-navigation">
      <button onClick={() => go(chapterIndex - 1)} disabled={chapterIndex === 0} aria-label={text('上一节', 'Previous topic')}><ChevronLeft size={20} aria-hidden="true" /></button>
      <label><select aria-label={text('选择主题', 'Choose a topic')} value={chapterIndex} onChange={event => go(Number(event.target.value))}>{chapters.map((item, index) => <option key={item.id} value={index}>{index === 0 ? '' : `0${index} · `}{text(item.name[0], item.name[1])}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></label>
      <button onClick={() => go(chapterIndex === chapters.length - 1 ? 0 : chapterIndex + 1)} aria-label={text('下一节', 'Next topic')}><ChevronRight size={20} aria-hidden="true" /></button>
    </div>
    <div className="book-layout">
      <div className="book-sidebar">
        <nav aria-label={text('内容导航', 'Topic navigation')}>
          {chapters.map((item, index) => <a key={item.id} href={href(item.id)} aria-current={index === chapterIndex ? 'page' : undefined} onClick={event => { event.preventDefault(); go(index) }}><span className="book-index">{index === 0 ? '—' : `0${index}`}</span><span>{text(item.name[0], item.name[1])}</span><ChevronRight className="book-nav-arrow" size={15} aria-hidden="true" /></a>)}
        </nav>
        {chapterIndex > 0 && outline.length > 0 && <div className="book-outline" role="navigation" aria-label={text('本节内容', 'In this topic')}><h3>{text('本节内容', 'In this topic')}</h3>{outline.map(item => <button key={item.id} type="button" aria-current={activeSection === item.id ? 'location' : undefined} onClick={() => jumpToSection(item.id)}>{item.title}</button>)}</div>}
      </div>
      <div ref={viewportRef} className="book-reading-viewport architecture-scroll-viewport" onScroll={trackSection} tabIndex={0} aria-label={text('正文', 'Content')}>
        <article key={chapter.id} className={`book-page ${chapterIndex === 0 ? 'book-cover-page' : ''}`} data-direction={direction} data-chapter={chapter.id} aria-labelledby="book-heading">
          {chapterIndex === 0 ? <>
            <div className="book-cover-spread">
              <div className="book-cover-copy">
                <h1 id="book-heading" ref={headingRef} tabIndex={-1}>{text('知识各有形态，', 'Knowledge takes many forms.')}<br /><span>{text('答案应有来处。', 'Answers need a source.')}</span></h1>
                <p>{text('一份文档、一张图片、一段声音。', 'A document. An image. A fragment of sound.')}<br />{text('散落的资料，如何成为可以对话的知识？', 'How can scattered material become knowledge you can talk to?')}</p>
                <p className="book-cover-invitation">{text('理解 Tessmora 如何解析多模态资料、组织索引、寻找证据，再把它们变成有出处的回答。', 'Explore how Tessmora parses multimodal material, organizes indexes, finds evidence and builds answers with sources.')}</p>
                <button className="book-start" type="button" onClick={() => go(1)}>{text('从设计出发点开始', 'Explore the design')}<ArrowRight size={18} aria-hidden="true" /></button>
              </div>
              <figure className="book-cover-art"><img src="/architecture/evidence-sculpture.webp" width="1280" height="960" alt={text('文档、图像、声音和视频，由紫色丝带连接到同一个知识容器。', 'Documents, images, sound and video connected by violet ribbons to a shared knowledge container.')} loading="eager" decoding="async" /><figcaption>{text('不同的形态，共同的来处。', 'Different forms. Connected sources.')}</figcaption></figure>
            </div>
            <nav className="overview-routes" aria-label={text('探索架构主题', 'Explore architecture topics')}>
              {[
                { title: text('资料如何被理解', 'How material is understood'), detail: text('从解析结构，到可以搜索的表示。', 'From parsed structure to searchable representations.'), links: [2, 3] },
                { title: text('问题如何找到依据', 'How questions find evidence'), detail: text('比较检索视角，选择研究的深度。', 'Compare retrieval perspectives and research depth.'), links: [4, 5] },
                { title: text('回答如何经得起回看', 'How answers remain inspectable'), detail: text('追溯来源，理解系统的运行边界。', 'Trace sources and understand runtime boundaries.'), links: [6, 7] },
              ].map(item => <div key={item.title}><h2>{item.title}</h2><p>{item.detail}</p><div>{item.links.map(index => <a key={index} href={href(chapters[index].id)} onClick={event => { event.preventDefault(); go(index) }}>{text(chapters[index].name[0], chapters[index].name[1])}<ArrowUpRight size={13} aria-hidden="true" /></a>)}</div></div>)}
            </nav>
          </> : <>
            <div className={`book-chapter-opening ${['idea', 'evidence'].includes(chapter.id) ? 'book-chapter-opening--illustrated' : ''}`}><div><h1 id="book-heading" ref={headingRef} tabIndex={-1}>{text(chapter.title[0], chapter.title[1])}</h1><p className="book-chapter-lead">{text(chapter.lead[0], chapter.lead[1])}</p></div>{chapter.id === 'idea' && <EditorialArtwork kind="representation" text={text} />}{chapter.id === 'evidence' && <EditorialArtwork kind="evidence" text={text} />}</div>
            {chapter.id === 'idea' && <DesignChapter text={text} />}
            {chapter.id === 'materials' && <ParsingChapter text={text} />}
            {chapter.id === 'storage' && <StorageChapter text={text} />}
            {chapter.id === 'retrieval' && <RetrievalChapter text={text} />}
            {chapter.id === 'paths' && <PathsChapter text={text} mode={mode} onModeChange={changeMode} />}
            {chapter.id === 'evidence' && <EvidenceChapter text={text} />}
            {chapter.id === 'system' && <div className="book-system">
              <RuntimeChapter text={text} />
              <div className="book-further-reading"><h2>{text('系统全景与源码索引', 'System map and source index')}</h2><p>{text('把前面的设计放在一起，查看模块之间的连接。', 'Bring the design together and inspect the connections between modules.')}</p>
                <details id="system-architecture" className="book-appendix" open={hash === 'system-architecture' || undefined}><summary><span>{text('展开系统全景', 'Explore the system map')}</span><ChevronDown size={18} aria-hidden="true" /></summary><div><ArchitectureBlueprint /></div></details>
                <details id="modules" className="book-appendix" open={hash === 'modules' || undefined}><summary><span>{text('查看模块与源码', 'Read the modules and source')}</span><ChevronDown size={18} aria-hidden="true" /></summary><div><ArchitectureDetails mode={mode} /></div></details>
                <details id="tech-stack" className="book-appendix" open={hash === 'tech-stack' || undefined}><summary><span>{text('查看运行配置与恢复约定', 'Inspect runtime and recovery details')}</span><ChevronDown size={18} aria-hidden="true" /></summary><div><ArchitectureRuntime mode={mode} /></div></details>
              </div>
              <div className="book-colophon"><a href="/" onClick={event => { event.preventDefault(); navigate('/') }}>{text('回到对话', 'Return to chat')}<ArrowUpRight size={17} aria-hidden="true" /></a><SourceLink path="docs/MMA_ARCHITECTURE.md">{text('完整技术文档', 'Full technical documentation')}</SourceLink></div>
            </div>}
          </>}
          <footer className="book-pagination" aria-label={text('内容切换', 'Topic navigation controls')}>
            <button type="button" className="book-prev" aria-label={chapterIndex === 1 ? text('回到总览', 'Back to overview') : text('上一节', 'Previous topic')} disabled={chapterIndex === 0} onClick={() => go(chapterIndex - 1)}><ArrowLeft size={16} aria-hidden="true" /><span>{chapterIndex === 1 ? text('回到总览', 'Back to overview') : text('上一节', 'Previous topic')}</span></button>
            <span className="book-page-indicator">{text(chapter.name[0], chapter.name[1])}<span>{chapterIndex === 0 ? 'TESSMORA' : `${String(chapterIndex).padStart(2, '0')} / 07`}</span></span>
            <button type="button" className="book-next" onClick={() => go(chapterIndex === chapters.length - 1 ? 0 : chapterIndex + 1)}><span>{chapterIndex === chapters.length - 1 ? text('回到总览', 'Return to overview') : text(chapters[chapterIndex + 1].name[0], chapters[chapterIndex + 1].name[1])}</span><ArrowRight size={17} aria-hidden="true" /></button>
          </footer>
        </article>
      </div>
    </div>

  </div>
}
