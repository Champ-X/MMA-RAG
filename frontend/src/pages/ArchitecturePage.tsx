import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, Github, List } from 'lucide-react'
import { translate as t, useTranslation } from '@/i18n'
import { ArchitectureBlueprint } from '@/components/architecture/ArchitectureBlueprint'
import { ArchitectureDetails } from '@/components/architecture/ArchitectureDetails'
import { ArchitectureRuntime } from '@/components/architecture/ArchitectureRuntime'
import { architectureModes, architectureSourceUrl, type ArchitectureMode } from '@/data/architectureExperience'
import { AtlasOverview } from '@/components/architecture/color-atlas/AtlasOverview'
import { AtlasParsing, type AtlasMaterial } from '@/components/architecture/color-atlas/AtlasParsing'
import { AtlasStorage, AtlasRetrieval, AtlasRuntime } from '@/components/architecture/color-atlas/AtlasSystems'
import { AtlasPrinciples, AtlasResearch, AtlasCitations } from '@/components/architecture/color-atlas/AtlasNarratives'
import { readAtlasScroll, saveAtlasScroll } from '@/components/architecture/color-atlas/useAtlasSelection'
import '@/components/architecture/architectureFonts.css'
import '@/components/architecture/color-atlas/colorAtlas.css'
import '@/components/architecture/color-atlas/atlasOverview.css'
import '@/components/architecture/color-atlas/atlasExploration.css'

const chapters = [
  { id: 'overview', name: ['总览', 'Overview'], title: ['', ''], lead: ['', ''] },
  { id: 'idea', name: ['设计出发点', 'Principles'], title: ['能被找到，也能被核对。', 'Made to be found. Ready to be checked.'], lead: ['资料怎样变得可搜索，又保留可核对的原貌？', 'How can sources become searchable and remain verifiable?'] },
  { id: 'materials', name: ['分模态解析', 'Parsing'], title: ['每一种资料，都有自己的语言。', 'Every medium has a language.'], lead: ['保留结构，读懂内容，再把它变成可以寻找的线索。', 'Keep its structure, understand its content, then make it discoverable.'] },
  { id: 'storage', name: ['存储与索引', 'Storage'], title: ['原件与索引，\n由来源相连。', 'Originals and indexes.\nConnected by their source.'], lead: ['原文件与搜索索引分别存在哪里，又怎样相连？', 'Where do originals and indexes live, and what connects them?'] },
  { id: 'retrieval', name: ['多路检索', 'Retrieval'], title: ['一个问题，\n多种线索。', 'One question.\nMany kinds of clues.'], lead: ['一个问题，怎样找到文字、画面与声音里的线索？', 'How does a question find clues in words, images and sound?'] },
  { id: 'paths', name: ['问答与研究', 'Research'], title: ['让问题决定，\n还要走多远。', 'Let the question decide\nhow far to go.'], lead: ['什么时候直接回答，什么时候需要继续研究？', 'When is a direct answer enough, and when should research continue?'] },
  { id: 'evidence', name: ['回答与引用', 'Citations'], title: ['沿着引用，\n回到原处。', 'Follow a citation\nback to its source.'], lead: ['一句回答，怎样回到支持它的原文与具体位置？', 'How does an answer lead back to its source and location?'] },
  { id: 'system', name: ['运行与边界', 'Runtime'], title: ['看清系统，\n也看清边界。', 'See the system.\nUnderstand its limits.'], lead: ['服务如何协作，出错后又能恢复到哪里？', 'How do the services cooperate, and what survives a failure?'] },
] as const
const legacyChapters: Record<string, string> = { 'flow-lab': 'evidence', 'request-flow': 'evidence', 'data-flow': 'evidence', 'system-architecture': 'system', modules: 'system', 'tech-stack': 'system' }
const materialKinds: readonly AtlasMaterial[] = ['document', 'table', 'image', 'audio', 'video']

export function ArchitecturePage() {
  const { i18n } = useTranslation()
  const text = (zh: string, en: string) => i18n.language.startsWith('en') ? en : zh
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const [contentsOpen, setContentsOpen] = useState(false)
  const contentsButtonRef = useRef<HTMLButtonElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const focusAfterNavigation = useRef(false)
  const previousChapter = useRef('')
  const hash = location.hash.slice(1)
  const chapterId = legacyChapters[hash] ?? hash
  const chapterIndex = Math.max(0, chapters.findIndex(item => item.id === chapterId))
  const chapter = chapters[chapterIndex]
  const scrollKey = chapter.id + location.search
  const query = new URLSearchParams(location.search)
  const path = query.get('path')
  const material = materialKinds.find(kind => kind === query.get('material')) ?? 'document'
  const mode: ArchitectureMode = architectureModes.some(item => item.id === path) ? path as ArchitectureMode : 'direct'
  const href = (id: string) => `${location.pathname}${location.search}${id === 'overview' ? '' : `#${id}`}`
  const go = (index: number, kind?: AtlasMaterial) => {
    if (index < 0 || index >= chapters.length) return
    saveAtlasScroll(scrollKey, viewportRef.current?.scrollTop ?? 0)
    setContentsOpen(false)
    focusAfterNavigation.current = true
    if (kind) {
      const params = new URLSearchParams(location.search)
      params.set('material', kind)
      navigate(`${location.pathname}?${params}#${chapters[index].id}`)
    } else navigate(href(chapters[index].id))
  }
  const changeMaterial = (next: AtlasMaterial) => {
    const params = new URLSearchParams(location.search)
    if (next === 'document') params.delete('material')
    else params.set('material', next)
    navigate(`${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`, { replace: true })
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

  useLayoutEffect(() => {
    if (location.pathname !== '/architecture') return
    const chapterChanged = previousChapter.current !== chapter.id
    if (chapterChanged || navigationType === 'POP') {
      const top = navigationType === 'POP' ? readAtlasScroll(scrollKey) : 0
      if (viewportRef.current) viewportRef.current.scrollTop = top
    }
    if (focusAfterNavigation.current || (previousChapter.current && previousChapter.current !== chapter.id)) {
      viewportRef.current?.querySelector<HTMLElement>('#book-heading')?.focus({ preventScroll: true })
    }
    previousChapter.current = chapter.id
    focusAfterNavigation.current = false
    const selected = navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
  }, [chapter.id, location.pathname, location.key, navigationType, scrollKey])

  useEffect(() => {
    if (!['modules', 'tech-stack', 'system-architecture'].includes(hash)) return
    const frame = requestAnimationFrame(() => viewportRef.current?.querySelector<HTMLElement>(`#${hash}`)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [hash])

  return <div className="architecture-page color-atlas h-full min-h-0" data-chapter={chapter.id} lang={i18n.language.startsWith('en') ? 'en' : 'zh-CN'}>
    <header className="ca-masthead">
      <a href={href('overview')} onClick={event => { event.preventDefault(); go(0) }} className="ca-wordmark"><strong>Tessmora</strong><span>{text('设计与实现', 'Design & implementation')}</span></a>
      <a className="ca-github" href={architectureSourceUrl('README.md')} target="_blank" rel="noreferrer"><Github size={19} aria-hidden="true" /><span>GitHub</span><ArrowUpRight size={12} aria-hidden="true" /></a>
    </header>
    <div className="ca-mobile-contents"><span><small>{String(chapterIndex + 1).padStart(2, '0')} / 08</small><strong>{text(chapter.name[0], chapter.name[1])}</strong></span><button ref={contentsButtonRef} type="button" aria-expanded={contentsOpen} aria-controls="atlas-contents" onClick={() => setContentsOpen(open => !open)}><List size={16} aria-hidden="true" />{text('目录', 'Contents')}<ChevronDown size={14} aria-hidden="true" /></button></div>
    <nav ref={navigationRef} id="atlas-contents" className={`ca-chapters ${contentsOpen ? 'is-open' : ''}`} onKeyDown={event => { if (event.key === 'Escape') { setContentsOpen(false); contentsButtonRef.current?.focus() } }} aria-label={text('内容导航', 'Topic navigation')}>
      {chapters.map((item, index) => <a key={item.id} href={href(item.id)} aria-current={index === chapterIndex ? 'page' : undefined} onClick={event => { event.preventDefault(); go(index) }}>{text(item.name[0], item.name[1])}</a>)}
    </nav>
    <div ref={viewportRef} className="ca-reading-viewport architecture-scroll-viewport" onScroll={event => saveAtlasScroll(scrollKey, event.currentTarget.scrollTop)} tabIndex={0} aria-label={text('正文', 'Content')}>
      <article key={chapter.id} className={`ca-page ca-page-${chapter.id}`} aria-labelledby="book-heading" data-chapter={chapter.id}>
        {chapterIndex === 0 ? <AtlasOverview text={text} onExplore={go} /> : <>
          {chapter.id !== 'materials' && <div className="ca-chapter-heading"><h1 id="book-heading" tabIndex={-1}>{text(chapter.title[0], chapter.title[1])}</h1><p>{text(chapter.lead[0], chapter.lead[1])}</p></div>}
          {chapter.id === 'idea' && <AtlasPrinciples text={text} />}
          {chapter.id === 'materials' && <AtlasParsing text={text} kind={material} onKindChange={changeMaterial} />}
          {chapter.id === 'storage' && <AtlasStorage text={text} />}
          {chapter.id === 'retrieval' && <AtlasRetrieval text={text} />}
          {chapter.id === 'paths' && <AtlasResearch text={text} mode={mode} onModeChange={changeMode} />}
          {chapter.id === 'evidence' && <AtlasCitations text={text} />}
          {chapter.id === 'system' && <><AtlasRuntime text={text} /><section className="ca-appendices"><h2>{text('进一步，走进实现。', 'A closer look at the implementation.')}</h2>
            <details id="system-architecture" className="ca-appendix book-appendix" open={hash === 'system-architecture' || undefined}><summary>{text('系统全景', 'System map')}</summary><ArchitectureBlueprint /></details>
            <details id="modules" className="ca-appendix book-appendix" open={hash === 'modules' || undefined}><summary>{text('模块与源码', 'Modules & source')}</summary><ArchitectureDetails mode={mode} /></details>
            <details id="tech-stack" className="ca-appendix book-appendix" open={hash === 'tech-stack' || undefined}><summary>{text('运行配置与恢复约定', 'Runtime configuration & recovery')}</summary><ArchitectureRuntime mode={mode} /></details>
          </section></>}
        </>}
        <footer className="ca-pagination" aria-label={text('内容切换', 'Topic navigation controls')}>
          <button type="button" className="book-prev" disabled={chapterIndex === 0} onClick={() => go(chapterIndex - 1)}><ArrowLeft size={16} aria-hidden="true" /><span>{chapterIndex > 0 ? text(chapters[chapterIndex - 1].name[0], chapters[chapterIndex - 1].name[1]) : text('总览', 'Overview')}</span></button>
          <span className="ca-page-position" style={{ '--ca-progress': `${(chapterIndex + 1) / chapters.length * 100}%` } as CSSProperties}>{String(chapterIndex + 1).padStart(2, '0')}<i aria-hidden="true" />08</span>
          <button type="button" className="book-next" onClick={() => go(chapterIndex === chapters.length - 1 ? 0 : chapterIndex + 1)}><span>{chapterIndex === chapters.length - 1 ? text('回到总览', 'Back to overview') : text(chapters[chapterIndex + 1].name[0], chapters[chapterIndex + 1].name[1])}</span><ArrowRight size={16} aria-hidden="true" /></button>
        </footer>
      </article>
    </div>
  </div>
}
