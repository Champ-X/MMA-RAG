from __future__ import annotations

import httpx
import pytest

from nexus.bootstrap import NexusContainer
from nexus.infrastructure.providers import ExtractiveModelGateway, GovernedModelGateway
from nexus.infrastructure.postgres.models import ModelDeployment
from nexus.infrastructure.secrets import EnvironmentCredentialStore
from nexus.modules.models.application import ModelCatalogService
from nexus.modules.models.domain import (
    ManagedModelSeed,
    ManagedProviderSpec,
    ModelRequirement,
    ModelResponse,
    SynthesisRequest,
    TaskRequest,
)
from nexus.shared.domain.errors import CapabilityUnavailableError


def test_credential_backed_provider_and_models_are_auto_discovered_without_secret_leakage(
    nexus: NexusContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AUTO_DISCOVERY_KEY", "top-secret-value")
    service = ModelCatalogService(
        repository=nexus.model_catalog.repository,
        credentials=EnvironmentCredentialStore(),
        managed_providers=(
            ManagedProviderSpec(
                name="Auto discovered",
                protocol_family="openai_compatible",
                endpoint="https://catalog.invalid/v1",
                secret_ref="env://AUTO_DISCOVERY_KEY",
                seeds=(
                    ManagedModelSeed(
                        upstream_model_id="seed/vision-v1",
                        declared_capabilities=("text", "vision"),
                        runtime_roles=("document_figure_caption",),
                    ),
                ),
            ),
        ),
    )

    def fake_get(url: str, **kwargs: object) -> httpx.Response:
        assert url == "https://catalog.invalid/v1/models"
        assert kwargs["headers"] == {"Authorization": "Bearer top-secret-value"}
        return httpx.Response(
            200,
            request=httpx.Request("GET", url),
            json={"data": [{"id": "remote/audio-transcription-v2"}]},
        )

    monkeypatch.setattr(httpx, "get", fake_get)
    result = service.sync_managed()
    assert result["failures"] == []
    assert result["discovered"] == 1
    providers = service.repository.list_providers()
    provider = next(item for item in providers if item.name == "Auto discovered")
    assert provider.health_status == "healthy"
    assert provider.secret_ref == "env://AUTO_DISCOVERY_KEY"
    assert "top-secret-value" not in repr(provider)
    models = service.repository.list_models(provider.id)
    assert {item.upstream_model_id for item in models} == {
        "seed/vision-v1",
        "remote/audio-transcription-v2",
    }
    assert "audio_transcription" in next(
        item for item in models if item.upstream_model_id.startswith("remote/")
    ).declared_capabilities


def test_manual_model_lifecycle_route_and_snapshot(nexus: NexusContainer) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="contract-compatible",
        protocol_family="openai_compatible",
        endpoint="https://provider.invalid/v1",
        secret_ref="CONTRACT_PROVIDER_KEY",
    )
    candidate = catalog.register_model(
        provider.id,
        upstream_model_id="provider/model-v1",
        declared_capabilities=["text"],
    )
    verified = catalog.repository.record_probe(
        candidate.id,
        results={"chat": True, "protocol_family": "openai_compatible"},
        verified_capabilities=["text"],
        error=None,
    )
    assert verified.lifecycle == "verified"
    enabled = catalog.enable(candidate.id)
    assert enabled.lifecycle == "enabled"

    draft = catalog.create_route(
        role="research_synthesis",
        deployment_ids=[enabled.id],
        required_capabilities=["text"],
    )
    assert draft.status == "draft"
    active = catalog.activate_route(draft.id)
    assert active.status == "active"
    assert catalog.snapshot()["routes"] == [
        {
            "id": active.id,
            "role": "research_synthesis",
            "revision": 1,
            "status": "active",
            "deployment_ids": [enabled.id],
            "required_capabilities": ["text"],
        }
    ]


def test_verify_configured_models_enables_and_routes_idempotently(
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ModelCatalogService(
        repository=nexus.model_catalog.repository,
        credentials=EnvironmentCredentialStore(),
        managed_providers=(
            ManagedProviderSpec(
                name="Configured runtime",
                protocol_family="openai_compatible",
                endpoint="https://runtime.invalid/v1",
                secret_ref="env://CONFIGURED_RUNTIME_KEY",
                seeds=(
                    ManagedModelSeed(
                        upstream_model_id="runtime/text-v1",
                        declared_capabilities=("text",),
                        runtime_roles=("quick_synthesis", "query_rewrite"),
                    ),
                ),
            ),
        ),
    )
    monkeypatch.setenv("CONFIGURED_RUNTIME_KEY", "configured-secret")

    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        assert url == "https://runtime.invalid/v1/chat/completions"
        assert kwargs["headers"] == {"Authorization": "Bearer configured-secret"}
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={"choices": [{"message": {"content": "ok"}}]},
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    first = service.verify_configured()
    assert first["enabled"] == 1
    assert first["routes_activated"] == 2
    assert first["failures"] == []
    assert first["roles_ready"] == ["query_rewrite", "quick_synthesis"]
    second = service.verify_configured()
    assert second["probed"] == 0
    assert second["routes_activated"] == 0
    assert len([route for route in service.list_routes() if route.status == "active"]) == 2

    governed = nexus.model_gateway
    assert governed.health()["status"] == "ready"
    assert governed.health()["state"] == "capability_routes_verified"
    deployment_id = next(
        model.id
        for model in service.repository.list_models()
        if model.upstream_model_id == "runtime/text-v1"
    )
    with nexus.database.transaction() as session:
        row = session.get(ModelDeployment, deployment_id)
        assert row is not None
        row.lifecycle = "verified"
    health = governed.health()
    assert health["status"] == "degraded"
    assert health["state"] == "route_drift"
    assert health["drift_count"] == 2
    assert health["failures"] == [
        {
            "deployment_id": deployment_id,
            "error_type": "RouteDrift",
            "route_id": route.id,
        }
        for route in service.list_routes()
        if route.status == "active"
    ]


def test_recommended_setup_completes_missing_routes_without_replacing_custom_choices(
    nexus: NexusContainer,
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="recommended-setup",
        protocol_family="openai_compatible",
        endpoint="https://recommended.invalid/v1",
        secret_ref=None,
    )
    text_model = catalog.register_model(
        provider.id,
        upstream_model_id="quality/text-v1",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        text_model.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(text_model.id)
    vision_model = catalog.register_model(
        provider.id,
        upstream_model_id="quality/vision-v1",
        declared_capabilities=["text", "vision"],
    )
    catalog.repository.record_probe(
        vision_model.id,
        results={"image_input": True},
        verified_capabilities=["text", "vision"],
        error=None,
    )
    catalog.enable(vision_model.id)
    custom = catalog.create_route(
        role="quick_synthesis",
        deployment_ids=[text_model.id],
        required_capabilities=["text"],
    )
    custom = catalog.activate_route(custom.id)

    plan = catalog.recommend_setup()
    roles = {item["role"]: item for item in plan["roles"]}
    assert plan["status"] == "action_available"
    assert roles["quick_synthesis"]["state"] == "active"
    assert roles["research_synthesis"]["recommended_deployment_id"] == text_model.id
    assert roles["image_caption"]["recommended_deployment_id"] == vision_model.id
    assert roles["audio_transcription"]["state"] == "fallback"

    applied = catalog.apply_recommended_setup()
    assert applied["routes_activated"] == 9
    assert applied["setup"]["ready_role_count"] == 10
    assert set(applied["unfilled_roles"]) == {
        "audio_transcription",
        "video_audio_transcription",
        "dense_embedding",
        "reranking",
    }
    active_quick = next(
        route
        for route in catalog.list_routes()
        if route.role == "quick_synthesis" and route.status == "active"
    )
    assert active_quick.id == custom.id

    second = catalog.apply_recommended_setup()
    assert second["routes_activated"] == 0


def test_recommended_setup_api_exposes_and_applies_verified_candidates(
    api: object,
    nexus: NexusContainer,
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="setup-api",
        protocol_family="openai_compatible",
        endpoint="https://setup-api.invalid/v1",
        secret_ref=None,
    )
    deployment = catalog.register_model(
        provider.id,
        upstream_model_id="setup/text-v1",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        deployment.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(deployment.id)

    response = api.get("/api/v1/model-setup")  # type: ignore[attr-defined]
    assert response.status_code == 200
    assert response.json()["configurable_role_count"] == 7

    applied = api.post(  # type: ignore[attr-defined]
        "/api/v1/model-setup/apply",
        json={"replace_existing": False},
    )
    assert applied.status_code == 200
    assert applied.json()["routes_activated"] == 7
    assert applied.json()["setup"]["ready_role_count"] == 7


def test_active_route_controls_runtime_generation(
    nexus: NexusContainer, monkeypatch: object
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="runtime-compatible",
        protocol_family="openai_compatible",
        endpoint="https://provider.invalid/v1",
        secret_ref=None,
    )
    candidate = catalog.register_model(
        provider.id,
        upstream_model_id="runtime/model-v2",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        candidate.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(candidate.id)
    route = catalog.create_route(
        role="quick_synthesis",
        deployment_ids=[candidate.id],
        required_capabilities=["text"],
    )
    catalog.activate_route(route.id)
    evidence_id = "11111111-1111-4111-8111-111111111111"

    def fake_post(url: str, **_: object) -> httpx.Response:
        assert url == "https://provider.invalid/v1/chat/completions"
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "model": "runtime/model-v2",
                "choices": [
                    {
                        "message": {"content": f"Routed answer [evidence:{evidence_id}]"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"total_tokens": 12},
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)  # type: ignore[attr-defined]
    response = nexus.model_gateway.synthesize(
        SynthesisRequest(
            goal="Use the active route",
            evidence=(
                {
                    "evidence_revision_id": evidence_id,
                    "source_name": "contract",
                    "locator": {"locator_type": "paragraph"},
                    "text": "Routed evidence",
                },
            ),
            verification_level="T1",
        ),
        ModelRequirement(role="quick_synthesis", required_capabilities=("text",)),
    )
    assert response.actual_model == "runtime/model-v2"
    assert nexus.model_gateway.health()["route_id"] == route.id


def test_active_route_failure_degrades_to_local_extractive_synthesis(
    nexus: NexusContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="runtime-timeout",
        protocol_family="openai_compatible",
        endpoint="https://timeout.invalid/v1",
        secret_ref=None,
    )
    candidate = catalog.register_model(
        provider.id,
        upstream_model_id="timeout/model-v1",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        candidate.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(candidate.id)
    route = catalog.create_route(
        role="quick_synthesis",
        deployment_ids=[candidate.id],
        required_capabilities=["text"],
    )
    catalog.activate_route(route.id)

    def timeout_post(url: str, **_: object) -> httpx.Response:
        assert url == "https://timeout.invalid/v1/chat/completions"
        raise httpx.ReadTimeout("provider timed out")

    monkeypatch.setattr(httpx, "post", timeout_post)
    response = nexus.model_gateway.synthesize(
        SynthesisRequest(
            goal="Answer despite model timeout",
            evidence=(
                {
                    "evidence_revision_id": "evidence-timeout",
                    "source_name": "timeout.md",
                    "locator": {"locator_type": "paragraph"},
                    "text": "# Timeout Evidence\n\nThe fallback should retain this evidence.",
                },
            ),
            verification_level="T1",
        ),
        ModelRequirement(
            role="quick_synthesis",
            required_capabilities=("text",),
            allow_degradation=True,
        ),
    )

    assert response.actual_model == "extractive-local-v1"
    assert "The fallback should retain this evidence." in response.text
    assert response.metadata["degradation_reason"] == "active_model_route_failed"
    assert response.metadata["failed_route_id"] == route.id
    assert response.metadata["failures"] == [
        {"deployment_id": candidate.id, "error_type": "ReadTimeout"}
    ]
    health = nexus.model_gateway.health()
    assert health["route_id"] == route.id
    assert health["fallback_model"] == "extractive-local-v1"


def test_active_route_failure_preserves_nested_provider_error_type(
    nexus: NexusContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="runtime-capability-error",
        protocol_family="openai_compatible",
        endpoint="https://capability-error.invalid/v1",
        secret_ref=None,
    )
    candidate = catalog.register_model(
        provider.id,
        upstream_model_id="capability-error/model-v1",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        candidate.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(candidate.id)
    route = catalog.create_route(
        role="quick_synthesis",
        deployment_ids=[candidate.id],
        required_capabilities=["text"],
    )
    catalog.activate_route(route.id)

    def capability_error_post(_url: str, **_: object) -> httpx.Response:
        raise CapabilityUnavailableError(
            "Wrapped provider failure",
            details={"error_type": "ReadTimeout"},
        )

    monkeypatch.setattr(httpx, "post", capability_error_post)
    response = nexus.model_gateway.synthesize(
        SynthesisRequest(
            goal="Answer despite wrapped provider timeout",
            evidence=(
                {
                    "evidence_revision_id": "wrapped-evidence",
                    "source_name": "wrapped.md",
                    "locator": {"locator_type": "paragraph"},
                    "text": "Wrapped provider fallback evidence.",
                },
            ),
            verification_level="T1",
        ),
        ModelRequirement(
            role="quick_synthesis",
            required_capabilities=("text",),
            allow_degradation=True,
        ),
    )

    assert response.metadata["degradation_reason"] == "active_model_route_failed"
    assert response.metadata["failed_route_id"] == route.id
    assert response.metadata["failures"] == [
        {"deployment_id": candidate.id, "error_type": "ReadTimeout"}
    ]


def test_active_route_capability_mismatch_reports_missing_capabilities(
    nexus: NexusContainer,
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="runtime-missing-capability",
        protocol_family="openai_compatible",
        endpoint="https://runtime-missing.invalid/v1",
        secret_ref=None,
    )
    deployment = catalog.register_model(
        provider.id,
        upstream_model_id="runtime-missing/model-v1",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        deployment.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(deployment.id)
    route = catalog.create_route(
        role="quick_synthesis",
        deployment_ids=[deployment.id],
        required_capabilities=["text"],
    )
    catalog.activate_route(route.id)
    with nexus.database.transaction() as session:
        row = session.get(ModelDeployment, deployment.id)
        assert row is not None
        row.verified_capabilities = ["text"]

    response = nexus.model_gateway.synthesize(
        SynthesisRequest(
            goal="Answer despite missing capability",
            evidence=(
                {
                    "evidence_revision_id": "missing-capability-evidence",
                    "source_name": "missing.md",
                    "locator": {"locator_type": "paragraph"},
                    "text": "Capability mismatch fallback evidence.",
                },
            ),
            verification_level="T1",
        ),
        ModelRequirement(
            role="quick_synthesis",
            required_capabilities=("text", "json_schema"),
            allow_degradation=True,
        ),
    )

    assert response.metadata["degradation_reason"] == "active_model_route_failed"
    assert response.metadata["failed_route_id"] == route.id
    assert response.metadata["failures"] == [
        {
            "deployment_id": deployment.id,
            "error_type": "CapabilityMismatch",
            "missing": ["json_schema"],
        }
    ]


def test_pinned_setup_gateway_failure_degrades_to_local_extractive_synthesis(
    nexus: NexusContainer,
) -> None:
    class FailingPinnedGateway:
        def synthesize(
            self,
            _request: SynthesisRequest,
            _requirement: ModelRequirement,
        ) -> ModelResponse:
            raise CapabilityUnavailableError(
                "Pinned setup gateway failed",
                details={"error_type": "ReadTimeout"},
            )

        def complete(
            self,
            _request: TaskRequest,
            _requirement: ModelRequirement,
        ) -> ModelResponse:
            raise CapabilityUnavailableError("Pinned setup gateway failed")

        def snapshot(self) -> dict[str, object]:
            return {"gateway": "failing-pinned"}

        def health(self) -> dict[str, object]:
            return {"status": "degraded"}

    gateway = GovernedModelGateway(
        repository=nexus.model_catalog.repository,
        credentials=EnvironmentCredentialStore(),
        pinned_gateway=FailingPinnedGateway(),
        timeout_seconds=0.01,
        fallback_gateway=ExtractiveModelGateway(),
    )
    response = gateway.synthesize(
        SynthesisRequest(
            goal="Answer despite pinned gateway timeout",
            evidence=(
                {
                    "evidence_revision_id": "pinned-evidence",
                    "source_name": "pinned.md",
                    "locator": {"locator_type": "paragraph"},
                    "text": "# Pinned Evidence\n\nThe local fallback keeps this citation.",
                },
            ),
            verification_level="T1",
        ),
        ModelRequirement(
            role="quick_synthesis",
            required_capabilities=("text",),
            allow_degradation=True,
        ),
    )

    assert response.actual_model == "extractive-local-v1"
    assert "The local fallback keeps this citation." in response.text
    assert response.metadata["degradation_reason"] == "pinned_setup_gateway_failed"
    assert response.metadata["failures"] == [
        {"deployment_id": "pinned_setup_gateway", "error_type": "ReadTimeout"}
    ]
    assert gateway.health()["fallback_model"] == "extractive-local-v1"


def test_question_override_failure_degrades_with_explicit_override_reason(
    nexus: NexusContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="question-override-timeout",
        protocol_family="openai_compatible",
        endpoint="https://override-timeout.invalid/v1",
        secret_ref=None,
    )
    deployment = catalog.register_model(
        provider.id,
        upstream_model_id="override-timeout/model-v1",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        deployment.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(deployment.id)

    def timeout_post(url: str, **_: object) -> httpx.Response:
        assert url == "https://override-timeout.invalid/v1/chat/completions"
        raise httpx.ReadTimeout("provider timed out")

    monkeypatch.setattr(httpx, "post", timeout_post)
    response = nexus.model_gateway.synthesize(
        SynthesisRequest(
            goal="Answer despite selected model timeout",
            evidence=(
                {
                    "evidence_revision_id": "override-evidence",
                    "source_name": "override.md",
                    "locator": {"locator_type": "paragraph"},
                    "text": "# Override Evidence\n\nThe selected model fallback keeps this evidence.",
                },
            ),
            verification_level="T1",
        ),
        ModelRequirement(
            role="quick_synthesis",
            required_capabilities=("text",),
            allow_degradation=True,
            preferred_deployment_id=deployment.id,
        ),
    )

    assert response.actual_model == "extractive-local-v1"
    assert "The selected model fallback keeps this evidence." in response.text
    assert response.metadata["degradation_reason"] == "question_override_model_failed"
    assert response.metadata["failed_route_id"] == "question_override"
    assert response.metadata["failures"] == [
        {"deployment_id": deployment.id, "error_type": "ReadTimeout"}
    ]
    assert nexus.model_gateway.health()["route_id"] == "question_override"


def test_question_model_override_uses_the_selected_verified_deployment(
    nexus: NexusContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="question-override-provider",
        protocol_family="openai_compatible",
        endpoint="https://override.invalid/v1",
        secret_ref=None,
    )
    deployment = catalog.register_model(
        provider.id,
        upstream_model_id="override/model-v3",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        deployment.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(deployment.id)
    evidence_id = "22222222-2222-4222-8222-222222222222"

    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        assert url == "https://override.invalid/v1/chat/completions"
        assert kwargs["json"]["model"] == "override/model-v3"  # type: ignore[index]
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "model": "override/model-v3",
                "choices": [
                    {
                        "message": {
                            "content": f"Selected answer [evidence:{evidence_id}]"
                        },
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    response = nexus.model_gateway.synthesize(
        SynthesisRequest(
            goal="Use the question override",
            evidence=(
                {
                    "evidence_revision_id": evidence_id,
                    "source_name": "override contract",
                    "locator": {"locator_type": "paragraph"},
                    "text": "Override evidence",
                },
            ),
            verification_level="T1",
        ),
        ModelRequirement(
            role="quick_synthesis",
            required_capabilities=("text",),
            preferred_deployment_id=deployment.id,
        ),
    )
    assert response.actual_model == "override/model-v3"
    assert nexus.model_gateway.health()["route_id"] == "question_override"


def test_active_task_route_failure_degrades_to_deterministic_task_payload(
    nexus: NexusContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="task-timeout",
        protocol_family="openai_compatible",
        endpoint="https://task-timeout.invalid/v1",
        secret_ref=None,
    )
    deployment = catalog.register_model(
        provider.id,
        upstream_model_id="task-timeout/model-v1",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        deployment.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(deployment.id)
    route = catalog.create_route(
        role="query_rewrite",
        deployment_ids=[deployment.id],
        required_capabilities=["text"],
    )
    catalog.activate_route(route.id)

    def timeout_post(url: str, **_: object) -> httpx.Response:
        assert url == "https://task-timeout.invalid/v1/chat/completions"
        raise httpx.ReadTimeout("provider timed out")

    monkeypatch.setattr(httpx, "post", timeout_post)
    response = nexus.model_gateway.complete(
        TaskRequest(
            system_prompt="Rewrite the question as JSON.",
            user_prompt=(
                '{"question":"它的具体日期是什么？",'
                '"recent_conversation":[{"role":"user","content":"When does Project Comet launch?"}],'
                '"required_output":{"rewritten_query":"string"}}'
            ),
            temperature=0.0,
        ),
        ModelRequirement(
            role="query_rewrite",
            required_capabilities=("text",),
            allow_degradation=True,
        ),
    )

    assert response.actual_model == "deterministic-task-local-v1"
    assert response.text == (
        '{"rewritten_query": "Previous user question: When does Project Comet launch?\\n'
        'Current follow-up: 它的具体日期是什么？", "multi_view_queries": [], '
        '"keywords": ["它的具体日期是什么"], "fallback": true}'
    )
    assert response.metadata["degradation_reason"] == "active_task_model_route_failed"
    assert response.metadata["failed_route_id"] == route.id
    assert response.metadata["failures"] == [
        {"deployment_id": deployment.id, "error_type": "ReadTimeout"}
    ]
    health = nexus.model_gateway.health()
    assert health["route_id"] == route.id
    assert health["role"] == "query_rewrite"
    assert health["fallback_model"] == "deterministic-task-local-v1"


def test_task_route_capability_mismatch_reports_missing_capabilities(
    nexus: NexusContainer,
) -> None:
    catalog = nexus.model_catalog
    provider = catalog.create_provider(
        name="task-missing-capability",
        protocol_family="openai_compatible",
        endpoint="https://task-missing.invalid/v1",
        secret_ref=None,
    )
    deployment = catalog.register_model(
        provider.id,
        upstream_model_id="task-missing/model-v1",
        declared_capabilities=["text"],
    )
    catalog.repository.record_probe(
        deployment.id,
        results={"chat": True},
        verified_capabilities=["text"],
        error=None,
    )
    catalog.enable(deployment.id)
    route = catalog.create_route(
        role="query_rewrite",
        deployment_ids=[deployment.id],
        required_capabilities=["text"],
    )
    catalog.activate_route(route.id)
    with nexus.database.transaction() as session:
        row = session.get(ModelDeployment, deployment.id)
        assert row is not None
        row.verified_capabilities = ["text"]

    response = nexus.model_gateway.complete(
        TaskRequest(
            system_prompt="Rewrite the question as JSON.",
            user_prompt='{"question":"Project Comet date?"}',
        ),
        ModelRequirement(
            role="query_rewrite",
            required_capabilities=("text", "json_schema"),
            allow_degradation=True,
        ),
    )

    assert response.metadata["failures"] == [
        {
            "deployment_id": deployment.id,
            "error_type": "CapabilityMismatch",
            "missing": ["json_schema"],
        }
    ]


def test_pinned_setup_task_gateway_failure_degrades_to_deterministic_task_payload(
    nexus: NexusContainer,
) -> None:
    class FailingPinnedGateway:
        def synthesize(
            self,
            _request: SynthesisRequest,
            _requirement: ModelRequirement,
        ) -> ModelResponse:
            raise CapabilityUnavailableError("Pinned setup gateway failed")

        def complete(
            self,
            _request: TaskRequest,
            _requirement: ModelRequirement,
        ) -> ModelResponse:
            raise CapabilityUnavailableError(
                "Pinned setup task gateway failed",
                details={"error_type": "ReadTimeout"},
            )

        def snapshot(self) -> dict[str, object]:
            return {"gateway": "failing-pinned"}

        def health(self) -> dict[str, object]:
            return {"status": "degraded"}

    gateway = GovernedModelGateway(
        repository=nexus.model_catalog.repository,
        credentials=EnvironmentCredentialStore(),
        pinned_gateway=FailingPinnedGateway(),
        timeout_seconds=0.01,
        fallback_gateway=ExtractiveModelGateway(),
    )
    response = gateway.complete(
        TaskRequest(
            system_prompt="Classify the question as JSON.",
            user_prompt='{"question":"这张图片是什么？","required_output":{"intent":"string"}}',
        ),
        ModelRequirement(
            role="query_intent",
            required_capabilities=("text",),
            allow_degradation=True,
        ),
    )

    assert response.actual_model == "deterministic-task-local-v1"
    assert response.text == (
        '{"intent": "factual", "modality_intent": "image", "is_complex": false, '
        '"keywords": ["这张图片是什么"], "sub_queries": [], "fallback": true}'
    )
    assert response.metadata["degradation_reason"] == "pinned_setup_task_gateway_failed"
    assert response.metadata["failures"] == [
        {"deployment_id": "pinned_setup_gateway", "error_type": "ReadTimeout"}
    ]
    health = gateway.health()
    assert health["route"] == "pinned_setup_gateway"
    assert health["role"] == "query_intent"
    assert health["fallback_model"] == "deterministic-task-local-v1"
