from __future__ import annotations

import hashlib
import json
import math
import re
import time
from collections import Counter
from typing import Any

from qdrant_client import QdrantClient, models
from sqlalchemy import exists, func, select

from nexus.infrastructure.postgres.database import Database
from nexus.infrastructure.postgres.models import (
    CapabilityReadiness,
    EvidenceAsset,
    EvidenceLocator,
    EvidenceRevision,
    IndexGeneration,
    IndexRelease,
    ProjectionItem,
    SourceSpaceLink,
    SourceVersion,
)
from nexus.modules.retrieval.domain import ChannelCandidate, ChannelQuery, ChannelResult
from nexus.shared.domain.enums import EvidenceStatus, ProjectionStatus
from nexus.shared.domain.errors import CapabilityUnavailableError
from nexus.shared.domain.ids import new_id

FALLBACK_DENSE_DIMENSION = 256
SPARSE_DIMENSION = 1 << 20
INDEX_SCHEMA_REVISION = "quality-multimodal-v2"

FAMILY_SCHEMAS: dict[str, dict[str, str]] = {
    "text_evidence": {"dense": "dense", "sparse": "sparse"},
    "image_evidence": {
        "visual": "dense",
        "caption_dense": "dense",
        "caption_sparse": "sparse",
    },
    "audio_evidence": {
        "text_dense": "dense",
        "text_sparse": "sparse",
        "acoustic": "dense",
    },
    "video_evidence": {
        "scene_dense": "dense",
        "frame_visual": "dense",
        "text_sparse": "sparse",
    },
}

MODALITY_FAMILY = {
    "text": "text_evidence",
    "table": "text_evidence",
    "image": "image_evidence",
    "audio": "audio_evidence",
    "video": "video_evidence",
}


def _tokens(value: str) -> list[str]:
    lowered = value.casefold()
    result = re.findall(r"[a-z0-9_./:+-]+|[\u4e00-\u9fff]", lowered)
    result.extend(
        lowered[index : index + 2]
        for index in range(max(0, len(lowered) - 1))
        if re.fullmatch(r"[\u4e00-\u9fff]{2}", lowered[index : index + 2])
    )
    return result


def deterministic_dense(
    value: str, dimension: int = FALLBACK_DENSE_DIMENSION
) -> list[float]:
    vector = [0.0] * dimension
    for token in _tokens(value):
        digest = hashlib.blake2b(token.encode(), digest_size=16).digest()
        index = int.from_bytes(digest[:8], "big") % dimension
        sign = 1.0 if digest[8] & 1 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(item * item for item in vector)) or 1.0
    return [item / norm for item in vector]


def deterministic_sparse(value: str) -> models.SparseVector:
    counts: Counter[int] = Counter()
    for token in _tokens(value):
        index = int.from_bytes(hashlib.blake2b(token.encode(), digest_size=8).digest(), "big")
        counts[index % SPARSE_DIMENSION] += 1
    indices = sorted(counts)
    return models.SparseVector(
        indices=indices,
        values=[1.0 + math.log(counts[index]) for index in indices],
    )


class QdrantEvidenceIndex:
    """Rebuildable Qdrant projection with PostgreSQL-controlled generations/releases."""

    def __init__(
        self,
        *,
        database: Database,
        client: QdrantClient,
        blob_store: object | None = None,
        dense_encoder: object | None = None,
        sparse_encoder: object | None = None,
        feature_encoder: object | None = None,
    ) -> None:
        self.database = database
        self.client = client
        self.blob_store = blob_store
        self.dense_encoder = dense_encoder
        self.sparse_encoder = sparse_encoder
        self.feature_encoder = feature_encoder
        manifest = {
            "schema": INDEX_SCHEMA_REVISION,
            "dense": (
                self.dense_encoder.manifest()  # type: ignore[attr-defined]
                if self.dense_encoder is not None and hasattr(self.dense_encoder, "manifest")
                else self.dense_encoder_name
            ),
            "dense_dimension": self.dense_dimension,
            "sparse": (
                self.sparse_encoder.manifest()  # type: ignore[attr-defined]
                if self.sparse_encoder is not None and hasattr(self.sparse_encoder, "manifest")
                else self.sparse_encoder_name
            ),
            "features": (
                self.feature_encoder.manifest()  # type: ignore[attr-defined]
                if self.feature_encoder is not None and hasattr(self.feature_encoder, "manifest")
                else self.feature_encoder_name
            ),
            "visual_dimension": self.visual_dimension,
            "acoustic_dimension": self.acoustic_dimension,
        }
        digest = hashlib.sha256(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()[:12]
        self.encoder_revision = f"{INDEX_SCHEMA_REVISION}-{digest}"

    @property
    def dense_encoder_name(self) -> str:
        return str(getattr(self.dense_encoder, "name", "deterministic-hash-v1"))

    @property
    def dense_dimension(self) -> int:
        return int(getattr(self.dense_encoder, "dimension", FALLBACK_DENSE_DIMENSION))

    @property
    def sparse_encoder_name(self) -> str:
        return str(getattr(self.sparse_encoder, "name", "deterministic-hash-v1"))

    @property
    def feature_encoder_name(self) -> str:
        return str(getattr(self.feature_encoder, "name", "not-configured"))

    @property
    def visual_dimension(self) -> int:
        return int(getattr(self.feature_encoder, "visual_dimension", 768))

    @property
    def acoustic_dimension(self) -> int:
        return int(getattr(self.feature_encoder, "acoustic_dimension", 512))

    def _vector_schema(self, family: str) -> dict[str, dict[str, int | str | None]]:
        dimensions = {
            "dense": self.dense_dimension,
            "visual": self.visual_dimension,
            "acoustic": self.acoustic_dimension,
            "frame_visual": self.visual_dimension,
            "caption_dense": self.dense_dimension,
            "text_dense": self.dense_dimension,
            "scene_dense": self.dense_dimension,
        }
        return {
            name: {"kind": kind, "dimension": dimensions.get(name) if kind == "dense" else None}
            for name, kind in FAMILY_SCHEMAS[family].items()
        }

    def _native_roles(self, family: str) -> list[str]:
        if self.feature_encoder is None:
            return []
        return {
            "text_evidence": [],
            "image_evidence": ["visual"],
            "audio_evidence": ["acoustic"],
            "video_evidence": ["frame_visual"],
        }[family]

    def ensure_release(self, *, force: bool = False) -> dict[str, object]:
        with self.database.transaction() as session:
            active = session.scalar(
                select(IndexRelease)
                .where(IndexRelease.status == "active")
                .order_by(IndexRelease.release_no.desc())
            )
            candidate = session.scalar(
                select(IndexRelease)
                .where(IndexRelease.status.in_(["building", "validated", "activating"]))
                .order_by(IndexRelease.release_no.desc())
            )
            if candidate:
                candidate_generations = [
                    session.get(IndexGeneration, generation_id)
                    for generation_id in candidate.generation_map.values()
                ]
                if all(
                    generation
                    and generation.encoder_manifest.get("projection_encoder_revision")
                    == self.encoder_revision
                    for generation in candidate_generations
                ):
                    return {
                        "release_id": candidate.id,
                        "release_no": candidate.release_no,
                        "status": candidate.status,
                        "generation_map": candidate.generation_map,
                    }
            if active:
                active_generations = [
                    session.get(IndexGeneration, generation_id)
                    for generation_id in active.generation_map.values()
                ]
                if not force and all(
                    generation
                    and generation.encoder_manifest.get("projection_encoder_revision")
                    == self.encoder_revision
                    for generation in active_generations
                ):
                    return {
                        "release_id": active.id,
                        "release_no": active.release_no,
                        "status": active.status,
                        "generation_map": active.generation_map,
                    }
            generation_map: dict[str, str] = {}
            generation_rows: list[IndexGeneration] = []
            for family in FAMILY_SCHEMAS:
                epoch = (
                    session.scalar(
                        select(func.max(IndexGeneration.epoch)).where(
                            IndexGeneration.family == family
                        )
                    )
                    or 0
                ) + 1
                physical_name = (
                    f"{family}__{self.encoder_revision}__g{epoch}"
                )
                row = IndexGeneration(
                    family=family,
                    epoch=epoch,
                    physical_name=physical_name,
                    status="building",
                    vector_schema=self._vector_schema(family),
                    encoder_manifest={
                        "dense_encoder": self.dense_encoder_name,
                        "dense_asset": (
                            self.dense_encoder.manifest()  # type: ignore[attr-defined]
                            if self.dense_encoder is not None
                            and hasattr(self.dense_encoder, "manifest")
                            else {"type": "deterministic_hash", "dimension": self.dense_dimension}
                        ),
                        "sparse_encoder": self.sparse_encoder_name,
                        "sparse_asset": (
                            self.sparse_encoder.manifest()  # type: ignore[attr-defined]
                            if self.sparse_encoder is not None
                            and hasattr(self.sparse_encoder, "manifest")
                            else {"type": "deterministic_hash"}
                        ),
                        "feature_asset": (
                            self.feature_encoder.manifest()  # type: ignore[attr-defined]
                            if self.feature_encoder is not None
                            and hasattr(self.feature_encoder, "manifest")
                            else {"type": "not_configured"}
                        ),
                        "projection_encoder_revision": self.encoder_revision,
                        "native_roles": self._native_roles(family),
                        "proxy_only": not bool(self._native_roles(family)),
                        "rebuildable": True,
                    },
                )
                session.add(row)
                session.flush()
                generation_map[family] = row.id
                generation_rows.append(row)
            release_no = (session.scalar(select(func.max(IndexRelease.release_no))) or 0) + 1
            release = IndexRelease(
                release_no=release_no,
                status="building",
                generation_map=generation_map,
                validation_report={},
            )
            session.add(release)
            session.flush()
            release_id = release.id

        created: list[str] = []
        for row in generation_rows:
            self._ensure_collection(row)
            created.append(row.physical_name)
        with self.database.transaction() as session:
            release = session.get(IndexRelease, release_id, with_for_update=True)
            if release is None:
                raise RuntimeError("Index release disappeared during collection creation")
            release.validation_report = {
                "collections": created,
                "dense_encoder": self.dense_encoder_name,
                "sparse_encoder": self.sparse_encoder_name,
                "feature_encoder": self.feature_encoder_name,
                "native_multimodal": self.feature_encoder is not None,
                "projection_encoder_revision": self.encoder_revision,
                "state": "awaiting_projection",
            }
            return {
                "release_id": release.id,
                "release_no": release.release_no,
                "status": release.status,
                "generation_map": release.generation_map,
            }

    def _ensure_collection(self, generation: IndexGeneration) -> None:
        if not self.client.collection_exists(generation.physical_name):
            schema = generation.vector_schema
            vectors_config = {
                name: models.VectorParams(
                    size=int(spec["dimension"]), distance=models.Distance.COSINE
                )
                for name, spec in schema.items()
                if spec["kind"] == "dense"
            }
            sparse_config = {
                name: models.SparseVectorParams()
                for name, spec in schema.items()
                if spec["kind"] == "sparse"
            }
            self.client.create_collection(
                collection_name=generation.physical_name,
                vectors_config=vectors_config,
                sparse_vectors_config=sparse_config,
            )
        # Aliases are switched only after the complete release is projected and
        # validated. Search resolves the active physical generation from PG, so
        # a building collection can never receive traffic early.

    def project_pending(
        self, *, limit: int = 1000, force_rebuild: bool = False
    ) -> dict[str, object]:
        release_info = self.ensure_release(force=force_rebuild)
        generation_map = release_info["generation_map"]
        assert isinstance(generation_map, dict)
        projected = 0
        failures: list[dict[str, str]] = []
        degradations: list[dict[str, str]] = []
        with self.database.transaction() as session:
            generation_rows = {
                family: session.get(IndexGeneration, generation_id)
                for family, generation_id in generation_map.items()
            }
            evidence_rows: list[EvidenceRevision] = []
            remaining = limit
            for family, generation in generation_rows.items():
                if generation is None or remaining <= 0:
                    continue
                modalities = [
                    modality
                    for modality, modality_family in MODALITY_FAMILY.items()
                    if modality_family == family
                ]
                already_projected = exists(
                    select(ProjectionItem.id).where(
                        ProjectionItem.evidence_revision_id == EvidenceRevision.id,
                        ProjectionItem.index_generation_id == generation.id,
                        ProjectionItem.status == ProjectionStatus.ACTIVE.value,
                    )
                )
                rows = list(
                    session.scalars(
                        select(EvidenceRevision)
                        .where(
                            EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                            EvidenceRevision.modality.in_(modalities),
                            ~already_projected,
                        )
                        .order_by(EvidenceRevision.id)
                        .limit(remaining)
                    )
                )
                evidence_rows.extend(rows)
                remaining -= len(rows)
            link_rows = list(
                session.execute(
                    select(SourceSpaceLink.source_id, SourceSpaceLink.space_id).where(
                        SourceSpaceLink.valid_to_sequence.is_(None)
                    )
                )
            )
            spaces_by_source: dict[str, list[str]] = {}
            for source_id, space_id in link_rows:
                spaces_by_source.setdefault(source_id, []).append(space_id)
            media_refs = {
                evidence.id: self._media_ref(session, evidence)
                for evidence in evidence_rows
                if evidence.modality in {"image", "audio", "video"}
            }

        for evidence in evidence_rows:
            family = MODALITY_FAMILY[evidence.modality]
            generation = generation_rows.get(family)
            if generation is None:
                continue
            point_id = new_id()
            try:
                vectors, roles, vector_degradations = self._vectors_for(
                    evidence, media_refs.get(evidence.id)
                )
                degradations.extend(
                    {"evidence_revision_id": evidence.id, "reason": reason}
                    for reason in vector_degradations
                )
                native_roles = {"visual", "acoustic", "frame_visual"}.intersection(roles)
                payload = {
                    "evidence_revision_id": evidence.id,
                    "source_version_id": evidence.source_version_id,
                    "source_id": evidence.source_id,
                    "space_ids": spaces_by_source.get(evidence.source_id, []),
                    "visible_from_sequence": evidence.visible_from_sequence,
                    "visible_until_sequence": evidence.visible_until_sequence,
                    "modality": evidence.modality,
                    "status": evidence.status,
                    "visibility": "active",
                    "proxy_only": not bool(native_roles),
                    "native_roles": sorted(native_roles),
                }
                self.client.upsert(
                    collection_name=generation.physical_name,
                    points=[models.PointStruct(id=point_id, vector=vectors, payload=payload)],
                    wait=True,
                )
                with self.database.transaction() as session:
                    for role in roles:
                        session.add(
                            ProjectionItem(
                                evidence_revision_id=evidence.id,
                                index_generation_id=generation.id,
                                vector_role=role,
                                status=ProjectionStatus.ACTIVE.value,
                                point_id=point_id,
                                input_hash=evidence.content_hash,
                            )
                        )
                projected += 1
            except Exception as exc:
                failures.append(
                    {"evidence_revision_id": evidence.id, "error_type": type(exc).__name__}
                )
        removed_inactive = self.remove_inactive()
        release_status, validation_report = self._validate_and_activate(
            str(release_info["release_id"]), failures=failures
        )
        if release_status == "active":
            self._resolve_projection_capabilities(str(release_info["release_id"]))
        return {
            "release_id": release_info["release_id"],
            "release_status": release_status,
            "projected": projected,
            "failures": failures,
            "degradations": degradations,
            "removed_inactive": removed_inactive,
            "validation": validation_report,
        }

    def _validate_and_activate(
        self, release_id: str, *, failures: list[dict[str, str]]
    ) -> tuple[str, dict[str, object]]:
        with self.database.transaction() as session:
            release = session.get(IndexRelease, release_id, with_for_update=True)
            if release is None:
                raise RuntimeError("Index release disappeared during validation")
            if release.status == "active":
                return release.status, release.validation_report
            generation_rows = {
                family: session.get(IndexGeneration, generation_id)
                for family, generation_id in release.generation_map.items()
            }
            family_counts: dict[str, dict[str, object]] = {}
            complete = not failures
            for family, generation in generation_rows.items():
                if generation is None:
                    complete = False
                    family_counts[family] = {"error": "generation_missing"}
                    continue
                modalities = [
                    modality
                    for modality, modality_family in MODALITY_FAMILY.items()
                    if modality_family == family
                ]
                expected = int(
                    session.scalar(
                        select(func.count(EvidenceRevision.id)).where(
                            EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                            EvidenceRevision.modality.in_(modalities),
                        )
                    )
                    or 0
                )
                required_roles = set(FAMILY_SCHEMAS[family])
                if not generation.encoder_manifest.get("native_roles"):
                    required_roles -= {"visual", "acoustic", "frame_visual"}
                role_counts = {
                    role: int(
                        session.scalar(
                            select(func.count(func.distinct(ProjectionItem.evidence_revision_id)))
                            .where(
                                ProjectionItem.index_generation_id == generation.id,
                                ProjectionItem.vector_role == role,
                                ProjectionItem.status == ProjectionStatus.ACTIVE.value,
                            )
                        )
                        or 0
                    )
                    for role in sorted(required_roles)
                }
                family_complete = all(count == expected for count in role_counts.values())
                complete = complete and family_complete
                family_counts[family] = {
                    "expected_evidence": expected,
                    "required_role_counts": role_counts,
                    "complete": family_complete,
                }
            report: dict[str, object] = {
                **release.validation_report,
                "state": "validated" if complete else "awaiting_projection",
                "families": family_counts,
                "failures": failures,
            }
            release.validation_report = report
            if not complete:
                release.status = "building"
                return release.status, report
            release.status = "validated"

        with self.database.transaction() as session:
            release = session.get(IndexRelease, release_id, with_for_update=True)
            if release is None:
                raise RuntimeError("Index release disappeared before activation")
            release.status = "activating"
            generation_rows = {
                family: session.get(IndexGeneration, generation_id)
                for family, generation_id in release.generation_map.items()
            }

        aliases = {
            item.alias_name: item.collection_name
            for item in self.client.get_aliases().aliases
        }
        operations: list[models.AliasOperations] = []
        for family, generation in generation_rows.items():
            if generation is None:
                raise RuntimeError(f"Index generation missing for {family}")
            alias_name = f"{family}_active"
            current = aliases.get(alias_name)
            if current and current != generation.physical_name:
                operations.append(
                    models.DeleteAliasOperation(
                        delete_alias=models.DeleteAlias(alias_name=alias_name)
                    )
                )
            if current != generation.physical_name:
                operations.append(
                    models.CreateAliasOperation(
                        create_alias=models.CreateAlias(
                            collection_name=generation.physical_name,
                            alias_name=alias_name,
                        )
                    )
                )
        if operations:
            self.client.update_collection_aliases(change_aliases_operations=operations)
        actual_aliases = {
            item.alias_name: item.collection_name for item in self.client.get_aliases().aliases
        }
        for family, generation in generation_rows.items():
            assert generation is not None
            if actual_aliases.get(f"{family}_active") != generation.physical_name:
                raise RuntimeError(f"Index alias activation failed for {family}")

        with self.database.transaction() as session:
            release = session.get(IndexRelease, release_id, with_for_update=True)
            if release is None:
                raise RuntimeError("Index release disappeared during activation")
            previous = session.scalar(
                select(IndexRelease)
                .where(IndexRelease.status == "active", IndexRelease.id != release.id)
                .order_by(IndexRelease.release_no.desc())
                .with_for_update()
            )
            if previous:
                previous.status = "superseded"
                for generation_id in previous.generation_map.values():
                    generation = session.get(IndexGeneration, generation_id)
                    if generation:
                        generation.status = "retired"
            for generation_id in release.generation_map.values():
                generation = session.get(IndexGeneration, generation_id)
                if generation:
                    generation.status = "active"
            release.status = "active"
            release.validation_report = {**release.validation_report, "state": "active"}
            return release.status, release.validation_report

    def _resolve_projection_capabilities(self, release_id: str) -> None:
        """Close parser readiness once the release that serves retrieval is active."""

        capability_roles = {
            "text_index": {"dense", "sparse"},
            "image_pipeline": {"visual", "caption_dense", "caption_sparse"},
            "visual_index": {"visual"},
            "acoustic_index": {"acoustic"},
            "frame_visual_index": {"frame_visual"},
        }
        native_capabilities = {"visual_index", "acoustic_index", "frame_visual_index"}
        with self.database.transaction() as session:
            release = session.get(IndexRelease, release_id)
            if release is None or release.status != "active":
                return
            generation_ids = tuple(str(item) for item in release.generation_map.values())
            projected_roles: dict[str, set[str]] = {}
            for source_version_id, vector_role in session.execute(
                select(EvidenceRevision.source_version_id, ProjectionItem.vector_role)
                .join(
                    ProjectionItem,
                    ProjectionItem.evidence_revision_id == EvidenceRevision.id,
                )
                .where(
                    EvidenceRevision.status == EvidenceStatus.PUBLISHED.value,
                    ProjectionItem.index_generation_id.in_(generation_ids),
                    ProjectionItem.status == ProjectionStatus.ACTIVE.value,
                )
                .distinct()
            ):
                projected_roles.setdefault(str(source_version_id), set()).add(str(vector_role))

            pending = list(
                session.scalars(
                    select(CapabilityReadiness).where(
                        CapabilityReadiness.status == "pending",
                        CapabilityReadiness.capability.in_(tuple(capability_roles)),
                    )
                )
            )
            for capability in pending:
                roles = projected_roles.get(capability.source_version_id, set())
                expected_roles = capability_roles[capability.capability]
                if roles.intersection(expected_roles):
                    capability.status = "ready"
                    reason = "active_projection"
                elif capability.capability in native_capabilities and self.feature_encoder is None:
                    capability.status = "not_configured"
                    reason = "native_feature_encoder_not_configured"
                else:
                    capability.status = "failed"
                    reason = "required_projection_role_missing"
                capability.detail = {
                    **(capability.detail or {}),
                    "projection_release_id": release_id,
                    "projected_roles": sorted(roles),
                    "resolution": reason,
                }

    def _dense_vector(self, value: str) -> list[float]:
        if self.dense_encoder is None:
            return deterministic_dense(value)
        return self.dense_encoder.encode_query(value)  # type: ignore[attr-defined]

    def _sparse_vector(self, value: str, *, document: bool = False) -> models.SparseVector:
        if self.sparse_encoder is None:
            return deterministic_sparse(value)
        if document and hasattr(self.sparse_encoder, "encode_documents"):
            weights = self.sparse_encoder.encode_documents([value])[0]  # type: ignore[attr-defined]
        else:
            weights = self.sparse_encoder.encode_query(value)  # type: ignore[attr-defined]
        indices = sorted(weights)
        return models.SparseVector(indices=indices, values=[weights[index] for index in indices])

    def _vectors_for(
        self,
        evidence: EvidenceRevision,
        media_ref: tuple[str, int | None, int | None] | None,
    ) -> tuple[dict[str, Any], list[str], list[str]]:
        dense = self._dense_vector(evidence.searchable_text)
        degradations: list[str] = []
        sparse: models.SparseVector | None = None
        try:
            sparse = self._sparse_vector(evidence.searchable_text, document=True)
        except Exception as exc:
            degradations.append(f"sparse_unavailable:{type(exc).__name__}")
        if evidence.modality in {"text", "table"}:
            vectors: dict[str, Any] = {"dense": dense}
            roles = ["dense"]
            if sparse is not None:
                vectors["sparse"] = sparse
                roles.append("sparse")
            return vectors, roles, degradations
        if evidence.modality == "image":
            vectors = {"caption_dense": dense}
            roles = ["caption_dense"]
            if sparse is not None:
                vectors["caption_sparse"] = sparse
                roles.append("caption_sparse")
            native_role = "visual"
        if evidence.modality == "audio":
            vectors = {"text_dense": dense, "text_sparse": sparse}
            roles = ["text_dense"]
            if sparse is None:
                vectors.pop("text_sparse")
            else:
                roles.append("text_sparse")
            native_role = "acoustic"
        if evidence.modality == "video":
            vectors = {"scene_dense": dense}
            roles = ["scene_dense"]
            if sparse is not None:
                vectors["text_sparse"] = sparse
                roles.append("text_sparse")
            native_role = "frame_visual"
        if self.feature_encoder is None or self.blob_store is None or media_ref is None:
            degradations.append(f"{native_role}_not_configured")
            return vectors, roles, degradations
        object_key, start_ms, end_ms = media_ref
        try:
            content = self.blob_store.get(object_key)  # type: ignore[attr-defined]
            if native_role == "acoustic":
                vector = self.feature_encoder.encode_audio(  # type: ignore[attr-defined]
                    content, start_ms=start_ms, end_ms=end_ms
                )
            elif native_role == "frame_visual":
                timestamp_ms = int(((start_ms or 0) + (end_ms or start_ms or 0)) / 2)
                vector = self.feature_encoder.encode_video_frame(  # type: ignore[attr-defined]
                    content, timestamp_ms=timestamp_ms
                )
            else:
                vector = self.feature_encoder.encode_image(content)  # type: ignore[attr-defined]
            vectors[native_role] = vector
            roles.append(native_role)
        except Exception as exc:
            degradations.append(f"{native_role}_failed:{type(exc).__name__}")
        return vectors, roles, degradations

    @staticmethod
    def _media_ref(
        session: Any, evidence: EvidenceRevision
    ) -> tuple[str, int | None, int | None] | None:
        asset = session.scalar(
            select(EvidenceAsset)
            .where(EvidenceAsset.evidence_revision_id == evidence.id)
            .order_by(EvidenceAsset.role)
        )
        version = session.get(SourceVersion, evidence.source_version_id)
        locator = session.scalar(
            select(EvidenceLocator).where(EvidenceLocator.evidence_revision_id == evidence.id)
        )
        object_key = (
            asset.object_key
            if asset is not None
            else (version.object_key if version else None)
        )
        if not object_key:
            return None
        return (
            object_key,
            locator.start_ms if locator is not None else None,
            locator.end_ms if locator is not None else None,
        )

    def remove_source(self, source_id: str) -> int:
        removed = 0
        with self.database.transaction() as session:
            items = list(
                session.execute(
                    select(ProjectionItem, IndexGeneration)
                    .join(
                        EvidenceRevision, EvidenceRevision.id == ProjectionItem.evidence_revision_id
                    )
                    .join(IndexGeneration, IndexGeneration.id == ProjectionItem.index_generation_id)
                    .where(EvidenceRevision.source_id == source_id)
                )
            )
        by_collection: dict[str, list[str]] = {}
        for item, generation in items:
            by_collection.setdefault(generation.physical_name, []).append(item.point_id)
        for collection, point_ids in by_collection.items():
            self.client.delete(
                collection_name=collection,
                points_selector=models.PointIdsList(points=point_ids),
                wait=True,
            )
            removed += len(point_ids)
        with self.database.transaction() as session:
            for item, _ in items:
                persisted = session.get(ProjectionItem, item.id)
                if persisted:
                    persisted.status = ProjectionStatus.DELETED.value
        return removed

    def remove_evidence(self, evidence_revision_ids: list[str]) -> int:
        if not evidence_revision_ids:
            return 0
        return self._remove_projection_items(
            select(ProjectionItem, IndexGeneration)
            .join(IndexGeneration, IndexGeneration.id == ProjectionItem.index_generation_id)
            .where(ProjectionItem.evidence_revision_id.in_(evidence_revision_ids))
        )

    def remove_inactive(self) -> int:
        return self._remove_projection_items(
            select(ProjectionItem, IndexGeneration)
            .join(
                EvidenceRevision,
                EvidenceRevision.id == ProjectionItem.evidence_revision_id,
            )
            .join(IndexGeneration, IndexGeneration.id == ProjectionItem.index_generation_id)
            .where(
                EvidenceRevision.status != EvidenceStatus.PUBLISHED.value,
                ProjectionItem.status == ProjectionStatus.ACTIVE.value,
            )
        )

    def _remove_projection_items(self, statement: Any) -> int:
        with self.database.transaction() as session:
            items = list(session.execute(statement))
        by_collection: dict[str, set[str]] = {}
        for item, generation in items:
            by_collection.setdefault(generation.physical_name, set()).add(item.point_id)
        for collection, point_ids in by_collection.items():
            self.client.delete(
                collection_name=collection,
                points_selector=models.PointIdsList(points=list(point_ids)),
                wait=True,
            )
        with self.database.transaction() as session:
            for item, _ in items:
                persisted = session.get(ProjectionItem, item.id)
                if persisted:
                    persisted.status = ProjectionStatus.DELETED.value
        return sum(len(point_ids) for point_ids in by_collection.values())

    def health(self) -> dict[str, object]:
        try:
            collections = self.client.get_collections().collections
            aliases = self.client.get_aliases().aliases
            with self.database.transaction() as session:
                generations = list(
                    session.scalars(
                        select(IndexGeneration).where(IndexGeneration.status == "active")
                    )
                )
                active_generation_ids = [generation.id for generation in generations]
                role_counts = {
                    str(role): int(count)
                    for role, count in session.execute(
                        select(ProjectionItem.vector_role, func.count(ProjectionItem.id))
                        .where(
                            ProjectionItem.index_generation_id.in_(active_generation_ids),
                            ProjectionItem.status == ProjectionStatus.ACTIVE.value,
                        )
                        .group_by(ProjectionItem.vector_role)
                    )
                }
            active_native_roles = {
                generation.family: generation.encoder_manifest.get("native_roles", [])
                for generation in generations
            }
            native_multimodal = all(
                role in active_native_roles.get(family, []) and role_counts.get(role, 0) > 0
                for family, role in (
                    ("image_evidence", "visual"),
                    ("audio_evidence", "acoustic"),
                    ("video_evidence", "frame_visual"),
                )
            )
            return {
                "status": "ready",
                "collections": [item.name for item in collections],
                "aliases": {item.alias_name: item.collection_name for item in aliases},
                "sparse_encoder": self.sparse_encoder_name,
                "dense_encoder": self.dense_encoder_name,
                "feature_encoder": self.feature_encoder_name,
                "native_multimodal": native_multimodal,
                "native_roles": active_native_roles,
                "projection_role_counts": role_counts,
                "projection_encoder_revision": self.encoder_revision,
                "dense_health": (
                    self.dense_encoder.health()  # type: ignore[attr-defined]
                    if self.dense_encoder is not None and hasattr(self.dense_encoder, "health")
                    else {"status": "degraded", "model": "deterministic-hash-v1"}
                ),
                "sparse_health": (
                    self.sparse_encoder.health()  # type: ignore[attr-defined]
                    if self.sparse_encoder is not None and hasattr(self.sparse_encoder, "health")
                    else {"status": "degraded", "model": "deterministic-hash-v1"}
                ),
                "feature_health": (
                    self.feature_encoder.health()  # type: ignore[attr-defined]
                    if self.feature_encoder is not None and hasattr(self.feature_encoder, "health")
                    else {"status": "not_configured"}
                ),
            }
        except Exception as exc:
            return {"status": "unavailable", "error": f"{type(exc).__name__}: {exc}"}


class QdrantFamilyChannel:
    def __init__(
        self,
        *,
        name: str,
        database: Database,
        client: QdrantClient,
        family: str,
        vector_name: str,
        vector_kind: str,
        native_modality: bool,
        dense_encoder: object | None = None,
        sparse_encoder: object | None = None,
        feature_encoder: object | None = None,
    ) -> None:
        self.name = name
        self.database = database
        self.client = client
        self.family = family
        self.vector_name = vector_name
        self.vector_kind = vector_kind
        self.native_modality = native_modality
        self.dense_encoder = dense_encoder
        self.sparse_encoder = sparse_encoder
        self.feature_encoder = feature_encoder

    def search(self, request: ChannelQuery) -> ChannelResult:
        started = time.perf_counter()
        with self.database.transaction() as session:
            generation = session.scalar(
                select(IndexGeneration)
                .where(
                    IndexGeneration.family == self.family,
                    IndexGeneration.status == "active",
                )
                .order_by(IndexGeneration.epoch.desc())
            )
        if generation is None:
            return ChannelResult(
                channel=self.name,
                status="unavailable",
                error="no_active_generation",
                latency_ms=(time.perf_counter() - started) * 1000,
                native_modality=self.native_modality,
            )
        must: list[models.Condition] = [
            models.FieldCondition(key="visibility", match=models.MatchValue(value="active"))
        ]
        if request.scope.source_ids:
            must.append(
                models.FieldCondition(
                    key="source_id", match=models.MatchAny(any=list(request.scope.source_ids))
                )
            )
        elif request.scope.space_ids:
            must.append(
                models.FieldCondition(
                    key="space_ids", match=models.MatchAny(any=list(request.scope.space_ids))
                )
            )
        try:
            query_vector, encoder_name = self._encode_query_with_retry(request.query)
        except Exception as exc:
            return ChannelResult(
                channel=self.name,
                status="failed",
                error=f"query_encoder_unavailable:{type(exc).__name__}",
                latency_ms=(time.perf_counter() - started) * 1000,
                model=self._encoder_name(),
                generation=generation.id,
                native_modality=self.native_modality,
            )
        response = self.client.query_points(
            collection_name=generation.physical_name,
            query=query_vector,
            using=self.vector_name,
            query_filter=models.Filter(must=must),
            limit=request.limit,
            with_payload=True,
        )
        candidates = tuple(
            ChannelCandidate(
                evidence_revision_id=str(point.payload["evidence_revision_id"]),
                rank=index + 1,
                score=float(point.score),
                reason=f"{self.family}:{self.vector_name}",
            )
            for index, point in enumerate(response.points)
            if point.payload and point.payload.get("evidence_revision_id")
        )
        return ChannelResult(
            channel=self.name,
            status="completed",
            candidates=candidates,
            latency_ms=(time.perf_counter() - started) * 1000,
            model=encoder_name,
            generation=generation.id,
            native_modality=self.native_modality,
        )

    def _encode_query_with_retry(self, query: str) -> tuple[Any, str]:
        """Retry one transient lazy-load failure before declaring a channel degraded.

        Standard runs API and index projection in separate processes against one
        read-through model cache. A first request can overlap another process's
        asset/model initialization. Persistent failures remain explicit after the
        single bounded retry.
        """

        try:
            return self._encode_query(query)
        except CapabilityUnavailableError:
            time.sleep(0.25)
            return self._encode_query(query)

    def _encode_query(self, query: str) -> tuple[Any, str]:
        if self.vector_kind == "sparse":
            if self.sparse_encoder is None:
                return deterministic_sparse(query), "deterministic-hash-v1"
            weights = self.sparse_encoder.encode_query(query)  # type: ignore[attr-defined]
            indices = sorted(weights)
            return (
                models.SparseVector(
                    indices=indices,
                    values=[weights[index] for index in indices],
                ),
                str(getattr(self.sparse_encoder, "name", "sparse-encoder")),
            )
        if self.vector_kind == "visual":
            if self.feature_encoder is None:
                raise RuntimeError("CLIP is not configured")
            return (
                self.feature_encoder.encode_visual_query(query),  # type: ignore[attr-defined]
                str(getattr(self.feature_encoder, "name", "clip")),
            )
        if self.vector_kind == "acoustic":
            if self.feature_encoder is None:
                raise RuntimeError("CLAP is not configured")
            return (
                self.feature_encoder.encode_acoustic_query(query),  # type: ignore[attr-defined]
                str(getattr(self.feature_encoder, "name", "clap")),
            )
        if self.dense_encoder is None:
            return deterministic_dense(query), "deterministic-hash-v1"
        return (
            self.dense_encoder.encode_query(query),  # type: ignore[attr-defined]
            str(getattr(self.dense_encoder, "name", "dense-encoder")),
        )

    def _encoder_name(self) -> str:
        encoder = (
            self.feature_encoder
            if self.vector_kind in {"visual", "acoustic"}
            else self.sparse_encoder
            if self.vector_kind == "sparse"
            else self.dense_encoder
        )
        return str(getattr(encoder, "name", "not-configured"))
