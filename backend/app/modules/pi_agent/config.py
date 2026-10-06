"""Pi configuration is intentionally separate from the existing task model routes."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from .contracts import RunBudget

ROOT = Path(__file__).resolve().parents[4]


class PiSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PI_AGENT_", env_file=ROOT / "backend" / ".env", extra="ignore")
    enabled: bool = True
    model: str = "deepseek:deepseek-flash"
    thinking_enabled: bool = False
    answer_checks_enabled: bool = False
    model_api_key: SecretStr | None = None
    model_base_url: str | None = None
    yield_to_legacy: bool = True
    embedding_model: str = "Qwen/Qwen3-Embedding-8B"
    vision_model: str = "aliyun_bailian:qwen3-vl-plus-2025-12-19"
    audio_model: str = "aliyun_bailian:qwen3-omni-flash"
    allowed_models: list[str] = Field(default_factory=list)
    allowed_kb_ids: list[str] | None = None
    # Local workspace access is explicit; deployments can supply a trusted server token.
    api_token: SecretStr | None = None
    trusted_user_id: str | None = None
    data_dir: Path = ROOT / "data" / "pi-agent"
    node_binary: str = "node"
    max_concurrent_runs: int = Field(default=2, ge=1, le=8)
    max_concurrent_searches: int = Field(default=1, ge=1, le=4)
    max_queued_runs: int = Field(default=8, ge=0, le=32)
    max_source_bytes: int = Field(default=256 * 1024 * 1024, ge=1024, le=512 * 1024 * 1024)
    budget: RunBudget = Field(default_factory=RunBudget)


@lru_cache
def get_pi_settings() -> PiSettings:
    return PiSettings()


def resolve_model(registry, selected: str | None, settings: PiSettings) -> tuple[dict, str]:
    name = selected or settings.model
    if name not in (settings.allowed_models or [settings.model]):
        raise ValueError("所选模型不在纯 Agent 的可用模型范围内")
    configured = registry.get_model_config(name)
    if not configured or "chat" not in str(configured.get("type", "")).split(","):
        raise ValueError("纯 Agent 需要支持对话与工具调用的模型")
    provider_name = configured["provider"]
    provider = registry.get_provider(provider_name)
    if provider is None or not (settings.model_api_key or getattr(provider, "api_key", None)):
        raise ValueError("所选模型的服务商尚未配置")
    raw = configured.get("raw_model") or (name.split(":", 1)[1] if ":" in name else name)
    base_url = settings.model_base_url or getattr(provider, "base_url", "")
    if not base_url:
        raise ValueError("该模型服务商没有可用的兼容接口")
    capabilities = str(configured.get("type", "")).split(",")
    model = {"id": raw, "name": name, "api": "openai-completions", "provider": provider_name,
             "baseUrl": base_url, "reasoning": provider_name in {"deepseek", "aliyun_bailian"},
             "input": ["text", "image"] if "vision" in capabilities else ["text"],
             "contextWindow": int(configured.get("context_length") or 64000),
             "maxTokens": settings.budget.output_tokens,
             "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
             "compat": {"supportsStore": False, "supportsDeveloperRole": False,
                        "maxTokensField": "max_tokens", "supportsReasoningEffort": False}}
    if settings.thinking_enabled and not model["reasoning"]:
        raise ValueError("该纯 Agent 模型尚未配置推理协议，请关闭 Pi 推理或选择已支持的模型")
    if provider_name == "deepseek":
        model["compat"]["thinkingFormat"] = "deepseek"
    elif provider_name == "aliyun_bailian":
        model["compat"]["thinkingFormat"] = "qwen"
    return model, settings.model_api_key.get_secret_value() if settings.model_api_key else provider.api_key
