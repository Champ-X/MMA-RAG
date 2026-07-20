from __future__ import annotations

import re
import time

from sqlalchemy import or_, select

from nexus.infrastructure.postgres.database import Database
from nexus.infrastructure.postgres.models import EvidenceRevision, SourceSpaceLink
from nexus.modules.retrieval.domain import (
    ChannelCandidate,
    ChannelQuery,
    ChannelResult,
)
from nexus.shared.domain.enums import EvidenceStatus


def _terms(value: str) -> set[str]:
    lowered = value.casefold()
    tokens = set(re.findall(r"[a-z0-9_./:+-]+|[\u4e00-\u9fff]+", lowered))
    for token in tuple(tokens):
        if re.fullmatch(r"[\u4e00-\u9fff]+", token) and len(token) > 2:
            tokens.update(token[index : index + 2] for index in range(len(token) - 1))
    return {token for token in tokens if token}


class PostgresExactChannel:
    """Exact/identifier/numeric channel; PostgreSQL uses FTS/trigram indexes in production."""

    name = "exact"

    def __init__(self, database: Database) -> None:
        self.database = database

    def search(self, request: ChannelQuery) -> ChannelResult:
        started = time.perf_counter()
        query_text = request.query.casefold().strip()
        query_terms = _terms(query_text)
        with self.database.transaction() as session:
            statement = select(EvidenceRevision).where(
                EvidenceRevision.status == EvidenceStatus.PUBLISHED.value
            )
            # Frozen Run scopes always carry resolved Source IDs. Prefer that
            # immutable membership over today's Space links so a later unlink
            # cannot erase or silently expand an older Run snapshot.
            if request.scope.source_ids:
                statement = statement.where(
                    EvidenceRevision.source_id.in_(request.scope.source_ids)
                )
            elif request.scope.space_ids:
                statement = statement.join(
                    SourceSpaceLink, SourceSpaceLink.source_id == EvidenceRevision.source_id
                ).where(
                    SourceSpaceLink.space_id.in_(request.scope.space_ids),
                    SourceSpaceLink.valid_to_sequence.is_(None),
                )
            if request.modalities:
                statement = statement.where(
                    EvidenceRevision.modality.in_(item.value for item in request.modalities)
                )
            if request.scope.publish_watermark is not None:
                watermark = request.scope.publish_watermark
                statement = statement.where(
                    EvidenceRevision.visible_from_sequence <= watermark,
                    or_(
                        EvidenceRevision.visible_until_sequence.is_(None),
                        EvidenceRevision.visible_until_sequence > watermark,
                    ),
                )
            # Portable prefilter; PostgreSQL deployments additionally create FTS/trigram indexes.
            prefilter_terms = sorted(query_terms, key=len, reverse=True)[:8]
            if prefilter_terms:
                statement = statement.where(
                    or_(
                        *[
                            EvidenceRevision.searchable_text.ilike(f"%{term}%")
                            for term in prefilter_terms
                        ]
                    )
                )
            statement = statement.limit(max(request.limit * 20, 200))
            rows = list(session.scalars(statement))
        scored: list[tuple[float, str, str]] = []
        for row in rows:
            text = row.searchable_text.casefold()
            text_terms = _terms(text)
            overlap = query_terms & text_terms
            if not overlap and query_text not in text:
                continue
            phrase_bonus = 4.0 if query_text and query_text in text else 0.0
            numeric_bonus = sum(2.0 for term in overlap if any(char.isdigit() for char in term))
            identifier_bonus = sum(1.0 for term in overlap if "_" in term or "/" in term)
            score = (
                phrase_bonus
                + numeric_bonus
                + identifier_bonus
                + len(overlap) / max(len(query_terms), 1)
            )
            scored.append((score, row.id, ", ".join(sorted(overlap)[:8])))
        scored.sort(key=lambda item: (-item[0], item[1]))
        candidates = tuple(
            ChannelCandidate(
                evidence_revision_id=identifier,
                rank=index + 1,
                score=score,
                reason=f"exact terms: {reason}" if reason else "exact phrase",
            )
            for index, (score, identifier, reason) in enumerate(scored[: request.limit])
        )
        return ChannelResult(
            channel=self.name,
            status="completed",
            candidates=candidates,
            latency_ms=(time.perf_counter() - started) * 1000,
            model="postgres-exact-fts-v1",
        )
