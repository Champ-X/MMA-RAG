import { useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
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

const moduleColors = {
  blue: {
    badge: 'border-[#a5c3d4] bg-[#e7eff5] text-[#426f92] dark:border-[#3f6078] dark:bg-[#426f92]/12 dark:text-[#9bc0dc]',
    dot: 'bg-[#5e8db0]',
  },
  green: {
    badge: 'border-[#afcbb8] bg-[#e8f0e8] text-[#5f8e72] dark:border-[#3d624d] dark:bg-[#5f8e72]/12 dark:text-[#91c3a1]',
    dot: 'bg-[#5f8e72]',
  },
  orange: {
    badge: 'border-[#e5b89d] bg-[#f6e8dc] text-[#d76f43] dark:border-[#754b37] dark:bg-[#e47b4e]/12 dark:text-[#eeaa88]',
    dot: 'bg-[#e47b4e]',
  },
  purple: {
    badge: 'border-[#c6b8d2] bg-[#eee9f2] text-[#765c95] dark:border-[#59476e] dark:bg-[#765c95]/12 dark:text-[#c2add6]',
    dot: 'bg-[#765c95]',
  },
} as const

export function ModuleExplorer({ modules }: ModuleExplorerProps) {
  const [activeId, setActiveId] = useState(modules[0]?.id ?? '')
  const activeModule = modules.find((module) => module.id === activeId) ?? modules[0]

  if (!activeModule) return null

  const activeColors = moduleColors[activeModule.color]

  return (
    <div className="mt-9 overflow-hidden rounded-[28px] border border-[#b9ccc6] bg-[#edf2ed] shadow-[0_34px_90px_-64px_rgba(16,45,66,0.72)] dark:border-[#2b4d58] dark:bg-[#0b222c]">
      <div className="grid min-w-0 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="min-w-0 bg-[#102d42] p-3 text-white sm:p-4">
          <div className="px-3 pb-4 pt-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-[#80bdc7]">Domain index</p>
            <p className="mt-1.5 text-[13px] leading-6 text-[#a9bec1]">从职责切换到代码，而不是从目录猜职责。</p>
          </div>
          <div
            role="tablist"
            aria-label="核心模块"
            className="scrollbar-hide flex min-w-0 max-w-full gap-2 overflow-x-auto lg:block lg:space-y-1"
          >
            {modules.map((module) => {
              const Icon = moduleIcons[module.id as keyof typeof moduleIcons] ?? Code2
              const isActive = module.id === activeModule.id
              const colors = moduleColors[module.color]

              return (
                <button
                  key={module.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls="module-panel"
                  onClick={() => setActiveId(module.id)}
                  className={cn(
                    'group flex min-h-[4.25rem] min-w-[10rem] items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fc2cf] lg:min-w-0 lg:w-full',
                    isActive
                      ? 'border-white/15 bg-white/10 text-white shadow-[inset_0_1px_rgba(255,255,255,0.08)]'
                      : 'border-transparent text-[#9fb5b9] hover:border-white/10 hover:bg-white/[0.055] hover:text-white'
                  )}
                >
                  <span className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-[#9fb5b9] transition-colors',
                    isActive && 'bg-white text-[#102d42]'
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{module.name}</span>
                    <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#78939a]">
                      <i className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />
                      {module.id}
                    </span>
                  </span>
                  <ChevronRight className={cn('hidden h-4 w-4 shrink-0 transition-transform lg:block', isActive ? 'text-[#7fc2cf]' : '-translate-x-1 text-[#496976] group-hover:translate-x-0')} />
                </button>
              )
            })}
          </div>
        </div>

        <div
          key={activeModule.id}
          id="module-panel"
          role="tabpanel"
          className="animate-in fade-in min-w-0 bg-white/30 p-5 dark:bg-white/[0.018] sm:p-8 lg:p-10"
        >
          <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${activeColors.badge}`}>
                <i className={`h-1.5 w-1.5 rounded-full ${activeColors.dot}`} />
                {activeModule.id}
              </div>
              <h3 className="architecture-display mt-4 text-3xl font-semibold tracking-[-0.035em] text-[#102d42] dark:text-[#edf6f3] sm:text-4xl">
                {activeModule.name}
              </h3>
              <p className="mt-3 text-sm leading-7 text-[#586f74] dark:text-[#abc0c1]">{activeModule.role}</p>
            </div>

            <div className="grid w-full overflow-hidden rounded-[20px] border border-[#c5d5cf] bg-[#e8eee9] dark:border-[#294a56] dark:bg-[#071a24]/45 sm:grid-cols-2 xl:max-w-[32rem]">
              <ContractCell icon={<ArrowDownToLine />} label="接收" value={activeModule.receives} />
              <ContractCell icon={<ArrowUpFromLine />} label="交付" value={activeModule.delivers} bordered />
            </div>
          </div>

          <div className="mt-9 grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,0.62fr)]">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#738789] dark:text-[#8ba5a7]">Responsibilities</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {activeModule.highlights.map((item) => (
                  <li
                    key={item}
                    className="relative rounded-2xl border border-[#cad8d3] bg-white/55 px-4 py-3.5 pl-6 text-[13px] leading-6 text-[#526b70] dark:border-[#2b4c57] dark:bg-white/[0.03] dark:text-[#b2c5c5]"
                  >
                    <span className={`absolute left-3 top-[1.12rem] h-1.5 w-1.5 rounded-full ${activeColors.dot}`} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {activeModule.codeRefs?.length ? (
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#738789] dark:text-[#8ba5a7]">
                  <Code2 className="h-3.5 w-3.5 text-[#2f7f93]" />
                  Code map
                </p>
                <dl className="mt-3 min-w-0 max-w-full overflow-hidden rounded-2xl bg-[#102d42] text-[#d3e2df]">
                  {activeModule.codeRefs.map((ref, index) => (
                    <div key={`${ref.label}-${ref.path}`} className={cn('px-4 py-3.5', index > 0 && 'border-t border-white/10')}>
                      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7fc2cf]">{ref.label}</dt>
                      <dd className="mt-1.5 overflow-x-auto font-mono text-[10px] leading-6 text-[#c5d7d4]">{ref.path}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function ContractCell({ icon, label, value, bordered = false }: { icon: React.ReactNode; label: string; value: string; bordered?: boolean }) {
  return (
    <div className={cn('p-4', bordered && 'border-t border-[#c5d5cf] dark:border-[#294a56] sm:border-l sm:border-t-0')}>
      <div className="flex items-center gap-2 text-[#2f7f93] dark:text-[#7fc2cf] [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon}
        <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</dt>
      </div>
      <dd className="mt-2 text-xs leading-6 text-[#526d72] dark:text-[#a6bcbc]">{value}</dd>
    </div>
  )
}
