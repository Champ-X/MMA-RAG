import { techStackItems } from '@/data/architectureData'

const categoryLabel: Record<
  (typeof techStackItems)[number]['category'],
  { label: string; color: string; bg: string }
> = {
  backend: {
    label: '后端',
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
  },
  frontend: {
    label: '前端',
    color: 'text-sky-700 dark:text-sky-300',
    bg: 'bg-sky-50 dark:bg-sky-950/30',
  },
  storage: {
    label: '存储',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
  },
  model: {
    label: '模型',
    color: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-50 dark:bg-violet-950/30',
  },
  infra: {
    label: '基础设施',
    color: 'text-slate-700 dark:text-slate-300',
    bg: 'bg-slate-50 dark:bg-slate-900/60',
  },
  integration: {
    label: '集成',
    color: 'text-sky-700 dark:text-sky-300',
    bg: 'bg-sky-50 dark:bg-sky-950/30',
  },
}

export function TechStackSection() {
  return (
    <section id="tech-stack" className="scroll-mt-24 space-y-4">
      <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm dark:bg-slate-800/70 dark:text-slate-100">
        <span className="h-2 w-2 rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500" />
        <span>技术栈与非功能特性</span>
      </div>

      <p className="max-w-4xl break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
        项目采用分层清晰、易于扩展的技术栈：后端 FastAPI + DDD，前端 React + Tailwind，存储 MinIO/Qdrant/Redis（文档/图片/音频/视频分目录）；模型由 LLMManager 按任务路由，支持 SiliconFlow、OpenRouter、阿里云百炼、DeepSeek 等多厂商 API，以及 Qwen3-Embedding、BGE-M3、CLIP（图/视频）、CLAP（音频）、Reranker 等全模态能力；可选接入飞书开放平台（长连接、卡片与文件 API）。支持 Docker 容器化部署。
      </p>

      <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {techStackItems.map((item, index) => {
          const meta = categoryLabel[item.category]
          return (
            <div
              key={item.id}
              className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-100 bg-white/90 p-3 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-slate-800/80 dark:bg-slate-950/80"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${meta.bg.replace('bg-', 'from-').replace('/30', '/0').replace('/60', '/0')} transition-opacity duration-300 group-hover:opacity-20`} />
              <div className="relative mb-1 flex items-center justify-between gap-2">
                <div className="break-words text-[11px] font-semibold text-slate-900 transition-colors duration-300 group-hover:text-slate-700 dark:text-slate-50 dark:group-hover:text-slate-200">
                  {item.name}
                </div>
                <span
                  className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium shadow-sm transition-all duration-300 group-hover:scale-105 ${meta.bg} ${meta.color}`}
                >
                  {meta.label}
                </span>
              </div>
              {item.description && (
                <p className="relative mt-0.5 break-words text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {item.description}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-slate-200/80 bg-gradient-to-br from-slate-50/80 to-indigo-50/30 p-4 dark:border-slate-800/80 dark:from-slate-900/60 dark:to-indigo-950/30">
        <p className="mb-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">非功能特性</p>
        <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <li className="flex items-start gap-2">
            <span className="mt-[5px] h-1 w-1 flex-shrink-0 rounded-full bg-indigo-500" />
            <span>可观测性：结构化日志、检索统计、审计日志，支持后续监控系统对接</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-[5px] h-1 w-1 flex-shrink-0 rounded-full bg-indigo-500" />
            <span>安全性：支持 JWT 认证与限流机制（可按需接入）</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-[5px] h-1 w-1 flex-shrink-0 rounded-full bg-indigo-500" />
            <span>扩展性：模块化 DDD 设计，便于替换向量库、模型服务或存储后端</span>
          </li>
        </ul>
      </div>
    </section>
  )
}

