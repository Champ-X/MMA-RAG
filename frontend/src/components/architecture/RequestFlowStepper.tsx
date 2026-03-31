import { useState } from 'react'
import { ArrowRight, MessageCircle, Brain, Network, Search, Sparkles, Layers, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { requestFlowSteps } from '@/data/architectureData'

const stepIconMap: Record<string, JSX.Element> = {
  'chat-api': <MessageCircle className="h-4 w-4" />,
  intent: <Brain className="h-4 w-4" />,
  routing: <Network className="h-4 w-4" />,
  'hybrid-search': <Search className="h-4 w-4" />,
  rerank: <Layers className="h-4 w-4" />,
  prompt: <FileText className="h-4 w-4" />,
  generation: <Sparkles className="h-4 w-4" />,
}

export function RequestFlowStepper() {
  const [activeId, setActiveId] = useState<string>(requestFlowSteps[0]?.id ?? 'chat-api')

  const activeStep = requestFlowSteps.find(step => step.id === activeId) ?? requestFlowSteps[0]

  return (
    <section id="request-flow" className="scroll-mt-24 space-y-4">
      <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-200">
        <ArrowRight className="h-3.5 w-3.5" />
        <span>RAG 请求链路</span>
      </div>

      <p className="max-w-3xl break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
        从用户发起对话到 SSE 推送引用与正文，链路拆分为 {requestFlowSteps.length} 个阶段。下方为各步职责与代码入口（流式对话入口为{' '}
        <span className="font-mono text-[12px] text-indigo-700 dark:text-indigo-300">/api/chat/stream</span>）。
      </p>

      <div className="rounded-2xl border border-emerald-100/80 bg-gradient-to-br from-emerald-50/60 via-slate-50/80 to-slate-50/80 p-4 shadow-sm dark:border-emerald-900/80 dark:from-emerald-950/30 dark:via-slate-950 dark:to-slate-950">
        {/* Stepper */}
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {requestFlowSteps.map((step, index) => {
              const isActive = step.id === activeId
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveId(step.id)}
                  className={cn(
                    'group relative flex min-w-[120px] flex-col items-start overflow-hidden rounded-xl border px-3 py-2 text-left text-xs transition-all duration-300',
                    isActive
                      ? 'border-emerald-500/80 bg-white shadow-md dark:border-emerald-400/80 dark:bg-slate-950'
                      : 'border-emerald-100/60 bg-emerald-50/40 hover:border-emerald-300 hover:bg-emerald-50/80 hover:shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:hover:border-emerald-700'
                  )}
                >
                  {isActive && (
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-teal-500/5 to-emerald-500/5" />
                  )}
                  <div className="relative mb-1 flex items-center gap-2 text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-300',
                        isActive
                          ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm scale-110'
                          : 'bg-emerald-100 text-emerald-700 group-hover:scale-105 dark:bg-emerald-900/70 dark:text-emerald-200'
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="line-clamp-1">{step.title}</span>
                  </div>
                  <div className="relative flex items-center gap-1 text-[11px] text-emerald-700/90 dark:text-emerald-300/90">
                    <span className="opacity-80 transition-transform duration-300 group-hover:scale-110">
                      {stepIconMap[step.id] ?? <ArrowRight className="h-4 w-4" />}
                    </span>
                    <span className="line-clamp-1">{step.short}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Active step detail */}
        {activeStep && (
          <div className="mt-4 animate-in fade-in slide-in-from-top-2 rounded-xl border border-emerald-100/80 bg-white/90 p-4 text-xs shadow-sm dark:border-emerald-900/80 dark:bg-slate-950/80">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-slate-800 dark:text-slate-50">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-[10px] font-bold text-white shadow-sm">
                {requestFlowSteps.findIndex(s => s.id === activeStep.id) + 1}
              </span>
              <span>{activeStep.title}</span>
            </div>
            <p className="mb-3 break-words text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break">
              {activeStep.description}
            </p>
            
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              {activeStep.estimatedTime && (
                <div className="rounded-lg border border-emerald-100/60 bg-emerald-50/50 p-2 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                  <div className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">预估耗时</div>
                  <div className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-100">{activeStep.estimatedTime}</div>
                </div>
              )}
              {activeStep.keyTechnologies && activeStep.keyTechnologies.length > 0 && (
                <div className="rounded-lg border border-sky-100/60 bg-sky-50/50 p-2 dark:border-sky-900/60 dark:bg-sky-950/30">
                  <div className="text-[10px] font-medium text-sky-700 dark:text-sky-300">关键技术</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {activeStep.keyTechnologies.map(tech => (
                      <span
                        key={tech}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300 bg-sky-100/80 dark:bg-sky-900/50"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {activeStep.backendEntry && (
              <div className="mb-2 rounded-lg border border-slate-200/60 bg-slate-50/50 p-2 dark:border-slate-800/60 dark:bg-slate-900/30">
                <p className="mb-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">相关代码入口</p>
                <code className="block break-words rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  {activeStep.backendEntry}
                </code>
              </div>
            )}
            <p className="mt-2 break-words text-[10px] text-slate-500 dark:text-slate-400 text-chinese-break">
              在前端中，这条链路会被映射为 `ThinkingCapsule` 中的「意图解析 → 智能路由 → 检索策略」三个阶段，可实时观测每一步的决策结果。
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
