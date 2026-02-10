import { Layers, Sparkles, Database, Brain } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { overviewStats, overviewTags } from '@/data/architectureData'

export function OverviewSection() {
  return (
    <section id="overview" className="scroll-mt-24 space-y-6">
      <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm dark:bg-indigo-950/40 dark:text-indigo-200">
        <Layers className="h-3.5 w-3.5" />
        <span>项目总览</span>
      </div>

      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Multi-Modal 智能路由可扩展知识库 RAG Agent
        </h1>
        <div className="space-y-3 max-w-4xl">
          <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
            本项目是一个面向多知识库、多模态场景的 RAG（Retrieval-Augmented Generation）Agent 系统，旨在解决企业级知识管理中的核心挑战：如何在多个异构知识库中，高效、准确地检索并生成包含文档与图像的统一回答。
          </p>
          <div className="space-y-2">
            <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
              <span className="font-semibold text-slate-700 dark:text-slate-200">核心设计理念：</span>
              采用领域驱动设计（DDD）架构，将系统划分为 Ingestion、Knowledge、Retrieval、Generation 与 LLM Manager 五个核心业务模块，每个模块职责清晰、可独立演进，同时通过统一的接口协作完成端到端的 RAG 流程。
            </p>
            <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
              <span className="font-semibold text-slate-700 dark:text-slate-200">关键技术特性：</span>
              系统支持文档与图像的统一检索，通过智能知识库画像路由实现多库场景下的精准选库，采用三路混合检索（语义向量、稀疏向量、视觉特征）提升召回质量，并具备完整的思考链可视化能力，让用户能够理解系统每一步的决策过程。
            </p>
            <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
              <span className="font-semibold text-slate-700 dark:text-slate-200">本页说明：</span>
              以下内容将在 3–5 分钟内帮助你理解整体架构设计、核心模块职责、RAG 请求的完整流转路径，以及数据在系统中的生命周期。通过可视化的方式，清晰展示从用户提问到系统返回带引用回答的每一个关键环节。
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {overviewTags.map(tag => (
          <Badge
            key={tag}
            className="bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-900"
          >
            <Sparkles className="mr-1 h-3 w-3" />
            {tag}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="group relative overflow-hidden border-indigo-100/80 bg-gradient-to-br from-indigo-50/80 to-slate-50/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-indigo-900/80 dark:from-indigo-950/40 dark:to-slate-950/40">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 to-purple-500/0 transition-all duration-300 group-hover:from-indigo-500/10 group-hover:to-purple-500/10" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">核心模块</CardTitle>
            <Layers className="h-4 w-4 text-indigo-500 transition-transform duration-300 group-hover:scale-110" />
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{overviewStats.modules}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Ingestion / Knowledge / Retrieval / Generation / LLM Manager</p>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border-emerald-100/80 bg-gradient-to-br from-emerald-50/80 to-slate-50/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-emerald-900/80 dark:from-emerald-950/30 dark:to-slate-950/40">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-teal-500/0 transition-all duration-300 group-hover:from-emerald-500/10 group-hover:to-teal-500/10" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">RAG 请求链路</CardTitle>
            <Brain className="h-4 w-4 text-emerald-500 transition-transform duration-300 group-hover:scale-110" />
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-50">7</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">从 Chat API 到 LLM 流式返回的 7 个关键阶段</p>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border-sky-100/80 bg-gradient-to-br from-sky-50/80 to-slate-50/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-sky-900/80 dark:from-sky-950/30 dark:to-slate-950/40">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-500/0 to-cyan-500/0 transition-all duration-300 group-hover:from-sky-500/10 group-hover:to-cyan-500/10" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">存储与模型</CardTitle>
            <Database className="h-4 w-4 text-sky-500 transition-transform duration-300 group-hover:scale-110" />
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              {overviewStats.coreApis}+{overviewStats.modelTasks}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              MinIO / Qdrant / Redis + 多任务 LLM 能力（意图、生成、重排等）
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

