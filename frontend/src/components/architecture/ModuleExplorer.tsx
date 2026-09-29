import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Braces,
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
  blue: 'bg-[#5e8db0]',
  green: 'bg-[#5f8e72]',
  orange: 'bg-[#e47b4e]',
  purple: 'bg-[#765c95]',
} as const

export function ModuleExplorer({ modules }: ModuleExplorerProps) {
  const [activeId, setActiveId] = useState(modules[0]?.id ?? '')
  const activeModule = modules.find((module) => module.id === activeId) ?? modules[0]

  if (!activeModule) return null

  return (
    <Tabs.Root
      value={activeModule.id}
      onValueChange={setActiveId}
      className="architecture-module-explorer mt-8 min-w-0 overflow-hidden rounded-2xl border border-[#b9ccc6] bg-white/45 dark:border-[#2b4d58] dark:bg-[#0b222c]"
    >
      <Tabs.List
        aria-label="核心模块"
        className="scrollbar-hide flex min-w-0 gap-1 overflow-x-auto border-b border-[#c5d5cf] bg-[#edf2ed]/70 p-2 dark:border-[#294a56] dark:bg-white/[0.025]"
      >
        {modules.map((module) => {
          const Icon = moduleIcons[module.id as keyof typeof moduleIcons] ?? Code2
          return (
            <Tabs.Trigger
              key={module.id}
              value={module.id}
              className="group inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-[#61777a] transition-colors hover:bg-white/65 hover:text-[#17384a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f7f93] data-[state=active]:bg-[#102d42] data-[state=active]:text-white dark:text-[#a1b8b9] dark:hover:bg-white/[0.06] dark:hover:text-white dark:data-[state=active]:bg-[#dcebe7] dark:data-[state=active]:text-[#102d42]"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {module.name}
            </Tabs.Trigger>
          )
        })}
      </Tabs.List>

      {modules.map((module) => (
        <Tabs.Content
          key={module.id}
          value={module.id}
          className="architecture-module-panel min-w-0 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2f7f93] sm:p-7 lg:p-8"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className={cn('h-2.5 w-2.5 rounded-full', moduleColors[module.color])} aria-hidden="true" />
            <h3 className="text-2xl font-semibold tracking-[-0.025em] text-[#102d42] dark:text-[#edf6f3]">{module.name}</h3>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[#586f74] dark:text-[#abc0c1]">{module.role}</p>

          <dl className="mt-6 grid gap-5 border-y border-[#c5d5cf] py-5 dark:border-[#294a56] sm:grid-cols-2 sm:gap-8">
            <ContractCell icon={<ArrowDownToLine />} label="接收" value={module.receives} />
            <ContractCell icon={<ArrowUpFromLine />} label="交付" value={module.delivers} />
          </dl>

          <div className="mt-7 grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] xl:gap-10">
            <div className="min-w-0">
              <h4 className="text-xs font-semibold tracking-wide text-[#526b70] dark:text-[#a9bfc0]">核心职责</h4>
              <ul className="mt-3 space-y-3" role="list">
                {module.highlights.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-7 text-[#526b70] dark:text-[#b2c5c5]">
                    <span className={cn('mt-3 h-1 w-1 shrink-0 rounded-full', moduleColors[module.color])} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {module.codeRefs?.length ? (
              <div className="min-w-0">
                <h4 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[#526b70] dark:text-[#a9bfc0]">
                  <Code2 className="h-4 w-4" aria-hidden="true" />
                  代码入口
                </h4>
                <dl className="mt-3 min-w-0 rounded-xl bg-[#edf2ed] px-4 dark:bg-[#071a24]/55">
                  {module.codeRefs.map((ref, index) => (
                    <div key={`${ref.label}-${ref.path}`} className={cn('py-3.5', index > 0 && 'border-t border-[#c5d5cf] dark:border-[#294a56]')}>
                      <dt className="text-xs font-semibold text-[#2f7f93] dark:text-[#7fc2cf]">{ref.label}</dt>
                      <dd className="mt-1.5 break-words font-mono text-xs leading-6 text-[#526b70] dark:text-[#b2c5c5]">{ref.path}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}

function ContractCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt className="flex items-center gap-2 text-xs font-semibold text-[#2f7f93] dark:text-[#7fc2cf] [&_svg]:h-4 [&_svg]:w-4" >
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="mt-2 text-sm leading-6 text-[#526d72] dark:text-[#a6bcbc]">{value}</dd>
    </div>
  )
}
