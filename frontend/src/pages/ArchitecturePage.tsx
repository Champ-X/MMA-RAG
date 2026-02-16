import { useState, useCallback, useEffect } from 'react'
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

export function ArchitecturePage() {
  const [activeSection, setActiveSection] = useState<ArchitectureSectionId>('overview')

  const handleNavigate = useCallback((id: ArchitectureSectionId) => {
    setActiveSection(id)
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  // 简单的 scroll-spy：监听滚动并更新当前 section
  useEffect(() => {
    const handler = () => {
      const offsets: { id: ArchitectureSectionId; top: number }[] = []
      architectureSections.forEach(section => {
        const el = document.getElementById(section.id)
        if (el) {
          const rect = el.getBoundingClientRect()
          offsets.push({ id: section.id, top: Math.abs(rect.top - 96) })
        }
      })
      if (offsets.length) {
        offsets.sort((a, b) => a.top - b.top)
        if (offsets[0].id !== activeSection) {
          setActiveSection(offsets[0].id)
        }
      }
    }
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [activeSection])

  return (
    <div className="flex h-full gap-6">
      <ScrollArea className="flex-1 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl flex-col gap-10">
          <OverviewSection />
          <InnovationSection />
          <PerformanceMetrics />
          <ArchitectureDiagram />
          <RequestFlowStepper />

          <section id="modules" className="scroll-mt-24 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm dark:bg-indigo-950/40 dark:text-indigo-200">
              <span className="h-2 w-2 rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-500" />
              <span>核心模块拆分</span>
            </div>
            <p className="max-w-4xl break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
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
        </div>
      </ScrollArea>

      <div className="hidden w-56 shrink-0 lg:block">
        <ArchitectureNav sections={architectureSections} activeId={activeSection} onNavigate={handleNavigate} />
      </div>
    </div>
  )
}

