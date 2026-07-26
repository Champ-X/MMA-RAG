import { useState } from 'react'
import {
  Bot,
  Braces,
  ChevronRight,
  Code2,
  FileInput,
  LibraryBig,
  Search,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ModuleInfo } from '@/data/architectureData'

interface ModuleExplorerProps {
  modules: ModuleInfo[]
}

const moduleIcons = {
  ingestion: FileInput,
  knowledge: LibraryBig,
  retrieval: Search,
  agent: Bot,
  generation: Sparkles,
  'llm-manager': Braces,
} as const

export function ModuleExplorer({ modules }: ModuleExplorerProps) {
  const [activeId, setActiveId] = useState(modules[0]?.id ?? '')
  const activeModule = modules.find((module) => module.id === activeId) ?? modules[0]

  if (!activeModule) return null

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_24px_70px_-58px_rgba(15,23,42,0.55)] dark:border-slate-800 dark:bg-slate-950">
      <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div
          role="tablist"
          aria-label="核心模块"
          className="scrollbar-hide flex overflow-x-auto border-b border-slate-200/80 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-slate-900/40 lg:block lg:border-b-0 lg:border-r lg:p-3"
        >
          {modules.map((module) => {
            const Icon = moduleIcons[module.id as keyof typeof moduleIcons] ?? Code2
            const isActive = module.id === activeModule.id

            return (
              <button
                key={module.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`module-panel-${module.id}`}
                onClick={() => setActiveId(module.id)}
                className={cn(
                  'group flex min-h-14 min-w-[11.5rem] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/70 lg:min-w-0 lg:w-full',
                  isActive
                    ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-white dark:ring-slate-700'
                    : 'text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100'
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    isActive
                      ? 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300'
                      : 'border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500'
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{module.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-slate-400 dark:text-slate-500">
                    {module.id}
                  </span>
                </span>
                <ChevronRight
                  className={cn(
                    'hidden h-4 w-4 shrink-0 transition-transform lg:block',
                    isActive ? 'translate-x-0 text-teal-600' : '-translate-x-1 text-slate-300 group-hover:translate-x-0'
                  )}
                />
              </button>
            )
          })}
        </div>

        <div
          key={activeModule.id}
          id={`module-panel-${activeModule.id}`}
          role="tabpanel"
          className="animate-in fade-in p-5 sm:p-7 lg:p-9"
        >
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-teal-700 dark:text-teal-300">
              {activeModule.id}
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950 dark:text-white">
              {activeModule.name}
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">{activeModule.role}</p>
          </div>

          <ul className="mt-7 grid gap-3 sm:grid-cols-2">
            {activeModule.highlights.map((item) => (
              <li
                key={item}
                className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600 ring-1 ring-inset ring-slate-200/70 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-800"
              >
                {item}
              </li>
            ))}
          </ul>

          {activeModule.codeRefs?.length ? (
            <div className="mt-8 border-t border-slate-200/80 pt-5 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                <Code2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                当前代码入口
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {activeModule.codeRefs.map((ref) => (
                  <div key={`${ref.label}-${ref.path}`} className="min-w-0">
                    <dt className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{ref.label}</dt>
                    <dd className="mt-1 overflow-x-auto font-mono text-[10px] leading-5 text-slate-700 dark:text-slate-300">
                      {ref.path}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
