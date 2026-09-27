"""Required Jev reranking must never masquerade as baseline/empty success."""
import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.llm.jev import JevError, JevRequiredError, JevScores
from app.modules.retrieval.reranker import Reranker


def forced_ranker():
    ranker = Reranker()
    ranker.jev_mode = "force"
    ranker._apply_cross_encoder_reranking = AsyncMock(
        side_effect=AssertionError("required Jev must not call the baseline")
    )
    ranker.jev_client = SimpleNamespace(score=AsyncMock(return_value=JevScores(
        [{"index": 0, "relevance_score": .1}, {"index": 1, "relevance_score": .9}],
        "jev-1.13.0", {"input_tokens": 500, "output_tokens": 40}, .1,
    )))
    raw = {"dense": [
        {"id": str(i), "score": .01, "content_type": "doc",
         "payload": {"text_content": f"茶叶驯化证据 {i}", "kb_id": "selected-kb"}}
        for i in range(2)
    ]}
    return ranker, raw


@pytest.mark.asyncio
async def test_force_uses_jev_scores_preserves_input_and_reports_actual_model():
    ranker, raw = forced_ranker()
    before = copy.deepcopy(raw)
    result = await ranker.rerank("介绍一下茶叶的驯化史", raw)
    assert [item["id"] for item in result["results"]] == ["1", "0"]
    assert [item["cross_encoder_score"] for item in result["results"]] == [.9, .1]
    assert result["scorer"]["mode"] == "force"
    assert result["scorer"]["status"] == "ok"
    assert result["scorer"]["model"] == "jev-1.13.0"
    ranker.jev_client.score.assert_awaited_once()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()
    assert raw == before


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["timeout", "budget_exhausted", "missing_key", "circuit_open", "http_429"])
async def test_force_failures_propagate_out_of_rerank_without_baseline(reason):
    ranker, raw = forced_ranker()
    ranker.jev_client.score.side_effect = JevError(reason)
    with pytest.raises(JevRequiredError) as caught:
        await ranker.rerank("茶叶驯化史", raw)
    assert caught.value.stage == "rerank"
    assert caught.value.reason == reason
    assert caught.value.diagnostics()["fallback_used"] is False
    ranker.jev_client.score.assert_awaited_once()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [RuntimeError("secret response body"), JevError("secret API key")])
async def test_force_unexpected_failure_is_sanitized(error):
    ranker, raw = forced_ranker()
    ranker.jev_client.score.side_effect = error
    with pytest.raises(JevRequiredError) as caught:
        await ranker.rerank("茶叶驯化史", raw)
    assert caught.value.reason == "unexpected_error"
    assert "secret" not in str(caught.value)
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("scores,reason", [
    ([], "incomplete_scores"),
    ([{"index": 0, "relevance_score": .8}], "incomplete_scores"),
    ([{"index": 0, "relevance_score": .8}, {"index": 0, "relevance_score": .7}], "incomplete_scores"),
    ([{"index": 0, "relevance_score": .8}, {"index": 2, "relevance_score": .7}], "incomplete_scores"),
    ([{"index": 0, "relevance_score": .8}, {"index": True, "relevance_score": .7}], "incomplete_scores"),
    ([{"index": 0, "relevance_score": .8}, {"index": 1}], "invalid_score"),
    ([{"index": 0, "relevance_score": .8}, {"index": 1, "relevance_score": float("nan")}], "invalid_score"),
    ([{"index": 0, "relevance_score": .8}, {"index": 1, "relevance_score": True}], "invalid_score"),
])
async def test_force_rejects_malformed_scores_without_filling_missing_scores(scores, reason):
    ranker, raw = forced_ranker()
    ranker.jev_client.score.return_value.scores = scores
    with pytest.raises(JevRequiredError) as caught:
        await ranker.rerank("茶叶驯化史", raw)
    assert caught.value.reason == reason
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["merge", "final"])
async def test_force_does_not_swallow_post_scoring_failures(stage):
    ranker, raw = forced_ranker()
    if stage == "merge":
        # Exercise _merge_scores' real exception handler, which is permissive
        # for legacy callers but must not return original candidates in force.
        ranker.cross_encoder_weight = None
    else:
        original = ranker._protected_modality_minimums
        calls = 0

        def fail_only_on_final(context):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("sensitive malformed context")
            return original(context)

        ranker._protected_modality_minimums = fail_only_on_final
    with pytest.raises(JevRequiredError) as caught:
        await ranker.rerank("茶叶驯化史", raw)
    assert caught.value.reason == "unexpected_error"
    assert "sensitive" not in str(caught.value)
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
async def test_force_empty_candidates_are_skipped_with_accurate_diagnostics():
    ranker, _ = forced_ranker()
    result = await ranker.rerank("茶叶驯化史", {})
    assert result["results"] == []
    assert result["scorer"] == {"mode": "force", "status": "skipped", "reason": "no_candidates"}
    ranker.jev_client.score.assert_not_awaited()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["missing_id", "unsortable_score", "unhashable_id"])
async def test_force_candidate_preparation_failure_is_not_reported_as_no_results(failure):
    ranker, raw = forced_ranker()
    if failure == "missing_id":
        del raw["dense"][0]["id"]
    elif failure == "unsortable_score":
        raw["dense"][0]["score"] = "not a numeric score"
    else:
        raw["dense"][0]["id"] = []
    with pytest.raises(JevRequiredError) as caught:
        await ranker.rerank("茶叶驯化史", raw)
    assert caught.value.reason == "unexpected_error"
    assert caught.value.stage == "rerank"
    ranker.jev_client.score.assert_not_awaited()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
async def test_force_document_failure_is_not_scored_as_placeholder_text():
    class MalformedText:
        def __str__(self):
            raise ValueError("private content cannot be decoded")

    ranker, raw = forced_ranker()
    raw["dense"][0]["payload"]["text_content"] = MalformedText()
    with pytest.raises(JevRequiredError) as caught:
        await ranker.rerank("茶叶驯化史", raw)
    assert caught.value.reason == "unexpected_error"
    assert "private content" not in str(caught.value)
    ranker.jev_client.score.assert_not_awaited()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
async def test_force_invalid_query_is_an_error_not_baseline_success():
    ranker, raw = forced_ranker()
    with pytest.raises(JevRequiredError) as caught:
        await ranker.rerank("   ", raw)
    assert caught.value.reason == "invalid_input"
    ranker.jev_client.score.assert_not_awaited()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()


@pytest.mark.asyncio
async def test_force_cancellation_propagates_and_cancels_the_jev_call():
    ranker, raw = forced_ranker()
    entered = asyncio.Event()
    cancelled = asyncio.Event()

    async def pending(*args):
        entered.set()
        try:
            await asyncio.Future()
        finally:
            cancelled.set()

    ranker.jev_client.score.side_effect = pending
    task = asyncio.create_task(ranker.rerank("茶叶驯化史", raw))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()
    ranker._apply_cross_encoder_reranking.assert_not_awaited()
