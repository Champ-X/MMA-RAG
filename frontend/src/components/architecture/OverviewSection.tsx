import { Layers, Sparkles, Database, Brain } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { overviewStats, overviewTags, requestFlowSteps } from '@/data/architectureData'

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
            面向<strong className="font-medium text-slate-800 dark:text-slate-100"> 多知识库、多模态 </strong>
            的 RAG Agent，统一检索与生成文档与图像，并扩展音频（ASR + CLAP）、视频（关键帧 + 整体描述 + CLIP）等模态；支持本地上传、URL、文件夹、热点订阅等多来源接入。Web 端通过 SSE 获取思考链与引用；若部署飞书集成，可在 IM 内复用同一套领域服务，以卡片 2.0、Post 等呈现多模态引用。
          </p>
          <div className="space-y-2">
            <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
              <span className="font-semibold text-slate-700 dark:text-slate-200">核心设计理念：</span>
              采用领域驱动设计（DDD）架构，将系统划分为 Ingestion、Knowledge、Retrieval、Generation 与 LLM Manager 五个核心业务模块，每个模块职责清晰、可独立演进，通过统一接口协作完成端到端 RAG 流程；LLM 调用由 Core 层统一管理，支持多厂商 API 与多模态任务（图注、ASR、生成、重排等）路由。
            </p>
            <p className="break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
              <span className="font-semibold text-slate-700 dark:text-slate-200">关键技术特性：</span>
              知识库画像（K-Means + LLM 主题摘要）与 TopN 加权路由；检索以 Dense + BGE-M3 稀疏 + Visual 为主干，并按意图并入 Audio / Video；RRF 粗排与 Cross-Encoder 精排；One-Pass 意图与 visual/audio/video 分支；SSE 推送思考链与可调试引用（含 context_window）。
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
            <div className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{requestFlowSteps.length}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              从 Chat API 到 LLM 流式返回的 {requestFlowSteps.length} 个关键阶段
            </p>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border-sky-100/80 bg-gradient-to-br from-sky-50/80 to-slate-50/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-sky-900/80 dark:from-sky-950/30 dark:to-slate-950/40">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-500/0 to-cyan-500/0 transition-all duration-300 group-hover:from-sky-500/10 group-hover:to-cyan-500/10" />
          <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 dark:text-slate-400">数据平面</CardTitle>
            <Database className="h-4 w-4 text-sky-500 transition-transform duration-300 group-hover:scale-110" />
          </CardHeader>
          <CardContent className="relative">
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

