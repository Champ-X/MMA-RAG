import { Layers, Sparkles, Database, Brain } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { overviewStats, overviewTags, requestFlowSteps } from '@/data/architectureData'

export function OverviewSection() {
  return (
    <section id="overview" className="scroll-mt-8 space-y-6">
      <div>
        <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-indigo-600 dark:text-indigo-300">
          系统总览
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-slate-950 dark:text-slate-50 sm:text-2xl">
          从多模态资料到可验证回答
        </h2>
      </div>

      <div className="max-w-4xl space-y-3">
        <p className="break-words text-sm leading-7 text-slate-600 dark:text-slate-300 text-chinese-break text-description">
          系统统一接入文档、图片、音频与视频，通过知识库画像选择检索范围，再组合 Dense、Sparse 与 Visual 等通道完成召回和重排。
        </p>
        <p className="break-words text-sm leading-7 text-slate-600 dark:text-slate-300 text-chinese-break text-description">
          领域模块按 DDD 拆分并独立演进；LLM Manager 统一调度意图识别、图注、ASR、重排和生成任务，Web 端通过 SSE 持续接收过程状态与引用。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {overviewTags.map(tag => (
          <Badge
            key={tag}
            variant="outline"
            className="rounded-[6px] border-slate-200 bg-transparent px-2.5 py-1 font-normal text-slate-600 shadow-none dark:border-slate-800 dark:text-slate-300"
          >
            <Sparkles className="mr-1 h-3 w-3 text-indigo-500" />
            {tag}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-[8px] border-slate-200 bg-slate-50/60 shadow-none dark:border-slate-800 dark:bg-slate-900/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">核心模块</CardTitle>
            <Layers className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{overviewStats.modules}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Ingestion / Knowledge / Retrieval / Generation / LLM Manager</p>
          </CardContent>
        </Card>

        <Card className="rounded-[8px] border-slate-200 bg-slate-50/60 shadow-none dark:border-slate-800 dark:bg-slate-900/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">RAG 请求链路</CardTitle>
            <Brain className="h-4 w-4 text-teal-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{requestFlowSteps.length}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              从 Chat API 到 LLM 流式返回的 {requestFlowSteps.length} 个关键阶段
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-[8px] border-slate-200 bg-slate-50/60 shadow-none dark:border-slate-800 dark:bg-slate-900/40">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">数据平面</CardTitle>
            <Database className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{overviewStats.storageLayers}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              MinIO / Qdrant / Redis（Celery broker 与任务状态）
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
