import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Cable,
  CheckCircle2,
  DatabaseZap,
  Network,
  Play,
  Plus,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { PageHeader } from '@/components/nexus/PageHeader'
import { StatusMark } from '@/components/nexus/StatusMark'
import { modelBrand, providerBrand, type Brand } from './modelBranding'
import { CatalogModelPicker } from './CatalogModelPicker'
import { RecommendedSetupPanel } from './RecommendedSetupPanel'
import { taskRoles } from './modelTasks'

type Tab = 'setup' | 'providers' | 'catalog' | 'routing'
type ProviderItem = Awaited<ReturnType<typeof nexusApi.listProviders>>['items'][number]
type ModelItem = Awaited<ReturnType<typeof nexusApi.listModels>>['items'][number]
type RouteItem = Awaited<ReturnType<typeof nexusApi.listModelRoutes>>['items'][number]
type ProviderProtocol = ProviderItem['protocol_family'] & ('openai_chat' | 'openai_responses' | 'openai_compatible' | 'anthropic_messages' | 'google_gemini')
type PanelProps = { busy: boolean; run: (operation: () => Promise<unknown>) => void }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
export default function ModelsPage({ tab }: { tab: Tab }) {
  const client = useQueryClient()
  const providers = useQuery({ queryKey: ['providers'], queryFn: nexusApi.listProviders })
  const models = useQuery({ queryKey: ['models'], queryFn: nexusApi.listModels })
  const routes = useQuery({ queryKey: ['model-routes'], queryFn: nexusApi.listModelRoutes })
  const setup = useQuery({ queryKey: ['model-setup'], queryFn: nexusApi.getRecommendedModelSetup })
  const [feedback, setFeedback] = useState<string | null>(null)
  const autoSyncStarted = useRef(false)
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['providers'] }),
      client.invalidateQueries({ queryKey: ['models'] }),
      client.invalidateQueries({ queryKey: ['model-routes'] }),
      client.invalidateQueries({ queryKey: ['model-setup'] }),
    ])
  }
  const action = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: async () => {
      await refresh()
    },
    onError: (error) => setFeedback(message(error)),
  })
  useEffect(() => {
    if (autoSyncStarted.current) return
    autoSyncStarted.current = true
    nexusApi.syncModelCatalog()
      .then(async (result) => {
        setFeedback(result.failures.length ? `Local catalog ready; ${result.failures.length} remote endpoint(s) could not be refreshed.` : `Discovered ${result.discovered} remote model records.`)
        await refresh()
      })
      .catch((error) => setFeedback(`Local catalog is available. Remote refresh failed: ${message(error)}`))
    // Catalog discovery is deliberately once per mounted gateway, not on cache refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (providers.isLoading || models.isLoading || routes.isLoading || setup.isLoading) return <LoadingState />
  const providerItems = providers.data?.items ?? []
  const modelItems = models.data?.items ?? []
  const activeRoutes = (routes.data?.items ?? []).filter((route) => route.status === 'active').length
  return (
    <div className="page-shell model-gateway-page">
      <PageHeader
        eyebrow="Model Intelligence Gateway"
        title="Models & capabilities"
        description="Start with a safe recommended setup, then open Providers, Catalog or task routes only when you need finer control."
        actions={<button className="button primary" disabled={action.isPending} onClick={() => action.mutate(async () => {
          const result = await nexusApi.verifyConfiguredModels()
          setFeedback(`${result.enabled} configured model(s) ready · ${result.roles_ready.length} task roles available${result.failures.length ? ` · ${result.failures.length} probe(s) need attention` : ''}.`)
          return result
        })}><ShieldCheck size={15} />{action.isPending ? 'Verifying configured models…' : 'Verify & configure models'}</button>}
      />
      <section className="model-gateway-summary" aria-label="Model gateway summary">
        <Metric icon={<Cable />} value={providerItems.length} label="credential-backed Providers" />
        <Metric icon={<DatabaseZap />} value={modelItems.length} label="discovered deployments" />
        <Metric icon={<ShieldCheck />} value={modelItems.filter((item) => item.lifecycle === 'enabled').length} label="enabled models" />
        <Metric icon={<Route />} value={activeRoutes} label="active task routes" />
      </section>
      <nav className="subnav model-subnav">
        <Link className={tab === 'setup' ? 'active' : ''} to="/models/setup"><Sparkles size={15} />Recommended setup</Link>
        <Link className={tab === 'providers' ? 'active' : ''} to="/models/providers"><Cable size={15} />Providers</Link>
        <Link className={tab === 'catalog' ? 'active' : ''} to="/models/catalog"><Network size={15} />Catalog</Link>
        <Link className={tab === 'routing' ? 'active' : ''} to="/models/routing"><Route size={15} />Task routes</Link>
        <button className="text-button sync-catalog" disabled={action.isPending} onClick={() => action.mutate(nexusApi.syncModelCatalog)}><RefreshCw size={13} />Sync catalog</button>
      </nav>
      {feedback && <p className="lifecycle-feedback"><Sparkles size={13} />{feedback}</p>}
      {tab === 'setup' && setup.data && <RecommendedSetupPanel setup={setup.data} models={modelItems} busy={action.isPending} run={(operation) => action.mutate(operation)} announce={setFeedback} />}
      {tab === 'providers' && <ProviderPanel providers={providerItems} models={modelItems} busy={action.isPending} run={(operation) => action.mutate(operation)} />}
      {tab === 'catalog' && <CatalogPanel providers={providerItems} models={modelItems} busy={action.isPending} run={(operation) => action.mutate(operation)} />}
      {tab === 'routing' && <RoutingPanel providers={providerItems} models={modelItems} routes={routes.data?.items ?? []} busy={action.isPending} run={(operation) => action.mutate(operation)} />}
    </div>
  )
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return <div><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>
}

function BrandMark({ brand, small = false }: { brand: Brand; small?: boolean }) {
  return <span className={`model-brand-mark${small ? ' small' : ''}`} style={{ '--brand': brand.color } as React.CSSProperties}><img src={brand.logo} alt="" /><span>{brand.name}</span></span>
}

function ProviderPanel({ providers, models, busy, run }: PanelProps & { providers: ProviderItem[]; models: ModelItem[] }) {
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai_compatible')
  const [secretRef, setSecretRef] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    run(() => nexusApi.createProvider({ name, endpoint, protocol_family: protocol, secret_ref: secretRef || null }))
  }
  return (
    <section className="panel provider-panel">
      <div className="panel-head"><div><p className="eyebrow">Credential inventory</p><h2>{providers.length} Provider connections</h2></div><p className="panel-note">Secret values remain in environment variables; only their names are stored.</p></div>
      {providers.length ? <div className="provider-card-grid">{providers.map((provider) => {
        const brand = providerBrand(provider.name, provider.endpoint)
        const count = models.filter((model) => model.provider_connection_id === provider.id).length
        return <article key={provider.id} className="provider-card" style={{ '--brand': brand.color } as React.CSSProperties}>
          <div className="provider-card-top"><BrandMark brand={brand} /><StatusMark status={provider.enabled ? provider.health_status : 'pending'} /></div>
          <p>{provider.endpoint}</p>
          <div className="provider-facts"><span><strong>{count}</strong> models</span><span>{provider.protocol_family.replaceAll('_', ' ')}</span></div>
          <footer><span><CheckCircle2 size={12} />{provider.secret_ref ? `Managed by ${provider.secret_ref}` : 'Manual connection'}</span><button className="text-button" disabled={busy} onClick={() => run(() => nexusApi.discoverModels(provider.id))}><RefreshCw size={12} />Discover now</button></footer>
        </article>
      })}</div> : <EmptyState title="No configured model credentials" body="Add a supported API key to backend/.env, or create a manual protocol connection below." />}
      <details className="advanced-model-form"><summary><Plus size={13} />Add a custom Provider</summary><form className="inline-form model-form" onSubmit={submit}>
        <input aria-label="Provider name" placeholder="Connection name" value={name} onChange={(event) => setName(event.target.value)} required />
        <select aria-label="Protocol" value={protocol} onChange={(event) => setProtocol(event.target.value as ProviderProtocol)}><option value="openai_compatible">OpenAI compatible</option><option value="openai_chat">OpenAI Chat</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic_messages">Anthropic Messages</option><option value="google_gemini">Google Gemini</option></select>
        <input aria-label="Endpoint" placeholder="https://provider.example/v1" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} required />
        <input aria-label="Secret reference" placeholder="Environment variable name" value={secretRef} onChange={(event) => setSecretRef(event.target.value)} />
        <button className="button primary" disabled={busy}><Plus size={14} />Create</button>
      </form></details>
    </section>
  )
}

function CatalogPanel({ providers, models, busy, run }: PanelProps & { providers: ProviderItem[]; models: ModelItem[] }) {
  const [query, setQuery] = useState('')
  const [capability, setCapability] = useState('all')
  const providersById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])
  const capabilities = useMemo(() => Array.from(new Set(models.flatMap((model) => model.declared_capabilities))).sort(), [models])
  const visible = models.filter((model) => {
    const text = `${model.upstream_model_id} ${model.protocol_family}`.toLowerCase()
    return text.includes(query.toLowerCase()) && (capability === 'all' || model.declared_capabilities.includes(capability))
  })
  return (
    <section className="panel catalog-panel">
      <div className="panel-head"><div><p className="eyebrow">Capability evidence</p><h2>{visible.length} of {models.length} deployments</h2></div><p className="panel-note">Declared capability is inferred or reported. Verified capability is earned by an active probe.</p></div>
      <div className="catalog-toolbar"><label><Search size={14} /><input aria-label="Search models" placeholder="Search model or family" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Capability filter" value={capability} onChange={(event) => setCapability(event.target.value)}><option value="all">All capabilities</option>{capabilities.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></div>
      {visible.length ? <div className="model-catalog-grid">{visible.map((model) => {
        const provider = providersById.get(model.provider_connection_id)
        const providerIdentity = providerBrand(provider?.name ?? 'Provider', provider?.endpoint)
        const brand = modelBrand(model.upstream_model_id, providerIdentity)
        const runtimeRoles = Array.isArray(model.observation.runtime_roles) ? model.observation.runtime_roles as string[] : []
        return <article key={model.id} className="model-catalog-card">
          <header><BrandMark brand={brand} /><StatusMark status={model.lifecycle} /></header>
          <h3 title={model.upstream_model_id}>{model.upstream_model_id}</h3>
          <p>{provider?.name ?? model.protocol_family}{runtimeRoles.length ? ` · ${runtimeRoles.join(', ')}` : ''}</p>
          <div className="capability-stack">{model.declared_capabilities.map((item) => <span key={item} className={model.verified_capabilities.includes(item) ? 'verified' : ''}>{model.verified_capabilities.includes(item) && <ShieldCheck size={10} />}{item.replaceAll('_', ' ')}</span>)}</div>
          <footer>{model.lifecycle !== 'enabled' ? <button className="text-button" disabled={busy} onClick={() => run(() => model.lifecycle === 'verified' ? nexusApi.enableModel(model.id) : nexusApi.probeModel(model.id))}>{model.lifecycle === 'verified' ? <ShieldCheck size={12} /> : <Play size={12} />}{model.lifecycle === 'verified' ? 'Enable for routing' : 'Run capability probe'}</button> : <span><CheckCircle2 size={12} />Eligible for task routes</span>}</footer>
        </article>
      })}</div> : <EmptyState title="No matching model" body="Change the search or capability filter. Configured task models remain visible even when a remote discovery endpoint is unavailable." />}
    </section>
  )
}

function RoutingPanel({ providers, models, routes, busy, run }: PanelProps & { providers: ProviderItem[]; models: ModelItem[]; routes: RouteItem[] }) {
  const [role, setRole] = useState('research_synthesis')
  const selectedTask = taskRoles.find(([id]) => id === role) ?? taskRoles[0]
  const compatible = models.filter((model) => model.declared_capabilities.includes(selectedTask[2]) || model.verified_capabilities.includes(selectedTask[2]))
  const [deploymentId, setDeploymentId] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    run(() => nexusApi.createModelRoute({ role, deployment_ids: [deploymentId], required_capabilities: [selectedTask[2]] }))
  }
  const activeByRole = new Map(routes.filter((route) => route.status === 'active').map((route) => [route.role, route]))
  return (
    <section className="panel routing-panel">
      <div className="panel-head"><div><p className="eyebrow">Task-specific policy</p><h2>Route each cognitive and multimodal task independently</h2></div><p className="panel-note">A question may override synthesis later; ingestion and retrieval tasks continue to use their dedicated routes.</p></div>
      <div className="task-route-matrix">{taskRoles.map(([id, label, required]) => {
        const active = activeByRole.get(id)
        const deployed = active?.deployment_ids.map((deployment) => models.find((model) => model.id === deployment)?.upstream_model_id).filter(Boolean).join(', ')
        return <button key={id} className={role === id ? 'selected' : ''} onClick={() => { setRole(id); setDeploymentId('') }}><span><strong>{label}</strong><small>{required.replaceAll('_', ' ')}</small></span>{active ? <em><CheckCircle2 size={12} />{deployed}</em> : <em>Uses configured fallback</em>}</button>
      })}</div>
      <form className="route-composer" onSubmit={submit}><span><strong>{selectedTask[1]}</strong><small>requires verified {selectedTask[2].replaceAll('_', ' ')}</small></span><CatalogModelPicker models={models} providers={providers} capability={selectedTask[2]} value={deploymentId} onChange={setDeploymentId} allowFallback={false} label="Choose deployment" /><button className="button" disabled={busy || !deploymentId}><Plus size={14} />Create route revision</button></form>
      {!compatible.length && <p className="route-warning">No discovered model declares <strong>{selectedTask[2]}</strong>. Sync the Catalog after adding a suitable Provider deployment.</p>}
      {routes.some((route) => route.status === 'draft') && <div className="route-drafts"><p className="eyebrow">Draft revisions</p>{routes.filter((route) => route.status === 'draft').map((route) => <div key={route.id}><span><strong>{route.role} · rev {route.revision}</strong><small>{route.required_capabilities.join(', ')}</small></span><button className="button" disabled={busy} onClick={() => run(() => nexusApi.activateModelRoute(route.id))}><Play size={13} />Activate</button></div>)}</div>}
    </section>
  )
}
