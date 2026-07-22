import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
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
import { nexusApi } from '@/api/nexus'
import { EmptyState } from '@/components/nexus/EmptyState'
import { LoadingState } from '@/components/nexus/LoadingState'
import { LedgerSelect } from '@/components/nexus/LedgerSelect'
import { PageHeader } from '@/components/nexus/PageHeader'
import { PanelNote } from '@/components/nexus/PanelNote'
import { QueryErrorNotice } from '@/components/nexus/QueryErrorNotice'
import { StatusMark } from '@/components/nexus/StatusMark'
import { Subnav, type SubnavItem } from '@/components/nexus/Subnav'
import { SubmitReadinessCard } from '@/components/nexus/SubmitReadinessCard'
import { buildQueryErrorNoticeViewModel } from '@/components/nexus/queryErrorNoticeViewModel'
import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'
import { modelBrand, providerBrand, type Brand } from './modelBranding'
import { CatalogModelPicker } from './CatalogModelPicker'
import {
  buildModelGatewayActionGateViewModel,
  buildModelGatewayActionViewModel,
  buildProviderCreateViewModel,
  buildRouteCreateViewModel,
  type ModelGatewayAction,
} from './modelGatewayViewModel'
import { RecommendedSetupPanel } from './RecommendedSetupPanel'
import { taskRoles } from './modelTasks'
import './ModelsPage.css'

type Tab = 'setup' | 'providers' | 'catalog' | 'routing'
type ProviderItem = Awaited<ReturnType<typeof nexusApi.listProviders>>['items'][number]
type ModelItem = Awaited<ReturnType<typeof nexusApi.listModels>>['items'][number]
type RouteItem = Awaited<ReturnType<typeof nexusApi.listModelRoutes>>['items'][number]
type ProviderProtocol = ProviderItem['protocol_family'] & ('openai_chat' | 'openai_responses' | 'openai_compatible' | 'anthropic_messages' | 'google_gemini')
type GatewayActionContext = {
  action: ModelGatewayAction
  successDetail?: (result: unknown) => string
  targetName?: string
}
type GatewayActionRequest = GatewayActionContext & {
  operation: () => Promise<unknown>
}
type GatewayActionReceipt = {
  action: ModelGatewayAction
  detail?: string
  errorMessage?: string
  targetName?: string
}
type PanelProps = {
  actionFeedbackId: string
  busy: boolean
  pendingAction?: GatewayActionContext | null
  run: (operation: () => Promise<unknown>, context: GatewayActionContext) => void
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const modelGatewayActionFeedbackId = 'model-gateway-action-feedback'
const modelGatewayActionGateId = (action: ModelGatewayAction, suffix = 'global') => `${modelGatewayActionFeedbackId}-${action}-${suffix}-gate`
const providerCreateEndpointHelpId = 'provider-create-endpoint-help'
const providerCreateEndpointId = 'provider-create-endpoint'
const providerCreateFeedbackId = 'provider-create-feedback'
const providerCreateGateId = 'provider-create-gate'
const providerCreateNameHelpId = 'provider-create-name-help'
const providerCreateNameId = 'provider-create-name'
const routeCreateFeedbackId = 'route-create-feedback'
const routeCreateGateId = 'route-create-gate'
const protocolOptions = [
  { value: 'openai_compatible', label: 'OpenAI compatible', description: 'Most hosted OpenAI-style endpoints.' },
  { value: 'openai_chat', label: 'OpenAI Chat', description: 'Chat Completions protocol.' },
  { value: 'openai_responses', label: 'OpenAI Responses', description: 'Responses API protocol.' },
  { value: 'anthropic_messages', label: 'Anthropic Messages', description: 'Claude Messages protocol.' },
  { value: 'google_gemini', label: 'Google Gemini', description: 'Gemini native protocol.' },
]
const modelTabs: Array<SubnavItem<Tab>> = [
  { value: 'setup', label: 'Recommended setup', to: '/models/setup', icon: <Sparkles size={15} /> },
  { value: 'providers', label: 'Providers', to: '/models/providers', icon: <Cable size={15} /> },
  { value: 'catalog', label: 'Catalog', to: '/models/catalog', icon: <Network size={15} /> },
  { value: 'routing', label: 'Task routes', to: '/models/routing', icon: <Route size={15} /> },
]

function summarizeCatalogSync(result: Awaited<ReturnType<typeof nexusApi.syncModelCatalog>>) {
  return result.failures.length
    ? `Catalog refreshed ${result.models} model record(s); ${result.failures.length} remote endpoint(s) need attention. Discovery did not enable or route deployments.`
    : `Catalog refreshed ${result.discovered} remote model record(s) across ${result.providers} Provider connection(s). Discovery did not enable or route deployments.`
}

function summarizeConfiguredVerification(result: Awaited<ReturnType<typeof nexusApi.verifyConfiguredModels>>) {
  return `${result.enabled} configured model(s) ready; ${result.roles_ready.length} task role(s) available${result.failures.length ? `; ${result.failures.length} probe(s) need attention` : ''}.`
}

function summarizeProviderDiscovery(result: Awaited<ReturnType<typeof nexusApi.discoverModels>>) {
  return `${result.items.length} model record(s) are now listed for this Provider. Discovery did not enable or route deployments.`
}

function summarizeProviderCreate(result: Awaited<ReturnType<typeof nexusApi.createProvider>>) {
  return `${result.name} was registered as a Provider reference. Discovery and capability verification remain explicit.`
}

function summarizeModelProbe(result: Awaited<ReturnType<typeof nexusApi.probeModel>>) {
  return `${result.upstream_model_id} probe finished with ${result.verified_capabilities.length} verified capability marker(s). Task routing remains explicit.`
}

function summarizeModelEnable(result: Awaited<ReturnType<typeof nexusApi.enableModel>>) {
  return `${result.upstream_model_id} is enabled for routing eligibility. No active task route changed automatically.`
}

function summarizeRouteCreate(result: Awaited<ReturnType<typeof nexusApi.createModelRoute>>) {
  return `${result.role} route revision ${result.revision} was created as ${result.status}. It will serve live tasks only after activation.`
}

function summarizeRouteActivation(result: Awaited<ReturnType<typeof nexusApi.activateModelRoute>>) {
  return `${result.role} revision ${result.revision} is now active for governed task routing.`
}

export default function ModelsPage({ tab }: { tab: Tab }) {
  const client = useQueryClient()
  const providers = useQuery({ queryKey: ['providers'], queryFn: nexusApi.listProviders })
  const models = useQuery({ queryKey: ['models'], queryFn: nexusApi.listModels })
  const routes = useQuery({ queryKey: ['model-routes'], queryFn: nexusApi.listModelRoutes })
  const setup = useQuery({ queryKey: ['model-setup'], queryFn: nexusApi.getRecommendedModelSetup })
  const queryErrorNotice = buildQueryErrorNoticeViewModel([
    { error: providers.error, hasData: Boolean(providers.data), label: 'Providers', required: true },
    { error: models.error, hasData: Boolean(models.data), label: 'Models', required: true },
    { error: routes.error, hasData: Boolean(routes.data), label: 'Routes', required: true },
    { error: setup.error, hasData: Boolean(setup.data), label: 'Setup', required: true },
  ])
  const [actionReceipt, setActionReceipt] = useState<GatewayActionReceipt | null>(null)
  const [pendingAction, setPendingAction] = useState<GatewayActionContext | null>(null)
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
    mutationFn: async (request: GatewayActionRequest) => request.operation(),
    onMutate: (request) => {
      setActionReceipt(null)
      setPendingAction({
        action: request.action,
        targetName: request.targetName,
      })
    },
    onSuccess: async (result, request) => {
      setActionReceipt({
        action: request.action,
        detail: request.successDetail?.(result),
        targetName: request.targetName,
      })
      await refresh()
    },
    onError: (error, request) => {
      setActionReceipt({
        action: request.action,
        errorMessage: message(error),
        targetName: request.targetName,
      })
    },
    onSettled: () => setPendingAction(null),
  })
  const runGatewayAction: PanelProps['run'] = (operation, context) => {
    action.mutate({ ...context, operation })
  }
  useEffect(() => {
    if (providers.isLoading || models.isLoading || routes.isLoading || setup.isLoading) return
    if (queryErrorNotice.tone === 'blocking') return
    if (autoSyncStarted.current) return
    autoSyncStarted.current = true
    nexusApi.syncModelCatalog()
      .then(async (result) => {
        setActionReceipt({
          action: 'sync-catalog',
          detail: result.failures.length ? `Local catalog is available; ${result.failures.length} remote endpoint(s) could not be refreshed.` : summarizeCatalogSync(result),
        })
        await refresh()
      })
      .catch((error) => setActionReceipt({
        action: 'sync-catalog',
        errorMessage: `Local catalog is available. Remote refresh failed: ${message(error)}`,
      }))
    // Catalog discovery is deliberately once per mounted gateway, not on cache refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.isLoading, providers.isLoading, queryErrorNotice.tone, routes.isLoading, setup.isLoading])

  if (providers.isLoading || models.isLoading || routes.isLoading || setup.isLoading) return <LoadingState />
  const retryModelGateway = () => {
    void providers.refetch()
    void models.refetch()
    void routes.refetch()
    void setup.refetch()
  }
  const providerItems = providers.data?.items ?? []
  const modelItems = models.data?.items ?? []
  const activeRoutes = (routes.data?.items ?? []).filter((route) => route.status === 'active').length
  const gatewayAction = buildModelGatewayActionViewModel({
    completedAction: actionReceipt?.errorMessage ? undefined : actionReceipt?.action,
    completedDetail: actionReceipt?.errorMessage ? undefined : actionReceipt?.detail,
    completedTargetName: actionReceipt?.errorMessage ? undefined : actionReceipt?.targetName,
    errorAction: actionReceipt?.errorMessage ? actionReceipt.action : undefined,
    errorMessage: actionReceipt?.errorMessage,
    errorTargetName: actionReceipt?.errorMessage ? actionReceipt.targetName : undefined,
    pending: action.isPending,
    pendingAction: pendingAction?.action,
    pendingTargetName: pendingAction?.targetName,
  })
  const verifyConfiguredGate = buildModelGatewayActionGateViewModel({
    action: 'verify-configured',
    pending: action.isPending,
    pendingAction: pendingAction?.action,
    pendingTargetName: pendingAction?.targetName,
  })
  const syncCatalogGate = buildModelGatewayActionGateViewModel({
    action: 'sync-catalog',
    pending: action.isPending,
    pendingAction: pendingAction?.action,
    pendingTargetName: pendingAction?.targetName,
  })
  const providerCreateError = actionReceipt?.action === 'create-provider' ? actionReceipt.errorMessage : undefined
  const recommendedSetupError = actionReceipt?.action === 'apply-recommended' || actionReceipt?.action === 'verify-configured' ? actionReceipt.errorMessage : undefined
  const routeCreateError = actionReceipt?.action === 'create-route' ? actionReceipt.errorMessage : undefined
  return (
    <div className="page-shell model-gateway-page">
      <PageHeader
        eyebrow="Model Intelligence Gateway"
        title="Models & capabilities"
        description="Start with a safe recommended setup, then open Providers, Catalog or task routes only when you need finer control."
        actions={<><button
          type="button"
          className="button primary"
          aria-describedby={`${modelGatewayActionFeedbackId}${verifyConfiguredGate.disabledDetail ? ` ${modelGatewayActionGateId('verify-configured')}` : ''}`}
          aria-disabled={verifyConfiguredGate.ariaDisabled || undefined}
          onClick={() => {
            if (verifyConfiguredGate.canSubmit) {
              runGatewayAction(nexusApi.verifyConfiguredModels, {
                action: 'verify-configured',
                successDetail: (result) => summarizeConfiguredVerification(result as Awaited<ReturnType<typeof nexusApi.verifyConfiguredModels>>),
              })
            }
          }}
        ><ShieldCheck size={15} />{action.isPending && pendingAction?.action === 'verify-configured' ? 'Verifying configured models...' : 'Verify & configure models'}</button>{verifyConfiguredGate.disabledDetail && <span className="sr-only" id={modelGatewayActionGateId('verify-configured')}>{verifyConfiguredGate.disabledDetail}</span>}</>}
      />
      <QueryErrorNotice model={queryErrorNotice} onRetry={retryModelGateway} />
      {queryErrorNotice.tone === 'blocking' ? (
        <EmptyState title="Model gateway could not be loaded" body="Nexus could not verify Providers, catalog, task routes or recommended setup. Retry before changing model credentials or route policy." />
      ) : <>
      <section className="model-gateway-summary" aria-label="Model gateway summary">
        <Metric icon={<Cable />} value={providerItems.length} label="credential-backed Providers" />
        <Metric icon={<DatabaseZap />} value={modelItems.length} label="discovered deployments" />
        <Metric icon={<ShieldCheck />} value={modelItems.filter((item) => item.lifecycle === 'enabled').length} label="enabled models" />
        <Metric icon={<Route />} value={activeRoutes} label="active task routes" />
      </section>
      <Subnav active={tab} ariaLabel="Model gateway sections" className="model-subnav" items={modelTabs}>
        <button
          type="button"
          className="text-button sync-catalog"
          aria-describedby={`${modelGatewayActionFeedbackId}${syncCatalogGate.disabledDetail ? ` ${modelGatewayActionGateId('sync-catalog')}` : ''}`}
          aria-disabled={syncCatalogGate.ariaDisabled || undefined}
          onClick={() => {
            if (syncCatalogGate.canSubmit) {
              runGatewayAction(nexusApi.syncModelCatalog, {
                action: 'sync-catalog',
                successDetail: (result) => summarizeCatalogSync(result as Awaited<ReturnType<typeof nexusApi.syncModelCatalog>>),
              })
            }
          }}
        ><RefreshCw size={13} />{action.isPending && pendingAction?.action === 'sync-catalog' ? 'Syncing catalog...' : 'Sync catalog'}</button>
        {syncCatalogGate.disabledDetail && <span className="sr-only" id={modelGatewayActionGateId('sync-catalog')}>{syncCatalogGate.disabledDetail}</span>}
      </Subnav>
      <SubmitReadinessCard className="model-gateway-feedback" id={modelGatewayActionFeedbackId} model={gatewayAction} />
      {tab === 'setup' && setup.data && <RecommendedSetupPanel setup={setup.data} models={modelItems} busy={action.isPending} errorMessage={recommendedSetupError} run={runGatewayAction} />}
      {tab === 'providers' && <ProviderPanel providers={providerItems} models={modelItems} busy={action.isPending} pendingAction={pendingAction} errorMessage={providerCreateError} actionFeedbackId={modelGatewayActionFeedbackId} run={runGatewayAction} />}
      {tab === 'catalog' && <CatalogPanel providers={providerItems} models={modelItems} busy={action.isPending} pendingAction={pendingAction} actionFeedbackId={modelGatewayActionFeedbackId} run={runGatewayAction} />}
      {tab === 'routing' && <RoutingPanel providers={providerItems} models={modelItems} routes={routes.data?.items ?? []} busy={action.isPending} pendingAction={pendingAction} errorMessage={routeCreateError} actionFeedbackId={modelGatewayActionFeedbackId} run={runGatewayAction} />}
      </>}
    </div>
  )
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return <div><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>
}

function BrandMark({ brand, small = false }: { brand: Brand; small?: boolean }) {
  return <span className={`model-brand-mark${small ? ' small' : ''}`} style={{ '--brand': brand.color } as React.CSSProperties}><img src={brand.logo} alt="" /><span>{brand.name}</span></span>
}

function ProviderPanel({ actionFeedbackId, providers, models, busy, errorMessage, pendingAction, run }: PanelProps & { errorMessage?: string; providers: ProviderItem[]; models: ModelItem[] }) {
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai_compatible')
  const [secretRef, setSecretRef] = useState('')
  const protocolLabel = protocolOptions.find((option) => option.value === protocol)?.label ?? protocol.replaceAll('_', ' ')
  const providerCreate = buildProviderCreateViewModel({
    endpoint,
    errorMessage,
    name,
    pending: busy,
    protocolLabel,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!providerCreate.canSubmit) return
    run(() => nexusApi.createProvider({ name, endpoint, protocol_family: protocol, secret_ref: secretRef || null }), {
      action: 'create-provider',
      successDetail: (result) => summarizeProviderCreate(result as Awaited<ReturnType<typeof nexusApi.createProvider>>),
      targetName: name.trim() || 'Provider',
    })
  }
  return (
    <section className="panel provider-panel">
      <div className="panel-head"><div><p className="eyebrow">Credential inventory</p><h2>{providers.length} Provider connections</h2></div><PanelNote>Secret values remain in environment variables; only their names are stored.</PanelNote></div>
      {providers.length ? <div className="provider-card-grid">{providers.map((provider) => {
        const brand = providerBrand(provider.name, provider.endpoint)
        const count = models.filter((model) => model.provider_connection_id === provider.id).length
        const discoverGate = buildModelGatewayActionGateViewModel({
          action: 'discover-provider',
          pending: busy,
          pendingAction: pendingAction?.action,
          pendingTargetName: pendingAction?.targetName,
          targetName: provider.name,
        })
        const discoverGateId = modelGatewayActionGateId('discover-provider', provider.id)
        return <article key={provider.id} className="provider-card" style={{ '--brand': brand.color } as React.CSSProperties}>
          <div className="provider-card-top"><BrandMark brand={brand} /><StatusMark status={provider.enabled ? provider.health_status : 'pending'} /></div>
          <p>{provider.endpoint}</p>
          <div className="provider-facts"><span><strong>{count}</strong> models</span><span>{provider.protocol_family.replaceAll('_', ' ')}</span></div>
          <footer><span><CheckCircle2 size={12} />{provider.secret_ref ? `Managed by ${provider.secret_ref}` : 'Manual connection'}</span><button
            type="button"
            className="text-button"
            aria-describedby={`${actionFeedbackId}${discoverGate.disabledDetail ? ` ${discoverGateId}` : ''}`}
            aria-disabled={discoverGate.ariaDisabled || undefined}
            onClick={() => {
              if (discoverGate.canSubmit) {
                run(() => nexusApi.discoverModels(provider.id), {
                  action: 'discover-provider',
                  successDetail: (result) => summarizeProviderDiscovery(result as Awaited<ReturnType<typeof nexusApi.discoverModels>>),
                  targetName: provider.name,
                })
              }
            }}
          ><RefreshCw size={12} />Discover now</button>{discoverGate.disabledDetail && <span className="sr-only" id={discoverGateId}>{discoverGate.disabledDetail}</span>}</footer>
        </article>
      })}</div> : <EmptyState title="No configured model credentials" body="Add a supported API key to backend/.env, or create a manual protocol connection below." />}
      <details className="advanced-model-form"><summary><Plus size={13} />Add a custom Provider</summary><form className="inline-form model-form" onSubmit={submit}>
        <p className="sr-only" id={providerCreateNameHelpId}>Provider name is required so model inventory stays readable.</p>
        <input id={providerCreateNameId} aria-label="Provider name" aria-describedby={`${providerCreateNameHelpId} ${providerCreateFeedbackId}`} aria-invalid={providerCreate.nameRequired} aria-required="true" placeholder="Connection name" value={name} onChange={(event) => setName(event.target.value)} />
        <LedgerSelect ariaLabel="Protocol" value={protocol} options={protocolOptions} onChange={(next) => setProtocol(next as ProviderProtocol)} />
        <p className="sr-only" id={providerCreateEndpointHelpId}>Endpoint is required and must be a full http or https URL.</p>
        <input id={providerCreateEndpointId} aria-label="Endpoint" aria-describedby={`${providerCreateEndpointHelpId} ${providerCreateFeedbackId}`} aria-invalid={providerCreate.endpointRequired || providerCreate.endpointInvalid} aria-required="true" placeholder="https://provider.example/v1" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        <input aria-label="Secret reference" placeholder="Environment variable name" value={secretRef} onChange={(event) => setSecretRef(event.target.value)} />
        <button type="submit" className="button primary" aria-describedby={`${providerCreateFeedbackId} ${actionFeedbackId}${providerCreate.disabledDetail ? ` ${providerCreateGateId}` : ''}`} aria-disabled={providerCreate.ariaDisabled || undefined} onClick={(event) => { if (!providerCreate.canSubmit) event.preventDefault() }}><Plus size={14} />{providerCreate.submitLabel}</button>
        {providerCreate.disabledDetail && <span className="sr-only" id={providerCreateGateId}>{providerCreate.disabledDetail}</span>}
        <SubmitReadinessCard className="model-submit-feedback" id={providerCreateFeedbackId} model={providerCreate} />
      </form></details>
    </section>
  )
}

function CatalogPanel({ actionFeedbackId, providers, models, busy, pendingAction, run }: PanelProps & { providers: ProviderItem[]; models: ModelItem[] }) {
  const [query, setQuery] = useState('')
  const [capability, setCapability] = useState('all')
  const providersById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])
  const capabilities = useMemo(() => Array.from(new Set(models.flatMap((model) => model.declared_capabilities))).sort(), [models])
  const capabilityOptions = useMemo(() => [
    { value: 'all', label: 'All capabilities', description: 'Show every discovered deployment.' },
    ...capabilities.map((item) => ({ value: item, label: item.replaceAll('_', ' '), description: 'Filter by declared capability.' })),
  ], [capabilities])
  const visible = models.filter((model) => {
    const text = `${model.upstream_model_id} ${model.protocol_family}`.toLowerCase()
    return text.includes(query.toLowerCase()) && (capability === 'all' || model.declared_capabilities.includes(capability))
  })
  return (
    <section className="panel catalog-panel">
      <div className="panel-head"><div><p className="eyebrow">Capability evidence</p><h2>{visible.length} of {models.length} deployments</h2></div><PanelNote>Declared capability is inferred or reported. Verified capability is earned by an active probe.</PanelNote></div>
      <div className="catalog-toolbar"><label><Search size={14} /><input aria-label="Search models" placeholder="Search model or family" value={query} onChange={(event) => setQuery(event.target.value)} /></label><LedgerSelect ariaLabel="Capability filter" value={capability} options={capabilityOptions} onChange={setCapability} /></div>
      {visible.length ? <div className="model-catalog-grid">{visible.map((model) => {
        const provider = providersById.get(model.provider_connection_id)
        const providerIdentity = providerBrand(provider?.name ?? 'Provider', provider?.endpoint)
        const brand = modelBrand(model.upstream_model_id, providerIdentity)
        const runtimeRoles = Array.isArray(model.observation.runtime_roles) ? model.observation.runtime_roles as string[] : []
        const modelAction: ModelGatewayAction = model.lifecycle === 'verified' ? 'enable-model' : 'probe-model'
        const modelGate = buildModelGatewayActionGateViewModel({
          action: modelAction,
          pending: busy,
          pendingAction: pendingAction?.action,
          pendingTargetName: pendingAction?.targetName,
          targetName: model.upstream_model_id,
        })
        const modelGateId = modelGatewayActionGateId(modelAction, model.id)
        return <article key={model.id} className="model-catalog-card">
          <header><BrandMark brand={brand} /><StatusMark status={model.lifecycle} /></header>
          <h3 title={model.upstream_model_id}>{model.upstream_model_id}</h3>
          <p>{provider?.name ?? model.protocol_family}{runtimeRoles.length ? ` · ${runtimeRoles.join(', ')}` : ''}</p>
          <div className="capability-stack">{model.declared_capabilities.map((item) => <span key={item} className={model.verified_capabilities.includes(item) ? 'verified' : ''}>{model.verified_capabilities.includes(item) && <ShieldCheck size={10} />}{item.replaceAll('_', ' ')}</span>)}</div>
          <footer>{model.lifecycle !== 'enabled' ? <button
            type="button"
            className="text-button"
            aria-describedby={`${actionFeedbackId}${modelGate.disabledDetail ? ` ${modelGateId}` : ''}`}
            aria-disabled={modelGate.ariaDisabled || undefined}
            onClick={() => {
              if (modelGate.canSubmit) {
                run(
                  () => model.lifecycle === 'verified' ? nexusApi.enableModel(model.id) : nexusApi.probeModel(model.id),
                  {
                    action: modelAction,
                    successDetail: (result) => model.lifecycle === 'verified'
                      ? summarizeModelEnable(result as Awaited<ReturnType<typeof nexusApi.enableModel>>)
                      : summarizeModelProbe(result as Awaited<ReturnType<typeof nexusApi.probeModel>>),
                    targetName: model.upstream_model_id,
                  },
                )
              }
            }}
          >{model.lifecycle === 'verified' ? <ShieldCheck size={12} /> : <Play size={12} />}{model.lifecycle === 'verified' ? 'Enable for routing' : 'Run capability probe'}</button> : <span><CheckCircle2 size={12} />Eligible for task routes</span>}{modelGate.disabledDetail && <span className="sr-only" id={modelGateId}>{modelGate.disabledDetail}</span>}</footer>
        </article>
      })}</div> : <EmptyState title="No matching model" body="Change the search or capability filter. Configured task models remain visible even when a remote discovery endpoint is unavailable." />}
    </section>
  )
}

function RoutingPanel({ actionFeedbackId, providers, models, routes, busy, errorMessage, pendingAction, run }: PanelProps & { errorMessage?: string; providers: ProviderItem[]; models: ModelItem[]; routes: RouteItem[] }) {
  const [role, setRole] = useState('research_synthesis')
  const roleRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({})
  const selectedTask = taskRoles.find(([id]) => id === role) ?? taskRoles[0]
  const compatible = models.filter((model) => model.declared_capabilities.includes(selectedTask[2]) || model.verified_capabilities.includes(selectedTask[2]))
  const [deploymentId, setDeploymentId] = useState('')
  const routeCreate = buildRouteCreateViewModel({
    compatibleCount: compatible.length,
    deploymentId,
    errorMessage,
    pending: busy,
    requiredCapability: selectedTask[2],
    roleLabel: selectedTask[1],
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!routeCreate.canSubmit) return
    run(() => nexusApi.createModelRoute({ role, deployment_ids: [deploymentId], required_capabilities: [selectedTask[2]] }), {
      action: 'create-route',
      successDetail: (result) => summarizeRouteCreate(result as Awaited<ReturnType<typeof nexusApi.createModelRoute>>),
      targetName: selectedTask[1],
    })
  }
  const selectRole = (nextRole: string) => {
    setRole(nextRole)
    setDeploymentId('')
  }
  const handleRoleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction = resolveRadioGroupDirection(event.key)
    if (!direction) return
    event.preventDefault()
    const nextRole = moveRadioGroupValue(taskRoles.map(([id]) => id), role, direction)
    selectRole(nextRole)
    window.requestAnimationFrame(() => roleRefs.current[nextRole]?.focus({ preventScroll: true }))
  }
  const activeByRole = new Map(routes.filter((route) => route.status === 'active').map((route) => [route.role, route]))
  return (
    <section className="panel routing-panel">
      <div className="panel-head"><div><p className="eyebrow">Task-specific policy</p><h2>Route each cognitive and multimodal task independently</h2></div><PanelNote>A question may override synthesis later; ingestion and retrieval tasks continue to use their dedicated routes.</PanelNote></div>
      <div className="task-route-matrix" role="radiogroup" aria-label="Model task route role">{taskRoles.map(([id, label, required]) => {
        const active = activeByRole.get(id)
        const deployed = active?.deployment_ids.map((deployment) => models.find((model) => model.id === deployment)?.upstream_model_id).filter(Boolean).join(', ')
        return <button type="button" key={id} ref={(node) => { roleRefs.current[id] = node }} role="radio" aria-checked={role === id} tabIndex={role === id ? 0 : -1} className={role === id ? 'selected' : ''} onKeyDown={handleRoleKeyDown} onClick={() => selectRole(id)}><span><strong>{label}</strong><small>{required.replaceAll('_', ' ')}</small></span>{active ? <em><CheckCircle2 size={12} />{deployed}</em> : <em>Uses configured fallback</em>}</button>
      })}</div>
      <form className="route-composer" onSubmit={submit}><span><strong>{selectedTask[1]}</strong><small>requires verified {selectedTask[2].replaceAll('_', ' ')}</small></span><CatalogModelPicker models={models} providers={providers} capability={selectedTask[2]} value={deploymentId} onChange={setDeploymentId} allowFallback={false} locked={busy} describedBy={`${routeCreateFeedbackId}${routeCreate.disabledDetail ? ` ${routeCreateGateId}` : ''}`} label="Choose deployment" /><button type="submit" className="button" aria-describedby={`${routeCreateFeedbackId} ${actionFeedbackId}${routeCreate.disabledDetail ? ` ${routeCreateGateId}` : ''}`} aria-disabled={routeCreate.ariaDisabled || undefined} onClick={(event) => { if (!routeCreate.canSubmit) event.preventDefault() }}><Plus size={14} />{routeCreate.submitLabel}</button>{routeCreate.disabledDetail && <span className="sr-only" id={routeCreateGateId}>{routeCreate.disabledDetail}</span>}<SubmitReadinessCard className="model-submit-feedback route-submit-feedback" id={routeCreateFeedbackId} model={routeCreate} /></form>
      {!compatible.length && <p className="route-warning">No discovered model declares <strong>{selectedTask[2]}</strong>. Sync the Catalog after adding a suitable Provider deployment.</p>}
      {routes.some((route) => route.status === 'draft') && <div className="route-drafts"><p className="eyebrow">Draft revisions</p>{routes.filter((route) => route.status === 'draft').map((route) => {
        const activateGate = buildModelGatewayActionGateViewModel({
          action: 'activate-route',
          pending: busy,
          pendingAction: pendingAction?.action,
          pendingTargetName: pendingAction?.targetName,
          targetName: route.role,
        })
        const activateGateId = modelGatewayActionGateId('activate-route', route.id)
        return <div key={route.id}><span><strong>{route.role} · rev {route.revision}</strong><small>{route.required_capabilities.join(', ')}</small></span><button
          type="button"
          className="button"
          aria-describedby={`${actionFeedbackId}${activateGate.disabledDetail ? ` ${activateGateId}` : ''}`}
          aria-disabled={activateGate.ariaDisabled || undefined}
          onClick={() => {
            if (activateGate.canSubmit) {
              run(() => nexusApi.activateModelRoute(route.id), {
                action: 'activate-route',
                successDetail: (result) => summarizeRouteActivation(result as Awaited<ReturnType<typeof nexusApi.activateModelRoute>>),
                targetName: route.role,
              })
            }
          }}
        ><Play size={13} />Activate</button>{activateGate.disabledDetail && <span className="sr-only" id={activateGateId}>{activateGate.disabledDetail}</span>}</div>
      })}</div>}
    </section>
  )
}
