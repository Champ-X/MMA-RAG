from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True, slots=True)
class ModelRequirement:
    role: str
    required_capabilities: tuple[str, ...]
    allow_degradation: bool = False
    preferred_deployment_id: str | None = None


@dataclass(frozen=True, slots=True)
class ModelResponse:
    text: str
    provider_request_id: str | None = None
    actual_model: str | None = None
    finish_reason: str = "stop"
    usage: dict[str, int] = field(default_factory=dict)
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class SynthesisRequest:
    goal: str
    evidence: tuple[dict[str, object], ...]
    verification_level: str
    artifact: bool = False


@dataclass(frozen=True, slots=True)
class TaskRequest:
    """A non-evidence-bound governed model task such as intent or query rewrite."""

    system_prompt: str
    user_prompt: str
    temperature: float = 0.0
    max_tokens: int = 1200


@dataclass(frozen=True, slots=True)
class ProviderView:
    id: str
    name: str
    protocol_family: str
    endpoint: str
    secret_ref: str | None
    enabled: bool
    health_status: str


@dataclass(frozen=True, slots=True)
class ManagedModelSeed:
    upstream_model_id: str
    declared_capabilities: tuple[str, ...]
    runtime_roles: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ManagedProviderSpec:
    """Credential-backed provider declared by runtime configuration."""

    name: str
    protocol_family: str
    endpoint: str
    secret_ref: str
    seeds: tuple[ManagedModelSeed, ...] = ()


@dataclass(frozen=True, slots=True)
class ModelDeploymentView:
    id: str
    provider_connection_id: str
    protocol_family: str
    upstream_model_id: str
    lifecycle: str
    declared_capabilities: tuple[str, ...]
    verified_capabilities: tuple[str, ...]
    observation: dict[str, object]


@dataclass(frozen=True, slots=True)
class ModelRouteView:
    id: str
    role: str
    revision: int
    status: str
    deployment_ids: tuple[str, ...]
    required_capabilities: tuple[str, ...]
    created_at: datetime
    updated_at: datetime
