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
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-100/90 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/70 dark:text-slate-100">
        <span className="h-2 w-2 rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 shadow-[0_0_8px_rgba(99,102,241,0.45)]" />
        <span>技术栈与非功能特性</span>
      </div>

      <p className="max-w-4xl break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
        后端 FastAPI + DDD，前端 React + Vite + Tailwind；数据平面为 MinIO、Qdrant、Redis（Celery broker）；模型由 LLMManager 按 task_type 路由至 SiliconFlow / OpenRouter / 阿里云百炼 / DeepSeek 等；嵌入与检索侧含 Qwen3-Embedding、BGE-M3、CLIP、CLAP、Reranker。飞书为<strong className="font-medium text-slate-800 dark:text-slate-200"> 可选 </strong>
        集成。默认依赖编排见仓库根目录 <span className="font-mono text-[12px]">docker-compose.yml</span>。
      </p>

      <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {techStackItems.map((item, index) => {
          const meta = categoryLabel[item.category]
          return (
            <div
              key={item.id}
              className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-100 bg-white/90 p-3 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-slate-200/90 dark:border-slate-800/80 dark:bg-slate-950/80 dark:hover:border-slate-700/90"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/0 via-indigo-50/0 to-violet-50/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-transparent dark:via-indigo-950/20 dark:to-transparent" />
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

      <div className="rounded-xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-indigo-50/20 to-teal-50/15 p-4 dark:border-slate-800/80 dark:from-slate-900/60 dark:via-indigo-950/25 dark:to-teal-950/10">
        <p className="mb-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">非功能特性（按模块可扩展）</p>
        <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <li className="flex items-start gap-2">
            <span className="mt-[5px] h-1 w-1 flex-shrink-0 rounded-full bg-indigo-500" />
            <span>可观测性：结构化日志、检索与生成链路事件，便于对接监控与排障</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-[5px] h-1 w-1 flex-shrink-0 rounded-full bg-indigo-500" />
            <span>安全性：密钥集中于 backend/.env（勿提交）；可按需在 API 层增加认证与限流</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-[5px] h-1 w-1 flex-shrink-0 rounded-full bg-indigo-500" />
            <span>扩展性：DDD 边界清晰，可替换向量库、Provider 或存储实现</span>
          </li>
        </ul>
      </div>
    </section>
  )
}

