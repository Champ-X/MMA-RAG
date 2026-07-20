import { useQuery } from '@tanstack/react-query'
import { Bot, CheckCircle2, Compass, Shield } from 'lucide-react'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'

export default function AgentsPage() {
  const profiles = useQuery({ queryKey: ['agent-profiles'], queryFn: nexusApi.listAgentProfiles })
  if (profiles.isLoading) return <LoadingState />
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Nexus Harness" title="Agent profiles" description="Profiles declare capability and policy; the Harness enforces scope, evidence gain, trust gates and stopping outside model prompts." />
      {profiles.data?.items.length ? <div className="agent-grid">{profiles.data.items.map((profile) => <article className="agent-card" key={profile.id}><header><span><Bot size={18} /></span><div><h2>{profile.id.replaceAll('-', ' ')}</h2><small>{profile.default_quality} · minimum {profile.minimum_verification}</small></div><StatusMark status={profile.enabled ? 'ready' : 'disabled'} /></header><p>{profile.description}</p><div className="agent-section"><strong><Compass size={13} />Allowed tools</strong><span className="tag-row">{profile.tools.map((tool) => <em key={tool}>{tool}</em>)}</span></div><div className="agent-section"><strong><Shield size={13} />External safeguards</strong>{Object.entries(profile.policy).map(([key, value]) => <span className="policy-row" key={key}><CheckCircle2 size={12} />{key.replaceAll('_', ' ')}: {String(value)}</span>)}</div></article>)}</div> : <EmptyState title="No Agent profiles" body="Research remains disabled until a Harness policy profile is available." />}
    </div>
  )
}
