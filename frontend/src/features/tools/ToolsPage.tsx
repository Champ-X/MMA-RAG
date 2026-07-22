import { useQuery } from '@tanstack/react-query'
import { LockKeyhole, Shield, Wrench } from 'lucide-react'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { StatusMark } from '@/components/nexus/StatusMark'
import './ToolsPage.css'

export default function ToolsPage() {
  const tools = useQuery({ queryKey: ['tools'], queryFn: nexusApi.listTools })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: tools.error, hasData: Boolean(tools.data), label: 'Tools', required: true },
  ])
  const retryTools = () => {
    void tools.refetch()
  }
  if (tools.isLoading) return <LoadingState />
  if (queryErrorNotice.tone === 'blocking') return <div className="page-shell"><PageHeader eyebrow="Harness-controlled surface" title="Tools could not be loaded" description="Nexus could not verify the typed tool registry." /><QueryErrorNotice model={queryErrorNotice} onRetry={retryTools} /><EmptyState title="Tool registry is temporarily unavailable" body="Retry before treating this environment as having no registered tools. Agent capability policy depends on the authoritative registry." /></div>
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Harness-controlled surface" title="Tools & MCP" description="The model sees only task-relevant typed tools. Scope, risk, approval and idempotency are enforced outside the prompt." />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryTools} />
      {tools.data?.items.length ? <div className="tool-grid">{tools.data.items.map((tool) => <article key={tool.id} className="tool-card"><header><span><Wrench size={16} /></span><div><h2>{tool.name}</h2><code>v{tool.version}</code></div><StatusMark status={tool.enabled ? 'ready' : 'disabled'} /></header><p>{tool.description}</p><footer><span><Shield size={13} />{tool.risk_level}</span><span><LockKeyhole size={13} />{tool.requires_approval ? 'approval' : tool.idempotency.replaceAll('_', ' ')}</span></footer></article>)}</div> : <EmptyState title="No tools registered" body="Seed the built-in read-only knowledge tools before enabling an Agent profile." />}
    </div>
  )
}
