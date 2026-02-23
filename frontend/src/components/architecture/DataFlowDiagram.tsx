import { ArrowRight, ArrowDown, FileText, Database, GitBranch, Server, Activity, Zap, Sparkles } from 'lucide-react'
import { dataFlowStages } from '@/data/architectureData'

export function DataFlowDiagram() {
  const ingestionStages = [
    { id: 'upload', icon: <FileText className="h-4 w-4 text-sky-500" />, title: '多来源接入', label: '上传 / URL / 文件夹 / 热点' },
    { id: 'minio', icon: <Database className="h-4 w-4 text-amber-600" />, title: 'MinIO', label: '对象存储' },
    { id: 'vectorize-qdrant', icon: <Activity className="h-4 w-4 text-emerald-600" />, title: '向量化 & Qdrant', label: 'Dense + BGE-M3 稀疏 + CLIP' },
    { id: 'redis-celery', icon: <Server className="h-4 w-4 text-rose-600" />, title: 'Redis & Celery', label: '异步任务与进度' },
  ]

  const ragStages = [
    { id: 'retrieval-generation', icon: <Sparkles className="h-4 w-4 text-indigo-600" />, title: '检索 → 生成', label: 'RAG 主链路' },
    { id: 'citation', icon: <ArrowRight className="h-4 w-4 text-purple-600" />, title: 'Citation', label: '引用展示' },
  ]

  return (
    <section id="data-flow" className="scroll-mt-24 space-y-4">
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 shadow-sm dark:bg-amber-950/40 dark:text-amber-200">
        <GitBranch className="h-3.5 w-3.5" />
        <span>数据流与存储</span>
      </div>

      <p className="max-w-4xl break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
        下面的流程图从「多来源接入」（本地上传或 URL/文件夹/热点导入）开始，沿 Ingestion → MinIO → 向量化与 Qdrant → 检索与生成 → 引用展示，描述数据在系统中的完整旅程。
      </p>

      <div className="space-y-6 rounded-2xl border border-amber-100/80 bg-gradient-to-br from-amber-50/60 via-slate-50/80 to-slate-50/80 p-6 shadow-lg dark:border-amber-900/80 dark:from-amber-950/30 dark:via-slate-950 dark:to-slate-950">
        {/* 数据摄取阶段 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 p-1.5 shadow-md">
              <Zap className="h-3 w-3 text-white" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">数据摄取阶段</h3>
          </div>
          <div className="flex flex-col items-center gap-3 md:flex-row md:flex-wrap md:justify-center md:gap-2 lg:gap-3">
            {ingestionStages.map((stage, index) => {
              const stageData = dataFlowStages.find(s => s.id === stage.id)
              const description = stage.id === 'vectorize-qdrant'
                ? `${dataFlowStages.find(s => s.id === 'vectorize')?.description ?? ''} ${dataFlowStages.find(s => s.id === 'qdrant')?.description ?? ''}`
                : stageData?.description

              return (
                <div key={stage.id} className="flex items-center gap-2">
                  <StageCard icon={stage.icon} title={stage.title} label={stage.label} description={description} />
                  {index < ingestionStages.length - 1 && (
                    <>
                      <div className="hidden md:block">
                        <ArrowHorizontal />
                      </div>
                      <div className="block md:hidden">
                        <ArrowVertical />
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 连接线 - 从摄取到RAG */}
        <div className="flex items-center justify-center py-2">
          <div className="flex flex-col items-center gap-2 md:flex-row">
            <div className="hidden h-px w-16 bg-gradient-to-r from-rose-400/60 to-transparent md:block" />
            <div className="flex h-12 w-px items-center justify-center bg-gradient-to-b from-rose-400/60 via-indigo-400/60 to-purple-400/60 md:h-px md:w-12 md:bg-gradient-to-r dark:from-rose-500 dark:via-indigo-500 dark:to-purple-500">
              <div className="rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 p-1.5 shadow-md">
                <ArrowDown className="h-4 w-4 animate-bounce text-white md:hidden" />
                <ArrowRight className="hidden h-4 w-4 animate-bounce text-white md:block" />
              </div>
            </div>
            <div className="hidden h-px w-16 bg-gradient-to-l from-purple-400/60 to-transparent md:block" />
          </div>
        </div>

        {/* RAG阶段 */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 p-1.5 shadow-md">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">RAG 检索与生成阶段</h3>
          </div>
          <div className="flex flex-col items-center gap-3 md:flex-row md:justify-center md:gap-2 lg:gap-3">
            {ragStages.map((stage, index) => {
              const stageData = dataFlowStages.find(s => s.id === stage.id)
              const description = stageData?.description

              return (
                <div key={stage.id} className="flex items-center gap-2">
                  <StageCard icon={stage.icon} title={stage.title} label={stage.label} description={description} />
                  {index < ragStages.length - 1 && (
                    <>
                      <div className="hidden md:block">
                        <ArrowHorizontal />
                      </div>
                      <div className="block md:hidden">
                        <ArrowVertical />
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

interface StageCardProps {
  icon: React.ReactNode
  title: string
  label: string
  description?: string
}

function StageCard({ icon, title, label, description }: StageCardProps) {
  return (
    <div className="group relative flex w-full flex-shrink-0 flex-col overflow-hidden rounded-xl border-2 border-amber-200/60 bg-gradient-to-br from-white/95 via-amber-50/30 to-white/95 p-4 text-xs shadow-md backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-300/80 hover:shadow-lg sm:max-w-[280px] md:w-[200px] lg:w-[220px] xl:w-[240px] dark:border-amber-800/60 dark:from-slate-950/95 dark:via-amber-950/20 dark:to-slate-950/95">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-500/0 to-orange-500/0 transition-all duration-300 group-hover:from-amber-500/5 group-hover:to-orange-500/5" />
      <div className="relative mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 to-orange-100 shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:shadow-md dark:from-amber-900/50 dark:to-orange-900/50">
          {icon}
        </div>
        <span className="break-words text-xs font-bold text-slate-800 dark:text-slate-50">{title}</span>
      </div>
      <p className="relative mb-3 text-[10px] font-semibold uppercase tracking-wide text-amber-700/90 dark:text-amber-300/90 break-words">
        {label}
      </p>
      {description && (
        <p className="relative flex-1 break-words text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break">
          {description}
        </p>
      )}
    </div>
  )
}

function ArrowHorizontal() {
  return (
    <div className="flex items-center">
      <div className="group/arrow flex h-px w-6 items-center justify-center bg-gradient-to-r from-amber-400/70 via-amber-500/80 to-amber-400/70 transition-all duration-300 hover:w-8 dark:from-amber-600 dark:via-amber-500 dark:to-amber-600">
        <ArrowRight className="h-3.5 w-3.5 -mr-1 animate-pulse text-amber-600 transition-transform duration-300 group-hover/arrow:translate-x-1 dark:text-amber-300" />
      </div>
    </div>
  )
}

function ArrowVertical() {
  return (
    <div className="flex items-center justify-center py-1">
      <div className="group/arrow flex w-px h-6 flex-col items-center justify-center bg-gradient-to-b from-amber-400/70 via-amber-500/80 to-amber-400/70 transition-all duration-300 hover:h-8 dark:from-amber-600 dark:via-amber-500 dark:to-amber-600">
        <ArrowDown className="h-3.5 w-3.5 -mb-1 animate-pulse text-amber-600 transition-transform duration-300 group-hover/arrow:translate-y-1 dark:text-amber-300" />
      </div>
    </div>
  )
}
