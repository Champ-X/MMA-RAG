import { Globe2, Server, Layers, Database, Cloud, Workflow, ArrowDown, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function ArchitectureDiagram() {
  return (
    <section id="system-architecture" className="scroll-mt-24 space-y-4">
      <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 shadow-sm dark:bg-sky-950/40 dark:text-sky-200">
        <Workflow className="h-3.5 w-3.5" />
        <span>整体架构图</span>
      </div>

      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Browser ↓ Backend ↓ Storage & Models</h2>
        <p className="max-w-3xl break-words text-xs leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
          从浏览器到后端 FastAPI，再到 DDD 业务模块与底层存储/模型服务，下面这张纵向示意图展示了一次 RAG 请求经过的主要"车站"。
        </p>
      </div>

      <Card className="group relative overflow-hidden border-slate-200/80 bg-gradient-to-br from-slate-50/95 via-indigo-50/30 to-purple-50/30 shadow-xl transition-all duration-500 hover:shadow-2xl dark:border-slate-800/80 dark:from-slate-950 dark:via-indigo-950/20 dark:to-purple-950/20">
        {/* 背景装饰 */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-purple-500/0 to-pink-500/0 transition-all duration-700 group-hover:from-indigo-500/5 group-hover:via-purple-500/5 group-hover:to-pink-500/5" />
        <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-gradient-to-br from-indigo-200/20 to-purple-200/20 blur-3xl dark:from-indigo-800/10 dark:to-purple-800/10" />
        <div className="absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-gradient-to-br from-emerald-200/20 to-teal-200/20 blur-3xl dark:from-emerald-800/10 dark:to-teal-800/10" />
        
        <CardHeader className="relative pb-2">
          <CardTitle className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Zap className="h-3.5 w-3.5 text-indigo-500" />
            <span>系统架构示意</span>
          </CardTitle>
        </CardHeader>
        
        <CardContent className="relative space-y-4">
          <div className="flex flex-col items-center gap-3">
            {/* 顶部：Browser */}
            <div className="group/browser relative w-full max-w-2xl flex flex-col items-center justify-center rounded-xl border-2 border-indigo-200/60 bg-gradient-to-br from-indigo-50/90 via-white to-purple-50/50 p-4 text-center shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:border-indigo-300/80 hover:shadow-xl dark:border-indigo-800/60 dark:from-indigo-950/50 dark:via-slate-950 dark:to-purple-950/30">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-indigo-500/0 to-purple-500/0 transition-all duration-300 group-hover/browser:from-indigo-500/10 group-hover/browser:to-purple-500/10" />
              <div className="relative mb-2 flex items-center gap-2">
                <div className="rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 p-1.5 shadow-md">
                  <Globe2 className="h-4 w-4 text-white" />
                </div>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Browser / Frontend</span>
              </div>
              <div className="relative space-y-0.5">
                <p className="text-[11px] font-medium leading-tight text-slate-600 dark:text-slate-300 break-words">
                  React + TypeScript + Vite
                </p>
                <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400 break-words">
                  Chat Interface / Knowledge List / Thinking Capsule
                </p>
              </div>
            </div>

            {/* 连接箭头 - 增强版 */}
            <div className="relative flex items-center justify-center py-1.5">
              <div className="absolute flex h-8 w-px items-center justify-center bg-gradient-to-b from-indigo-400/60 via-purple-400/60 to-emerald-400/60 dark:from-indigo-500 dark:via-purple-500 dark:to-emerald-500">
                <div className="absolute h-full w-full bg-gradient-to-b from-transparent via-white/50 to-transparent dark:via-slate-900/50" />
              </div>
              <div className="relative z-10 rounded-full bg-gradient-to-br from-indigo-500 to-emerald-500 p-1.5 shadow-lg">
                <ArrowDown className="h-4 w-4 animate-bounce text-white" />
              </div>
            </div>

            {/* 中间：Backend DDD */}
            <div className="group/backend relative w-full max-w-5xl rounded-xl border-2 border-emerald-200/60 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/50 p-4 shadow-lg backdrop-blur-sm transition-all duration-300 hover:border-emerald-300/80 hover:shadow-xl dark:border-emerald-800/60 dark:from-emerald-950/50 dark:via-slate-950 dark:to-teal-950/30">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-emerald-500/0 to-teal-500/0 transition-all duration-300 group-hover/backend:from-emerald-500/10 group-hover/backend:to-teal-500/10" />
              <div className="relative mb-3 flex items-center justify-center gap-2">
                <div className="rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 p-1.5 shadow-md">
                  <Server className="h-4 w-4 text-white" />
                </div>
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">FastAPI Backend (DDD)</span>
              </div>
              <div className="relative grid gap-2.5 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                <div className="group/module relative overflow-hidden rounded-lg border border-indigo-200/50 bg-gradient-to-br from-indigo-50/80 to-indigo-100/40 p-3 transition-all duration-300 hover:scale-105 hover:border-indigo-300/70 hover:bg-indigo-100/90 hover:shadow-lg dark:border-indigo-800/50 dark:from-indigo-950/40 dark:to-indigo-900/30 dark:hover:border-indigo-700/70 dark:hover:bg-indigo-900/50">
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 to-purple-500/0 transition-all duration-300 group-hover/module:from-indigo-500/10 group-hover/module:to-purple-500/10" />
                  <div className="relative mb-2 flex items-center gap-1.5">
                    <div className="rounded-lg bg-indigo-500/10 p-1 dark:bg-indigo-500/20">
                      <Layers className="h-3.5 w-3.5 flex-shrink-0 text-indigo-600 transition-transform duration-300 group-hover/module:scale-110 group-hover/module:rotate-3 dark:text-indigo-300" />
                    </div>
                    <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-200">Ingestion</span>
                  </div>
                  <p className="relative text-[10px] leading-tight break-words text-indigo-900/80 dark:text-indigo-100/90">文件解析、Dense+BGE-M3+CLIP 向量化，多来源接入，写入 MinIO 与 Qdrant</p>
                </div>
                <div className="group/module relative overflow-hidden rounded-lg border border-sky-200/50 bg-gradient-to-br from-sky-50/80 to-sky-100/40 p-3 transition-all duration-300 hover:scale-105 hover:border-sky-300/70 hover:bg-sky-100/90 hover:shadow-lg dark:border-sky-800/50 dark:from-sky-950/40 dark:to-sky-900/30 dark:hover:border-sky-700/70 dark:hover:bg-sky-900/50">
                  <div className="absolute inset-0 bg-gradient-to-br from-sky-500/0 to-cyan-500/0 transition-all duration-300 group-hover/module:from-sky-500/10 group-hover/module:to-cyan-500/10" />
                  <div className="relative mb-2 flex items-center gap-1.5">
                    <div className="rounded-lg bg-sky-500/10 p-1 dark:bg-sky-500/20">
                      <Layers className="h-3.5 w-3.5 flex-shrink-0 text-sky-600 transition-transform duration-300 group-hover/module:scale-110 group-hover/module:rotate-3 dark:text-sky-300" />
                    </div>
                    <span className="text-[11px] font-bold text-sky-700 dark:text-sky-200">Knowledge</span>
                  </div>
                  <p className="relative text-[10px] leading-tight break-words text-sky-900/80 dark:text-sky-100/90">知识库管理与画像生成，支撑智能路由决策</p>
                </div>
                <div className="group/module relative overflow-hidden rounded-lg border border-emerald-200/50 bg-gradient-to-br from-emerald-50/80 to-emerald-100/40 p-3 transition-all duration-300 hover:scale-105 hover:border-emerald-300/70 hover:bg-emerald-100/90 hover:shadow-lg dark:border-emerald-800/50 dark:from-emerald-950/40 dark:to-emerald-900/30 dark:hover:border-emerald-700/70 dark:hover:bg-emerald-900/50">
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-teal-500/0 transition-all duration-300 group-hover/module:from-emerald-500/10 group-hover/module:to-teal-500/10" />
                  <div className="relative mb-2 flex items-center gap-1.5">
                    <div className="rounded-lg bg-emerald-500/10 p-1 dark:bg-emerald-500/20">
                      <Layers className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600 transition-transform duration-300 group-hover/module:scale-110 group-hover/module:rotate-3 dark:text-emerald-300" />
                    </div>
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-200">Retrieval</span>
                  </div>
                  <p className="relative text-[10px] leading-tight break-words text-emerald-900/80 dark:text-emerald-100/90">One-Pass 意图、三路混合检索（Dense+Sparse+Visual）与两阶段重排</p>
                </div>
                <div className="group/module relative overflow-hidden rounded-lg border border-purple-200/50 bg-gradient-to-br from-purple-50/80 to-purple-100/40 p-3 transition-all duration-300 hover:scale-105 hover:border-purple-300/70 hover:bg-purple-100/90 hover:shadow-lg dark:border-purple-800/50 dark:from-purple-950/40 dark:to-purple-900/30 dark:hover:border-purple-700/70 dark:hover:bg-purple-900/50">
                  <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-500/0 transition-all duration-300 group-hover/module:from-purple-500/10 group-hover/module:to-pink-500/10" />
                  <div className="relative mb-2 flex items-center gap-1.5">
                    <div className="rounded-lg bg-purple-500/10 p-1 dark:bg-purple-500/20">
                      <Layers className="h-3.5 w-3.5 flex-shrink-0 text-purple-600 transition-transform duration-300 group-hover/module:scale-110 group-hover/module:rotate-3 dark:text-purple-300" />
                    </div>
                    <span className="text-[11px] font-bold text-purple-700 dark:text-purple-200">Generation &amp; LLM Manager</span>
                  </div>
                  <p className="relative text-[10px] leading-tight break-words text-purple-900/80 dark:text-purple-100/90">上下文构建、系统提示词管理，模型路由与流式生成</p>
                </div>
              </div>
            </div>

            {/* 连接箭头 - 增强版 */}
            <div className="relative flex items-center justify-center py-1.5">
              <div className="absolute flex h-8 w-px items-center justify-center bg-gradient-to-b from-emerald-400/60 via-amber-400/60 to-violet-400/60 dark:from-emerald-500 dark:via-amber-500 dark:to-violet-500">
                <div className="absolute h-full w-full bg-gradient-to-b from-transparent via-white/50 to-transparent dark:via-slate-900/50" />
              </div>
              <div className="relative z-10 rounded-full bg-gradient-to-br from-emerald-500 to-violet-500 p-1.5 shadow-lg">
                <ArrowDown className="h-4 w-4 animate-bounce text-white" />
              </div>
            </div>

            {/* 底部：Storage & Models */}
            <div className="grid w-full max-w-5xl gap-3 sm:grid-cols-2">
              <div className="group/storage relative overflow-hidden rounded-xl border-2 border-amber-200/60 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/50 p-3.5 text-xs shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:border-amber-300/80 hover:shadow-xl dark:border-amber-800/60 dark:from-amber-950/50 dark:via-slate-950 dark:to-orange-950/30">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/0 to-orange-500/0 transition-all duration-300 group-hover/storage:from-amber-500/10 group-hover/storage:to-orange-500/10" />
                <div className="relative mb-2.5 flex items-center justify-center gap-2">
                  <div className="rounded-full bg-gradient-to-br from-amber-500 to-orange-500 p-1.5 shadow-md">
                    <Database className="h-3.5 w-3.5 flex-shrink-0 text-white" />
                  </div>
                  <span className="text-xs font-bold text-amber-800 dark:text-amber-200">Storage Layer</span>
                </div>
                <div className="relative space-y-1.5 text-center">
                  <div className="rounded-lg bg-amber-100/50 px-2.5 py-1.5 text-[10px] leading-tight text-amber-900/90 dark:bg-amber-900/30 dark:text-amber-100/90">
                    <p className="break-words font-medium">MinIO（对象存储）</p>
                  </div>
                  <div className="rounded-lg bg-amber-100/50 px-2.5 py-1.5 text-[10px] leading-tight text-amber-900/90 dark:bg-amber-900/30 dark:text-amber-100/90">
                    <p className="break-words font-medium">Qdrant（向量与稀疏索引）</p>
                  </div>
                  <div className="rounded-lg bg-amber-100/50 px-2.5 py-1.5 text-[10px] leading-tight text-amber-900/90 dark:bg-amber-900/30 dark:text-amber-100/90">
                    <p className="break-words font-medium">Redis（缓存与队列）</p>
                  </div>
                </div>
              </div>

              <div className="group/models relative overflow-hidden rounded-xl border-2 border-violet-200/60 bg-gradient-to-br from-violet-50/90 via-white to-purple-50/50 p-3.5 text-xs shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:border-violet-300/80 hover:shadow-xl dark:border-violet-800/60 dark:from-violet-950/50 dark:via-slate-950 dark:to-purple-950/30">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/0 to-purple-500/0 transition-all duration-300 group-hover/models:from-violet-500/10 group-hover/models:to-purple-500/10" />
                <div className="relative mb-2.5 flex items-center justify-center gap-2">
                  <div className="rounded-full bg-gradient-to-br from-violet-500 to-purple-500 p-1.5 shadow-md">
                    <Cloud className="h-3.5 w-3.5 flex-shrink-0 text-white" />
                  </div>
                  <span className="text-xs font-bold text-violet-800 dark:text-violet-200">Model &amp; External Services</span>
                </div>
                <div className="relative space-y-1.5 text-center">
                  <div className="rounded-lg bg-violet-100/50 px-2.5 py-1.5 text-[10px] leading-tight text-violet-900/90 dark:bg-violet-900/30 dark:text-violet-100/90">
                    <p className="break-words font-medium">SiliconFlow / OpenRouter / 阿里云百炼 / DeepSeek / Qwen</p>
                  </div>
                  <div className="rounded-lg bg-violet-100/50 px-2.5 py-1.5 text-[10px] leading-tight text-violet-900/90 dark:bg-violet-900/30 dark:text-violet-100/90">
                    <p className="break-words font-medium">Qwen3-Embedding / BGE-M3 / Reranker / VLM / CLIP</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200/60 bg-gradient-to-r from-slate-50/80 to-indigo-50/40 p-3 dark:border-slate-800/60 dark:from-slate-950/80 dark:to-indigo-950/40">
            <p className="break-words text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break">
              <span className="font-semibold text-slate-700 dark:text-slate-200">一句话概括：</span>
              浏览器发起问题 → FastAPI 聚合 DDD 模块完成"意图 → 路由 → 检索 → 生成"整条链路 →
              依托 MinIO/Qdrant/Redis 等基础设施与外部大模型服务，返回带引用且可解释的回答。
            </p>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
