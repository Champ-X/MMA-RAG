from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from nexus.infrastructure.postgres.database import Database
from nexus.infrastructure.postgres.models import (
    CapabilityObservation,
    ModelDeployment,
    ModelRoute,
    ProbeRun,
    ProviderConnection,
)
from nexus.modules.models.domain import (
    ManagedProviderSpec,
    ModelDeploymentView,
    ModelRouteView,
    ProviderView,
)
from nexus.shared.domain.errors import ConflictError, NotFoundError, ValidationError


class SqlModelCatalogRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    def create_provider(
        self, *, name: str, protocol_family: str, endpoint: str, secret_ref: str | None
    ) -> ProviderView:
        try:
            with self.database.transaction() as session:
                row = ProviderConnection(
                    name=name,
                    protocol_family=protocol_family,
                    endpoint=endpoint,
                    secret_ref=secret_ref,
                )
                session.add(row)
                session.flush()
                return self._provider(row)
        except IntegrityError as exc:
            raise ConflictError("Provider connection name already exists") from exc

    def list_providers(self) -> list[ProviderView]:
        with self.database.transaction() as session:
            return [
                self._provider(row)
                for row in session.scalars(
                    select(ProviderConnection).order_by(ProviderConnection.name)
                )
            ]

    def upsert_managed_provider(self, spec: ManagedProviderSpec) -> ProviderView:
        with self.database.transaction() as session:
            row = session.scalar(
                select(ProviderConnection).where(ProviderConnection.name == spec.name)
            )
            if row is None:
                row = ProviderConnection(name=spec.name)
                session.add(row)
            row.protocol_family = spec.protocol_family
            row.endpoint = spec.endpoint.rstrip("/")
            row.secret_ref = spec.secret_ref
            row.enabled = True
            if row.health_status in {"unknown", "not_configured"}:
                row.health_status = "configured"
            session.flush()
            return self._provider(row)

    def set_provider_health(self, provider_id: str, status: str) -> ProviderView:
        with self.database.transaction() as session:
            row = session.get(ProviderConnection, provider_id, with_for_update=True)
            if row is None:
                raise NotFoundError("Provider connection not found")
            row.health_status = status
            return self._provider(row)

    def get_provider(self, provider_id: str) -> ProviderView:
        with self.database.transaction() as session:
            row = session.get(ProviderConnection, provider_id)
            if row is None:
                raise NotFoundError("Provider connection not found")
            return self._provider(row)

    def upsert_discovered_model(
        self,
        *,
        provider_id: str,
        upstream_model_id: str,
        declared_capabilities: list[str],
        observation: dict[str, object],
    ) -> ModelDeploymentView:
        with self.database.transaction() as session:
            provider = session.get(ProviderConnection, provider_id)
            if provider is None:
                raise NotFoundError("Provider connection not found")
            row = session.scalar(
                select(ModelDeployment).where(
                    ModelDeployment.provider_connection_id == provider_id,
                    ModelDeployment.upstream_model_id == upstream_model_id,
                    ModelDeployment.protocol_family == provider.protocol_family,
                )
            )
            if row is None:
                row = ModelDeployment(
                    provider_connection_id=provider_id,
                    protocol_family=provider.protocol_family,
                    upstream_model_id=upstream_model_id,
                    lifecycle="pending_verification",
                )
                session.add(row)
            row.declared_capabilities = sorted(set(declared_capabilities))
            row.observation = observation
            row.last_seen_at = datetime.now(UTC)
            session.flush()
            return self._model(row)

    def list_models(self, provider_id: str | None = None) -> list[ModelDeploymentView]:
        with self.database.transaction() as session:
            statement = select(ModelDeployment).order_by(ModelDeployment.upstream_model_id)
            if provider_id:
                statement = statement.where(ModelDeployment.provider_connection_id == provider_id)
            return [self._model(row) for row in session.scalars(statement)]

    def record_probe(
        self,
        model_id: str,
        *,
        results: dict[str, object],
        verified_capabilities: list[str],
        error: str | None,
    ) -> ModelDeploymentView:
        with self.database.transaction() as session:
            row = session.get(ModelDeployment, model_id, with_for_update=True)
            if row is None:
                raise NotFoundError("Model deployment not found")
            probe = ProbeRun(
                model_deployment_id=model_id,
                status="failed" if error else "succeeded",
                requested_capabilities=list(row.declared_capabilities),
                results=results,
                error=error,
            )
            session.add(probe)
            row.verified_capabilities = sorted(set(verified_capabilities))
            row.lifecycle = "verified" if verified_capabilities and not error else "quarantined"
            for capability in row.declared_capabilities:
                session.add(
                    CapabilityObservation(
                        model_deployment_id=row.id,
                        capability=capability,
                        supported=capability in verified_capabilities,
                        source_type="capability_probe",
                        source_ref=probe.id,
                        confidence=1.0,
                    )
                )
            return self._model(row)

    def enable_model(self, model_id: str) -> ModelDeploymentView:
        with self.database.transaction() as session:
            row = session.get(ModelDeployment, model_id, with_for_update=True)
            if row is None:
                raise NotFoundError("Model deployment not found")
            if row.lifecycle != "verified":
                raise ConflictError(
                    "Only a verified model can be enabled",
                    details={"lifecycle": row.lifecycle},
                )
            row.lifecycle = "enabled"
            return self._model(row)

    def create_route(
        self,
        *,
        role: str,
        deployment_ids: list[str],
        required_capabilities: list[str],
    ) -> ModelRouteView:
        if not deployment_ids:
            raise ValidationError("A model route needs at least one deployment")
        with self.database.transaction() as session:
            deployments = [
                session.get(ModelDeployment, identifier) for identifier in deployment_ids
            ]
            if any(deployment is None for deployment in deployments):
                raise ValidationError("A model route references an unknown deployment")
            for deployment in deployments:
                assert deployment is not None
                if deployment.lifecycle != "enabled":
                    raise ConflictError(
                        "Model routes may only reference enabled deployments",
                        details={
                            "deployment_id": deployment.id,
                            "lifecycle": deployment.lifecycle,
                        },
                    )
                missing = set(required_capabilities) - set(deployment.verified_capabilities)
                if missing:
                    raise ConflictError(
                        "A route deployment lacks required verified capabilities",
                        details={
                            "deployment_id": deployment.id,
                            "missing": sorted(missing),
                        },
                    )
            revision = (
                session.scalar(select(func.max(ModelRoute.revision)).where(ModelRoute.role == role))
                or 0
            ) + 1
            row = ModelRoute(
                role=role,
                revision=revision,
                status="draft",
                deployment_ids=list(dict.fromkeys(deployment_ids)),
                required_capabilities=sorted(set(required_capabilities)),
            )
            session.add(row)
            session.flush()
            return self._route(row)

    def activate_route(self, route_id: str) -> ModelRouteView:
        with self.database.transaction() as session:
            row = session.get(ModelRoute, route_id, with_for_update=True)
            if row is None:
                raise NotFoundError("Model route not found")
            deployments = [
                session.get(ModelDeployment, identifier) for identifier in row.deployment_ids
            ]
            if any(
                deployment is None or deployment.lifecycle != "enabled"
                for deployment in deployments
            ):
                raise ConflictError("Every route deployment must remain enabled at activation")
            for active in session.scalars(
                select(ModelRoute).where(ModelRoute.role == row.role, ModelRoute.status == "active")
            ):
                active.status = "retired"
            row.status = "active"
            return self._route(row)

    def list_routes(self) -> list[ModelRouteView]:
        with self.database.transaction() as session:
            rows = session.scalars(
                select(ModelRoute).order_by(ModelRoute.role, ModelRoute.revision.desc())
            )
            return [self._route(row) for row in rows]

    @staticmethod
    def _provider(row: ProviderConnection) -> ProviderView:
        return ProviderView(
            id=row.id,
            name=row.name,
            protocol_family=row.protocol_family,
            endpoint=row.endpoint,
            secret_ref=row.secret_ref,
            enabled=row.enabled,
            health_status=row.health_status,
        )

    @staticmethod
    def _model(row: ModelDeployment) -> ModelDeploymentView:
        return ModelDeploymentView(
            id=row.id,
            provider_connection_id=row.provider_connection_id,
            protocol_family=row.protocol_family,
            upstream_model_id=row.upstream_model_id,
            lifecycle=row.lifecycle,
            declared_capabilities=tuple(row.declared_capabilities),
            verified_capabilities=tuple(row.verified_capabilities),
            observation=row.observation,
        )

    @staticmethod
    def _route(row: ModelRoute) -> ModelRouteView:
        return ModelRouteView(
            id=row.id,
            role=row.role,
            revision=row.revision,
            status=row.status,
            deployment_ids=tuple(row.deployment_ids),
            required_capabilities=tuple(row.required_capabilities),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
