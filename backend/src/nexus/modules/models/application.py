from __future__ import annotations

import base64
import hashlib
import io
import struct
import wave
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime

import httpx

from nexus.modules.models.domain import (
    ManagedProviderSpec,
    ModelDeploymentView,
    ModelRouteView,
    ProviderView,
)
from nexus.modules.models.ports import CredentialStorePort, ModelCatalogRepositoryPort
from nexus.shared.domain.errors import CapabilityUnavailableError, ValidationError


def _silent_wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8_000)
        output.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


def _probe_png_data_url() -> str:
    """Return a deterministic 32 px image accepted by strict vision gateways."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)

    width = height = 32
    scanlines = b"".join(b"\x00" + b"\xe6\x3b\x32" * width for _ in range(height))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines))
        + chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode()


_ROLE_CAPABILITIES = {
    "quick_synthesis": "text",
    "research_synthesis": "text",
    "planning": "text",
    "verification": "text",
    "query_intent": "text",
    "query_rewrite": "text",
    "space_routing": "text",
    "image_caption": "vision",
    "document_figure_caption": "vision",
    "video_understanding": "vision",
    "audio_transcription": "audio_transcription",
    "video_audio_transcription": "audio_transcription",
    "dense_embedding": "embedding",
    "reranking": "rerank",
}

_ROLE_GROUPS = {
    "answering": (
        "quick_synthesis",
        "research_synthesis",
        "planning",
        "verification",
    ),
    "knowledge_navigation": (
        "query_intent",
        "query_rewrite",
        "space_routing",
    ),
    "visual_understanding": (
        "image_caption",
        "document_figure_caption",
        "video_understanding",
    ),
    "audio_understanding": (
        "audio_transcription",
        "video_audio_transcription",
    ),
    "retrieval_quality": (
        "dense_embedding",
        "reranking",
    ),
}


class ModelCatalogService:
    """Discovery produces candidates; probe and explicit enable remain separate gates."""

    def __init__(
        self,
        *,
        repository: ModelCatalogRepositoryPort,
        credentials: CredentialStorePort,
        managed_providers: tuple[ManagedProviderSpec, ...] = (),
        timeout_seconds: float = 30.0,
    ) -> None:
        self.repository = repository
        self.credentials = credentials
        self.managed_providers = managed_providers
        self.timeout_seconds = timeout_seconds

    def ensure_managed(self) -> list[ProviderView]:
        """Materialize configured providers and pinned task models idempotently."""
        providers: list[ProviderView] = []
        for spec in self.managed_providers:
            provider = self.repository.upsert_managed_provider(spec)
            providers.append(provider)
            for seed in spec.seeds:
                self.repository.upsert_discovered_model(
                    provider_id=provider.id,
                    upstream_model_id=seed.upstream_model_id,
                    declared_capabilities=list(seed.declared_capabilities),
                    observation={
                        "source_type": "runtime_configuration",
                        "observed_at": datetime.now(UTC).isoformat(),
                        "runtime_roles": list(seed.runtime_roles),
                        "managed": True,
                    },
                )
        return providers

    def sync_managed(self) -> dict[str, object]:
        """Refresh remote model lists while keeping ordinary catalog reads offline-safe."""
        providers = self.ensure_managed()
        discovered = 0
        failures: list[dict[str, str]] = []
        with ThreadPoolExecutor(max_workers=max(1, min(4, len(providers)))) as executor:
            pending = {
                executor.submit(self.discover, provider.id): provider
                for provider in providers
            }
            for future in as_completed(pending):
                provider = pending[future]
                try:
                    discovered += len(future.result())
                    self.repository.set_provider_health(provider.id, "healthy")
                except Exception as exc:
                    self.repository.set_provider_health(provider.id, "degraded")
                    failures.append(
                        {"provider_id": provider.id, "error": type(exc).__name__}
                    )
        return {
            "providers": len(providers),
            "models": len(self.repository.list_models()),
            "discovered": discovered,
            "failures": failures,
            "synced_at": datetime.now(UTC).isoformat(),
        }

    def verify_configured(self) -> dict[str, object]:
        """Probe configured task models, enable successes, and publish usable routes.

        This remains an explicit operator action: merely discovering a remote model can
        never make it executable. Re-running the action is safe and repairs missing task
        routes without creating duplicate revisions when the active route is already right.
        """
        self.ensure_managed()
        configured = [
            model
            for model in self.repository.list_models()
            if model.observation.get("managed")
            and isinstance(model.observation.get("runtime_roles"), list)
            and model.observation["runtime_roles"]
        ]
        enabled: dict[str, ModelDeploymentView] = {
            model.id: model for model in configured if model.lifecycle == "enabled"
        }
        failures: list[dict[str, str]] = []
        candidates = [model for model in configured if model.lifecycle != "enabled"]
        with ThreadPoolExecutor(max_workers=max(1, min(4, len(candidates)))) as executor:
            pending = {executor.submit(self.probe, model.id): model for model in candidates}
            for future in as_completed(pending):
                model = pending[future]
                try:
                    probed = future.result()
                    if probed.lifecycle != "verified":
                        failures.append(
                            {
                                "model_id": model.id,
                                "model": model.upstream_model_id,
                                "reason": "capability_probe_failed",
                            }
                        )
                        continue
                    enabled[model.id] = self.enable(model.id)
                except Exception as exc:
                    failures.append(
                        {
                            "model_id": model.id,
                            "model": model.upstream_model_id,
                            "reason": type(exc).__name__,
                        }
                    )

        active_routes = {
            route.role: route
            for route in self.repository.list_routes()
            if route.status == "active"
        }
        routes_activated = 0
        roles_ready: set[str] = set()
        for model in enabled.values():
            roles = model.observation.get("runtime_roles", [])
            if not isinstance(roles, list):
                continue
            for role_value in roles:
                role = str(role_value)
                required = _ROLE_CAPABILITIES.get(role)
                if required is None or required not in model.verified_capabilities:
                    continue
                roles_ready.add(role)
                current = active_routes.get(role)
                if (
                    current is not None
                    and current.deployment_ids == (model.id,)
                    and current.required_capabilities == (required,)
                ):
                    continue
                draft = self.create_route(
                    role=role,
                    deployment_ids=[model.id],
                    required_capabilities=[required],
                )
                active_routes[role] = self.activate_route(draft.id)
                routes_activated += 1

        return {
            "configured": len(configured),
            "probed": len(candidates),
            "enabled": len(enabled),
            "routes_activated": routes_activated,
            "roles_ready": sorted(roles_ready),
            "failures": failures,
            "verified_at": datetime.now(UTC).isoformat(),
        }

    @staticmethod
    def _recommendation_key(
        model: ModelDeploymentView,
        *,
        role: str,
    ) -> tuple[bool, bool, int, str, str]:
        runtime_roles = model.observation.get("runtime_roles", [])
        exact_role = isinstance(runtime_roles, list) and role in runtime_roles
        return (
            not exact_role,
            not bool(model.observation.get("managed")),
            len(model.verified_capabilities),
            model.upstream_model_id.casefold(),
            model.id,
        )

    def recommend_setup(self) -> dict[str, object]:
        """Build a deterministic, explainable plan from verified deployments only."""

        providers = self.repository.list_providers()
        models = self.repository.list_models()
        enabled = [model for model in models if model.lifecycle == "enabled"]
        active_routes = {
            route.role: route
            for route in self.repository.list_routes()
            if route.status == "active"
        }
        models_by_id = {model.id: model for model in models}
        roles: list[dict[str, object]] = []
        for role, capability in _ROLE_CAPABILITIES.items():
            active = active_routes.get(role)
            active_ids = list(active.deployment_ids) if active is not None else []
            candidates = sorted(
                [
                    model
                    for model in enabled
                    if capability in model.verified_capabilities
                ],
                key=lambda model: self._recommendation_key(model, role=role),
            )
            recommended = candidates[0] if candidates else None
            if active is not None:
                state = "active"
                reason = "An explicit verified route is already active and will be preserved."
            elif recommended is not None:
                state = "candidate"
                runtime_roles = recommended.observation.get("runtime_roles", [])
                reason = (
                    "This verified deployment is explicitly configured for the task."
                    if isinstance(runtime_roles, list) and role in runtime_roles
                    else "This verified deployment satisfies the task capability."
                )
            else:
                state = "fallback"
                reason = (
                    "No enabled deployment has the required verified capability; the "
                    "configured or deterministic fallback remains in use."
                )
            active_names = [
                models_by_id[deployment_id].upstream_model_id
                for deployment_id in active_ids
                if deployment_id in models_by_id
            ]
            roles.append(
                {
                    "role": role,
                    "required_capability": capability,
                    "state": state,
                    "active_deployment_ids": active_ids,
                    "active_model_names": active_names,
                    "recommended_deployment_id": recommended.id if recommended else None,
                    "recommended_model_name": (
                        recommended.upstream_model_id if recommended else None
                    ),
                    "reason": reason,
                }
            )

        roles_by_name = {str(item["role"]): item for item in roles}
        groups: list[dict[str, object]] = []
        for group, group_roles in _ROLE_GROUPS.items():
            items = [roles_by_name[role] for role in group_roles]
            ready_count = sum(item["state"] == "active" for item in items)
            configurable_count = sum(item["state"] == "candidate" for item in items)
            status = (
                "ready"
                if ready_count == len(items)
                else "action_available"
                if configurable_count
                else "fallback"
            )
            groups.append(
                {
                    "group": group,
                    "status": status,
                    "ready_count": ready_count,
                    "configurable_count": configurable_count,
                    "total_count": len(items),
                    "roles": list(group_roles),
                }
            )

        ready_role_count = sum(item["state"] == "active" for item in roles)
        configurable_role_count = sum(item["state"] == "candidate" for item in roles)
        if ready_role_count == len(roles):
            status = "ready"
        elif configurable_role_count:
            status = "action_available"
        elif models and not enabled:
            status = "verification_required"
        elif not providers:
            status = "credentials_required"
        else:
            status = "partial"
        return {
            "status": status,
            "provider_count": len(providers),
            "discovered_model_count": len(models),
            "enabled_model_count": len(enabled),
            "active_route_count": len(active_routes),
            "total_role_count": len(roles),
            "ready_role_count": ready_role_count,
            "configurable_role_count": configurable_role_count,
            "groups": groups,
            "roles": roles,
        }

    def apply_recommended_setup(self, *, replace_existing: bool = False) -> dict[str, object]:
        """Activate deterministic recommendations while preserving custom routes by default."""

        before = self.recommend_setup()
        activated: list[str] = []
        unfilled: list[str] = []
        for recommendation in before["roles"]:
            assert isinstance(recommendation, dict)
            role = str(recommendation["role"])
            if recommendation["state"] == "active" and not replace_existing:
                continue
            deployment_id = recommendation.get("recommended_deployment_id")
            if not isinstance(deployment_id, str):
                if recommendation["state"] != "active":
                    unfilled.append(role)
                continue
            draft = self.create_route(
                role=role,
                deployment_ids=[deployment_id],
                required_capabilities=[str(recommendation["required_capability"])],
            )
            self.activate_route(draft.id)
            activated.append(role)
        return {
            "routes_activated": len(activated),
            "roles_activated": activated,
            "unfilled_roles": unfilled,
            "setup": self.recommend_setup(),
        }

    def create_provider(
        self, *, name: str, protocol_family: str, endpoint: str, secret_ref: str | None
    ) -> ProviderView:
        if not endpoint.startswith(("http://", "https://")):
            raise ValidationError("Provider endpoint must use HTTP or HTTPS")
        return self.repository.create_provider(
            name=name.strip(),
            protocol_family=protocol_family,
            endpoint=endpoint.rstrip("/"),
            secret_ref=secret_ref,
        )

    def discover(self, provider_id: str) -> list[ModelDeploymentView]:
        provider = self.repository.get_provider(provider_id)
        key = self.credentials.resolve(provider.secret_ref) if provider.secret_ref else None
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        if provider.protocol_family in {"openai_chat", "openai_responses", "openai_compatible"}:
            response = httpx.get(
                f"{provider.endpoint}/models", headers=headers, timeout=self.timeout_seconds
            )
            response.raise_for_status()
            payload = response.json()
            candidates = payload.get("data", [])
            source_type = "provider_models_api"
        elif provider.protocol_family == "google_gemini":
            response = httpx.get(
                f"{provider.endpoint}/models",
                params={"key": key} if key else {},
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            candidates = payload.get("models", [])
            source_type = "provider_models_api"
        else:
            raise CapabilityUnavailableError(
                "This protocol does not expose a supported model discovery API",
                details={"protocol_family": provider.protocol_family},
            )
        raw_hash = hashlib.sha256(response.content).hexdigest()
        discovered: list[ModelDeploymentView] = []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            upstream_id = str(item.get("id") or item.get("name") or "").strip()
            if not upstream_id:
                continue
            declared = self.infer_capabilities(upstream_id)
            methods = item.get("supportedGenerationMethods", [])
            if "generateContent" in methods:
                declared.extend(["streaming", "multimodal"])
            discovered.append(
                self.repository.upsert_discovered_model(
                    provider_id=provider.id,
                    upstream_model_id=upstream_id,
                    declared_capabilities=declared,
                    observation={
                        "source_type": source_type,
                        "observed_at": datetime.now(UTC).isoformat(),
                        "raw_hash": raw_hash,
                    },
                )
            )
        return discovered

    @staticmethod
    def infer_capabilities(model_id: str) -> list[str]:
        """Conservative declarations only; probes remain the verification gate."""
        value = model_id.lower()
        if any(token in value for token in ("embedding", "embed", "bge-")):
            return ["embedding"]
        if any(token in value for token in ("rerank", "ranker")):
            return ["rerank"]
        capabilities = ["streaming", "text"]
        if any(
            token in value
            for token in ("vision", "-vl", "vl-", "qvq", "gpt-4o", "gemini", "claude")
        ):
            capabilities.extend(["image_input", "multimodal", "vision"])
        if any(token in value for token in ("omni", "audio", "whisper", "speech")):
            capabilities.extend(["audio_input", "audio_transcription", "multimodal"])
        if any(token in value for token in ("video", "omni")):
            capabilities.extend(["video_input", "video_understanding"])
        if "whisper" not in value:
            capabilities.append("tool_calling")
        return sorted(set(capabilities))

    def probe(self, model_id: str) -> ModelDeploymentView:
        models = {model.id: model for model in self.repository.list_models()}
        model = models.get(model_id)
        if model is None:
            raise ValidationError("Unknown model deployment")
        provider = self.repository.get_provider(model.provider_connection_id)
        key = self.credentials.resolve(provider.secret_ref) if provider.secret_ref else None
        try:
            declared = set(model.declared_capabilities)
            headers = {"Authorization": f"Bearer {key}"} if key else {}
            verified: list[str] = []
            probe_kind = "chat"
            if "embedding" in declared:
                probe_kind = "embedding"
                response = httpx.post(
                    f"{provider.endpoint}/embeddings",
                    headers=headers,
                    json={"model": model.upstream_model_id, "input": ["capability probe"]},
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                payload = response.json()
                valid = bool(payload.get("data") and payload["data"][0].get("embedding"))
                verified = ["embedding"] if valid else []
            elif "rerank" in declared:
                probe_kind = "rerank"
                response = httpx.post(
                    f"{provider.endpoint}/rerank",
                    headers=headers,
                    json={
                        "model": model.upstream_model_id,
                        "query": "capability probe",
                        "documents": ["capability probe", "unrelated text"],
                        "top_n": 2,
                    },
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                payload = response.json()
                valid = bool(payload.get("results"))
                verified = ["rerank"] if valid else []
            elif "audio_transcription" in declared and provider.protocol_family in {
                "openai_chat",
                "openai_compatible",
            }:
                probe_kind = "audio_input"
                encoded = base64.b64encode(_silent_wav()).decode()
                response = httpx.post(
                    f"{provider.endpoint}/chat/completions",
                    headers=headers,
                    json={
                        "model": model.upstream_model_id,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "input_audio",
                                        "input_audio": {
                                            "data": f"data:audio/wav;base64,{encoded}",
                                            "format": "wav",
                                        },
                                    },
                                    {
                                        "type": "text",
                                        "text": "Reply with ok. The audio may be silent.",
                                    },
                                ],
                            }
                        ],
                        "modalities": ["text"],
                        "temperature": 0,
                    },
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                payload = response.json()
                valid = bool(payload.get("choices"))
                verified = (
                    ["audio_input", "audio_transcription", "multimodal", "text"]
                    if valid
                    else []
                )
            elif "vision" in declared and provider.protocol_family in {
                "openai_chat",
                "openai_compatible",
            }:
                probe_kind = "image_input"
                response = httpx.post(
                    f"{provider.endpoint}/chat/completions",
                    headers=headers,
                    json={
                        "model": model.upstream_model_id,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": "Reply with the visible color."},
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": _probe_png_data_url()},
                                    },
                                ],
                            }
                        ],
                        "temperature": 0,
                        "max_tokens": 16,
                    },
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                payload = response.json()
                valid = bool(payload.get("choices"))
                verified = ["image_input", "multimodal", "text", "vision"] if valid else []
            elif provider.protocol_family in {"openai_chat", "openai_compatible"}:
                response = httpx.post(
                    f"{provider.endpoint}/chat/completions",
                    headers=headers,
                    json={
                        "model": model.upstream_model_id,
                        "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
                        "temperature": 0,
                        "max_tokens": 8,
                    },
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                payload = response.json()
                valid = bool(payload.get("choices"))
                verified = ["text"] if valid else []
            elif provider.protocol_family == "openai_responses":
                response = httpx.post(
                    f"{provider.endpoint}/responses",
                    headers={"Authorization": f"Bearer {key}"} if key else {},
                    json={"model": model.upstream_model_id, "input": "Reply with exactly: ok"},
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                payload = response.json()
                valid = bool(payload.get("output") or payload.get("output_text"))
                verified = ["text"] if valid else []
            elif provider.protocol_family == "anthropic_messages":
                response = httpx.post(
                    f"{provider.endpoint}/messages",
                    headers={
                        "x-api-key": key or "",
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model.upstream_model_id,
                        "max_tokens": 8,
                        "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
                    },
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                payload = response.json()
                valid = isinstance(payload.get("content"), list) and bool(payload["content"])
                verified = ["text"] if valid else []
            elif provider.protocol_family == "google_gemini":
                upstream = model.upstream_model_id.removeprefix("models/")
                response = httpx.post(
                    f"{provider.endpoint}/models/{upstream}:generateContent",
                    params={"key": key} if key else {},
                    json={"contents": [{"parts": [{"text": "Reply with exactly: ok"}]}]},
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                payload = response.json()
                valid = bool(payload.get("candidates"))
                verified = ["text"] if valid else []
            else:
                raise CapabilityUnavailableError(
                    "Capability probe does not support this provider protocol",
                    details={"protocol_family": provider.protocol_family},
                )
            return self.repository.record_probe(
                model_id,
                results={
                    probe_kind: valid,
                    "status_code": response.status_code,
                    "protocol_family": provider.protocol_family,
                },
                verified_capabilities=verified,
                error=None if valid else "invalid_response_shape",
            )
        except Exception as exc:
            return self.repository.record_probe(
                model_id,
                results={
                    "probe": False,
                    "protocol_family": provider.protocol_family,
                },
                verified_capabilities=[],
                error=type(exc).__name__,
            )

    def enable(self, model_id: str) -> ModelDeploymentView:
        return self.repository.enable_model(model_id)

    def resolve_runtime(
        self, role: str, required_capabilities: tuple[str, ...]
    ) -> dict[str, str] | None:
        """Resolve an active task route for internal adapters without exposing secrets."""
        route = next(
            (
                item
                for item in self.repository.list_routes()
                if item.role == role and item.status == "active"
            ),
            None,
        )
        if route is None:
            return None
        models = {item.id: item for item in self.repository.list_models()}
        for deployment_id in route.deployment_ids:
            deployment = models.get(deployment_id)
            if deployment is None or deployment.lifecycle != "enabled":
                continue
            if set(required_capabilities) - set(deployment.verified_capabilities):
                continue
            provider = self.repository.get_provider(deployment.provider_connection_id)
            secret = self.credentials.resolve(provider.secret_ref) if provider.secret_ref else ""
            return {
                "endpoint": provider.endpoint,
                "api_key": secret,
                "model": deployment.upstream_model_id,
                "protocol_family": provider.protocol_family,
                "deployment_id": deployment.id,
            }
        return None

    def register_model(
        self,
        provider_id: str,
        *,
        upstream_model_id: str,
        declared_capabilities: list[str],
    ) -> ModelDeploymentView:
        provider = self.repository.get_provider(provider_id)
        return self.repository.upsert_discovered_model(
            provider_id=provider.id,
            upstream_model_id=upstream_model_id.strip(),
            declared_capabilities=declared_capabilities or ["text"],
            observation={
                "source_type": "manual_provider_declaration",
                "observed_at": datetime.now(UTC).isoformat(),
                "protocol_family": provider.protocol_family,
            },
        )

    def create_route(
        self,
        *,
        role: str,
        deployment_ids: list[str],
        required_capabilities: list[str],
    ) -> ModelRouteView:
        clean_role = role.strip()
        if not clean_role:
            raise ValidationError("Model route role must not be empty")
        return self.repository.create_route(
            role=clean_role,
            deployment_ids=deployment_ids,
            required_capabilities=required_capabilities,
        )

    def activate_route(self, route_id: str) -> ModelRouteView:
        return self.repository.activate_route(route_id)

    def list_routes(self) -> list[ModelRouteView]:
        return self.repository.list_routes()

    def snapshot(self) -> dict[str, object]:
        return {
            "routes": [
                {
                    "id": route.id,
                    "role": route.role,
                    "revision": route.revision,
                    "status": route.status,
                    "deployment_ids": list(route.deployment_ids),
                    "required_capabilities": list(route.required_capabilities),
                }
                for route in self.repository.list_routes()
                if route.status == "active"
            ]
        }
