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
        className="flex-1 min-w-0 rounded-2xl border border-white/70 bg-gradient-to-b from-white/96 via-indigo-50/25 to-teal-50/20 shadow-[0_8px_32px_-14px_rgba(79,70,229,0.22)] backdrop-blur-sm dark:border-slate-800/80 dark:from-slate-950/96 dark:via-slate-950/92 dark:to-indigo-950/25 dark:shadow-[0_8px_40px_-16px_rgba(0,0,0,0.65)]"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          <header className="relative overflow-hidden rounded-2xl border border-indigo-100/80 bg-gradient-to-br from-indigo-500/[0.08] via-violet-500/[0.04] to-teal-500/[0.03] px-5 py-7 shadow-sm dark:border-indigo-900/45 dark:from-indigo-500/12 dark:via-violet-600/6 dark:to-teal-900/10">
            <div className="pointer-events-none absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-gradient-to-tr from-teal-400/10 to-transparent blur-3xl dark:from-teal-500/8" />
            <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br from-indigo-400/20 to-fuchsia-400/10 blur-3xl dark:from-indigo-500/15 dark:to-fuchsia-500/10" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(99,102,241,0.06),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_50%_0%,rgba(99,102,241,0.12),transparent_50%)]" />
            <p className="relative text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-600/85 dark:text-indigo-300/90">
              Architecture
            </p>
            <h1 className="relative mt-1.5 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">
              系统架构与设计说明
            </h1>
            <p className="relative mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break">
              FastAPI DDD 模块、MinIO / Qdrant / Redis 数据平面、三路混合检索与两阶段重排；配置与行为以源码及{' '}
              <span className="font-mono text-[12px] text-indigo-700 dark:text-indigo-300">backend/.env</span> 为准。
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

          <footer className="rounded-xl border border-slate-200/70 bg-slate-50/50 px-4 py-5 text-center text-[11px] leading-relaxed text-slate-500 dark:border-slate-800/80 dark:bg-slate-900/40 dark:text-slate-400">
            本页为架构导读；细节与迭代说明以{' '}
            <span className="font-mono text-slate-600 dark:text-slate-300">docs/MMA_ARCHITECTURE.md</span>、
            <span className="font-mono text-slate-600 dark:text-slate-300"> backend/.env.example</span> 与源码为准。
          </footer>
        </div>
      </ScrollArea>

      <div className="hidden w-[15.5rem] shrink-0 lg:block">
        <ArchitectureNav sections={architectureSections} activeId={activeSection} onNavigate={handleNavigate} />
      </div>
    </div>
  )
}

