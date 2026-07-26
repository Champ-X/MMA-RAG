import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, BookOpenText, CheckCircle2, SearchCheck } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { architectureSections, coreModules, type ArchitectureSectionId } from '@/data/architectureData'
import { ArchitectureNav } from '@/components/architecture/ArchitectureNav'
import { OverviewSection } from '@/components/architecture/OverviewSection'
import { ArchitectureDiagram } from '@/components/architecture/ArchitectureDiagram'
import { RequestFlowStepper } from '@/components/architecture/RequestFlowStepper'
import { ModuleExplorer } from '@/components/architecture/ModuleExplorer'
import { DataFlowDiagram } from '@/components/architecture/DataFlowDiagram'
import { TechStackSection } from '@/components/architecture/TechStackSection'

export function ArchitecturePage() {
  const [activeSection, setActiveSection] = useState<ArchitectureSectionId>('overview')
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)

  const getScrollContainer = useCallback(() => {
    const viewport = scrollAreaRef.current?.firstElementChild
    return viewport instanceof HTMLDivElement ? viewport : null
  }, [])

  const handleNavigate = useCallback((id: ArchitectureSectionId) => {
    setActiveSection(id)
    const section = document.getElementById(id)
    const scrollContainer = getScrollContainer()

    if (section && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      const sectionRect = section.getBoundingClientRect()
      const nextTop = scrollContainer.scrollTop + sectionRect.top - containerRect.top - 72

      scrollContainer.scrollTo({
        top: Math.max(nextTop, 0),
        behavior: 'smooth',
      })
      return
    }

    section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [getScrollContainer])

  useEffect(() => {
    const root = getScrollContainer()
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
        rootMargin: '-12% 0px -70% 0px',
        threshold: [0, 0.08, 0.3],
      }
    )

    architectureSections.forEach(({ id }) => {
      const section = document.getElementById(id)
      if (section) observer.observe(section)
    })

    return () => observer.disconnect()
  }, [getScrollContainer])

  return (
    <div className="h-full min-h-0">
      <ScrollArea
        ref={scrollAreaRef}
        className="h-full rounded-[18px] border border-slate-200/80 bg-[#fcfdfc] shadow-[0_18px_60px_-46px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-950"
      >
        <header className="relative overflow-hidden border-b border-slate-200/80 dark:border-slate-800">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_12%,rgba(13,148,136,0.12),transparent_34%),radial-gradient(circle_at_18%_90%,rgba(249,115,22,0.07),transparent_28%)] dark:bg-[radial-gradient(circle_at_78%_12%,rgba(20,184,166,0.12),transparent_32%),radial-gradient(circle_at_18%_90%,rgba(249,115,22,0.05),transparent_30%)]"
          />

          <div className="relative mx-auto max-w-[1440px] px-5 pb-9 pt-8 sm:px-8 sm:pb-11 sm:pt-10 lg:px-12 lg:pt-12">
            <div className="max-w-4xl">
              <p className="font-mono text-[11px] font-semibold tracking-[0.16em] text-teal-700 dark:text-teal-300">
                Architecture
              </p>
              <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-[1.12] tracking-[-0.045em] text-slate-950 [text-wrap:balance] dark:text-white sm:text-5xl">
                从输入到证据，再到可追溯回答
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">
                一张图读懂 Tessmora 的多模态入库、共享检索、Agent 取证循环与引用生成。
              </p>
              <button
                type="button"
                onClick={() => handleNavigate('system-architecture')}
                className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 active:translate-y-0 dark:bg-slate-100 dark:text-slate-950 dark:focus-visible:ring-offset-slate-950"
              >
                查看系统图
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>

            <dl className="mt-9 grid max-w-4xl grid-cols-2 gap-x-8 gap-y-5 border-t border-slate-200/80 pt-5 dark:border-slate-800 sm:grid-cols-4">
              <HeroStat value={coreModules.length.toString()} label="核心模块" />
              <HeroStat value="2" label="执行路径" />
              <HeroStat value="4" label="证据模态" />
              <div>
                <dt className="flex items-center gap-1.5 text-xs text-teal-700 dark:text-teal-300">
                  <SearchCheck className="h-3.5 w-3.5" />
                  实现状态
                </dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">与当前代码同步</dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-7 lg:px-11">
            <ArchitectureNav
              sections={architectureSections}
              activeId={activeSection}
              onNavigate={handleNavigate}
            />
          </div>
        </div>

        <div className="mx-auto flex max-w-[1440px] flex-col gap-24 px-5 py-12 sm:px-8 sm:py-16 lg:px-12 lg:py-20">
          <OverviewSection />
          <ArchitectureDiagram />
          <RequestFlowStepper />

          <section id="modules" className="scroll-mt-24">
            <div className="max-w-3xl">
              <h2 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950 [text-wrap:balance] dark:text-white sm:text-3xl">
                六个模块，一套证据合同
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
                选择模块即可查看职责、实现边界和当前代码入口，页面不会跳离阅读上下文。
              </p>
            </div>
            <ModuleExplorer modules={coreModules} />
          </section>

          <DataFlowDiagram />
          <TechStackSection />

          <footer className="grid gap-4 border-t border-slate-200/80 pt-6 text-xs leading-6 text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:grid-cols-[1fr_auto] sm:items-center">
            <span className="inline-flex items-center gap-2">
              <BookOpenText className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              完整实现说明：docs/MMA_ARCHITECTURE.md
            </span>
            <span className="inline-flex items-center gap-2 font-mono text-[10px]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              implementation snapshot 2026-07-26
            </span>
          </footer>
        </div>
      </ScrollArea>
    </div>
  )
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-950 dark:text-slate-100">{value}</dd>
    </div>
  )
}
