import type { components } from '@/generated/nexus'

export type Space = components['schemas']['SpaceResponse']
export type SpaceList = components['schemas']['SpaceListResponse']
export type SpaceCreate = components['schemas']['SpaceCreate']
export type Collection = components['schemas']['CollectionResponse']
export type CollectionList = components['schemas']['CollectionListResponse']
export type CollectionCreate = components['schemas']['CollectionCreate']
export type CollectionUpdate = components['schemas']['CollectionUpdate']
export type SourceVersion = components['schemas']['SourceVersionResponse']
export type SourceList = components['schemas']['SourceListResponse']
export type UploadResult = components['schemas']['UploadResponse']
export type Evidence = components['schemas']['EvidenceResponse']
export type EvidenceList = components['schemas']['EvidenceListResponse']
export type SpaceKnowledgeClaim = components['schemas']['SpaceKnowledgeClaimResponse']
export type SpaceKnowledgeList = components['schemas']['SpaceKnowledgeListResponse']
export type SpaceRoute = components['schemas']['SpaceRouteResponse']
export type SearchResponse = components['schemas']['SearchResponse']
export type SearchExplanation = components['schemas']['SearchExplanationResponse']
export type Run = components['schemas']['RunResponse']
export type RunList = components['schemas']['RunListResponse']
export type Conversation = components['schemas']['ConversationResponse']
export type ConversationList = components['schemas']['ConversationListResponse']
export type RunSnapshot = components['schemas']['RunSnapshotResponse']
export type RunSuggestedQuestions = components['schemas']['RunSuggestedQuestionListResponse']
export type Artifact = components['schemas']['ArtifactResponse']
export type ArtifactList = components['schemas']['ArtifactListResponse']
export type ArtifactRefreshProposal = components['schemas']['ArtifactRefreshProposalResponse']
export type ArtifactRefreshProposalList =
  components['schemas']['ArtifactRefreshProposalListResponse']
export type ArtifactTemplate = components['schemas']['ArtifactTemplateResponse']
export type ArtifactTemplateList = components['schemas']['ArtifactTemplateListResponse']
export type Provider = components['schemas']['ProviderResponse']
export type ProviderList = components['schemas']['ProviderListResponse']
export type ProviderCreate = components['schemas']['ProviderCreate']
export type Model = components['schemas']['ModelResponseSchema']
export type ModelList = components['schemas']['ModelListResponse']
export type ModelRoute = components['schemas']['ModelRouteResponse']
export type ModelRouteList = components['schemas']['ModelRouteListResponse']
export type ModelSetup = components['schemas']['ModelSetupResponse']
export type ModelSetupApplyResult = components['schemas']['ModelSetupApplyResponse']
export type ConnectorSync = components['schemas']['ConnectorSyncCreate']
export type ConnectorSyncResult = components['schemas']['ConnectorSyncResponse']
export type SourceSyncSchedule = components['schemas']['SourceSyncScheduleResponse']
export type SourceSyncExecution = components['schemas']['SourceSyncExecutionResponse']
export type SourceSyncExecutionList = components['schemas']['SourceSyncExecutionListResponse']
export type ToolList = components['schemas']['ToolListResponse']
export type Health = components['schemas']['HealthResponse']
export type IngestionJobList = components['schemas']['IngestionJobListResponse']
export type IngestionJob = components['schemas']['IngestionJobResponse']
export type BackupList = components['schemas']['BackupListResponse']
export type AgentProfileList = components['schemas']['AgentProfileListResponse']

export type ScopeInput = {
  space_ids: string[]
  collection_ids?: string[]
  source_ids?: string[]
  global_search?: boolean
  publish_watermark?: number | null
}

export type DurableRunEvent = {
  event_id: string
  stream_id: string
  sequence: number
  event_type: string
  occurred_at: string
  producer: string
  trace_id: string
  schema_version: number
  public_payload: Record<string, unknown>
  artifact_refs: string[]
  supersedes: string | null
}

type ApiErrorBody = {
  error?: {
    code?: string
    message?: string
    details?: unknown
    trace_id?: string
    retryable?: boolean
  }
  detail?: unknown
}

export class NexusApiError extends Error {
  readonly status: number
  readonly code: string
  readonly traceId?: string
  readonly details?: unknown
  readonly retryable: boolean

  constructor(status: number, body: ApiErrorBody) {
    const error = body.error
    super(error?.message ?? `Request failed with status ${status}`)
    this.name = 'NexusApiError'
    this.status = status
    this.code = error?.code ?? 'HTTP_ERROR'
    this.traceId = error?.trace_id
    this.details = error?.details ?? body.detail
    this.retryable = error?.retryable ?? false
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, { ...init, headers })
  const rawBody = await response.text()
  let parsedBody: unknown = null
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody)
    } catch {
      parsedBody = rawBody
    }
  }
  if (!response.ok) {
    const body: ApiErrorBody =
      parsedBody && typeof parsedBody === 'object'
        ? (parsedBody as ApiErrorBody)
        : { detail: parsedBody ?? response.statusText }
    throw new NexusApiError(response.status, body)
  }
  return parsedBody as T
}

const query = (values: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  })
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export const nexusApi = {
  listSpaces: () => request<SpaceList>('/api/v1/spaces'),
  getSpace: (id: string) => request<Space>(`/api/v1/spaces/${id}`),
  getSpacePortrait: (id: string) => request<{
    space_id: string
    space_name: string
    evidence_count: number
    modalities: Record<string, number>
    profile_text: string
    algorithm: string
    clusters: Array<{
      id: string
      label: string
      keywords: string[]
      evidence_count: number
      modalities: Record<string, number>
      x: number
      y: number
      samples: Array<{ evidence_revision_id: string; source_name: string; excerpt: string; modality: string }>
    }>
  }>(`/api/v1/spaces/${id}/portrait`),
  getSpaceSuggestedQuestions: (id: string) => request<{
    space_id: string
    portrait_algorithm: string
    suggestions: Array<{
      id: string
      question: string
      cluster_id: string
      cluster_label: string
      evidence_count: number
      modalities: string[]
      reason: string
    }>
  }>(`/api/v1/spaces/${id}/suggested-questions`),
  routeSpaces: (queryText: string, limit = 3) =>
    request<SpaceRoute>('/api/v1/spaces/route', {
      method: 'POST',
      body: JSON.stringify({ query: queryText, limit }),
    }),
  createSpace: (body: SpaceCreate) =>
    request<Space>('/api/v1/spaces', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
  deleteSpace: (id: string) =>
    request<Space>(`/api/v1/spaces/${id}`, { method: 'DELETE' }),
  listCollections: (spaceId: string) =>
    request<CollectionList>(`/api/v1/spaces/${spaceId}/collections`),
  getCollection: (id: string) => request<Collection>(`/api/v1/collections/${id}`),
  createCollection: (spaceId: string, body: CollectionCreate) =>
    request<Collection>(`/api/v1/spaces/${spaceId}/collections`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateCollection: (id: string, body: CollectionUpdate) =>
    request<Collection>(`/api/v1/collections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteCollection: (id: string) =>
    request<Collection>(`/api/v1/collections/${id}`, { method: 'DELETE' }),
  listSources: (spaceId: string) => request<SourceList>(`/api/v1/spaces/${spaceId}/sources`),
  uploadSource: (spaceId: string, file: File, sourceId?: string) => {
    const data = new FormData()
    data.set('space_id', spaceId)
    data.set('file', file)
    if (sourceId) data.set('source_id', sourceId)
    return request<UploadResult>('/api/v1/sources/upload', {
      method: 'POST',
      body: data,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
  },
  deleteSource: (sourceId: string) =>
    request<{
      source_id: string
      status: string
      projection: string
      removed_projection_items: number
    }>(`/api/v1/sources/${sourceId}`, { method: 'DELETE' }),
  reprocessSource: (sourceId: string) =>
    request<IngestionJob>(`/api/v1/sources/${sourceId}/reprocess`, { method: 'POST' }),
  refreshSource: (spaceId: string, sourceId: string) =>
    request<ConnectorSyncResult>(`/api/v1/spaces/${spaceId}/sources/${sourceId}/sync`, {
      method: 'POST',
    }),
  getSourceSyncSchedule: (spaceId: string, sourceId: string) =>
    request<components['schemas']['SourceSyncScheduleEnvelope']>(
      `/api/v1/spaces/${spaceId}/sources/${sourceId}/sync-schedule`,
    ),
  configureSourceSyncSchedule: (
    spaceId: string,
    sourceId: string,
    body: components['schemas']['SourceSyncScheduleUpdate'],
  ) => request<SourceSyncSchedule>(
    `/api/v1/spaces/${spaceId}/sources/${sourceId}/sync-schedule`,
    { method: 'PUT', body: JSON.stringify(body) },
  ),
  listSourceSyncExecutions: (spaceId: string, sourceId: string, limit = 20) =>
    request<SourceSyncExecutionList>(
      `/api/v1/spaces/${spaceId}/sources/${sourceId}/sync-executions${query({ limit })}`,
    ),
  getIngestionJob: (id: string) =>
    request<UploadResult['job']>(`/api/v1/ingestion-jobs/${id}`),
  retryIngestionJob: (id: string) =>
    request<IngestionJob>(`/api/v1/ingestion-jobs/${id}/retry`, { method: 'POST' }),
  cancelIngestionJob: (id: string) =>
    request<IngestionJob>(`/api/v1/ingestion-jobs/${id}/cancel`, { method: 'POST' }),
  listIngestionJobEvents: (id: string, after = 0) =>
    request<components['schemas']['IngestionJobEventListResponse']>(
      `/api/v1/ingestion-jobs/${id}/events${query({ after, stream: 'false' })}`,
    ),
  listEvidence: (filters: { spaceId?: string; sourceId?: string; modality?: string; query?: string; cursor?: string; limit?: number } = {}) =>
    request<EvidenceList>(
      `/api/v1/evidence${query({
        space_id: filters.spaceId,
        source_id: filters.sourceId,
        modality: filters.modality,
        query: filters.query,
        cursor: filters.cursor,
        limit: filters.limit,
      })}`,
    ),
  getEvidence: (id: string) => request<Evidence>(`/api/v1/evidence/${id}`),
  listSpaceKnowledge: (
    spaceId: string,
    filters: { status?: 'all' | 'supported' | 'attention'; cursor?: string; limit?: number } = {},
  ) => request<SpaceKnowledgeList>(
    `/api/v1/spaces/${spaceId}/knowledge${query({
      status: filters.status,
      cursor: filters.cursor,
      limit: filters.limit,
    })}`,
  ),
  expandEvidence: (id: string, before = 2, after = 2) =>
    request<EvidenceList>(`/api/v1/evidence/${id}/expand?before=${before}&after=${after}`, { method: 'POST' }),
  search: (body: {
    query: string
    scope: ScopeInput
    quality_mode: 'fast' | 'quality' | 'deep'
    limit?: number
  }) => request<SearchResponse>('/api/v1/search', { method: 'POST', body: JSON.stringify(body) }),
  listRuns: (limit = 50) => request<RunList>(`/api/v1/runs${query({ limit })}`),
  listConversations: (filters: {
    query?: string
    archived?: boolean
    cursor?: string
    limit?: number
  } = {}) => request<ConversationList>(`/api/v1/conversations${query({
    query: filters.query,
    archived: filters.archived ? 'true' : undefined,
    cursor: filters.cursor,
    limit: filters.limit,
  })}`),
  getConversation: (id: string) =>
    request<Conversation>(`/api/v1/conversations/${id}`),
  updateConversation: (
    id: string,
    body: { expected_revision: number; title?: string; pinned?: boolean; archived?: boolean },
  ) => request<Conversation>(`/api/v1/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
  getRun: (id: string) => request<Run>(`/api/v1/runs/${id}`),
  listConversationRuns: (conversationId: string) =>
    request<{ items: Run[]; page: { next_cursor: string | null } }>(
      `/api/v1/conversations/${conversationId}/runs`,
    ),
  getRunSnapshot: (id: string) => request<RunSnapshot>(`/api/v1/runs/${id}/snapshot`),
  getRunSuggestedQuestions: (id: string) =>
    request<RunSuggestedQuestions>(`/api/v1/runs/${id}/suggested-questions`),
  listRunEvents: (id: string, after = 0) =>
    request<{ items: DurableRunEvent[]; page: { next_cursor: number | null } }>(
      `/api/v1/runs/${id}/events${query({ after, stream: 'false' })}`,
    ),
  createRun: (body: {
    goal: string
    kind?: 'quick' | 'research'
    quality_mode?: 'fast' | 'quality' | 'deep'
    scope: ScopeInput
    auto_route?: boolean
    conversation_id?: string
    parent_run_id?: string
    attachment_source_ids?: string[]
    selected_model_deployment_id?: string
  }) =>
    request<Run>('/api/v1/runs', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    }),
  pauseRun: (id: string) => request<Run>(`/api/v1/runs/${id}/pause`, { method: 'POST' }),
  resumeRun: (id: string) => request<Run>(`/api/v1/runs/${id}/resume`, { method: 'POST' }),
  cancelRun: (id: string) => request<Run>(`/api/v1/runs/${id}/cancel`, { method: 'POST' }),
  listArtifacts: () => request<ArtifactList>('/api/v1/artifacts'),
  listArtifactTemplates: () => request<ArtifactTemplateList>('/api/v1/artifact-templates'),
  createArtifactFromTemplate: (body: {
    source_artifact_id: string
    template_id: string
    title: string
    review_text?: string
  }) => request<Artifact>('/api/v1/artifacts/from-template', {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  getArtifact: (id: string) => request<Artifact>(`/api/v1/artifacts/${id}`),
  reviseArtifact: (
    id: string,
    body: { expected_revision_no: number; canonical_document: Record<string, unknown> },
  ) =>
    request<Artifact>(`/api/v1/artifacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  setArtifactStatus: (
    id: string,
    body: { expected_revision_no: number; status: 'candidate' | 'published' },
  ) =>
    request<Artifact>(`/api/v1/artifacts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listArtifactRefreshProposals: (id: string) =>
    request<ArtifactRefreshProposalList>(`/api/v1/artifacts/${id}/refresh-proposals`),
  resolveArtifactRefreshProposal: (id: string, accept: boolean) =>
    request<ArtifactRefreshProposal>(`/api/v1/artifact-refresh-proposals/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    }),
  listProviders: () => request<ProviderList>('/api/v1/model-providers'),
  syncModelCatalog: () =>
    request<{ providers: number; models: number; discovered: number; failures: unknown[] }>(
      '/api/v1/model-catalog/sync',
      { method: 'POST' },
    ),
  verifyConfiguredModels: () =>
    request<{
      configured: number
      probed: number
      enabled: number
      routes_activated: number
      roles_ready: string[]
      failures: Array<{ model_id: string; model: string; reason: string }>
      verified_at: string
    }>('/api/v1/model-catalog/verify-configured', { method: 'POST' }),
  getRecommendedModelSetup: () => request<ModelSetup>('/api/v1/model-setup'),
  applyRecommendedModelSetup: (replaceExisting = false) =>
    request<ModelSetupApplyResult>('/api/v1/model-setup/apply', {
      method: 'POST',
      body: JSON.stringify({ replace_existing: replaceExisting }),
    }),
  createProvider: (body: ProviderCreate) =>
    request<Provider>('/api/v1/model-providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  discoverModels: (providerId: string) =>
    request<ModelList>(`/api/v1/model-providers/${providerId}/discover`, { method: 'POST' }),
  registerModel: (
    providerId: string,
    body: { upstream_model_id: string; declared_capabilities: string[] },
  ) =>
    request<Model>(`/api/v1/model-providers/${providerId}/models`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listModels: () => request<ModelList>('/api/v1/models'),
  probeModel: (modelId: string) =>
    request<Model>(`/api/v1/models/${modelId}/probe`, { method: 'POST' }),
  enableModel: (modelId: string) =>
    request<Model>(`/api/v1/models/${modelId}/enable`, { method: 'POST' }),
  listModelRoutes: () => request<ModelRouteList>('/api/v1/model-routes'),
  createModelRoute: (body: {
    role: string
    deployment_ids: string[]
    required_capabilities: string[]
  }) =>
    request<ModelRoute>('/api/v1/model-routes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  activateModelRoute: (routeId: string) =>
    request<ModelRoute>(`/api/v1/model-routes/${routeId}/activate`, { method: 'POST' }),
  syncConnector: (body: ConnectorSync) =>
    request<ConnectorSyncResult>('/api/v1/connectors/sync', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listTools: () => request<ToolList>('/api/v1/tools'),
  listAgentProfiles: () => request<AgentProfileList>('/api/v1/agent-profiles'),
  listIngestionJobs: (filters: { spaceId?: string; status?: string; cursor?: string; limit?: number } = {}) =>
    request<IngestionJobList>(`/api/v1/ingestion-jobs${query({
      space_id: filters.spaceId,
      status: filters.status,
      cursor: filters.cursor,
      limit: filters.limit,
    })}`),
  listBackups: () => request<BackupList>('/api/v1/backups'),
  createBackup: () => request<Record<string, unknown>>('/api/v1/backups', { method: 'POST' }),
  getSafeSystemConfig: () => request<Record<string, unknown>>('/api/v1/system/config'),
  getHealth: () => request<Health>('/api/v1/system/health'),
  getIndexHealth: () => request<Record<string, unknown>>('/api/v1/system/indexes'),
  reconcile: () => request<Record<string, unknown>>('/api/v1/reconciliation', { method: 'POST' }),
}
