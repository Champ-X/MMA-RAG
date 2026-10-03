import { useState, type ReactNode } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FileInput,
  LibraryBig,
  Search,
  Sparkles,
} from 'lucide-react'
import type { ModuleInfo } from '@/data/architectureData'
import { FlowArrow } from './ConnectorLayer'
import './architectureExplorers.css'

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

const moduleLabels: Record<string, string> = {
  ingestion: 'Ingestion pipeline',
  knowledge: 'Knowledge space',
  retrieval: 'Retrieval core',
  agent: 'Agent runtime',
  generation: 'Answer delivery',
  'llm-manager': 'Model orchestration',
}

export function ModuleExplorer({ modules }: ModuleExplorerProps) {
  const [activeId, setActiveId] = useState(modules[0]?.id ?? '')
  const activeModule = modules.find((module) => module.id === activeId) ?? modules[0]

  if (!activeModule) return null

  return (
    <Tabs.Root value={activeModule.id} onValueChange={setActiveId} orientation="vertical" className="architecture-module-explorer atlas-module-explorer">
      <div className="atlas-module-directory">
        <div className="atlas-module-directory-heading"><span>职责目录</span><p>选择一个模块，理解它与系统的交接。</p></div>
        <Tabs.List aria-label="核心模块" className="atlas-module-tabs">
        {modules.map((module) => {
          const Icon = moduleIcons[module.id as keyof typeof moduleIcons] ?? Code2
          return (
            <Tabs.Trigger key={module.id} value={module.id} className="atlas-module-tab" data-module={module.id}>
              <span className="atlas-module-tab-icon"><Icon size={16} aria-hidden="true" /></span>
              <span className="atlas-module-tab-copy"><strong>{module.name}</strong><small lang="en">{moduleLabels[module.id] ?? module.id}</small></span>
              <ChevronRight className="atlas-module-tab-arrow" size={15} aria-hidden="true" />
            </Tabs.Trigger>
          )
        })}
        </Tabs.List>
      </div>

      {modules.map((module) => {
        const Icon = moduleIcons[module.id as keyof typeof moduleIcons] ?? Code2
        return (
          <Tabs.Content key={module.id} value={module.id} className="architecture-module-panel atlas-module-panel" data-module={module.id}>
            <div className="atlas-module-panel-label"><span lang="en">{moduleLabels[module.id] ?? module.id}</span></div>
            <header className="atlas-module-heading">
              <span className="atlas-module-heading-icon"><Icon size={23} aria-hidden="true" /></span>
              <h3>{module.name}</h3>
            </header>
            <p className="atlas-module-lead">{module.role}</p>

            <div className="atlas-module-contracts">
              <ContractCell icon={<ArrowDownToLine size={15} />} label="接收什么" value={module.receives} />
              <span className="atlas-contract-connector" aria-hidden="true"><FlowArrow /></span>
              <ContractCell icon={<ArrowUpFromLine size={15} />} label="交付什么" value={module.delivers} />
            </div>

            <div className="atlas-module-body">
              <div className="atlas-module-responsibilities">
                <h4>如何完成这份职责</h4>
                <ul role="list">
                  {module.highlights.map((item) => (
                    <li key={item}><Check size={14} aria-hidden="true" /><span>{item}</span></li>
                  ))}
                </ul>
              </div>

              {module.codeRefs?.length ? (
                <details className="atlas-module-code">
                  <summary><Code2 size={17} aria-hidden="true" /><span>查看实现入口</span><small>{module.codeRefs.length} 处</small><ChevronDown size={16} aria-hidden="true" /></summary>
                  <dl>
                    {module.codeRefs.map((ref) => (
                      <div key={`${ref.label}-${ref.path}`}>
                        <dt>{ref.label}</dt>
                        <dd><code>{ref.path}</code></dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </div>
          </Tabs.Content>
        )
      })}
    </Tabs.Root>
  )
}

function ContractCell({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <dl className="atlas-contract-cell">
      <dt><span aria-hidden="true">{icon}</span>{label}</dt>
      <dd>{value}</dd>
    </dl>
  )
}
