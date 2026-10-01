import { useState, type ReactNode } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Bot,
  Braces,
  Check,
  Code2,
  FileInput,
  LibraryBig,
  Search,
  Sparkles,
} from 'lucide-react'
import type { ModuleInfo } from '@/data/architectureData'
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

export function ModuleExplorer({ modules }: ModuleExplorerProps) {
  const [activeId, setActiveId] = useState(modules[0]?.id ?? '')
  const activeModule = modules.find((module) => module.id === activeId) ?? modules[0]

  if (!activeModule) return null

  return (
    <Tabs.Root value={activeModule.id} onValueChange={setActiveId} className="architecture-module-explorer atlas-module-explorer">
      <Tabs.List aria-label="核心模块" className="atlas-module-tabs">
        {modules.map((module) => {
          const Icon = moduleIcons[module.id as keyof typeof moduleIcons] ?? Code2
          return (
            <Tabs.Trigger key={module.id} value={module.id} className="atlas-module-tab" data-module={module.id}>
              <span className="atlas-module-tab-icon"><Icon size={16} aria-hidden="true" /></span>
              {module.name}
            </Tabs.Trigger>
          )
        })}
      </Tabs.List>

      {modules.map((module) => {
        const Icon = moduleIcons[module.id as keyof typeof moduleIcons] ?? Code2
        return (
          <Tabs.Content key={module.id} value={module.id} className="architecture-module-panel atlas-module-panel" data-module={module.id}>
            <header className="atlas-module-heading">
              <span className="atlas-module-heading-icon"><Icon size={23} aria-hidden="true" /></span>
              <div><h3>{module.name}</h3><p>{module.role}</p></div>
            </header>

            <div className="atlas-module-contracts">
              <ContractCell icon={<ArrowDownToLine size={15} />} label="接收" value={module.receives} />
              <span className="atlas-contract-connector" aria-hidden="true"><ArrowRight size={20} /></span>
              <ContractCell icon={<ArrowUpFromLine size={15} />} label="交付" value={module.delivers} />
            </div>

            <div className="atlas-module-body">
              <div className="atlas-module-responsibilities">
                <h4>核心职责</h4>
                <ul role="list">
                  {module.highlights.map((item) => (
                    <li key={item}><Check size={14} aria-hidden="true" /><span>{item}</span></li>
                  ))}
                </ul>
              </div>

              {module.codeRefs?.length ? (
                <div className="atlas-module-code">
                  <h4><Code2 size={16} aria-hidden="true" />代码入口</h4>
                  <dl>
                    {module.codeRefs.map((ref) => (
                      <div key={`${ref.label}-${ref.path}`}>
                        <dt>{ref.label}</dt>
                        <dd><code>{ref.path}</code></dd>
                      </div>
                    ))}
                  </dl>
                </div>
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
