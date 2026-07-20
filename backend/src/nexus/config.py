from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class NexusSettings(BaseSettings):
    """Versioned runtime configuration for the new control plane.

    Production defaults intentionally point at the Compose service names. Tests and
    local smoke runs can opt into SQLite and filesystem blobs without changing domain
    behavior.
    """

    model_config = SettingsConfigDict(
        env_prefix="NEXUS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+psycopg://nexus:nexus@postgres:5432/nexus"
    auto_create_schema: bool = True
    bind_host: str = "127.0.0.1"
    bind_port: int = 8000
    cors_origins: list[str] = Field(default_factory=lambda: ["http://127.0.0.1:5173"])

    blob_backend: Literal["filesystem", "minio"] = "filesystem"
    blob_root: Path = Path("./data/nexus/blobs")
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = "nexus"
    minio_secret_key: str = "change-me"
    minio_secure: bool = False
    minio_bucket: str = "nexus-objects"

    qdrant_url: str | None = "http://qdrant:6333"
    qdrant_api_key: str | None = None
    redis_url: str | None = "redis://redis:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None
    scheduler_interval_seconds: float = 2.0
    inline_worker: bool = True
    worker_poll_seconds: float = 1.0
    worker_lease_seconds: int = 120
    otel_enabled: bool = True
    otel_service_name: str = "mma-rag-nexus"
    otel_exporter_otlp_endpoint: str | None = None

    mineru_token: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("MINERU_TOKEN", "NEXUS_MINERU_TOKEN"),
    )
    mineru_base_url: str = "https://mineru.net/api/v4"
    mineru_model: Literal["vlm", "pipeline"] = "vlm"
    mineru_language: str = "ch"
    mineru_timeout_seconds: int = 900
    research_runtime_enabled: bool = True
    agent_runtime: Literal["langgraph", "native"] = "langgraph"
    external_tools_enabled: bool = False
    mcp_read_servers: dict[str, str] = Field(default_factory=dict)
    sandbox_backend: Literal["unix", "local_test", "disabled"] = "unix"
    sandbox_socket_path: Path = Path("/run/nexus-sandbox/sql.sock")
    sandbox_timeout_seconds: float = 12.0
    knowledge_compilation_enabled: bool = False
    background_enrichment_enabled: bool = True
    page_multivector_enabled: bool = False
    sparse_encoder: Literal["deterministic", "bge_m3"] = "bge_m3"
    bge_m3_model_id: str = "BAAI/bge-m3"
    bge_m3_revision: str = "5617a9f61b028005a4858fdac845db406aefb181"
    bge_m3_use_fp16: bool = False
    hf_endpoint: str | None = None

    embedding_endpoint: str = "https://api.siliconflow.cn/v1"
    embedding_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "NEXUS_EMBEDDING_API_KEY",
            "SILICONFLOW_API_KEY",
            "ALIYUN_BAILIAN_API_KEY",
        ),
    )
    embedding_model: str = Field(
        default="Qwen/Qwen3-Embedding-8B",
        validation_alias=AliasChoices("NEXUS_EMBEDDING_MODEL", "DEFAULT_EMBEDDING_MODEL"),
    )
    embedding_dimension: int = 4096
    reranker_endpoint: str = "https://api.siliconflow.cn/v1/rerank"
    reranker_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "NEXUS_RERANKER_API_KEY",
            "SILICONFLOW_API_KEY",
            "ALIYUN_BAILIAN_API_KEY",
        ),
    )
    reranker_model: str = Field(
        default="Qwen/Qwen3-Reranker-8B",
        validation_alias=AliasChoices("NEXUS_RERANKER_MODEL", "DEFAULT_RERANKER_MODEL"),
    )
    feature_models_enabled: bool = True
    clip_model_id: str = "openai/clip-vit-large-patch14"
    clip_model_revision: str = "32bd64288804d66eefd0ccbe215aa642df71cc41"
    clap_model_id: str = "laion/clap-htsat-fused"
    clap_model_revision: str = "365dea6ef167def6676140ed93bbc43f84dabb28"
    media_enrichment_enabled: bool = True
    image_caption_endpoint: str = "https://api.siliconflow.cn/v1"
    image_caption_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "NEXUS_IMAGE_CAPTION_API_KEY",
            "SILICONFLOW_API_KEY",
        ),
    )
    image_caption_model: str = "Qwen/Qwen3-VL-30B-A3B-Instruct"
    image_ocr_endpoint: str | None = Field(
        default=None,
        validation_alias=AliasChoices("PADDLEOCR_API_URL", "NEXUS_IMAGE_OCR_ENDPOINT"),
    )
    image_ocr_token: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("PADDLEOCR_TOKEN", "NEXUS_IMAGE_OCR_TOKEN"),
    )
    audio_transcription_endpoint: str = (
        "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    audio_transcription_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "NEXUS_AUDIO_TRANSCRIPTION_API_KEY",
            "ALIYUN_BAILIAN_API_KEY",
        ),
    )
    audio_transcription_model: str = "qwen3-omni-flash"

    # Reasoning models can legitimately spend more than a minute synthesizing a
    # research artifact after multimodal retrieval and reranking have completed.
    provider_timeout_seconds: float = 180.0
    generation_endpoint: str | None = "https://api.siliconflow.cn/v1"
    generation_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "NEXUS_GENERATION_API_KEY",
            "SILICONFLOW_API_KEY",
            "ALIYUN_BAILIAN_API_KEY",
        ),
    )
    generation_model: str | None = "Pro/moonshotai/Kimi-K2.5"
    event_poll_seconds: float = 0.25
    event_heartbeat_seconds: float = 15.0
    emergency_transition_limit: int = 1000
    max_upload_bytes: int = 1024 * 1024 * 1024
    connector_allowed_folder_roots: list[Path] = Field(
        default_factory=lambda: [Path("/imports")]
    )
    connector_max_download_bytes: int = 256 * 1024 * 1024
    connector_timeout_seconds: float = 30.0
    connector_allow_private_networks: bool = False
    scheduled_news_space_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "NEXUS_SCHEDULED_NEWS_SPACE_ID",
            "TAVILY_HOT_TOPICS_KB_ID",
        ),
    )
    scheduled_news_query: str = Field(
        default="科技热点 互联网新闻 AI动态",
        validation_alias=AliasChoices(
            "NEXUS_SCHEDULED_NEWS_QUERY",
            "TAVILY_HOT_TOPICS_DEFAULT_QUERY",
        ),
    )
    scheduled_news_topic: Literal["general", "news", "finance"] = Field(
        default="news",
        validation_alias=AliasChoices(
            "NEXUS_SCHEDULED_NEWS_TOPIC",
            "TAVILY_HOT_TOPICS_TOPIC",
        ),
    )
    scheduled_news_time_range: Literal["day", "week", "month", "year"] = Field(
        default="day",
        validation_alias=AliasChoices(
            "NEXUS_SCHEDULED_NEWS_TIME_RANGE",
            "TAVILY_HOT_TOPICS_TIME_RANGE",
        ),
    )
    scheduled_news_max_results: int = Field(default=10, ge=1, le=20)
    scheduled_news_include_full_content: bool = False
    scheduled_news_hour_utc: int = Field(default=8, ge=0, le=23)
    scheduled_news_minute_utc: int = Field(default=0, ge=0, le=59)
    backup_root: Path = Path("/backups")

    # Optional Feishu/Lark IM channel. It is an adapter over Nexus Run/Ingestion
    # ports; it never recreates the legacy knowledge or session authority.
    feishu_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("FEISHU_WS_ENABLED", "NEXUS_FEISHU_ENABLED"),
    )
    feishu_app_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("FEISHU_APP_ID", "NEXUS_FEISHU_APP_ID"),
    )
    feishu_app_secret: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("FEISHU_APP_SECRET", "NEXUS_FEISHU_APP_SECRET"),
    )
    feishu_encrypt_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("FEISHU_ENCRYPT_KEY", "NEXUS_FEISHU_ENCRYPT_KEY"),
    )
    feishu_verification_token: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "FEISHU_VERIFICATION_TOKEN", "NEXUS_FEISHU_VERIFICATION_TOKEN"
        ),
    )
    feishu_default_space_ids: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices(
            "FEISHU_DEFAULT_SPACE_IDS",
            "FEISHU_DEFAULT_KB_IDS",
            "NEXUS_FEISHU_DEFAULT_SPACE_IDS",
        ),
    )
    feishu_reply_in_thread: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "FEISHU_REPLY_IN_THREAD", "NEXUS_FEISHU_REPLY_IN_THREAD"
        ),
    )
    feishu_reply_format: Literal["card", "text"] = "card"
    feishu_run_timeout_seconds: int = 180

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("feishu_default_space_ids", mode="before")
    @classmethod
    def parse_space_ids(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("connector_allowed_folder_roots", mode="before")
    @classmethod
    def parse_connector_roots(cls, value: object) -> object:
        if isinstance(value, str):
            return [Path(part.strip()) for part in value.split(",") if part.strip()]
        return value

    @field_validator("worker_lease_seconds")
    @classmethod
    def validate_worker_lease(cls, value: int) -> int:
        if value < 30:
            raise ValueError("worker_lease_seconds must be at least 30")
        return value

    @classmethod
    def for_test(cls, root: Path) -> NexusSettings:
        return cls(
            _env_file=None,
            environment="test",
            database_url=f"sqlite:///{root / 'nexus.db'}",
            blob_backend="filesystem",
            blob_root=root / "blobs",
            qdrant_url=None,
            redis_url=None,
            inline_worker=True,
            mineru_token=None,
            sparse_encoder="deterministic",
            embedding_api_key=None,
            reranker_api_key=None,
            feature_models_enabled=False,
            media_enrichment_enabled=False,
            image_caption_api_key=None,
            image_ocr_endpoint=None,
            image_ocr_token=None,
            audio_transcription_api_key=None,
            generation_endpoint=None,
            generation_api_key=None,
            generation_model=None,
            sandbox_backend="local_test",
            connector_allowed_folder_roots=[root],
        )


@lru_cache(maxsize=1)
def get_settings() -> NexusSettings:
    return NexusSettings()
