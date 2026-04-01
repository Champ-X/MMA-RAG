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
import { motion, useReducedMotion } from 'framer-motion'
import { innovationPoints } from '@/data/architectureData'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const innovationIconById: Record<string, LucideIcon> = {
  'kb-portrait': Target,
  'hybrid-search': Search,
  'two-stage-rerank': Zap,
  'one-pass-intent': Rocket,
  'multimodal-vector': ImageIcon,
  'visual-thinking': Brain,
  'feishu-delivery': MessageSquare,
}

const iconShellById: Record<string, string> = {
  'kb-portrait':
    'bg-gradient-to-br from-violet-500/20 to-purple-600/10 text-violet-700 dark:from-violet-500/30 dark:to-purple-600/15 dark:text-violet-200',
  'hybrid-search':
    'bg-gradient-to-br from-sky-500/20 to-blue-600/10 text-sky-800 dark:from-sky-500/25 dark:to-blue-600/15 dark:text-sky-200',
  'two-stage-rerank':
    'bg-gradient-to-br from-amber-500/20 to-orange-600/10 text-amber-800 dark:from-amber-500/25 dark:to-orange-600/15 dark:text-amber-200',
  'one-pass-intent':
    'bg-gradient-to-br from-fuchsia-500/20 to-pink-600/10 text-fuchsia-800 dark:from-fuchsia-500/25 dark:to-pink-600/15 dark:text-fuchsia-200',
  'multimodal-vector':
    'bg-gradient-to-br from-teal-500/20 to-cyan-600/10 text-teal-800 dark:from-teal-500/25 dark:to-cyan-600/15 dark:text-teal-200',
  'visual-thinking':
    'bg-gradient-to-br from-indigo-500/20 to-violet-600/10 text-indigo-800 dark:from-indigo-500/25 dark:to-violet-600/15 dark:text-indigo-200',
  'feishu-delivery':
    'bg-gradient-to-br from-blue-500/20 to-indigo-600/10 text-blue-800 dark:from-blue-500/25 dark:to-indigo-600/15 dark:text-blue-200',
}

export function InnovationSection() {
  const reduceMotion = useReducedMotion()

  return (
    <section
      id="innovations"
      className="scroll-mt-24 rounded-2xl border border-slate-200/80 bg-gradient-to-b from-slate-50/90 via-white to-slate-50/50 px-4 py-8 shadow-sm dark:border-slate-800/80 dark:from-slate-950/80 dark:via-slate-950/60 dark:to-slate-950/40 sm:px-6 sm:py-10"
    >
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-50 to-violet-50 px-3.5 py-1.5 text-xs font-semibold text-purple-800 shadow-sm ring-1 ring-purple-200/60 dark:from-purple-950/50 dark:to-violet-950/40 dark:text-purple-200 dark:ring-purple-800/50">
            <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-300" />
            <span>核心创新点</span>
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
            知识库画像与路由、全模态检索与两阶段重排、One-Pass 意图、思考链可视化；可选飞书与 Web 共用管道。
          </p>
        </div>

        <div className="grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">
          {innovationPoints.map((point, index) => {
            const Icon = innovationIconById[point.id] ?? Sparkles
            const iconShell = iconShellById[point.id] ?? iconShellById['kb-portrait']

            return (
              <motion.div
                key={point.id}
                className="flex h-full min-h-0"
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{
                  duration: reduceMotion ? 0 : 0.35,
                  delay: reduceMotion ? 0 : index * 0.05,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <Card
                  className={cn(
                    'group relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-t-lg rounded-b-none border-purple-100/80 bg-gradient-to-br from-purple-50/80 via-white to-pink-50/50 transition-all duration-300',
                    'hover:-translate-y-0.5 hover:shadow-md hover:shadow-purple-500/10',
                    'dark:border-purple-900/80 dark:from-purple-950/40 dark:via-slate-950 dark:to-pink-950/30 dark:hover:shadow-purple-950/15'
                  )}
                >
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-purple-500/0 via-pink-500/0 to-indigo-500/0 transition-all duration-300 group-hover:from-purple-500/5 group-hover:via-pink-500/5 group-hover:to-indigo-500/5" />
                  <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3 p-4">
                    <div className="shrink-0 flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm dark:shadow-none',
                          iconShell
                        )}
                      >
                        <Icon className="h-5 w-5" strokeWidth={2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="text-sm font-semibold leading-snug text-slate-900 dark:text-slate-50">
                            {point.title}
                          </h3>
                          {point.optional ? (
                            <Badge
                              variant="outline"
                              className="border-amber-300/90 bg-amber-50 px-2 py-0 text-[10px] font-semibold text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-100"
                            >
                              可选
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        #{index + 1}
                      </div>
                    </div>

                    <p className="min-h-0 flex-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break">
                      {point.description}
                    </p>

                    <div className="mt-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-50 to-teal-50 px-2 py-1.5 dark:from-emerald-950/40 dark:to-teal-950/40">
                      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-[11px] font-semibold leading-snug text-emerald-700 dark:text-emerald-300 text-chinese-break">
                        {point.impact}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
