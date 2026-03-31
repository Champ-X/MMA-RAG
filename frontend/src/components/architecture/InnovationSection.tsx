import {
  Sparkles,
  TrendingUp,
  Target,
  Search,
  Zap,
  Rocket,
  ImageIcon,
  Brain,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import { innovationPoints } from '@/data/architectureData'
import { Card, CardContent } from '@/components/ui/card'

const innovationIconById: Record<string, LucideIcon> = {
  'kb-portrait': Target,
  'hybrid-search': Search,
  'two-stage-rerank': Zap,
  'one-pass-intent': Rocket,
  'multimodal-vector': ImageIcon,
  'visual-thinking': Brain,
  'feishu-delivery': MessageSquare,
}

export function InnovationSection() {
  return (
    <section id="innovations" className="scroll-mt-24 space-y-5">
      <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-50 to-pink-50 px-3 py-1 text-xs font-medium text-purple-700 shadow-sm dark:from-purple-950/40 dark:to-pink-950/40 dark:text-purple-200">
        <Sparkles className="h-3.5 w-3.5" />
        <span>核心创新点</span>
      </div>

      <p className="max-w-3xl break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
        下列为架构层面的差异化能力：知识库路由、多路检索与重排、可解释思考链，以及可选的飞书触达。
      </p>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {innovationPoints.map((point, index) => {
          const Icon = innovationIconById[point.id] ?? Sparkles
          return (
            <Card
              key={point.id}
              className="group relative overflow-hidden border-purple-100/80 bg-gradient-to-br from-purple-50/80 via-white to-pink-50/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-purple-500/10 dark:border-purple-900/80 dark:from-purple-950/40 dark:via-slate-950 dark:to-pink-950/30"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 via-pink-500/0 to-indigo-500/0 transition-all duration-300 group-hover:from-purple-500/5 group-hover:via-pink-500/5 group-hover:to-indigo-500/5" />
              <CardContent className="relative p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-purple-700 shadow-sm dark:from-purple-500/30 dark:to-pink-500/30 dark:text-purple-200">
                    <Icon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                    #{index + 1}
                  </div>
                </div>
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">{point.title}</h3>
                <p className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{point.description}</p>
                <div className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-50 to-teal-50 px-2 py-1.5 dark:from-emerald-950/40 dark:to-teal-950/40">
                  <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[11px] font-semibold leading-snug text-emerald-700 dark:text-emerald-300">{point.impact}</span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
