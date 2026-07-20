from __future__ import annotations

from typing import Protocol

from nexus.modules.models.domain import (
    ManagedProviderSpec,
    ModelDeploymentView,
    ModelRequirement,
    ModelResponse,
    ModelRouteView,
    ProviderView,
    SynthesisRequest,
    TaskRequest,
)


class ModelGatewayPort(Protocol):
    def synthesize(
        self, request: SynthesisRequest, requirement: ModelRequirement
    ) -> ModelResponse: ...

    def complete(self, request: TaskRequest, requirement: ModelRequirement) -> ModelResponse: ...

    def snapshot(self) -> dict[str, object]: ...

    def health(self) -> dict[str, object]: ...


class ModelCatalogRepositoryPort(Protocol):
    def create_provider(
        self, *, name: str, protocol_family: str, endpoint: str, secret_ref: str | None
    ) -> ProviderView: ...

    def upsert_managed_provider(self, spec: ManagedProviderSpec) -> ProviderView: ...

    def set_provider_health(self, provider_id: str, status: str) -> ProviderView: ...

    def list_providers(self) -> list[ProviderView]: ...

    def get_provider(self, provider_id: str) -> ProviderView: ...

    def upsert_discovered_model(
        self,
        *,
        provider_id: str,
        upstream_model_id: str,
        declared_capabilities: list[str],
        observation: dict[str, object],
    ) -> ModelDeploymentView: ...

    def list_models(self, provider_id: str | None = None) -> list[ModelDeploymentView]: ...

    def record_probe(
        self,
        model_id: str,
        *,
        results: dict[str, object],
        verified_capabilities: list[str],
        error: str | None,
    ) -> ModelDeploymentView: ...

    def enable_model(self, model_id: str) -> ModelDeploymentView: ...

    def create_route(
        self,
        *,
        role: str,
        deployment_ids: list[str],
        required_capabilities: list[str],
    ) -> ModelRouteView: ...

    def activate_route(self, route_id: str) -> ModelRouteView: ...

    def list_routes(self) -> list[ModelRouteView]: ...


class CredentialStorePort(Protocol):
    def resolve(self, secret_ref: str) -> str: ...
