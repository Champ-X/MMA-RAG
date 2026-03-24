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
    <div className="flex h-full min-h-0 gap-4 lg:gap-6">
      <ScrollArea
        ref={scrollAreaRef}
        className="flex-1 min-w-0 rounded-2xl border border-white/70 bg-gradient-to-b from-white/95 via-white/90 to-indigo-50/30 shadow-[0_8px_30px_-12px_rgba(79,70,229,0.25)] backdrop-blur-sm dark:border-slate-800/80 dark:from-slate-950/95 dark:via-slate-950/90 dark:to-indigo-950/20 dark:shadow-[0_8px_40px_-16px_rgba(0,0,0,0.65)]"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <header className="relative overflow-hidden rounded-2xl border border-indigo-100/80 bg-gradient-to-br from-indigo-500/[0.07] via-violet-500/[0.05] to-transparent px-5 py-6 dark:border-indigo-900/40 dark:from-indigo-500/10 dark:via-violet-600/5">
            <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-indigo-400/20 to-fuchsia-400/10 blur-3xl dark:from-indigo-500/15 dark:to-fuchsia-500/10" />
            <p className="relative text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-600/80 dark:text-indigo-300/90">
              Architecture
            </p>
            <h1 className="relative mt-1 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
              系统架构与设计说明
            </h1>
            <p className="relative mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break">
              全模态 RAG、DDD 模块边界、数据生命周期，以及飞书 IM 等外部通道如何接入同一套检索与生成能力。
            </p>
          </header>

          <OverviewSection />
          <InnovationSection />
          <PerformanceMetrics />
          <ArchitectureDiagram />
          <IntegrationsSection />
          <RequestFlowStepper />

          <section id="modules" className="scroll-mt-24 space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100/90 bg-indigo-50/90 px-3 py-1 text-xs font-medium text-indigo-800 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-200">
              <span className="h-2 w-2 rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-500 shadow-sm shadow-indigo-500/40" />
              <span>核心模块拆分</span>
            </div>
            <p className="max-w-4xl text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
              按 DDD 思路划分为五个业务模块：Ingestion、Knowledge、Retrieval、Generation 与 LLM Manager，每个模块既可以单独理解，又在请求链路中形成清晰的职责分工。
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {coreModules.map((m) => (
                <ModuleCard key={m.id} module={m} />
              ))}
            </div>
          </section>

          <DataFlowDiagram />
          <TechStackSection />

          <footer className="border-t border-slate-200/80 pt-8 text-center text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            内容随仓库演进更新；实现细节以代码与配置为准。
          </footer>
        </div>
      </ScrollArea>

      <div className="hidden w-[15.5rem] shrink-0 lg:block">
        <ArchitectureNav sections={architectureSections} activeId={activeSection} onNavigate={handleNavigate} />
      </div>
    </div>
  )
}

