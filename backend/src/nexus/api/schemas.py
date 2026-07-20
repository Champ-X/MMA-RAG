from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel

from nexus.shared.domain.enums import KnowledgeProfile, Modality, QualityMode, RunKind


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    trace_id: str
    retryable: bool = False


class ErrorEnvelope(BaseModel):
    error: ErrorBody


class PageMeta(BaseModel):
    next_cursor: str | None = None


class SpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str | None = Field(default=None, max_length=120)
    description: str = ""
    knowledge_profile: KnowledgeProfile = KnowledgeProfile.SEARCHABLE
    default_quality: QualityMode | None = None


class SpacePolicyResponse(BaseModel):
    profile: KnowledgeProfile
    label: str
    summary: str
    default_quality: QualityMode
    recommended_run_kind: RunKind
    auto_route_eligible: bool
    behaviors: list[str]


class SpaceResponse(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    knowledge_profile: KnowledgeProfile
    default_quality: QualityMode
    policy: SpacePolicyResponse
    archived: bool
    revision: int
    source_count: int
    modality_counts: dict[str, int] = Field(default_factory=dict)
    evidence_modality_counts: dict[str, int] = Field(default_factory=dict)
    status_counts: dict[str, int] = Field(default_factory=dict)
    cover_source_version_id: str | None = None
    cover_evidence_id: str | None = None
    cover_source_name: str | None = None
    created_at: datetime
    updated_at: datetime


class SpaceListResponse(BaseModel):
    items: list[SpaceResponse]
    page: PageMeta


class SpaceRouteRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=3, ge=1, le=10)


class CollectionRuleInput(BaseModel):
    field: Literal["display_name", "modality", "mime_type", "connector_kind", "status"]
    operator: Literal["equals", "contains", "in"]
    value: str | list[str]


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    color: Literal["cobalt", "violet", "teal", "amber", "coral"] = "cobalt"
    view_kind: Literal["manual", "dynamic"] = "manual"
    rule_logic: Literal["all", "any"] = "all"
    source_ids: list[str] = Field(default_factory=list)
    rules: list[CollectionRuleInput] = Field(default_factory=list)


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    color: Literal["cobalt", "violet", "teal", "amber", "coral"] | None = None
    rule_logic: Literal["all", "any"] | None = None
    source_ids: list[str] | None = None
    rules: list[CollectionRuleInput] | None = None
    expected_revision: int | None = Field(default=None, ge=1)


class CollectionRuleResponse(BaseModel):
    id: str
    field: str
    operator: str
    value: Any
    position: int


class CollectionResponse(BaseModel):
    id: str
    space_id: str
    name: str
    description: str
    color: str
    view_kind: str
    rule_logic: str
    archived: bool
    revision: int
    source_ids: list[str]
    source_count: int
    rules: list[CollectionRuleResponse]
    modality_counts: dict[str, int] = Field(default_factory=dict)
    cover_source_version_id: str | None = None
    cover_evidence_id: str | None = None
    cover_source_name: str | None = None
    created_at: datetime
    updated_at: datetime


class CollectionListResponse(BaseModel):
    items: list[CollectionResponse]
    page: PageMeta


class SourceIngestionSummaryResponse(BaseModel):
    id: str
    status: str
    stage: str
    error_code: str | None
    error_message: str | None
    attempt_count: int
    updated_at: datetime


class SourceProjectionResponse(BaseModel):
    state: str
    expected_evidence_count: int
    active_evidence_count: int
    release_id: str | None


class SourceSyncScheduleResponse(BaseModel):
    id: str
    space_id: str
    source_id: str
    interval_minutes: int
    enabled: bool
    next_run_at: datetime
    last_run_at: datetime | None
    last_status: str
    last_error: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


class SourceSyncScheduleEnvelope(BaseModel):
    schedule: SourceSyncScheduleResponse | None


class SourceSyncScheduleUpdate(BaseModel):
    interval_minutes: int = Field(ge=15, le=10080)
    enabled: bool = True
    expected_revision: int | None = Field(default=None, ge=1)


class SourceSyncExecutionResponse(BaseModel):
    id: str
    schedule_id: str | None
    space_id: str
    source_id: str
    trigger: str
    status: str
    items_checked: int
    new_version_count: int
    job_ids: list[str]
    source_version_ids: list[str]
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None


class SourceSyncExecutionListResponse(BaseModel):
    items: list[SourceSyncExecutionResponse]


class SourceSyncResponse(BaseModel):
    connector_kind: str
    refreshable: bool
    scope: str
    last_checked_at: datetime
    schedules: list[SourceSyncScheduleResponse] = Field(default_factory=list)


class SourceHealthResponse(BaseModel):
    outcome: str
    severity: str
    summary: str
    searchable: bool
    blockers: list[str]
    primary_action: str | None


class SourceVersionResponse(BaseModel):
    id: str
    source_id: str
    space_ids: list[str]
    display_name: str
    version_no: int
    content_hash: str
    mime_type: str
    byte_size: int
    connector_kind: str
    canonical_uri: str | None
    external_version: str | None
    modality: Modality
    status: str
    capabilities: dict[str, str]
    capability_details: dict[str, dict[str, Any]]
    latest_job: SourceIngestionSummaryResponse | None
    projection: SourceProjectionResponse
    sync: SourceSyncResponse
    health: SourceHealthResponse
    created_at: datetime
    published_evidence_count: int = 0
    derived_image_count: int = 0
    cover_evidence_id: str | None = None


class IngestionJobResponse(BaseModel):
    id: str
    source_version_id: str
    status: str
    stage: str
    error_code: str | None
    error_message: str | None
    source_id: str | None = None
    display_name: str | None = None
    modality: Modality | None = None
    mime_type: str | None = None
    attempt_count: int = 0
    event_count: int = 0
    events: list[IngestionJobEventResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class IngestionJobEventResponse(BaseModel):
    sequence: int
    event_type: str
    payload: dict[str, Any]
    occurred_at: datetime


class IngestionJobEventListResponse(BaseModel):
    items: list[IngestionJobEventResponse]
    page: PageMeta


class IngestionJobListResponse(BaseModel):
    items: list[IngestionJobResponse]
    page: PageMeta


class UploadResponse(BaseModel):
    source_version: SourceVersionResponse
    job: IngestionJobResponse


class ConnectorCreateBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    space_id: str


class MarkdownConnectorCreate(ConnectorCreateBase):
    kind: Literal["markdown"]
    title: str = Field(default="Manual note", min_length=1, max_length=512)
    content: str = Field(min_length=1)


class UrlConnectorCreate(ConnectorCreateBase):
    kind: Literal["url"]
    url: str = Field(min_length=1, max_length=4096)
    mode: Literal["auto", "webpage", "file"] = "auto"
    filename: str | None = Field(default=None, max_length=512)
    include_links: bool = True
    include_images: bool = True


class RssConnectorCreate(ConnectorCreateBase):
    kind: Literal["rss"]
    feed_url: str = Field(min_length=1, max_length=4096)
    max_entries: int = Field(default=20, ge=1, le=200)


class FolderConnectorCreate(ConnectorCreateBase):
    kind: Literal["folder"]
    path: str = Field(min_length=1, max_length=4096)
    recursive: bool = True
    extensions: list[str] = Field(default_factory=list, max_length=100)
    exclude_globs: list[str] = Field(default_factory=list, max_length=100)
    max_files: int = Field(default=500, ge=1, le=2000)


class GitConnectorCreate(ConnectorCreateBase):
    kind: Literal["git"]
    repository_url: str = Field(min_length=1, max_length=4096)
    branch: str | None = Field(default=None, max_length=255)
    subdirectory: str | None = Field(default=None, max_length=1024)
    include_globs: list[str] = Field(default_factory=list)
    exclude_globs: list[str] = Field(default_factory=list)
    max_files: int = Field(default=500, ge=1, le=2000)


class NewsConnectorCreate(ConnectorCreateBase):
    kind: Literal["news"]
    query: str = Field(min_length=1, max_length=1000)
    topic: Literal["general", "news", "finance"] = "news"
    time_range: Literal["day", "week", "month", "year"] = "week"
    search_depth: Literal["basic", "advanced", "fast", "ultra-fast"] = "advanced"
    max_results: int = Field(default=10, ge=1, le=20)
    include_full_content: bool = False


class ImageSearchConnectorCreate(ConnectorCreateBase):
    kind: Literal["image_search"]
    query: str = Field(min_length=1, max_length=1000)
    source: Literal["google_images", "pixabay", "internet_archive"] = "google_images"
    quantity: int = Field(default=8, ge=1, le=20)
    image_type: Literal["all", "photo", "illustration", "vector"] = "photo"
    order: Literal["popular", "latest", "relevance", "downloads"] = "relevance"
    safe_search: bool = True


ConnectorSyncRequest = Annotated[
    MarkdownConnectorCreate
    | UrlConnectorCreate
    | RssConnectorCreate
    | FolderConnectorCreate
    | GitConnectorCreate
    | NewsConnectorCreate
    | ImageSearchConnectorCreate,
    Field(discriminator="kind"),
]


class ConnectorSyncCreate(RootModel[ConnectorSyncRequest]):
    """Connector-specific contract; unrelated parameters are rejected."""


class ConnectorSyncResponse(BaseModel):
    connector_kind: str
    location: str | None
    items: list[UploadResponse]
    execution: SourceSyncExecutionResponse | None = None


class UploadSessionCreate(BaseModel):
    space_id: str
    source_id: str | None = None
    filename: str = Field(min_length=1, max_length=512)
    mime_type: str = "application/octet-stream"
    total_bytes: int = Field(gt=0)
    part_size: int = Field(default=8 * 1024 * 1024, ge=1024 * 1024, le=64 * 1024 * 1024)
    expected_hash: str | None = None


class UploadSessionResponse(BaseModel):
    id: str
    space_id: str
    source_id: str | None
    filename: str
    mime_type: str
    total_bytes: int
    part_size: int
    expected_hash: str | None
    expected_parts: int
    received_parts: list[int]
    status: str
    expires_at: datetime
    completed_job_id: str | None


class UploadComplete(BaseModel):
    expected_hash: str | None = None


class SourceListResponse(BaseModel):
    items: list[SourceVersionResponse]
    page: PageMeta


class LocatorResponse(BaseModel):
    locator_type: str
    page_no: int | None = None
    bbox: list[float] | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    sheet: str | None = None
    cell_range: str | None = None
    char_start: int | None = None
    char_end: int | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class EvidenceResponse(BaseModel):
    id: str
    source_id: str
    source_version_id: str
    source_name: str
    modality: Modality
    evidence_type: str
    text_content: str
    searchable_text: str
    status: str
    locator: LocatorResponse
    quality_flags: list[str]
    visible_from_sequence: int
    visible_until_sequence: int | None
    created_at: datetime
    asset_url: str


class EvidenceListResponse(BaseModel):
    items: list[EvidenceResponse]
    page: PageMeta


class KnowledgeEvidenceReferenceResponse(BaseModel):
    evidence_revision_id: str
    source_name: str
    modality: str
    evidence_type: str
    locator_type: str
    relation: str
    support_score: float


class SpaceKnowledgeClaimResponse(BaseModel):
    id: str
    run_id: str
    text: str
    claim_type: str
    verification_level: str
    status: str
    explanation: str
    evidence: list[KnowledgeEvidenceReferenceResponse]
    created_at: datetime


class SpaceKnowledgeListResponse(BaseModel):
    items: list[SpaceKnowledgeClaimResponse]
    page: PageMeta


class ScopeRequest(BaseModel):
    space_ids: list[str] = Field(default_factory=list)
    collection_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)
    global_search: bool = False
    publish_watermark: int | None = None


class SearchBody(BaseModel):
    query: str = Field(min_length=1)
    scope: ScopeRequest
    quality_mode: QualityMode = QualityMode.QUALITY
    modalities: list[Modality] = Field(default_factory=list)
    limit: int = Field(default=10, ge=1, le=100)


class SearchHitResponse(BaseModel):
    rank: int
    fused_score: float
    channels: list[str]
    selection_reason: str
    evidence: EvidenceResponse


class ChannelResponse(BaseModel):
    channel: str
    status: str
    candidate_count: int
    latency_ms: float
    error: str | None
    model: str | None
    generation: str | None
    native_modality: bool


class SearchExplanationResponse(BaseModel):
    outcome: str
    severity: str
    scope_evidence_count: int
    candidate_count: int
    completed_channels: int
    failed_channels: int
    unavailable_channels: int
    suggested_actions: list[str]


class SearchResponse(BaseModel):
    query: str
    requested_quality: QualityMode
    actual_quality: QualityMode
    degraded: bool
    degradation_reasons: list[str]
    coverage: dict[str, int]
    hits: list[SearchHitResponse]
    channels: list[ChannelResponse]
    explanation: SearchExplanationResponse


class RunCreate(BaseModel):
    goal: str = Field(min_length=1)
    kind: RunKind | None = None
    quality_mode: QualityMode | None = None
    scope: ScopeRequest
    execute: bool = True
    conversation_id: str | None = None
    parent_run_id: str | None = None
    attachment_source_ids: list[str] = Field(default_factory=list)
    selected_model_deployment_id: str | None = None
    auto_route: bool = False


class RunResponse(BaseModel):
    id: str
    conversation_id: str
    parent_run_id: str | None
    goal: str
    kind: RunKind
    quality_mode: QualityMode
    scope: ScopeRequest
    request_context: dict[str, Any]
    selected_model_deployment_id: str | None
    status: str
    result: dict[str, Any] | None
    stop_reason: str | None
    state_version: int
    execution_epoch: int
    cancel_requested: bool
    created_at: datetime
    updated_at: datetime


class RunListResponse(BaseModel):
    items: list[RunResponse]
    page: PageMeta


class ConversationResponse(BaseModel):
    id: str
    title: str
    pinned: bool
    archived: bool
    revision: int
    run_count: int
    latest_run_id: str
    latest_goal: str
    latest_status: str
    kinds: list[str]
    space_ids: list[str]
    citation_count: int
    created_at: datetime
    updated_at: datetime
    last_activity_at: datetime


class ConversationListResponse(BaseModel):
    items: list[ConversationResponse]
    page: PageMeta


class ConversationUpdate(BaseModel):
    expected_revision: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    pinned: bool | None = None
    archived: bool | None = None


class RunSnapshotResponse(BaseModel):
    run_id: str
    snapshot: dict[str, Any]
    schema_version: int
    created_at: datetime
    state: RunResponse
    base_cursor: int


class RunSuggestedQuestionResponse(BaseModel):
    id: str
    question: str
    reason: Literal[
        "uncovered_retrieved_evidence",
        "cross_source_comparison",
        "native_modality_deep_dive",
        "cited_evidence_deep_dive",
    ]
    evidence_revision_ids: list[str]
    source_names: list[str]
    modalities: list[str]


class RunSuggestionScopeResponse(BaseModel):
    space_ids: list[str]
    source_ids: list[str]
    publish_watermark: int | None


class RunSuggestedQuestionListResponse(BaseModel):
    run_id: str
    outcome: Literal["available", "no_evidence_ledger"]
    generated_from: Literal["frozen_evidence_ledger"]
    scope: RunSuggestionScopeResponse
    ledger_evidence_count: int
    cited_evidence_count: int
    items: list[RunSuggestedQuestionResponse]


class CompareEvidenceBody(BaseModel):
    left_source_version_id: str
    right_source_version_id: str


class ArtifactCoverageResponse(BaseModel):
    content_block_count: int
    supported_block_count: int
    coverage_percent: int
    bound_evidence_count: int
    user_block_count: int


class ArtifactResponse(BaseModel):
    id: str
    run_id: str | None
    title: str
    artifact_type: str
    status: str
    revision_id: str
    revision_no: int
    canonical_document: dict[str, Any]
    evidence_revision_ids: list[str]
    coverage: ArtifactCoverageResponse
    pending_refresh_count: int
    created_at: datetime
    updated_at: datetime


class ArtifactListResponse(BaseModel):
    items: list[ArtifactResponse]
    page: PageMeta


class ArtifactRevisionCreate(BaseModel):
    expected_revision_no: int = Field(ge=1)
    canonical_document: dict[str, Any]


class ArtifactStatusUpdate(BaseModel):
    expected_revision_no: int = Field(ge=1)
    status: Literal["candidate", "published"]


class ArtifactTemplateResponse(BaseModel):
    id: str
    name: str
    description: str
    artifact_type: str
    audience: str
    review_prompt: str | None


class ArtifactTemplateListResponse(BaseModel):
    items: list[ArtifactTemplateResponse]


class ArtifactFromTemplateCreate(BaseModel):
    source_artifact_id: str = Field(min_length=1)
    template_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=512)
    review_text: str | None = Field(default=None, max_length=4000)


class ArtifactRefreshProposalResponse(BaseModel):
    id: str
    artifact_id: str
    base_revision_id: str
    status: str
    reason: str
    impacted_evidence_revision_ids: list[str]
    proposed_document: dict[str, Any]
    proposed_evidence_revision_ids: list[str]
    diff: dict[str, Any]
    created_at: datetime
    resolved_at: datetime | None


class ArtifactRefreshProposalListResponse(BaseModel):
    items: list[ArtifactRefreshProposalResponse]


class ArtifactRefreshResolution(BaseModel):
    accept: bool


class HealthComponent(BaseModel):
    status: Literal["ready", "degraded", "unavailable", "not_configured"]
    detail: dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: Literal["ready", "degraded", "unavailable"]
    control_ready: bool
    capabilities: dict[str, HealthComponent]
    version: str


class BackupResponse(BaseModel):
    id: str
    status: str
    destination: str
    verified: bool
    manifest: dict[str, Any]
    error: str | None
    created_at: datetime
    updated_at: datetime


class BackupListResponse(BaseModel):
    items: list[BackupResponse]


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    protocol_family: Literal[
        "openai_chat",
        "openai_responses",
        "openai_compatible",
        "anthropic_messages",
        "google_gemini",
    ]
    endpoint: str
    secret_ref: str | None = None


class ProviderResponse(BaseModel):
    id: str
    name: str
    protocol_family: str
    endpoint: str
    secret_ref: str | None
    enabled: bool
    health_status: str


class ProviderListResponse(BaseModel):
    items: list[ProviderResponse]


class ModelResponseSchema(BaseModel):
    id: str
    provider_connection_id: str
    protocol_family: str
    upstream_model_id: str
    lifecycle: str
    declared_capabilities: list[str]
    verified_capabilities: list[str]
    observation: dict[str, Any]


class ModelListResponse(BaseModel):
    items: list[ModelResponseSchema]


class ModelSetupRoleResponse(BaseModel):
    role: str
    required_capability: str
    state: Literal["active", "candidate", "fallback"]
    active_deployment_ids: list[str]
    active_model_names: list[str]
    recommended_deployment_id: str | None
    recommended_model_name: str | None
    reason: str


class ModelSetupGroupResponse(BaseModel):
    group: str
    status: Literal["ready", "action_available", "fallback"]
    ready_count: int
    configurable_count: int
    total_count: int
    roles: list[str]


class ModelSetupResponse(BaseModel):
    status: Literal[
        "ready",
        "action_available",
        "verification_required",
        "credentials_required",
        "partial",
    ]
    provider_count: int
    discovered_model_count: int
    enabled_model_count: int
    active_route_count: int
    total_role_count: int
    ready_role_count: int
    configurable_role_count: int
    groups: list[ModelSetupGroupResponse]
    roles: list[ModelSetupRoleResponse]


class ModelSetupApplyRequest(BaseModel):
    replace_existing: bool = False


class ModelSetupApplyResponse(BaseModel):
    routes_activated: int
    roles_activated: list[str]
    unfilled_roles: list[str]
    setup: ModelSetupResponse


class ModelRegistrationCreate(BaseModel):
    upstream_model_id: str = Field(min_length=1, max_length=255)
    declared_capabilities: list[str] = Field(default_factory=lambda: ["text"])


class ModelRouteCreate(BaseModel):
    role: str = Field(min_length=1, max_length=64)
    deployment_ids: list[str] = Field(min_length=1)
    required_capabilities: list[str] = Field(default_factory=lambda: ["text"])


class ModelRouteResponse(BaseModel):
    id: str
    role: str
    revision: int
    status: str
    deployment_ids: list[str]
    required_capabilities: list[str]
    created_at: datetime
    updated_at: datetime


class ModelRouteListResponse(BaseModel):
    items: list[ModelRouteResponse]


class ToolResponse(BaseModel):
    id: str
    name: str
    version: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    risk_level: str
    requires_approval: bool
    idempotency: str
    enabled: bool


class ToolListResponse(BaseModel):
    items: list[ToolResponse]


class AgentProfileResponse(BaseModel):
    id: str
    enabled: bool
    description: str
    default_quality: QualityMode
    minimum_verification: str
    tools: list[str]
    policy: dict[str, Any]


class AgentProfileListResponse(BaseModel):
    items: list[AgentProfileResponse]


class ToolExecuteBody(BaseModel):
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, max_length=128)


class ToolExecutionResponse(BaseModel):
    id: str
    run_id: str
    tool_definition_id: str
    status: str
    idempotency_key: str
    input_payload: dict[str, Any]
    output_payload: dict[str, Any] | None
    error: str | None
    created_at: datetime
    updated_at: datetime
