import { useState, useCallback, useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { architectureSections, coreModules, type ArchitectureSectionId } from '@/data/architectureData'
import { ArchitectureNav } from '@/components/architecture/ArchitectureNav'
import { OverviewSection } from '@/components/architecture/OverviewSection'
import { ArchitectureDiagram } from '@/components/architecture/ArchitectureDiagram'
import { RequestFlowStepper } from '@/components/architecture/RequestFlowStepper'
import { ModuleCard } from '@/components/architecture/ModuleCard'
import { DataFlowDiagram } from '@/components/architecture/DataFlowDiagram'
import { TechStackSection } from '@/components/architecture/TechStackSection'
import { InnovationSection } from '@/components/architecture/InnovationSection'
import { PerformanceMetrics } from '@/components/architecture/PerformanceMetrics'
import { IntegrationsSection } from '@/components/architecture/IntegrationsSection'

export function ArchitecturePage() {
  const [activeSection, setActiveSection] = useState<ArchitectureSectionId>('overview')
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)

  const getScrollContainer = useCallback(() => {
    const viewport = scrollAreaRef.current?.firstElementChild
    return viewport instanceof HTMLDivElement ? viewport : null
  }, [])

  const handleNavigate = useCallback((id: ArchitectureSectionId) => {
    setActiveSection(id)
    const el = document.getElementById(id)
    const scrollContainer = getScrollContainer()

    if (el && scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect()
      const elementRect = el.getBoundingClientRect()
      const nextTop = scrollContainer.scrollTop + (elementRect.top - containerRect.top) - 24

      scrollContainer.scrollTo({
        top: Math.max(nextTop, 0),
        behavior: 'smooth',
      })
    } else if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [getScrollContainer])

  // 监听正文滚动容器，保持侧边导航与阅读位置同步
  useEffect(() => {
    const scrollContainer = getScrollContainer()

    if (!scrollContainer) {
      return
    }

    let frameId = 0

    const updateActiveSection = () => {
      const containerRect = scrollContainer.getBoundingClientRect()
      const anchorTop = containerRect.top + 120
      const offsets: { id: ArchitectureSectionId; top: number }[] = []

      architectureSections.forEach(section => {
        const el = document.getElementById(section.id)
        if (el) {
          const rect = el.getBoundingClientRect()
          offsets.push({ id: section.id, top: Math.abs(rect.top - anchorTop) })
        }
      })

      if (offsets.length) {
        offsets.sort((a, b) => a.top - b.top)
        setActiveSection(prev => (prev === offsets[0].id ? prev : offsets[0].id))
      }
    }

    const handler = () => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(updateActiveSection)
    }

    scrollContainer.addEventListener('scroll', handler, { passive: true })
    window.addEventListener('resize', handler)
    handler()

    return () => {
      cancelAnimationFrame(frameId)
      scrollContainer.removeEventListener('scroll', handler)
      window.removeEventListener('resize', handler)
    }
  }, [getScrollContainer])

  return (
    <div className="h-full min-h-0">
      <ScrollArea
        ref={scrollAreaRef}
        className="h-full rounded-[8px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="mx-auto max-w-[1260px] px-5 py-7 sm:px-8 sm:py-9 lg:px-10">
          <header className="border-b border-slate-200 pb-8 dark:border-slate-800">
            <div className="mb-5 flex h-1 w-24 overflow-hidden rounded-full" aria-hidden>
              <span className="flex-1 bg-blue-500" />
              <span className="flex-1 bg-teal-500" />
              <span className="flex-1 bg-violet-500" />
              <span className="flex-1 bg-orange-400" />
            </div>
            <p className="font-mono text-[11px] font-semibold tracking-[0.16em] text-slate-500 dark:text-slate-400">
              架构导读
            </p>
            <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-slate-950 dark:text-slate-50 sm:text-[2.35rem] sm:leading-tight">
              多模态 RAG 系统如何协同工作
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300 text-chinese-break">
              从资料接入、意图识别和混合检索，到重排、生成与引用返回，沿一条完整链路理解系统模块及数据流向。
            </p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
              <span><strong className="font-mono font-semibold text-slate-800 dark:text-slate-200">{coreModules.length}</strong> 个核心模块</span>
              <span><strong className="font-mono font-semibold text-slate-800 dark:text-slate-200">4</strong> 类内容模态</span>
              <span><strong className="font-mono font-semibold text-slate-800 dark:text-slate-200">3–5</strong> 分钟阅读</span>
            </div>
          </header>

          <div className="grid items-start gap-10 py-10 xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-14">
            <div className="flex min-w-0 flex-col gap-12">
              <OverviewSection />
              <InnovationSection />
              <PerformanceMetrics />
              <ArchitectureDiagram />
              <IntegrationsSection />
              <RequestFlowStepper />

              <section id="modules" className="scroll-mt-8 space-y-5">
                <div>
                  <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
                    核心模块
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-slate-950 dark:text-slate-50">
                    按职责拆分，沿请求链路协作
                  </h2>
                </div>
                <p className="max-w-4xl text-sm leading-7 text-slate-600 dark:text-slate-300 text-chinese-break text-description">
                  Ingestion、Knowledge、Retrieval、Generation 与 LLM Manager 可以独立演进，并通过统一接口完成端到端 RAG 流程。
                </p>
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  {coreModules.map((m) => (
                    <ModuleCard key={m.id} module={m} />
                  ))}
                </div>
              </section>

              <DataFlowDiagram />
              <TechStackSection />

              <footer className="border-t border-slate-200 pt-5 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
                本页为架构导读；细节与迭代说明以{' '}
                <span className="font-mono text-slate-600 dark:text-slate-300">docs/MMA_ARCHITECTURE.md</span>、
                <span className="font-mono text-slate-600 dark:text-slate-300"> backend/.env.example</span> 与源码为准。
              </footer>
            </div>

            <aside className="hidden xl:block">
              <ArchitectureNav sections={architectureSections} activeId={activeSection} onNavigate={handleNavigate} />
            </aside>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
