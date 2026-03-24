import { Layers, Sparkles, Database, Brain } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { overviewStats, overviewTags } from '@/data/architectureData'

export function OverviewSection() {
  return (
    <section id="overview" className="scroll-mt-24 space-y-6">
      <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100/90 bg-indigo-50/95 px-3 py-1 text-xs font-medium text-indigo-800 shadow-sm dark:border-indigo-900/50 dark:bg-indigo-950/45 dark:text-indigo-200">
        <Layers className="h-3.5 w-3.5" />
        <span>项目总览</span>
      </div>

      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Multi-Modal 智能路由可扩展知识库 RAG Agent
        </h1>
        <div className="space-y-3 max-w-4xl">
          <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
            本项目是一个面向多知识库、全模态场景的 RAG（Retrieval-Augmented Generation）Agent 系统，旨在解决企业级知识管理中的核心挑战：如何在多个异构知识库中，高效、准确地检索并生成包含文档、图像、音频与视频的统一回答。支持多种内容来源（本地上传、URL、文件夹、热点订阅等），并完整支持音频（ASR+CLAP）与视频（关键帧+整体描述+CLIP）模态。除 Web 端外，可通过<strong className="font-medium text-slate-800 dark:text-slate-100"> 飞书长连接与开放平台 API </strong>在 IM 内使用同一套检索与生成能力，并以卡片 2.0、Post 等形式呈现多模态引用。
          </p>
          <div className="space-y-2">
            <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
              <span className="font-semibold text-slate-700 dark:text-slate-200">核心设计理念：</span>
              采用领域驱动设计（DDD）架构，将系统划分为 Ingestion、Knowledge、Retrieval、Generation 与 LLM Manager 五个核心业务模块，每个模块职责清晰、可独立演进，通过统一接口协作完成端到端 RAG 流程；LLM 调用由 Core 层统一管理，支持多厂商 API 与多模态任务（图注、ASR、生成、重排等）路由。
            </p>
            <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
              <span className="font-semibold text-slate-700 dark:text-slate-200">关键技术特性：</span>
              文档、图片、音频、视频全模态统一检索与引用；基于 K-Means + LLM 主题摘要的知识库画像（可覆盖全模态）与加权路由；多路混合检索（Dense、BGE-M3 稀疏、Visual 图片、Audio 音频、Video 视频）与两阶段重排（RRF 粗排 + Cross-Encoder 精排）；One-Pass 意图识别与 visual/audio/video 意图分支；完整思考链可视化与多模态引用展示（灯箱、播放器、关键帧）。
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
              MinIO / Qdrant / Redis + 多任务 LLM（意图、VLM、ASR、生成、重排、画像等）
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

