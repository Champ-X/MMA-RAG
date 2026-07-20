import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Cable,
  CheckCircle2,
  Eye,
  Headphones,
  Route,
  SearchCheck,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { nexusApi, type Model, type ModelSetup } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { taskLabel } from './modelTasks'

const setupGroups: Record<string, { label: string; description: string; icon: typeof BrainCircuit }> = {
  answering: { label: 'Answering & research', description: 'Quick answers, research synthesis, planning and claim checks.', icon: BrainCircuit },
  knowledge_navigation: { label: 'Knowledge navigation', description: 'Intent recognition, query rewriting and Space routing.', icon: SearchCheck },
  visual_understanding: { label: 'Visual understanding', description: 'Images, document figures and video scenes.', icon: Eye },
  audio_understanding: { label: 'Audio understanding', description: 'Standalone audio and video-track transcription.', icon: Headphones },
  retrieval_quality: { label: 'Retrieval quality', description: 'Dense embeddings and reranking.', icon: SlidersHorizontal },
}

const setupHeadline: Record<ModelSetup['status'], { title: string; body: string }> = {
  ready: { title: 'Recommended task coverage is complete.', body: 'Every governed task has an active route. Your custom choices remain editable in Advanced task routes.' },
  action_available: { title: 'Verified models can complete more tasks.', body: 'Nexus can fill missing routes without changing any active custom route.' },
  verification_required: { title: 'Models were discovered but are not trusted yet.', body: 'Run capability probes before a model can receive real tasks.' },
  credentials_required: { title: 'Connect one model provider to begin.', body: 'Credentials stay in environment variables; Nexus stores only the reference name.' },
  partial: { title: 'Core work can continue with explicit fallbacks.', body: 'Add a verified capability only for the tasks where you need a managed remote model.' },
}

type RecommendedSetupPanelProps = {
  setup: ModelSetup
  models: Model[]
  busy: boolean
  run: (operation: () => Promise<unknown>) => void
  announce: (message: string) => void
}

export function RecommendedSetupPanel({ setup, models, busy, run, announce }: RecommendedSetupPanelProps) {
  const headline = setupHeadline[setup.status]
  const verify = () => run(async () => {
    const result = await nexusApi.verifyConfiguredModels()
    announce(`${result.enabled} configured model(s) verified · ${result.roles_ready.length} explicit task roles ready${result.failures.length ? ` · ${result.failures.length} probe(s) need attention` : ''}.`)
    return result
  })
  const apply = () => run(async () => {
    const result = await nexusApi.applyRecommendedModelSetup(false)
    announce(`${result.routes_activated} missing task route(s) completed; ${result.unfilled_roles.length} task(s) remain on explicit fallback.`)
    return result
  })
  return <section className="recommended-model-setup">
    <div className={`model-setup-hero setup-${setup.status}`}>
      <div className="model-setup-copy"><span><Sparkles /></span><div><p className="eyebrow">Guided configuration</p><h2>{headline.title}</h2><p>{headline.body}</p></div></div>
      <div className="model-setup-checkpoints">
        <div className={setup.provider_count ? 'complete' : ''}><span>{setup.provider_count ? <CheckCircle2 /> : '1'}</span><strong>Connect credentials</strong><small>{setup.provider_count} Provider{setup.provider_count === 1 ? '' : 's'} available</small></div>
        <div className={setup.enabled_model_count ? 'complete' : ''}><span>{setup.enabled_model_count ? <CheckCircle2 /> : '2'}</span><strong>Verify capabilities</strong><small>{setup.enabled_model_count}/{setup.discovered_model_count} model deployments enabled</small></div>
        <div className={setup.ready_role_count === setup.total_role_count ? 'complete' : ''}><span>{setup.ready_role_count === setup.total_role_count ? <CheckCircle2 /> : '3'}</span><strong>Route real tasks</strong><small>{setup.ready_role_count}/{setup.total_role_count} roles explicit · {setup.configurable_role_count} ready to complete</small></div>
      </div>
      <footer>
        <p><ShieldCheck />Only active capability probes can produce a recommendation. Existing routes are preserved.</p>
        <div>{setup.provider_count === 0 && <Link className="button primary" to="/models/providers"><Cable size={14} />Connect Provider</Link>}{setup.discovered_model_count > setup.enabled_model_count && <button className="button" disabled={busy} onClick={verify}><ShieldCheck size={14} />Verify configured defaults</button>}{setup.configurable_role_count > 0 && <button className="button primary" disabled={busy} onClick={apply}><Sparkles size={14} />Complete {setup.configurable_role_count} missing routes</button>}{setup.status === 'ready' && <span className="setup-complete"><CheckCircle2 />No action required</span>}</div>
      </footer>
    </div>

    <div className="model-setup-groups">{setup.groups.map((group) => {
      const meta = setupGroups[group.group] ?? { label: group.group.replaceAll('_', ' '), description: 'Governed task family.', icon: Route }
      const Icon = meta.icon
      const roleItems = setup.roles.filter((role) => group.roles.includes(role.role))
      return <article key={group.group} className={`setup-group-card group-${group.status}`}>
        <header><span><Icon /></span><div><h3>{meta.label}</h3><p>{meta.description}</p></div><strong>{group.ready_count}/{group.total_count}</strong></header>
        <div className="setup-group-progress"><i style={{ width: `${group.ready_count / group.total_count * 100}%` }} /></div>
        <p>{group.status === 'ready' ? 'All tasks use explicit verified routes.' : group.configurable_count ? `${group.configurable_count} task route${group.configurable_count === 1 ? '' : 's'} can be completed now.` : 'No verified candidate; the visible fallback remains active.'}</p>
        <details><summary>Review task decisions <ArrowRight /></summary><div>{roleItems.map((role) => <div key={role.role}><span className={`route-decision state-${role.state}`}>{role.state === 'active' ? <CheckCircle2 /> : role.state === 'candidate' ? <Sparkles /> : <AlertTriangle />}</span><span><strong>{taskLabel(role.role)}</strong><small>{role.active_model_names[0] ?? role.recommended_model_name ?? 'Configured fallback'} · {role.required_capability.replaceAll('_', ' ')}</small></span></div>)}</div></details>
      </article>
    })}</div>

    <aside className="model-setup-explanation"><ShieldCheck /><span><strong>Why this is safe</strong><small>Recommendations are deterministic: an explicit runtime role wins, then a managed verified deployment, then the narrowest verified capability match. Discovery by model name never enables or routes a model.</small></span><Link to="/models/routing">Advanced task routes <ArrowRight /></Link></aside>
    {!models.length && <EmptyState title="No model catalog yet" body="Connect a Provider or configure a supported environment key. Built-in deterministic extraction remains labeled as a fallback." />}
  </section>
}
