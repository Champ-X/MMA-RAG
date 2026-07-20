import { useQuery } from '@tanstack/react-query'
import { LockKeyhole, Shield, Wrench } from 'lucide-react'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'

export default function ToolsPage() {
  const tools = useQuery({ queryKey: ['tools'], queryFn: nexusApi.listTools })
  if (tools.isLoading) return <LoadingState />
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Harness-controlled surface" title="Tools & MCP" description="The model sees only task-relevant typed tools. Scope, risk, approval and idempotency are enforced outside the prompt." />
      {tools.data?.items.length ? <div className="tool-grid">{tools.data.items.map((tool) => <article key={tool.id} className="tool-card"><header><span><Wrench size={16} /></span><div><h2>{tool.name}</h2><code>v{tool.version}</code></div><StatusMark status={tool.enabled ? 'ready' : 'disabled'} /></header><p>{tool.description}</p><footer><span><Shield size={13} />{tool.risk_level}</span><span><LockKeyhole size={13} />{tool.requires_approval ? 'approval' : tool.idempotency.replaceAll('_', ' ')}</span></footer></article>)}</div> : <EmptyState title="No tools registered" body="Seed the built-in read-only knowledge tools before enabling an Agent profile." />}
    </div>
  )
}
