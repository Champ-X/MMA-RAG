from __future__ import annotations

import re

from nexus.modules.spaces.domain import CollectionView, SpaceView
from nexus.modules.spaces.policy import policy_for, recommend_space_usage
from nexus.modules.spaces.ports import SpaceRepositoryPort
from nexus.shared.domain.enums import KnowledgeProfile, QualityMode
from nexus.shared.domain.errors import ValidationError


class SpaceService:
    def __init__(self, repository: SpaceRepositoryPort) -> None:
        self.repository = repository

    def create(
        self,
        *,
        name: str,
        slug: str | None = None,
        description: str = "",
        knowledge_profile: KnowledgeProfile = KnowledgeProfile.SEARCHABLE,
        default_quality: QualityMode | None = None,
        idempotency_key: str | None = None,
    ) -> SpaceView:
        clean_name = name.strip()
        if not clean_name:
            raise ValidationError("Space name must not be empty")
        clean_slug = self._slugify(slug or clean_name)
        resolved_quality = default_quality or policy_for(knowledge_profile).default_quality
        return self.repository.create_space(
            name=clean_name,
            slug=clean_slug,
            description=description.strip(),
            knowledge_profile=knowledge_profile,
            default_quality=resolved_quality,
            idempotency_key=idempotency_key,
        )

    def list(
        self, *, cursor: str | None = None, limit: int = 50
    ) -> tuple[list[SpaceView], str | None]:
        return self.repository.list_spaces(cursor=cursor, limit=max(1, min(limit, 200)))

    def get(self, space_id: str) -> SpaceView:
        return self.repository.get_space(space_id)

    def archive(self, space_id: str) -> SpaceView:
        """Archive a scope while leaving globally-addressed Sources intact."""
        return self.repository.archive_space(space_id)

    def usage_recommendation(self, space_ids: tuple[str, ...]) -> dict[str, object]:
        spaces = [self.repository.get_space(space_id) for space_id in dict.fromkeys(space_ids)]
        return recommend_space_usage(spaces)

    def create_collection(
        self,
        *,
        space_id: str,
        name: str,
        description: str = "",
        color: str = "cobalt",
        view_kind: str = "manual",
        rule_logic: str = "all",
        source_ids: tuple[str, ...] = (),
        rules: tuple[dict[str, object], ...] = (),
    ) -> CollectionView:
        clean_name = name.strip()
        if not clean_name:
            raise ValidationError("Collection name must not be empty")
        self._validate_collection(view_kind=view_kind, rule_logic=rule_logic, rules=rules)
        return self.repository.create_collection(
            space_id=space_id,
            name=clean_name,
            description=description.strip(),
            color=color.strip() or "cobalt",
            view_kind=view_kind,
            rule_logic=rule_logic,
            source_ids=tuple(dict.fromkeys(source_ids)),
            rules=rules,
        )

    def list_collections(self, space_id: str) -> list[CollectionView]:
        return self.repository.list_collections(space_id=space_id)

    def get_collection(self, collection_id: str) -> CollectionView:
        return self.repository.get_collection(collection_id)

    def update_collection(
        self,
        collection_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        color: str | None = None,
        rule_logic: str | None = None,
        source_ids: tuple[str, ...] | None = None,
        rules: tuple[dict[str, object], ...] | None = None,
        expected_revision: int | None = None,
    ) -> CollectionView:
        if name is not None and not name.strip():
            raise ValidationError("Collection name must not be empty")
        if rules is not None or rule_logic is not None:
            current = self.repository.get_collection(collection_id)
            self._validate_collection(
                view_kind=current.view_kind,
                rule_logic=rule_logic or current.rule_logic,
                rules=rules if rules is not None else tuple(
                    {"field": item.field, "operator": item.operator, "value": item.value}
                    for item in current.rules
                ),
            )
        return self.repository.update_collection(
            collection_id,
            name=name.strip() if name is not None else None,
            description=description.strip() if description is not None else None,
            color=color.strip() if color is not None else None,
            rule_logic=rule_logic,
            source_ids=tuple(dict.fromkeys(source_ids)) if source_ids is not None else None,
            rules=rules,
            expected_revision=expected_revision,
        )

    def archive_collection(self, collection_id: str) -> CollectionView:
        return self.repository.archive_collection(collection_id)

    def resolve_collection_source_ids(self, collection_ids: tuple[str, ...]) -> tuple[str, ...]:
        return self.repository.resolve_collection_source_ids(collection_ids)

    @staticmethod
    def _validate_collection(
        *, view_kind: str, rule_logic: str, rules: tuple[dict[str, object], ...]
    ) -> None:
        if view_kind not in {"manual", "dynamic"}:
            raise ValidationError("Collection view_kind must be manual or dynamic")
        if rule_logic not in {"all", "any"}:
            raise ValidationError("Collection rule_logic must be all or any")
        allowed_fields = {"display_name", "modality", "mime_type", "connector_kind", "status"}
        allowed_operators = {"equals", "contains", "in"}
        for rule in rules:
            if str(rule.get("field") or "") not in allowed_fields:
                raise ValidationError("Collection rule field is not supported")
            if str(rule.get("operator") or "") not in allowed_operators:
                raise ValidationError("Collection rule operator is not supported")

    @staticmethod
    def _slugify(value: str) -> str:
        slug = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", value.strip().lower()).strip("-")
        if not slug:
            raise ValidationError("Space slug contains no usable characters")
        return slug[:120]
