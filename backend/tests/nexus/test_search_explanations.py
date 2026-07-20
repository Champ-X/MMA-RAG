from nexus.modules.retrieval.domain import ChannelCandidate, ChannelResult
from nexus.modules.retrieval.explanation import aggregate_search_explanations, explain_search


def channel(
    name: str,
    status: str,
    *,
    candidates: int = 0,
) -> ChannelResult:
    return ChannelResult(
        channel=name,
        status=status,
        candidates=tuple(
            ChannelCandidate(
                evidence_revision_id=f"evidence-{index}",
                rank=index + 1,
                score=1.0,
                reason="test",
            )
            for index in range(candidates)
        ),
    )


def test_explanation_distinguishes_an_empty_scope_from_no_match() -> None:
    empty = explain_search(
        channels=(channel("exact", "completed"),),
        hit_count=0,
        scope_evidence_count=0,
    )
    no_match = explain_search(
        channels=(channel("exact", "completed"),),
        hit_count=0,
        scope_evidence_count=12,
    )

    assert empty.outcome == "scope_empty"
    assert empty.suggested_actions == ("add_sources", "inspect_ingestion")
    assert no_match.outcome == "no_relevant_evidence"


def test_explanation_does_not_claim_no_match_when_channels_failed() -> None:
    result = explain_search(
        channels=(
            channel("exact", "completed"),
            channel("text_dense", "failed"),
            channel("image", "unavailable"),
        ),
        hit_count=0,
        scope_evidence_count=12,
    )

    assert result.outcome == "retrieval_incomplete"
    assert result.severity == "warning"
    assert result.failed_channels == 1
    assert result.unavailable_channels == 1


def test_explanation_surfaces_projection_scope_mismatch() -> None:
    result = explain_search(
        channels=(channel("text_dense", "completed", candidates=2),),
        hit_count=0,
        scope_evidence_count=8,
    )

    assert result.outcome == "scope_projection_mismatch"
    assert "rebuild_search_projection" in result.suggested_actions


def test_explanation_marks_successful_degraded_retrieval() -> None:
    result = explain_search(
        channels=(channel("exact", "completed", candidates=1), channel("image", "failed")),
        hit_count=1,
        scope_evidence_count=18,
    )

    assert result.outcome == "evidence_found_degraded"
    assert result.severity == "warning"


def test_research_explanation_aggregates_passes_without_hiding_failures() -> None:
    completed = explain_search(
        channels=(channel("exact", "completed", candidates=1),),
        hit_count=1,
        scope_evidence_count=18,
    )
    incomplete = explain_search(
        channels=(channel("exact", "completed"), channel("image", "failed")),
        hit_count=0,
        scope_evidence_count=18,
    )

    result = aggregate_search_explanations((completed, incomplete), hit_count=1)

    assert result is not None
    assert result.outcome == "evidence_found_degraded"
    assert result.failed_channels == 1
    assert result.completed_channels == 2
