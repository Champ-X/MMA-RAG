from __future__ import annotations

import json
import re
from dataclasses import asdict
from typing import Any

from nexus.modules.artifacts.ports import ArtifactRepositoryPort
from nexus.modules.claims.ports import ClaimRepositoryPort
from nexus.modules.models.domain import ModelRequirement, SynthesisRequest, TaskRequest
from nexus.modules.models.ports import ModelGatewayPort
from nexus.modules.retrieval.application import RetrievalOrchestrator
from nexus.modules.retrieval.domain import EvidencePack, SearchRequest
from nexus.modules.retrieval.explanation import aggregate_search_explanations
from nexus.modules.runs.domain import RunView
from nexus.modules.runs.ports import RunRepositoryPort
from nexus.shared.domain.enums import (
    TERMINAL_RUN_STATUSES,
    ClaimStatus,
    Modality,
    RunKind,
    RunStatus,
)
from nexus.shared.domain.errors import CapabilityUnavailableError
from nexus.shared.domain.ids import new_id


class NexusHarness:
    """Recoverable Quick/Research runtime enforcing scope, ledger, verification and fuse rules."""

    runtime_version = "nexus-native-v1"

    def __init__(
        self,
        *,
        runs: RunRepositoryPort,
        retrieval: RetrievalOrchestrator,
        models: ModelGatewayPort,
        claims: ClaimRepositoryPort,
        artifacts: ArtifactRepositoryPort,
        worker_id: str = "inline-agent-worker",
        emergency_transition_limit: int = 1000,
    ) -> None:
        self.runs = runs
        self.retrieval = retrieval
        self.models = models
        self.claims = claims
        self.artifacts = artifacts
        self.worker_id = worker_id
        self.emergency_transition_limit = emergency_transition_limit

    def start(self, run_id: str) -> RunView:
        return self.advance(run_id)

    def advance(self, run_id: str) -> RunView:
        run = self.runs.get_run(run_id)
        if run.status.value in TERMINAL_RUN_STATUSES:
            return run
        if run.status == RunStatus.PAUSED:
            return run
        lease = self.runs.acquire_driver(run_id, worker_id=self.worker_id)
        trace_id = new_id()
        if run.cancel_requested:
            return self.runs.transition(
                lease, status=RunStatus.CANCELLED, stop_reason="user_cancelled"
            )
        self.runs.transition(
            lease,
            status=RunStatus.PLANNING if run.kind == RunKind.RESEARCH else RunStatus.RUNNING,
        )
        try:
            if run.kind == RunKind.QUICK:
                return self._quick(run, lease, trace_id)
            return self._research(run, lease, trace_id)
        except CapabilityUnavailableError as exc:
            result = {
                "answer": "执行所需能力当前不可用，已保留已有证据和轨迹。",
                "error": {"code": exc.code, "message": exc.message, "details": exc.details},
                "partial": True,
            }
            return self.runs.transition(
                lease,
                status=RunStatus.PARTIAL,
                stop_reason="capability_unavailable",
                result=result,
            )
        except Exception as exc:
            self.runs.append_event(
                run.id,
                "run.execution.failed",
                {"error_type": type(exc).__name__},
                producer=self.worker_id,
                trace_id=trace_id,
            )
            return self.runs.transition(
                lease,
                status=RunStatus.FAILED,
                stop_reason="runtime_error",
                result={"error": {"type": type(exc).__name__}},
            )

    def _quick(self, run: RunView, lease: object, trace_id: str) -> RunView:
        understanding = self._understand_query(run)
        self.runs.append_event(
            run.id,
            "query.understood",
            understanding,
            producer=self.worker_id,
            trace_id=trace_id,
        )
        pack = self.retrieval.search(
            SearchRequest(
                query=str(understanding["rewritten_query"]),
                scope=run.scope,
                quality_mode=run.quality_mode,
                modalities=self._intent_modalities(understanding),
                priority_source_ids=tuple(
                    str(item) for item in understanding.get("attachment_source_ids", [])
                ),
                limit=10,
            )
        )
        self._record_pack(run.id, pack, trace_id)
        self.runs.save_checkpoint(
            lease,  # type: ignore[arg-type]
            state={"phase": "retrieved", "evidence_ids": [hit.evidence.id for hit in pack.hits]},
            runtime_version=self.runtime_version,
        )
        if not pack.hits:
            claim = self.claims.create_claim(
                run_id=run.id,
                text=run.goal,
                claim_type="question",
                verification_level="T1",
                status=ClaimStatus.INSUFFICIENT.value,
                explanation="No published evidence matched the frozen scope.",
                evidence_links=[],
            )
            result = {
                "answer": "当前范围内没有足够证据支持可靠回答。",
                "citations": [],
                "claims": [claim.id],
                "verification_level": "T1",
                "verification_status": ClaimStatus.INSUFFICIENT.value,
                "quality": self._quality_payload(pack),
            }
            return self.runs.transition(
                lease,  # type: ignore[arg-type]
                status=RunStatus.PARTIAL,
                stop_reason="evidence_insufficient",
                result=result,
            )
        response = self.models.synthesize(
            SynthesisRequest(
                goal=str(understanding["synthesis_goal"]),
                evidence=self._model_evidence(pack),
                verification_level="T1",
            ),
            ModelRequirement(
                role="quick_synthesis",
                required_capabilities=("text",),
                allow_degradation=True,
                preferred_deployment_id=run.selected_model_deployment_id,
            ),
        )
        citation_ids = [
            identifier
            for identifier in response.metadata.get("citations", [])
            if identifier in {hit.evidence.id for hit in pack.hits}
        ]
        if not citation_ids:
            citation_ids = [hit.evidence.id for hit in pack.hits[:3]]
        verification = self._verify_claim(response.text, list(pack.hits), minimum_level="T1")
        claim = self.claims.create_claim(
            run_id=run.id,
            text=self._claim_text(response.text),
            claim_type="fact",
            verification_level=str(verification["level"]),
            status=str(verification["status"]),
            explanation=str(verification["explanation"]),
            evidence_links=[
                {
                    "evidence_revision_id": hit.evidence.id,
                    "relation": "supports",
                    "support_score": hit.fused_score,
                    "excerpt": hit.evidence.text_content[:500],
                }
                for hit in pack.hits
                if hit.evidence.id in citation_ids
            ],
        )
        result = {
            "answer": response.text,
            "citations": self._citation_payload(pack, citation_ids),
            "claims": [claim.id],
            "verification_level": verification["level"],
            "verification_status": verification["status"],
            "verification": verification,
            "model": {
                "actual_model": response.actual_model,
                "finish_reason": response.finish_reason,
                "usage": response.usage,
                "metadata": response.metadata,
            },
            "quality": self._quality_payload(pack),
            "query_understanding": understanding,
        }
        self.runs.save_checkpoint(
            lease,  # type: ignore[arg-type]
            state={"phase": "verified", "claim_id": claim.id, "result": result},
            runtime_version=self.runtime_version,
        )
        return self.runs.transition(
            lease,  # type: ignore[arg-type]
            status=RunStatus.COMPLETED,
            stop_reason="goal_achieved",
            result=result,
        )

    def _research(self, run: RunView, lease: object, trace_id: str) -> RunView:
        understanding = self._understand_query(run)
        self.runs.append_event(
            run.id,
            "query.understood",
            understanding,
            producer=self.worker_id,
            trace_id=trace_id,
        )
        queries = self._plan_queries(
            str(understanding["rewritten_query"]),
            extra=understanding.get("multi_view_queries", []),
        )
        self.runs.append_event(
            run.id,
            "research.plan.created",
            {"steps": [{"id": index + 1, "query": query} for index, query in enumerate(queries)]},
            producer=self.worker_id,
            trace_id=trace_id,
        )
        self.runs.save_checkpoint(
            lease,  # type: ignore[arg-type]
            state={"phase": "planned", "queries": queries},
            runtime_version=self.runtime_version,
        )
        self.runs.transition(lease, status=RunStatus.RUNNING)  # type: ignore[arg-type]
        all_hits: dict[str, object] = {}
        packs: list[EvidencePack] = []
        no_gain_rounds = 0
        for index, query in enumerate(queries):
            current = self.runs.get_run(run.id)
            if current.cancel_requested:
                return self.runs.transition(
                    lease,
                    status=RunStatus.CANCELLED,
                    stop_reason="user_cancelled",  # type: ignore[arg-type]
                )
            pack = self.retrieval.search(
                SearchRequest(
                    query=query,
                    scope=run.scope,
                    quality_mode=run.quality_mode,
                    modalities=self._intent_modalities(understanding),
                    priority_source_ids=tuple(
                        str(item) for item in understanding.get("attachment_source_ids", [])
                    ),
                    limit=12,
                )
            )
            packs.append(pack)
            before = len(all_hits)
            for hit in pack.hits:
                all_hits[hit.evidence.id] = hit
            gain = len(all_hits) - before
            no_gain_rounds = no_gain_rounds + 1 if gain == 0 else 0
            self._record_pack(run.id, pack, trace_id, step=index + 1, evidence_gain=gain)
            if no_gain_rounds >= 2:
                self.runs.append_event(
                    run.id,
                    "research.safety_fuse.triggered",
                    {"reason": "no_evidence_gain", "consecutive_rounds": no_gain_rounds},
                    producer=self.worker_id,
                    trace_id=trace_id,
                )
                break
        hits = list(all_hits.values())
        if not hits:
            result = {
                "answer": "研究已停止：冻结范围内没有发现足以支持结论的证据。",
                "citations": [],
                "verification_level": "T2",
                "verification_status": ClaimStatus.INSUFFICIENT.value,
                "partial": True,
                "quality": self._research_quality_payload(packs),
            }
            return self.runs.transition(
                lease,  # type: ignore[arg-type]
                status=RunStatus.PARTIAL,
                stop_reason="evidence_insufficient",
                result=result,
            )
        model_evidence = tuple(
            {
                "evidence_revision_id": hit.evidence.id,
                "source_name": hit.evidence.source_name,
                "locator": asdict(hit.evidence.locator),
                "text": hit.evidence.text_content,
            }
            for hit in hits[:24]
        )
        response = self.models.synthesize(
            SynthesisRequest(
                goal=str(understanding["synthesis_goal"]),
                evidence=model_evidence,
                verification_level="T2",
                artifact=True,
            ),
            ModelRequirement(
                role="research_synthesis",
                required_capabilities=("text",),
                allow_degradation=True,
                preferred_deployment_id=run.selected_model_deployment_id,
            ),
        )
        source_count = len({hit.evidence.source_id for hit in hits})
        verification = self._verify_claim(response.text, hits, minimum_level="T2")
        verification_status = ClaimStatus(str(verification["status"]))
        claim = self.claims.create_claim(
            run_id=run.id,
            text=self._claim_text(response.text),
            claim_type="analysis",
            verification_level=str(verification["level"]),
            status=verification_status.value,
            explanation=str(verification["explanation"]),
            evidence_links=[
                {
                    "evidence_revision_id": hit.evidence.id,
                    "relation": "supports",
                    "support_score": hit.fused_score,
                    "excerpt": hit.evidence.text_content[:500],
                }
                for hit in hits[:12]
            ],
        )
        canonical = {
            "schema": "nexus.block-document.v1",
            "title": run.goal,
            "blocks": [
                {"type": "heading", "level": 1, "text": run.goal, "origin": "generated"},
                {
                    "type": "paragraph",
                    "text": response.text,
                    "claim_ids": [claim.id],
                    "evidence_revision_ids": [hit.evidence.id for hit in hits[:12]],
                    "origin": "generated",
                },
                {
                    "type": "evidence_list",
                    "items": [
                        {
                            "evidence_revision_id": hit.evidence.id,
                            "source": hit.evidence.source_name,
                            "locator": asdict(hit.evidence.locator),
                        }
                        for hit in hits[:24]
                    ],
                },
            ],
        }
        artifact = self.artifacts.create_artifact(
            run_id=run.id,
            title=run.goal,
            artifact_type="research_report",
            canonical_document=canonical,
            evidence_revision_ids=[hit.evidence.id for hit in hits[:24]],
        )
        result = {
            "answer": response.text,
            "artifact_id": artifact.id,
            "citations": [
                {
                    "evidence_revision_id": hit.evidence.id,
                    "source_name": hit.evidence.source_name,
                    "locator": asdict(hit.evidence.locator),
                }
                for hit in hits[:24]
            ],
            "claims": [claim.id],
            "verification_level": verification["level"],
            "verification_status": verification_status.value,
            "verification": verification,
            "evidence_gain": len(hits),
            "sources": source_count,
            "model": {"actual_model": response.actual_model, "metadata": response.metadata},
            "quality": {
                **self._research_quality_payload(packs),
            },
            "query_understanding": understanding,
        }
        self.runs.save_checkpoint(
            lease,  # type: ignore[arg-type]
            state={"phase": "finalized", "artifact_id": artifact.id, "result": result},
            runtime_version=self.runtime_version,
        )
        return self.runs.transition(
            lease,  # type: ignore[arg-type]
            status=RunStatus.COMPLETED,
            stop_reason="goal_achieved",
            result=result,
        )

    def _understand_query(self, run: RunView) -> dict[str, object]:
        """Produce an auditable intent/rewrite record without exposing chain of thought."""
        value = run.goal.strip()
        lower = value.lower()
        history = run.request_context.get("conversation_history", [])
        user_turns = [
            str(item.get("content") or "")
            for item in history
            if isinstance(item, dict) and item.get("role") == "user"
        ]
        reference_tokens = (
            "它",
            "这个",
            "上述",
            "刚才",
            "继续",
            "that",
            "it ",
            "those",
            "above",
            "continue",
        )
        contextual = bool(user_turns) and any(token in lower for token in reference_tokens)
        rewritten = (
            f"Previous user question: {user_turns[-1]}\nCurrent follow-up: {value}"
            if contextual
            else value
        )
        modality = "text"
        if any(token in lower for token in ("视频", "video", "片段", "画面")):
            modality = "video"
        elif any(token in lower for token in ("音频", "audio", "声音", "乐器", "说了")):
            modality = "audio"
        elif any(token in lower for token in ("图片", "图中", "image", "照片", "图表")):
            modality = "image"
        intent = "analysis" if any(
            token in lower for token in ("比较", "分析", "为什么", "compare", "analyze", "why")
        ) else "factual"
        attachments = run.request_context.get("attachment_source_ids", [])
        synthesis_goal = rewritten
        if attachments:
            synthesis_goal += (
                "\nPrioritize the explicitly attached Sources when evidence is relevant."
            )
        understanding: dict[str, object] = {
            "intent": intent,
            "modality_intent": modality,
            "contextual_follow_up": contextual,
            "original_query": value,
            "rewritten_query": rewritten,
            "synthesis_goal": synthesis_goal,
            "attachment_source_ids": attachments,
            "retrieval_strategy": "dense+sparse+exact+native-modalities -> RRF -> rerank",
            "multi_view_queries": [],
            "keywords": [],
            "understanding_mode": "deterministic_fallback",
        }
        history_payload = [item for item in history[-10:] if isinstance(item, dict)]
        try:
            intent_response = self.models.complete(
                TaskRequest(
                    system_prompt=(
                        "You classify a knowledge-base question. Return one JSON object only; "
                        "do not include hidden reasoning. Use intent factual, comparison, "
                        "analysis, coding, or creative; modality_intent text, image, audio, "
                        "video, or multimodal."
                    ),
                    user_prompt=json.dumps(
                        {
                            "question": value,
                            "recent_conversation": history_payload,
                            "has_attachments": bool(attachments),
                            "required_output": {
                                "intent": "string",
                                "modality_intent": "string",
                                "is_complex": "boolean",
                                "keywords": ["string"],
                                "sub_queries": ["string"],
                            },
                        },
                        ensure_ascii=False,
                    ),
                    temperature=0.0,
                ),
                ModelRequirement(
                    role="query_intent",
                    required_capabilities=("text",),
                    allow_degradation=True,
                ),
            )
            parsed_intent = _json_object(intent_response.text)
            parsed_intent_name = str(parsed_intent.get("intent") or "").lower()
            parsed_modality = str(parsed_intent.get("modality_intent") or "").lower()
            if parsed_intent_name in {"factual", "comparison", "analysis", "coding", "creative"}:
                understanding["intent"] = parsed_intent_name
            if parsed_modality in {"text", "image", "audio", "video", "multimodal"}:
                understanding["modality_intent"] = parsed_modality
            understanding["is_complex"] = _bool_value(parsed_intent.get("is_complex"))
            understanding["keywords"] = _string_list(parsed_intent.get("keywords"), limit=12)
            understanding["sub_queries"] = _string_list(
                parsed_intent.get("sub_queries"), limit=8
            )
            understanding["intent_model"] = intent_response.actual_model
            understanding["understanding_mode"] = "model_with_deterministic_guardrails"
        except Exception as exc:
            understanding["intent_degradation"] = type(exc).__name__

        try:
            rewrite_response = self.models.complete(
                TaskRequest(
                    system_prompt=(
                        "Rewrite the current knowledge-base question as a standalone retrieval "
                        "query using conversation context. Preserve names, dates and constraints. "
                        "Return one JSON object only and do not include hidden reasoning."
                    ),
                    user_prompt=json.dumps(
                        {
                            "question": value,
                            "recent_conversation": history_payload,
                            "intent": understanding["intent"],
                            "modality_intent": understanding["modality_intent"],
                            "keywords": understanding["keywords"],
                            "required_output": {
                                "rewritten_query": "string",
                                "multi_view_queries": ["string"],
                                "keywords": ["string"],
                            },
                        },
                        ensure_ascii=False,
                    ),
                    temperature=0.2,
                ),
                ModelRequirement(
                    role="query_rewrite",
                    required_capabilities=("text",),
                    allow_degradation=True,
                ),
            )
            parsed_rewrite = _json_object(rewrite_response.text)
            model_rewrite = str(parsed_rewrite.get("rewritten_query") or "").strip()
            if model_rewrite:
                understanding["rewritten_query"] = model_rewrite
                understanding["synthesis_goal"] = model_rewrite
                if attachments:
                    understanding["synthesis_goal"] = (
                        f"{model_rewrite}\nPrioritize the explicitly attached Sources when "
                        "evidence is relevant."
                    )
            understanding["multi_view_queries"] = _string_list(
                parsed_rewrite.get("multi_view_queries"), limit=8
            )
            rewrite_keywords = _string_list(parsed_rewrite.get("keywords"), limit=12)
            if rewrite_keywords:
                understanding["keywords"] = list(
                    dict.fromkeys(
                        [
                            *_string_list(understanding.get("keywords"), limit=12),
                            *rewrite_keywords,
                        ]
                    )
                )[:12]
            understanding["rewrite_model"] = rewrite_response.actual_model
            understanding["understanding_mode"] = "model_with_deterministic_guardrails"
        except Exception as exc:
            understanding["rewrite_degradation"] = type(exc).__name__
        return understanding

    @staticmethod
    def _intent_modalities(understanding: dict[str, object]) -> tuple[Modality, ...]:
        if understanding.get("attachment_source_ids"):
            return ()
        value = str(understanding.get("modality_intent") or "text")
        return {
            "image": (Modality.IMAGE,),
            "audio": (Modality.AUDIO,),
            "video": (Modality.VIDEO,),
        }.get(value, ())

    def _record_pack(
        self,
        run_id: str,
        pack: EvidencePack,
        trace_id: str,
        *,
        step: int = 1,
        evidence_gain: int | None = None,
    ) -> None:
        relevance = {hit.evidence.id: hit.fused_score for hit in pack.hits}
        added = self.runs.add_ledger_items(
            run_id,
            list(relevance),
            discovered_by=f"retrieval-step-{step}",
            relevance=relevance,
        )
        self.runs.append_event(
            run_id,
            "retrieval.completed",
            {
                "query": pack.query,
                "requested_quality": pack.requested_quality.value,
                "actual_quality": pack.actual_quality.value,
                "degraded": pack.degraded,
                "degradation_reasons": list(pack.degradation_reasons),
                "channels": [
                    {
                        "channel": channel.channel,
                        "status": channel.status,
                        "candidate_count": len(channel.candidates),
                        "latency_ms": channel.latency_ms,
                        "error": channel.error,
                        "native_modality": channel.native_modality,
                    }
                    for channel in pack.channels
                ],
                "evidence_count": len(pack.hits),
                "evidence_gain": added if evidence_gain is None else evidence_gain,
            },
            producer=self.worker_id,
            trace_id=trace_id,
        )

    def resume(self, run_id: str) -> RunView:
        return self.advance(run_id)

    def cancel(self, run_id: str) -> RunView:
        run = self.runs.get_run(run_id)
        if run.status.value in TERMINAL_RUN_STATUSES:
            return run
        lease = self.runs.acquire_driver(run_id, worker_id=self.worker_id)
        return self.runs.transition(lease, status=RunStatus.CANCELLED, stop_reason="user_cancelled")

    def inspect(self, run_id: str) -> dict[str, object]:
        run = self.runs.get_run(run_id)
        return {
            "run": asdict(run),
            "checkpoint": self.runs.load_checkpoint(run_id),
            "claims": [asdict(claim) for claim in self.claims.list_claims(run_id)],
        }

    def recover(self, run_id: str) -> RunView:
        run = self.runs.get_run(run_id)
        if run.status.value in TERMINAL_RUN_STATUSES:
            return run
        return self.advance(run_id)

    @staticmethod
    def _plan_queries(goal: str, *, extra: object = ()) -> list[str]:
        parts = [
            part.strip(" ，,。;；")
            for part in re.split(
                r"(?:以及|并且|然后|比较|对比|\band\b|\bvs\.?\b)", goal, flags=re.I
            )
            if part.strip(" ，,。;；")
        ]
        queries = [goal]
        queries.extend(_string_list(extra, limit=8))
        queries.extend(part for part in parts if part != goal)
        # Stable dedup and a bounded emergency shape; this is not a business budget.
        return list(dict.fromkeys(queries))[:12]

    @staticmethod
    def _model_evidence(pack: EvidencePack) -> tuple[dict[str, object], ...]:
        return tuple(
            {
                "evidence_revision_id": hit.evidence.id,
                "source_name": hit.evidence.source_name,
                "locator": asdict(hit.evidence.locator),
                "text": hit.evidence.text_content,
            }
            for hit in pack.hits
        )

    @staticmethod
    def _citation_payload(pack: EvidencePack, citation_ids: list[str]) -> list[dict[str, object]]:
        return [
            {
                "evidence_revision_id": hit.evidence.id,
                "source_name": hit.evidence.source_name,
                "source_version_id": hit.evidence.source_version_id,
                "modality": hit.evidence.modality.value,
                "locator": asdict(hit.evidence.locator),
                "channels": list(hit.channels),
            }
            for hit in pack.hits
            if hit.evidence.id in citation_ids
        ]

    @staticmethod
    def _quality_payload(pack: EvidencePack) -> dict[str, object]:
        return {
            "requested": pack.requested_quality.value,
            "actual": pack.actual_quality.value,
            "degraded": pack.degraded,
            "degradation_reasons": list(pack.degradation_reasons),
            "coverage": pack.coverage,
            "explanation": asdict(pack.explanation) if pack.explanation else None,
        }

    @classmethod
    def _research_quality_payload(cls, packs: list[EvidencePack]) -> dict[str, object]:
        explanation = aggregate_search_explanations(
            tuple(pack.explanation for pack in packs if pack.explanation is not None),
            hit_count=len({hit.evidence.id for pack in packs for hit in pack.hits}),
        )
        return {
            "requested": packs[0].requested_quality.value if packs else "deep",
            "actual": packs[-1].actual_quality.value if packs else "deep",
            "degraded": any(pack.degraded for pack in packs),
            "degradation_reasons": sorted(
                {reason for pack in packs for reason in pack.degradation_reasons}
            ),
            "passes": [cls._quality_payload(pack) for pack in packs],
            "explanation": asdict(explanation) if explanation else None,
        }

    @staticmethod
    def _claim_text(answer: str) -> str:
        clean = re.sub(r"\[evidence:[0-9a-f-]{36}\]", "", answer).strip()
        return clean[:2000] or "Evidence-bound answer"

    @classmethod
    def _verify_claim(
        cls,
        answer: str,
        hits: list[Any],
        *,
        minimum_level: str,
    ) -> dict[str, object]:
        clean_answer = cls._claim_text(answer)
        answer_numbers = cls._numeric_tokens(clean_answer)
        high_risk = bool(
            answer_numbers
            or re.search(
                r"\b(version|budget|date|amount|quantity|price|cost|release|launch)\b"
                r"|版本|预算|日期|金额|数量|价格|发布|上线",
                clean_answer,
                flags=re.IGNORECASE,
            )
        )
        level = "T3" if high_risk else minimum_level
        source_ids = {hit.evidence.source_id for hit in hits}
        supporting_numbers = {
            number: sorted(
                {
                    hit.evidence.id
                    for hit in hits
                    if number in cls._numeric_tokens(hit.evidence.text_content)
                }
            )
            for number in answer_numbers
        }
        missing_numbers = sorted(
            number for number, evidence_ids in supporting_numbers.items() if not evidence_ids
        )
        conflicts = cls._detect_conflicts(hits)
        cross_source = len(source_ids) >= 2
        if conflicts:
            status = ClaimStatus.CONFLICTED.value
            explanation = "Contradictory values were found in independent Evidence Revisions."
        elif missing_numbers:
            status = ClaimStatus.PARTIALLY_SUPPORTED.value
            explanation = "At least one generated number was not found in the cited evidence."
        elif level == "T3" and not cross_source:
            status = ClaimStatus.PARTIALLY_SUPPORTED.value
            explanation = (
                "Deterministic number/version checks passed, but independent cross-source "
                "confirmation is unavailable."
            )
        elif minimum_level == "T2" and not cross_source:
            status = ClaimStatus.PARTIALLY_SUPPORTED.value
            explanation = "Evidence is relevant but only one independent source is available."
        else:
            status = ClaimStatus.SUPPORTED.value
            explanation = (
                "Numeric/version values are present in evidence and independently corroborated."
                if level == "T3"
                else "Evidence coverage and immutable locators satisfy the requested trust gate."
            )
        return {
            "level": level,
            "status": status,
            "numeric_checks": supporting_numbers,
            "missing_numbers": missing_numbers,
            "independent_source_count": len(source_ids),
            "cross_source": cross_source,
            "conflicts": conflicts,
            "needs_human_confirmation": level == "T3" and status != ClaimStatus.SUPPORTED.value,
            "explanation": explanation,
        }

    @staticmethod
    def _numeric_tokens(text: str) -> set[str]:
        return set(
            re.findall(
                r"(?<![0-9A-Za-z])(?:v(?:ersion)?\s*)?\d+(?:[.,]\d+)*(?:[-/]\d+){0,2}%?",
                text,
                flags=re.IGNORECASE,
            )
        )

    @classmethod
    def _detect_conflicts(cls, hits: list[Any]) -> list[dict[str, object]]:
        facts: dict[str, dict[str, set[str]]] = {}
        pattern = re.compile(
            r"(?P<label>[A-Za-z\u4e00-\u9fff][A-Za-z0-9_\-\u4e00-\u9fff ]{1,50}?)"
            r"\s+(?:is|was|are|equals|为|是|有)\s*"
            r"(?P<value>\d+(?:[.,]\d+)*(?:[-/]\d+){0,2}%?)",
            flags=re.IGNORECASE,
        )
        for hit in hits:
            for match in pattern.finditer(hit.evidence.text_content):
                label = " ".join(match.group("label").lower().split()[-6:])
                value = match.group("value")
                facts.setdefault(label, {}).setdefault(value, set()).add(hit.evidence.id)
        conflicts: list[dict[str, object]] = []
        for label, values in sorted(facts.items()):
            evidence_ids = {identifier for ids in values.values() for identifier in ids}
            if len(values) > 1 and len(evidence_ids) > 1:
                conflicts.append(
                    {
                        "subject": label,
                        "values": {
                            value: sorted(identifiers)
                            for value, identifiers in sorted(values.items())
                        },
                    }
                )
        return conflicts


def _json_object(value: str) -> dict[str, object]:
    clean = value.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean, flags=re.IGNORECASE)
    start = clean.find("{")
    end = clean.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("Model task output contains no JSON object")
    parsed = json.loads(clean[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Model task output is not a JSON object")
    return {str(key): item for key, item in parsed.items()}


def _string_list(value: object, *, limit: int) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return list(
        dict.fromkeys(
            str(item).strip() for item in value if isinstance(item, str) and item.strip()
        )
    )[:limit]


def _bool_value(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes"}
    return bool(value)
