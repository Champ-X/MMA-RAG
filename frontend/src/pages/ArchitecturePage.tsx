import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  BookOpenText,
  Bot,
  CheckCircle2,
  FileText,
  Image,
  Search,
  Sparkles,
  Video,
} from 'lucide-react'
import { architectureSections, coreModules, overviewTags, type ArchitectureSectionId } from '@/data/architectureData'
import { ArchitectureNav } from '@/components/architecture/ArchitectureNav'
import { OverviewSection } from '@/components/architecture/OverviewSection'
import { ArchitectureDiagram } from '@/components/architecture/ArchitectureDiagram'
import { RequestFlowStepper } from '@/components/architecture/RequestFlowStepper'
import { ModuleExplorer } from '@/components/architecture/ModuleExplorer'
import { DataFlowDiagram } from '@/components/architecture/DataFlowDiagram'
import { TechStackSection } from '@/components/architecture/TechStackSection'

export function ArchitecturePage() {
  const [activeSection, setActiveSection] = useState<ArchitectureSectionId>('overview')
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)
  const stickyNavRef = useRef<HTMLDivElement | null>(null)

  const handleNavigate = useCallback((id: ArchitectureSectionId, options: { writeHistory?: boolean } = {}) => {
    setActiveSection(id)
    if (options.writeHistory !== false && window.location.hash !== `#${id}`) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#${id}`)
    }

    // ScrollArea 的实际滚动层是内部 viewport。这里直接持有 viewport ref，避免通过
    // firstElementChild 猜测 DOM 结构，在懒加载/样式调整后导致导航失效。
    window.requestAnimationFrame(() => {
      const section = document.getElementById(id)
      const viewport = scrollViewportRef.current
      if (!section || !viewport) return

      const viewportRect = viewport.getBoundingClientRect()
      const sectionRect = section.getBoundingClientRect()
      const stickyNavHeight = stickyNavRef.current?.getBoundingClientRect().height ?? 0
      const nextTop = viewport.scrollTop + sectionRect.top - viewportRect.top - stickyNavHeight - 18
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      viewport.scrollTo({
        top: Math.max(nextTop, 0),
        behavior: reducedMotion ? 'auto' : 'smooth',
      })
    })
  }, [])

  useEffect(() => {
    const root = scrollViewportRef.current
    if (!root) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => {
            if (b.intersectionRatio !== a.intersectionRatio) {
              return b.intersectionRatio - a.intersectionRatio
            }
            return Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top)
          })

        const id = visible[0]?.target.id as ArchitectureSectionId | undefined
        if (id) setActiveSection(id)
      },
      {
        root,
        rootMargin: '-14% 0px -68% 0px',
        threshold: [0, 0.08, 0.3],
      }
    )

    architectureSections.forEach(({ id }) => {
      const section = document.getElementById(id)
      if (section) observer.observe(section)
    })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const readSectionFromHash = () => {
      const candidate = window.location.hash.replace(/^#/, '') as ArchitectureSectionId
      if (architectureSections.some((section) => section.id === candidate)) {
        handleNavigate(candidate, { writeHistory: false })
      }
    }

    readSectionFromHash()
    window.addEventListener('popstate', readSectionFromHash)
    return () => window.removeEventListener('popstate', readSectionFromHash)
  }, [handleNavigate])

  return (
    <div className="architecture-page h-full min-h-0">
      <div
        ref={scrollViewportRef}
        className="architecture-scroll-viewport h-full overflow-y-auto rounded-[22px] border border-[#cad8d3] bg-[#f3f6f2] shadow-[0_24px_80px_-54px_rgba(16,45,66,0.55)] dark:border-[#1f3d49] dark:bg-[#071a24]"
      >
        <header className="architecture-hero relative overflow-hidden border-b border-[#c9d9d3] dark:border-[#1e414d]">
          <div className="architecture-contours" aria-hidden />
          <div className="relative mx-auto max-w-[1480px] px-5 pb-9 pt-8 sm:px-8 sm:pb-12 sm:pt-10 lg:px-12 lg:pb-16 lg:pt-14 xl:px-16">
            <div className="grid gap-10 2xl:grid-cols-[minmax(25rem,0.82fr)_minmax(36rem,1.18fr)] 2xl:items-center 2xl:gap-14">
              <div className="max-w-[42rem]">
                <div className="flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f7f93] dark:text-[#7fc2cf]">
                  <span className="h-px w-9 bg-current" />
                  Tessmora system atlas
                </div>
                <h1 className="architecture-display mt-6 text-[2.65rem] font-semibold leading-[1.1] tracking-[-0.045em] text-[#102d42] [text-wrap:balance] dark:text-[#eef7f4] sm:text-[4rem] lg:text-[4.35rem] 2xl:text-[4.65rem]">
                  <span className="block">同一份证据，</span>
                  <span className="block text-[#2f7f93] dark:text-[#86c8d3]">恰到好处的推理深度</span>
                </h1>
                <p className="mt-6 max-w-2xl text-[15px] leading-8 text-[#526b72] dark:text-[#afc4c5] sm:text-base">
                  Tessmora 不把多模态素材粗暴压成一种文本。文档、图片、音频与视频先按各自的结构被理解，再汇入同一份可排序、可引用、可回看的证据合同；简单问题一次取证，复杂问题才在严格预算内补查。
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-2" aria-label="支持的证据模态">
                  <Modality icon={<FileText />} label="Document" />
                  <Modality icon={<Image />} label="Image" />
                  <Modality icon={<AudioLines />} label="Audio" />
                  <Modality icon={<Video />} label="Video" />
                </div>

                <div className="mt-8 grid max-w-[37rem] grid-cols-2 overflow-hidden rounded-[18px] border border-[#b8ccc5] bg-white/40 dark:border-[#2d505b] dark:bg-white/[0.035] sm:grid-cols-4">
                  <ArchitectureSignal value="4" label="原生模态" detail="文 · 图 · 声 · 视频" />
                  <ArchitectureSignal value="2" label="执行路径" detail="Direct / Agent" bordered />
                  <ArchitectureSignal value="1" label="证据合同" detail="RetrievalResult" bordered />
                  <ArchitectureSignal value="≤3" label="Agent 轮次" detail="默认硬预算" bordered />
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleNavigate('overview')}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#102d42] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_-18px_rgba(16,45,66,0.9)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93] focus-visible:ring-offset-2 active:translate-y-0 dark:bg-[#dbece7] dark:text-[#102d42] dark:focus-visible:ring-offset-[#071a24]"
                  >
                    阅读系统契约
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNavigate('system-architecture')}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#afc8c2] bg-white/45 px-5 py-2.5 text-sm font-semibold text-[#173b4d] transition-colors hover:border-[#2f7f93] hover:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7f93]/70 dark:border-[#315461] dark:bg-white/[0.04] dark:text-[#dce9e6] dark:hover:bg-white/[0.08]"
                  >
                    查看分层架构
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <SystemThesisMap />
            </div>
          </div>
        </header>

        <div ref={stickyNavRef} className="sticky top-0 z-30 border-b border-[#c7d7d1] bg-[#f3f6f2]/90 backdrop-blur-xl dark:border-[#1e414d] dark:bg-[#071a24]/90">
          <div className="mx-auto max-w-[1480px] px-3 sm:px-7 lg:px-11 xl:px-16">
            <ArchitectureNav
              sections={architectureSections}
              activeId={activeSection}
              onNavigate={handleNavigate}
            />
          </div>
        </div>

        <div className="mx-auto flex max-w-[1480px] flex-col gap-24 px-5 py-14 sm:px-8 sm:py-18 lg:gap-32 lg:px-12 lg:py-24 xl:px-16">
          <ArchitectureReadingGuide />
          <OverviewSection />
          <ArchitectureDiagram />
          <RequestFlowStepper />

          <section id="modules" className="scroll-mt-24">
            <SectionIntro
              eyebrow="Module contracts"
              title={
                <>
                  <span className="block sm:inline">六个领域模块，</span>
                  <span className="block sm:inline">围绕同一份证据合同协作</span>
                </>
              }
              description="模块边界不是代码目录的复述。选择一个模块即可查看它接收什么、需要做出哪些关键决定、最终交付什么，以及这些职责对应到哪些当前代码入口。"
            />
            <ModuleExplorer modules={coreModules} />
          </section>

          <DataFlowDiagram />
          <TechStackSection />

          <footer className="grid gap-4 border-t border-[#c7d7d1] pt-6 text-xs leading-6 text-[#62787d] dark:border-[#244551] dark:text-[#91aaac] sm:grid-cols-[1fr_auto] sm:items-center">
            <span className="inline-flex items-center gap-2">
              <BookOpenText className="h-4 w-4 text-[#2f7f93] dark:text-[#79bdca]" />
              完整实现说明：docs/MMA_ARCHITECTURE.md
            </span>
            <span className="inline-flex items-center gap-2 font-mono text-[11px]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              implementation snapshot · 2026-07-26
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}

function ArchitectureSignal({
  value,
  label,
  detail,
  bordered = false,
}: {
  value: string
  label: string
  detail: string
  bordered?: boolean
}) {
  return (
    <div className={`min-w-0 px-3 py-3 ${bordered ? 'border-l border-[#b8ccc5] dark:border-[#2d505b]' : ''}`}>
      <p className="font-mono text-base font-semibold tracking-[-0.05em] text-[#173b4d] dark:text-[#e4f1ee]">{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-[#4f6f73] dark:text-[#a3bbbc]">{label}</p>
      <p className="mt-1 font-mono text-[9px] leading-4 text-[#789093] dark:text-[#7e9da0]">{detail}</p>
    </div>
  )
}

function ArchitectureReadingGuide() {
  return (
    <aside className="architecture-reading-guide grid gap-5 overflow-hidden rounded-[24px] border border-[#b8ccc5] bg-[#e8f0eb]/75 p-5 shadow-[0_18px_50px_-42px_rgba(16,45,66,0.8)] dark:border-[#2d505b] dark:bg-[#0b2530]/72 sm:p-6 lg:grid-cols-[minmax(17rem,0.55fr)_minmax(0,1fr)] lg:items-center">
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#2f7f93] dark:text-[#83c4cf]">Reading guide</p>
        <h2 className="architecture-display mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#102d42] dark:text-[#eaf4f0]">先找证据主干，再看实现细节</h2>
        <p className="mt-2 text-xs leading-6 text-[#5d7478] dark:text-[#9cb6b7]">顶部目录会滚动到对应章节并同步更新高亮。建议按“系统契约 → 分层架构 → 问答链路 → 模块与边界”的顺序阅读。</p>
      </div>
      <div className="flex flex-wrap content-center gap-2">
        {overviewTags.map((tag) => (
          <span key={tag} className="rounded-full border border-[#bed0ca] bg-white/45 px-3 py-1.5 font-mono text-[10px] font-medium tracking-[-0.02em] text-[#48686d] dark:border-[#31525e] dark:bg-white/[0.035] dark:text-[#a7c0c0]">
            {tag}
          </span>
        ))}
      </div>
    </aside>
  )
}

function SystemThesisMap() {
  return (
    <figure className="architecture-map-shell relative overflow-hidden rounded-[28px] border border-[#afc8c2] bg-[#eef3eb]/90 p-4 shadow-[0_35px_90px_-54px_rgba(16,45,66,0.65)] dark:border-[#315461] dark:bg-[#0d2530]/90 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c5d6d0] pb-4 dark:border-[#294a56]">
        <figcaption>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6d8285] dark:text-[#88a5a7]">System thesis</p>
          <p className="mt-1 text-sm font-semibold text-[#102d42] dark:text-[#e7f1ee]">问题进入，证据返回</p>
        </figcaption>
        <div className="flex items-center gap-4 font-mono text-[10px] font-medium text-[#6d8285] dark:text-[#9ab1b2]">
          <span className="inline-flex items-center gap-1.5"><i className="h-1.5 w-5 rounded-full bg-[#5f8e72]" /> request</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-1.5 w-5 rounded-full bg-[#765c95]" /> evidence</span>
        </div>
      </div>

      <div className="relative mt-5 grid gap-3 md:grid-cols-[0.8fr_1.35fr_0.9fr] md:items-stretch">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-1" aria-label="多模态输入">
          <MapCell icon={<FileText />} title="Documents" detail="structure · sparse" />
          <MapCell icon={<Image />} title="Images" detail="caption · CLIP" />
          <MapCell icon={<AudioLines />} title="Audio" detail="ASR · CLAP" />
          <MapCell icon={<Video />} title="Video" detail="scene · shot" />
        </div>

        <div className="relative flex min-h-[18rem] flex-col justify-between overflow-hidden rounded-[22px] border border-[#95b9b6] bg-[#dfecea] p-4 dark:border-[#37606b] dark:bg-[#12333e] sm:p-5">
          <div className="architecture-orbit" aria-hidden />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#2f7f93] dark:text-[#86c8d3]">Shared substrate</span>
              <Search className="h-4 w-4 text-[#2f7f93] dark:text-[#86c8d3]" />
            </div>
            <h2 className="architecture-display mt-3 text-2xl font-semibold tracking-[-0.035em] text-[#102d42] dark:text-[#eff8f5] sm:text-3xl">Retrieval Core</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#526f74] dark:text-[#a8c0c1]">画像路由 · 五路召回 · RRF · Cross-Encoder</p>
          </div>

          <div className="relative mt-7 grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/75 bg-white/65 p-3 dark:border-white/10 dark:bg-white/[0.06]">
              <div className="flex items-center gap-2 text-[#2f7f93] dark:text-[#83c4cf]">
                <Search className="h-4 w-4" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">Direct</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#18394a] dark:text-[#e5f0ed]">一次完成</p>
              <p className="mt-1 text-xs leading-5 text-[#687e81] dark:text-[#9db4b5]">固定的一次取证路径</p>
            </div>
            <div className="rounded-2xl border border-[#c3b5d3]/80 bg-[#f0eaf4]/75 p-3 dark:border-[#684f83] dark:bg-[#765c95]/15">
              <div className="flex items-center gap-2 text-[#765c95] dark:text-[#c5addb]">
                <Bot className="h-4 w-4" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">Agent</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#342744] dark:text-[#f1eaf6]">有界补查</p>
              <p className="mt-1 text-xs leading-5 text-[#75687f] dark:text-[#beaecd]">复用同一检索器循环取证</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <MapCell icon={<Sparkles />} title="Context" detail="budget · reference map" featured />
          <div className="flex min-h-[8rem] flex-1 flex-col justify-between rounded-[18px] border border-[#e2b592] bg-[#f5e2d4]/80 p-3.5 dark:border-[#754a36] dark:bg-[#e47b4e]/10">
            <Sparkles className="h-5 w-5 text-[#e47b4e]" />
            <div>
              <p className="text-sm font-semibold text-[#5b3323] dark:text-[#f5ded1]">Cited answer</p>
              <p className="mt-1 font-mono text-[10px] leading-5 text-[#8b654f] dark:text-[#c9a594]">thought → citation → message</p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-4 grid gap-2 border-t border-[#c5d6d0] pt-4 dark:border-[#294a56] sm:grid-cols-2" aria-label="请求与证据流向">
        <FlowRail
          label="请求进入"
          detail="sources → retrieval → generation"
          tone="request"
        />
        <FlowRail
          label="证据返回"
          detail="sources ← evidence ← answer"
          tone="evidence"
          reverse
        />
      </div>
    </figure>
  )
}

function FlowRail({
  label,
  detail,
  tone,
  reverse = false,
}: {
  label: string
  detail: string
  tone: 'request' | 'evidence'
  reverse?: boolean
}) {
  return (
    <div className="rounded-xl border border-[#c8d7d1] bg-white/35 px-3.5 py-3 dark:border-[#2c4c58] dark:bg-white/[0.025]">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span className={tone === 'request' ? 'text-xs font-semibold text-[#4f7f63] dark:text-[#8fc09f]' : 'text-xs font-semibold text-[#765c95] dark:text-[#c5addb]'}>
          {label}
        </span>
        <span className="font-mono text-[10px] tracking-[-0.02em] text-[#7b8e90] dark:text-[#829d9f]">{detail}</span>
      </div>
      <span
        aria-hidden
        className={`architecture-flow-rail-line mt-2 ${tone === 'request' ? 'text-[#5f8e72]' : 'text-[#765c95]'} ${reverse ? 'architecture-flow-rail-reverse' : ''}`}
      >
        <span />
      </span>
    </div>
  )
}

function MapCell({
  icon,
  title,
  detail,
  featured = false,
}: {
  icon: React.ReactNode
  title: string
  detail: string
  featured?: boolean
}) {
  return (
    <div className={featured
      ? 'flex min-h-[8rem] flex-col justify-between rounded-[18px] border border-[#c3b5d3] bg-[#eee9f2]/85 p-3.5 dark:border-[#5d4a73] dark:bg-[#765c95]/10'
      : 'rounded-[16px] border border-[#cad8d3] bg-white/55 p-3 dark:border-[#2c4c58] dark:bg-white/[0.035]'}
    >
      <span className={featured ? 'text-[#765c95] dark:text-[#c5addb]' : 'text-[#5f8e72] dark:text-[#8fc09f]'}>
        {icon}
      </span>
      <div className={featured ? 'mt-5' : 'mt-2'}>
        <p className="text-[13px] font-semibold text-[#18394a] dark:text-[#e2efeb]">{title}</p>
        <p className="mt-1 font-mono text-[10px] leading-5 text-[#74878a] dark:text-[#8fa8aa]">{detail}</p>
      </div>
    </div>
  )
}

function Modality({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[#bdcfca] bg-white/50 px-3.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#46656b] dark:border-[#2d505c] dark:bg-white/[0.04] dark:text-[#9db4b5] [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-[#5f8e72] dark:[&_svg]:text-[#8fc09f]">
      {icon}
      {label}
    </span>
  )
}

function SectionIntro({ eyebrow, title, description }: { eyebrow: string; title: React.ReactNode; description: string }) {
  return (
    <div className="max-w-3xl">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2f7f93] dark:text-[#7fc2cf]">{eyebrow}</p>
      <h2 className="architecture-display mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-[#102d42] [text-wrap:balance] dark:text-[#edf6f3] sm:text-[2.55rem]">
        {title}
      </h2>
      <p className="mt-4 text-sm leading-7 text-[#5a7075] dark:text-[#a7bcbd] sm:text-[15px]">{description}</p>
    </div>
  )
}
