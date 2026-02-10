import { Zap, TrendingUp, Target, Layers } from 'lucide-react'
import { performanceMetrics } from '@/data/architectureData'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const iconMap = {
  'retrieval-accuracy': <Target className="h-4 w-4" />,
  'intent-latency': <Zap className="h-4 w-4" />,
  'rerank-accuracy': <TrendingUp className="h-4 w-4" />,
  'multimodal-support': <Layers className="h-4 w-4" />,
}

const colorMap: Record<string, { gradient: string; icon: string }> = {
  'retrieval-accuracy': { gradient: 'from-emerald-500 to-teal-500', icon: 'text-emerald-500' },
  'intent-latency': { gradient: 'from-blue-500 to-cyan-500', icon: 'text-blue-500' },
  'rerank-accuracy': { gradient: 'from-purple-500 to-pink-500', icon: 'text-purple-500' },
  'multimodal-support': { gradient: 'from-orange-500 to-amber-500', icon: 'text-orange-500' },
}

export function PerformanceMetrics() {
  return (
    <section id="performance" className="scroll-mt-24 space-y-4">
      <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-200">
        <TrendingUp className="h-3.5 w-3.5" />
        <span>性能指标</span>
      </div>

      <p className="max-w-3xl break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break">
        通过创新的架构设计和算法优化，系统在检索准确率、响应延迟、多模态支持等关键指标上实现了显著提升。
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {performanceMetrics.map(metric => (
          <Card
            key={metric.id}
            className="group relative overflow-hidden border-slate-200/80 bg-gradient-to-br from-white via-slate-50/50 to-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800/80 dark:from-slate-950 dark:via-slate-900/50 dark:to-slate-950"
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${colorMap[metric.id]?.gradient || 'from-slate-500 to-slate-600'}/0 transition-all duration-300 group-hover:opacity-5`} />
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-slate-600 dark:text-slate-400">{metric.label}</CardTitle>
              <div className={colorMap[metric.id]?.icon || 'text-slate-500'}>
                {iconMap[metric.id as keyof typeof iconMap]}
              </div>
            </CardHeader>
            <CardContent className="relative">
              <div className="mb-1 flex items-baseline gap-2">
                <span className={`text-3xl font-bold bg-gradient-to-r ${colorMap[metric.id]?.gradient || 'from-slate-500 to-slate-600'} bg-clip-text text-transparent`}>
                  {metric.value}
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{metric.unit}</span>
              </div>
              {metric.improvement && (
                <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">{metric.improvement}</p>
              )}
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{metric.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
