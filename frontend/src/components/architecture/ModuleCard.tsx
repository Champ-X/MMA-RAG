import { useState } from 'react'
import { ArrowUpRight, Code2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ModuleInfo } from '@/data/architectureData'

interface ModuleCardProps {
  module: ModuleInfo
}

export function ModuleCard({ module }: ModuleCardProps) {
  const [open, setOpen] = useState(false)

  const colorClass =
    module.color === 'blue'
      ? 'border-sky-200/60 bg-gradient-to-br from-sky-50/90 via-white to-cyan-50/50 dark:border-sky-800/60 dark:from-sky-950/50 dark:via-slate-950 dark:to-cyan-950/30'
      : module.color === 'green'
      ? 'border-emerald-200/60 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/50 dark:border-emerald-800/60 dark:from-emerald-950/50 dark:via-slate-950 dark:to-teal-950/30'
      : module.color === 'orange'
      ? 'border-amber-200/60 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/50 dark:border-amber-800/60 dark:from-amber-950/50 dark:via-slate-950 dark:to-orange-950/30'
      : 'border-purple-200/60 bg-gradient-to-br from-purple-50/90 via-white to-pink-50/50 dark:border-purple-800/60 dark:from-purple-950/50 dark:via-slate-950 dark:to-pink-950/30'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'group relative flex h-full min-h-[220px] flex-col overflow-hidden rounded-xl border-2 p-4 text-left text-xs shadow-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950',
          colorClass
        )}
      >
        {/* 左侧装饰条 */}
        <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-indigo-400/60 via-purple-400/60 to-pink-400/60 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:from-indigo-500 dark:via-purple-500 dark:to-pink-500" />
        
        {/* 背景渐变 */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/0 via-white/0 to-white/0 transition-all duration-300 group-hover:from-white/30 group-hover:via-white/15 group-hover:to-white/5 dark:group-hover:from-white/10 dark:group-hover:via-white/0 dark:group-hover:to-white/0" />
        
        {/* 内容区域 */}
        <div className="relative flex flex-col h-full">
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="flex-1 break-words text-xs font-bold leading-tight text-slate-800 dark:text-slate-50">{module.name}</div>
            <div className="flex-shrink-0 rounded-lg bg-white/60 p-1.5 shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:bg-white/80 dark:bg-slate-800/60 dark:group-hover:bg-slate-800/80">
              <ArrowUpRight className="h-3.5 w-3.5 text-slate-500 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:text-slate-400" />
            </div>
          </div>
          
          <p className="mb-3 break-words text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break">{module.role}</p>
          
          <ul className="relative flex-1 space-y-2 text-[11px] text-slate-600 dark:text-slate-300">
            {module.highlights.slice(0, 4).map((item, idx) => (
              <li key={item} className="flex items-start gap-2 transition-all duration-200 group-hover:translate-x-0.5" style={{ transitionDelay: `${idx * 30}ms` }}>
                <span className="mt-[6px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 transition-all duration-200 group-hover:scale-125 group-hover:shadow-sm dark:from-indigo-500 dark:to-purple-500" />
                <span className="flex-1 break-words leading-relaxed text-chinese-break line-clamp-2">{item}</span>
              </li>
            ))}
            {module.highlights.length > 4 && (
              <li className="pt-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 italic transition-colors duration-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
                点击查看全部 {module.highlights.length} 项特性...
              </li>
            )}
          </ul>
        </div>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-h-[80vh] w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl animate-in zoom-in-95 duration-200 dark:border-slate-800/80 dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 text-xs dark:border-slate-800/80">
              <div>
                <div className="text-[11px] font-semibold text-slate-900 dark:text-slate-50">{module.name}</div>
                <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{module.role}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-4 px-4 py-4 text-xs text-slate-600 dark:text-slate-300">
              <div>
                <div className="mb-2 text-[11px] font-semibold text-slate-800 dark:text-slate-100">核心功能与特性</div>
                <ul className="space-y-2">
                  {module.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-[6px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-500 dark:bg-indigo-400" />
                      <span className="flex-1 break-words leading-relaxed text-chinese-break">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {module.codeRefs && module.codeRefs.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                    <Code2 className="h-3.5 w-3.5 text-indigo-500" />
                    <span>相关代码入口（示意）</span>
                  </div>
                  <ul className="space-y-1.5 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {module.codeRefs.map(ref => (
                      <li
                        key={`${ref.label}-${ref.path}`}
                        className="flex items-center justify-between rounded border border-slate-100/80 bg-slate-50/80 px-2 py-1 dark:border-slate-800/80 dark:bg-slate-900/60"
                      >
                        <span className="mr-2 text-[10px] text-slate-700 dark:text-slate-200">{ref.label}</span>
                        <span className="truncate text-[10px] text-slate-400 dark:text-slate-500">{ref.path}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

