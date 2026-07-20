from __future__ import annotations

import hashlib
import re
from pathlib import PurePath

from nexus.modules.evidence.domain import EvidenceView
from nexus.modules.evidence.ports import EvidenceRepositoryPort
from nexus.modules.runs.ports import RunRepositoryPort
from nexus.shared.domain.errors import NotFoundError


def _question_key(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", value.casefold())


def _seed(evidence: EvidenceView) -> str:
    lines = [
        re.sub(r"^[#>*\-\d.\s]+", "", line).strip()
        for line in evidence.text_content.splitlines()
    ]
    readable = next(
        (
            line
            for line in lines
            if 4 <= len(line) <= 72
            and not line.casefold().startswith(("http://", "https://"))
        ),
        "",
    )
    if readable:
        return readable.rstrip("。.!?？")
    filename = PurePath(evidence.source_name).stem.strip()
    return filename[:72] or evidence.modality.value


def _stable_id(run_id: str, reason: str, evidence_ids: tuple[str, ...]) -> str:
    digest = hashlib.sha256(
        f"{run_id}:{reason}:{':'.join(evidence_ids)}".encode()
    ).hexdigest()[:16]
    return f"suggestion-{digest}"


class RunSuggestionService:
    """Derive next questions from a Run's immutable retrieval ledger.

    This deliberately avoids a second generation call: suggestions remain available in
    degraded local installs and can name the exact Evidence that caused each prompt.
    """

    def __init__(
        self,
        *,
        runs: RunRepositoryPort,
        evidence: EvidenceRepositoryPort,
    ) -> None:
        self.runs = runs
        self.evidence = evidence

    def suggest(self, run_id: str, *, limit: int = 3) -> dict[str, object]:
        run = self.runs.get_run(run_id)
        ledger = self.runs.list_ledger_items(run_id)[:48]
        result = run.result or {}
        citations = result.get("citations", [])
        cited_ids = {
            str(item.get("evidence_revision_id"))
            for item in citations
            if isinstance(item, dict) and item.get("evidence_revision_id")
        }
        ordered_ids = list(
            dict.fromkeys(
                [item.evidence_revision_id for item in ledger]
                + sorted(cited_ids)
            )
        )
        evidence_by_id: dict[str, EvidenceView] = {}
        for evidence_id in ordered_ids:
            try:
                evidence_by_id[evidence_id] = self.evidence.get_evidence(evidence_id)
            except NotFoundError:
                # Purged/tombstoned Evidence cannot support a new question.
                continue

        is_chinese = bool(re.search(r"[\u4e00-\u9fff]", run.goal))
        prior_keys = {
            _question_key(item.goal)
            for item in self.runs.list_conversation(run.conversation_id)
        }
        items: list[dict[str, object]] = []
        suggestion_keys: set[str] = set()

        def add(
            question: str,
            *,
            reason: str,
            evidence_ids: tuple[str, ...],
        ) -> None:
            key = _question_key(question)
            if not key or key in prior_keys or key in suggestion_keys or len(items) >= limit:
                return
            supporting = [
                evidence_by_id[evidence_id]
                for evidence_id in evidence_ids
                if evidence_id in evidence_by_id
            ]
            if not supporting:
                return
            suggestion_keys.add(key)
            items.append(
                {
                    "id": _stable_id(run.id, reason, evidence_ids),
                    "question": question,
                    "reason": reason,
                    "evidence_revision_ids": list(evidence_ids),
                    "source_names": list(
                        dict.fromkeys(item.source_name for item in supporting)
                    ),
                    "modalities": sorted({item.modality.value for item in supporting}),
                }
            )

        uncovered = [
            evidence_by_id[item.evidence_revision_id]
            for item in ledger
            if item.evidence_revision_id not in cited_ids
            and item.evidence_revision_id in evidence_by_id
        ]
        for evidence in uncovered[:1]:
            topic = _seed(evidence)
            question = (
                f"“{topic}”还支持哪些本轮没有展开的结论？"
                if is_chinese
                else (
                    f'What additional conclusion about “{topic}” is supported but not '
                    "developed in this answer?"
                )
            )
            add(
                question,
                reason="uncovered_retrieved_evidence",
                evidence_ids=(evidence.id,),
            )

        unique_sources: list[EvidenceView] = []
        seen_sources: set[str] = set()
        for evidence_id in ordered_ids:
            evidence = evidence_by_id.get(evidence_id)
            if evidence and evidence.source_id not in seen_sources:
                seen_sources.add(evidence.source_id)
                unique_sources.append(evidence)
        if len(unique_sources) >= 2:
            left, right = unique_sources[:2]
            topic = _seed(left)
            question = (
                f"《{left.source_name}》和《{right.source_name}》对“{topic}”有哪些一致或冲突？"
                if is_chinese
                else (
                    f'Where do “{left.source_name}” and “{right.source_name}” agree or '
                    f'conflict about “{topic}”?'
                )
            )
            add(
                question,
                reason="cross_source_comparison",
                evidence_ids=(left.id, right.id),
            )

        cited = [
            evidence_by_id[evidence_id]
            for evidence_id in ordered_ids
            if evidence_id in cited_ids and evidence_id in evidence_by_id
        ]
        anchors = cited[:2] or list(evidence_by_id.values())[:2]
        for index, anchor in enumerate(anchors):
            topic = _seed(anchor)
            if anchor.modality.value in {"image", "audio", "video", "table"}:
                question = (
                    f"{anchor.modality.value} 证据为“{topic}”的文字结论补充了什么？"
                    if is_chinese
                    else (
                        f'What does the {anchor.modality.value} evidence add to the written '
                        f'conclusion about “{topic}”?'
                    )
                )
                reason = "native_modality_deep_dive"
            elif index:
                question = (
                    f"《{anchor.source_name}》中的“{topic}”会如何补充或修正当前答案？"
                    if is_chinese
                    else (
                        f'How does “{topic}” in “{anchor.source_name}” qualify or extend '
                        "the current answer?"
                    )
                )
                reason = "cited_evidence_deep_dive"
            else:
                question = (
                    f"围绕“{topic}”，证据中还有哪些假设或限制条件值得核查？"
                    if is_chinese
                    else (
                        f'What assumptions or caveats around “{topic}” should be examined next?'
                    )
                )
                reason = "cited_evidence_deep_dive"
            add(question, reason=reason, evidence_ids=(anchor.id,))

        return {
            "run_id": run.id,
            "outcome": "available" if items else "no_evidence_ledger",
            "generated_from": "frozen_evidence_ledger",
            "scope": {
                "space_ids": list(run.scope.space_ids),
                "source_ids": list(run.scope.source_ids),
                "publish_watermark": run.scope.publish_watermark,
            },
            "ledger_evidence_count": len(evidence_by_id),
            "cited_evidence_count": len(cited_ids & evidence_by_id.keys()),
            "items": items,
        }
