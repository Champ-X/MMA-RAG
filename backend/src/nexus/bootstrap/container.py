from __future__ import annotations

import os
from dataclasses import dataclass

from qdrant_client import QdrantClient

from nexus.config import NexusSettings, get_settings
from nexus.infrastructure.blob import FilesystemBlobStore, MinioBlobStore
from nexus.infrastructure.encoders import (
    BGEM3SparseEncoder,
    OpenAIEmbeddingEncoder,
    RemoteReranker,
    TransformersMultimodalEncoder,
)
from nexus.infrastructure.langgraph import LangGraphRuntimeAdapter
from nexus.infrastructure.mineru import MinerURemoteAdapter
from nexus.infrastructure.operations import OperationsService
from nexus.infrastructure.postgres import Database
from nexus.infrastructure.postgres.model_repository import SqlModelCatalogRepository
from nexus.infrastructure.postgres.repository import SqlControlPlaneRepository
from nexus.infrastructure.postgres.run_repository import SqlRunRepository
from nexus.infrastructure.postgres.search import PostgresExactChannel
from nexus.infrastructure.postgres.tool_repository import SqlToolRepository
from nexus.infrastructure.postgres.upload_repository import SqlUploadSessionRepository
from nexus.infrastructure.providers import (
    ExtractiveModelGateway,
    GovernedModelGateway,
    OpenAICompatibleGateway,
    RemoteMediaAnalyzer,
)
from nexus.infrastructure.qdrant import QdrantEvidenceIndex, QdrantFamilyChannel
from nexus.infrastructure.sandbox import (
    DisabledSandboxRunner,
    LocalTestSandboxRunner,
    UnixSocketSandboxRunner,
)
from nexus.infrastructure.secrets import EnvironmentCredentialStore
from nexus.infrastructure.source_adapters import ParserRouter
from nexus.infrastructure.source_adapters.connectors import BuiltinConnectorService
from nexus.infrastructure.tools import KnowledgeToolExecutor
from nexus.modules.conversations import ConversationService
from nexus.modules.models.application import ModelCatalogService
from nexus.modules.models.domain import ManagedModelSeed, ManagedProviderSpec
from nexus.modules.retrieval import RetrievalOrchestrator
from nexus.modules.runs import RunService, RunSuggestionService
from nexus.modules.sources import IngestionService, SourceSyncSchedulerService
from nexus.modules.sources.uploads import UploadSessionService
from nexus.modules.spaces import SpaceService
from nexus.modules.spaces.intelligence import SpaceIntelligenceService
from nexus.modules.tools import ToolRegistryService
from nexus.modules.tools.ports import SandboxRunnerPort
from nexus.runtime.nexus import NexusHarness


@dataclass(slots=True)
class NexusContainer:
    settings: NexusSettings
    database: Database
    control_plane: SqlControlPlaneRepository
    runs_repository: SqlRunRepository
    conversations: ConversationService
    blob_store: object
    spaces: SpaceService
    space_intelligence: SpaceIntelligenceService
    ingestion: IngestionService
    connectors: BuiltinConnectorService
    source_syncs: SourceSyncSchedulerService
    upload_sessions: UploadSessionService
    retrieval: RetrievalOrchestrator
    run_service: RunService
    run_suggestions: RunSuggestionService
    harness: NexusHarness
    agent_runtime: object
    model_gateway: object
    model_catalog: ModelCatalogService
    tools: ToolRegistryService
    tool_executor: KnowledgeToolExecutor
    sandbox_runner: SandboxRunnerPort
    operations: OperationsService
    qdrant_client: QdrantClient | None = None
    index: QdrantEvidenceIndex | None = None
    sparse_encoder: object | None = None
    dense_encoder: object | None = None
    feature_encoder: object | None = None
    reranker: object | None = None
    media_analyzer: RemoteMediaAnalyzer | None = None
    mineru: MinerURemoteAdapter | None = None


def build_container(settings: NexusSettings | None = None) -> NexusContainer:
    settings = settings or get_settings()
    database = Database(settings.database_url, create_schema=settings.auto_create_schema)
    control_plane = SqlControlPlaneRepository(database)
    runs_repository = SqlRunRepository(database)
    if settings.blob_backend == "minio":
        blob_store = MinioBlobStore(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            bucket=settings.minio_bucket,
            secure=settings.minio_secure,
        )
    else:
        blob_store = FilesystemBlobStore(settings.blob_root)
    qdrant_client: QdrantClient | None = None
    index: QdrantEvidenceIndex | None = None
    sparse_encoder: object | None = None
    dense_encoder: object | None = None
    feature_encoder: object | None = None
    reranker: object | None = None
    media_analyzer: RemoteMediaAnalyzer | None = None
    if settings.embedding_api_key is not None:
        dense_encoder = OpenAIEmbeddingEncoder(
            endpoint=settings.embedding_endpoint,
            api_key=settings.embedding_api_key.get_secret_value(),
            model=settings.embedding_model,
            dimension=settings.embedding_dimension,
            timeout_seconds=settings.provider_timeout_seconds,
        )
    if settings.reranker_api_key is not None:
        reranker = RemoteReranker(
            endpoint=settings.reranker_endpoint,
            api_key=settings.reranker_api_key.get_secret_value(),
            model=settings.reranker_model,
            timeout_seconds=settings.provider_timeout_seconds,
        )
    if settings.feature_models_enabled:
        feature_encoder = TransformersMultimodalEncoder(
            clip_model_id=settings.clip_model_id,
            clip_revision=settings.clip_model_revision,
            clap_model_id=settings.clap_model_id,
            clap_revision=settings.clap_model_revision,
            hf_endpoint=settings.hf_endpoint,
        )
    if settings.media_enrichment_enabled:
        media_analyzer = RemoteMediaAnalyzer(
            image_endpoint=settings.image_caption_endpoint,
            image_api_key=(
                settings.image_caption_api_key.get_secret_value()
                if settings.image_caption_api_key
                else None
            ),
            image_model=settings.image_caption_model,
            image_ocr_endpoint=settings.image_ocr_endpoint,
            image_ocr_token=(
                settings.image_ocr_token.get_secret_value()
                if settings.image_ocr_token
                else None
            ),
            audio_endpoint=settings.audio_transcription_endpoint,
            audio_api_key=(
                settings.audio_transcription_api_key.get_secret_value()
                if settings.audio_transcription_api_key
                else None
            ),
            audio_model=settings.audio_transcription_model,
            timeout_seconds=max(settings.provider_timeout_seconds, 180),
        )
    if settings.sparse_encoder == "bge_m3":
        sparse_encoder = BGEM3SparseEncoder(
            model_id=settings.bge_m3_model_id,
            revision=settings.bge_m3_revision,
            use_fp16=settings.bge_m3_use_fp16,
            hf_endpoint=settings.hf_endpoint,
        )
    channels: list[object] = [PostgresExactChannel(database)]
    if settings.qdrant_url:
        if settings.qdrant_url == ":memory:":
            qdrant_client = QdrantClient(":memory:")
        else:
            qdrant_client = QdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key,
                timeout=10,
            )
        index = QdrantEvidenceIndex(
            database=database,
            client=qdrant_client,
            blob_store=blob_store,
            dense_encoder=dense_encoder,
            sparse_encoder=sparse_encoder,
            feature_encoder=feature_encoder,
        )
        channels.extend(
            [
                QdrantFamilyChannel(
                    name="text_dense",
                    database=database,
                    client=qdrant_client,
                    family="text_evidence",
                    vector_name="dense",
                    vector_kind="dense",
                    native_modality=True,
                    dense_encoder=dense_encoder,
                    sparse_encoder=sparse_encoder,
                    feature_encoder=feature_encoder,
                ),
                QdrantFamilyChannel(
                    name="text_sparse",
                    database=database,
                    client=qdrant_client,
                    family="text_evidence",
                    vector_name="sparse",
                    vector_kind="sparse",
                    native_modality=True,
                    dense_encoder=dense_encoder,
                    sparse_encoder=sparse_encoder,
                    feature_encoder=feature_encoder,
                ),
                QdrantFamilyChannel(
                    name="image",
                    database=database,
                    client=qdrant_client,
                    family="image_evidence",
                    vector_name="visual",
                    vector_kind="visual",
                    native_modality=True,
                    dense_encoder=dense_encoder,
                    sparse_encoder=sparse_encoder,
                    feature_encoder=feature_encoder,
                ),
                QdrantFamilyChannel(
                    name="image_caption",
                    database=database,
                    client=qdrant_client,
                    family="image_evidence",
                    vector_name="caption_dense",
                    vector_kind="dense",
                    native_modality=False,
                    dense_encoder=dense_encoder,
                    sparse_encoder=sparse_encoder,
                    feature_encoder=feature_encoder,
                ),
                QdrantFamilyChannel(
                    name="audio",
                    database=database,
                    client=qdrant_client,
                    family="audio_evidence",
                    vector_name="acoustic",
                    vector_kind="acoustic",
                    native_modality=True,
                    dense_encoder=dense_encoder,
                    sparse_encoder=sparse_encoder,
                    feature_encoder=feature_encoder,
                ),
                QdrantFamilyChannel(
                    name="audio_text",
                    database=database,
                    client=qdrant_client,
                    family="audio_evidence",
                    vector_name="text_dense",
                    vector_kind="dense",
                    native_modality=False,
                    dense_encoder=dense_encoder,
                    sparse_encoder=sparse_encoder,
                    feature_encoder=feature_encoder,
                ),
                QdrantFamilyChannel(
                    name="video",
                    database=database,
                    client=qdrant_client,
                    family="video_evidence",
                    vector_name="frame_visual",
                    vector_kind="visual",
                    native_modality=True,
                    dense_encoder=dense_encoder,
                    sparse_encoder=sparse_encoder,
                    feature_encoder=feature_encoder,
                ),
                QdrantFamilyChannel(
                    name="video_text",
                    database=database,
                    client=qdrant_client,
                    family="video_evidence",
                    vector_name="scene_dense",
                    vector_kind="dense",
                    native_modality=False,
                    dense_encoder=dense_encoder,
                    sparse_encoder=sparse_encoder,
                    feature_encoder=feature_encoder,
                ),
            ]
        )
    retrieval = RetrievalOrchestrator(
        evidence_repository=control_plane,
        channels=channels,  # type: ignore[arg-type]
        reranker=reranker,
    )
    if settings.generation_endpoint and settings.generation_api_key and settings.generation_model:
        pinned_model_gateway = OpenAICompatibleGateway(
            endpoint=settings.generation_endpoint,
            api_key=settings.generation_api_key.get_secret_value(),
            model=settings.generation_model,
            timeout_seconds=settings.provider_timeout_seconds,
        )
    else:
        pinned_model_gateway = ExtractiveModelGateway()
    model_repository = SqlModelCatalogRepository(database)
    model_catalog = ModelCatalogService(
        repository=model_repository,
        credentials=EnvironmentCredentialStore(),
        managed_providers=_managed_provider_specs(settings),
        timeout_seconds=settings.provider_timeout_seconds,
    )
    if dense_encoder is not None:
        dense_encoder.route_resolver = model_catalog.resolve_runtime  # type: ignore[attr-defined]
    if reranker is not None:
        reranker.route_resolver = model_catalog.resolve_runtime  # type: ignore[attr-defined]
    if media_analyzer is not None:
        media_analyzer.route_resolver = model_catalog.resolve_runtime
    model_gateway = GovernedModelGateway(
        repository=model_repository,
        credentials=EnvironmentCredentialStore(),
        pinned_gateway=pinned_model_gateway,
        timeout_seconds=settings.provider_timeout_seconds,
    )
    runs_repository.model_snapshot_provider = lambda: {
        "gateway": model_gateway.snapshot(),
        "catalog": model_catalog.snapshot(),
    }
    harness = NexusHarness(
        runs=runs_repository,
        retrieval=retrieval,
        models=model_gateway,
        claims=runs_repository,
        artifacts=runs_repository,
        emergency_transition_limit=settings.emergency_transition_limit,
    )
    agent_runtime = (
        LangGraphRuntimeAdapter(harness=harness, runs=runs_repository)
        if settings.agent_runtime == "langgraph"
        else harness
    )
    run_service = RunService(
        repository=runs_repository,
        runtime=agent_runtime if settings.inline_worker else None,  # type: ignore[arg-type]
        research_enabled=settings.research_runtime_enabled,
    )
    mineru = MinerURemoteAdapter(
        token=(
            settings.mineru_token.get_secret_value()
            if settings.mineru_token is not None
            else None
        ),
        base_url=settings.mineru_base_url,
        model=settings.mineru_model,
        language=settings.mineru_language,
        timeout_seconds=settings.mineru_timeout_seconds,
    )
    ingestion = IngestionService(
        repository=control_plane,
        blob_store=blob_store,  # type: ignore[arg-type]
        parser=ParserRouter(
            mineru=mineru,
            media_analyzer=media_analyzer,
            remote_image_timeout_seconds=settings.connector_timeout_seconds,
            remote_image_max_bytes=min(settings.connector_max_download_bytes, 10 * 1024 * 1024),
            allow_private_networks=settings.connector_allow_private_networks,
        ),
        max_upload_bytes=settings.max_upload_bytes,
        worker_lease_seconds=settings.worker_lease_seconds,
    )
    connectors = BuiltinConnectorService(
        ingestion=ingestion,
        allowed_folder_roots=settings.connector_allowed_folder_roots,
        max_download_bytes=settings.connector_max_download_bytes,
        timeout_seconds=settings.connector_timeout_seconds,
        allow_private_networks=settings.connector_allow_private_networks,
    )
    source_syncs = SourceSyncSchedulerService(
        repository=control_plane,
        connectors=connectors,
        process_inline=settings.inline_worker,
        lease_seconds=settings.worker_lease_seconds,
        index=index,
    )
    tool_repository = SqlToolRepository(database)
    tool_registry = ToolRegistryService(tool_repository)
    tool_registry.seed_builtin(external_enabled=settings.external_tools_enabled)
    if settings.sandbox_backend == "unix":
        sandbox_runner: SandboxRunnerPort = UnixSocketSandboxRunner(
            settings.sandbox_socket_path,
            timeout_seconds=settings.sandbox_timeout_seconds,
        )
    elif settings.sandbox_backend == "local_test":
        if settings.environment != "test":
            raise RuntimeError("The local_test sandbox backend is forbidden outside tests")
        sandbox_runner = LocalTestSandboxRunner()
    else:
        sandbox_runner = DisabledSandboxRunner()
    tool_executor = KnowledgeToolExecutor(
        repository=tool_repository,
        runs=runs_repository,
        control_plane=control_plane,
        retrieval=retrieval,
        connectors=connectors,
        sandbox=sandbox_runner,
        external_tools_enabled=settings.external_tools_enabled,
        mcp_read_servers=settings.mcp_read_servers,
    )
    operations = OperationsService(
        settings=settings,
        database=database,
        blob_store=blob_store,  # type: ignore[arg-type]
        index=index,
        mineru=mineru,
        sandbox=sandbox_runner,
    )
    spaces = SpaceService(control_plane)
    return NexusContainer(
        settings=settings,
        database=database,
        control_plane=control_plane,
        runs_repository=runs_repository,
        conversations=ConversationService(runs_repository),
        blob_store=blob_store,
        spaces=spaces,
        space_intelligence=SpaceIntelligenceService(spaces, control_plane),
        ingestion=ingestion,
        connectors=connectors,
        source_syncs=source_syncs,
        upload_sessions=UploadSessionService(
            repository=SqlUploadSessionRepository(database),
            blob_store=blob_store,  # type: ignore[arg-type]
            ingestion=ingestion,
            process_inline=settings.inline_worker,
        ),
        retrieval=retrieval,
        run_service=run_service,
        run_suggestions=RunSuggestionService(
            runs=runs_repository,
            evidence=control_plane,
        ),
        harness=harness,
        agent_runtime=agent_runtime,
        model_gateway=model_gateway,
        model_catalog=model_catalog,
        tools=tool_registry,
        tool_executor=tool_executor,
        sandbox_runner=sandbox_runner,
        operations=operations,
        qdrant_client=qdrant_client,
        index=index,
        sparse_encoder=sparse_encoder,
        dense_encoder=dense_encoder,
        feature_encoder=feature_encoder,
        reranker=reranker,
        media_analyzer=media_analyzer,
        mineru=mineru,
    )


def _first_secret_ref(*names: str) -> str | None:
    return next((f"env://{name}" for name in names if os.environ.get(name)), None)


def _seed(model: str, *roles: str) -> ManagedModelSeed:
    return ManagedModelSeed(
        upstream_model_id=model,
        declared_capabilities=tuple(ModelCatalogService.infer_capabilities(model)),
        runtime_roles=roles,
    )


def _managed_provider_specs(settings: NexusSettings) -> tuple[ManagedProviderSpec, ...]:
    """Project configured credentials into the catalog without persisting secrets."""
    specs: list[ManagedProviderSpec] = []
    silicon_ref = _first_secret_ref(
        "SILICONFLOW_API_KEY",
        "NEXUS_GENERATION_API_KEY",
        "NEXUS_EMBEDDING_API_KEY",
        "NEXUS_RERANKER_API_KEY",
        "NEXUS_IMAGE_CAPTION_API_KEY",
    )
    if silicon_ref:
        seeds: list[ManagedModelSeed] = []
        if settings.generation_model and "siliconflow" in (settings.generation_endpoint or ""):
            seeds.append(
                _seed(
                    settings.generation_model,
                    "quick_synthesis",
                    "research_synthesis",
                    "planning",
                    "verification",
                    "query_intent",
                    "query_rewrite",
                    "space_routing",
                )
            )
        if "siliconflow" in settings.embedding_endpoint:
            seeds.append(_seed(settings.embedding_model, "dense_embedding"))
        if "siliconflow" in settings.reranker_endpoint:
            seeds.append(_seed(settings.reranker_model, "reranking"))
        if "siliconflow" in settings.image_caption_endpoint:
            seeds.append(
                _seed(
                    settings.image_caption_model,
                    "image_caption",
                    "document_figure_caption",
                    "video_understanding",
                )
            )
        specs.append(
            ManagedProviderSpec(
                name="SiliconFlow",
                protocol_family="openai_compatible",
                endpoint="https://api.siliconflow.cn/v1",
                secret_ref=silicon_ref,
                seeds=tuple(seeds),
            )
        )

    for name, endpoint, secret_name in (
        ("OpenRouter", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY"),
        ("DeepSeek", "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY"),
    ):
        if os.environ.get(secret_name):
            specs.append(
                ManagedProviderSpec(
                    name,
                    "openai_compatible",
                    endpoint,
                    f"env://{secret_name}",
                )
            )

    bailian_ref = _first_secret_ref(
        "ALIYUN_BAILIAN_API_KEY", "NEXUS_AUDIO_TRANSCRIPTION_API_KEY"
    )
    if bailian_ref:
        seeds = ()
        if "dashscope" in settings.audio_transcription_endpoint:
            seeds = (
                _seed(
                    settings.audio_transcription_model,
                    "audio_transcription",
                    "video_audio_transcription",
                ),
            )
        specs.append(
            ManagedProviderSpec(
                "Aliyun Bailian",
                "openai_compatible",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
                bailian_ref,
                seeds,
            )
        )

    runtime_ref = _first_secret_ref("NEXUS_GENERATION_API_KEY")
    known_endpoints = {spec.endpoint for spec in specs}
    generation_endpoint = (settings.generation_endpoint or "").rstrip("/")
    if runtime_ref and generation_endpoint and generation_endpoint not in known_endpoints:
        model = settings.generation_model or "configured-model"
        specs.append(
            ManagedProviderSpec(
                "Configured Runtime",
                "openai_compatible",
                generation_endpoint,
                runtime_ref,
                (_seed(model, "quick_synthesis", "research_synthesis"),),
            )
        )
    return tuple(specs)
