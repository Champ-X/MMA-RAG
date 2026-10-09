"""Optional Decision evidence cannot remove, reorder or rescore baseline hits."""
import asyncio
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core import jev_settings as runtime
from app.core.llm.jev import JevClient, JevError
from app.core.llm.manager import LLMCallResult
from app.modules.retrieval.decision_evidence import LEGACY_POLICY_VERSION, MAX_INPUT_BYTES, SIGNAL_THRESHOLD
from app.modules.retrieval.reranker import Reranker


def fixture(count=25, responder=None):
    ranker = Reranker()
    # Preserve the frozen pilot contract; v2 has independent tests.
    ranker.decision_evidence_policy = LEGACY_POLICY_VERSION
    ranker.jev_mode = "assist"
    ranker.llm_manager = SimpleNamespace(rerank=AsyncMock(side_effect=lambda **kw: LLMCallResult(
        success=True, data=[{"index": i, "relevance_score": .95 - .03 * i}
                            for i in range(len(kw["documents"]))])))
    raw = {"dense": [{"id": f"d{i}", "score": .01, "content_type": "doc",
                      "payload": {"text_content": f"Source {i}: 2026年机构甲明确不适用每日600次限制。",
                                  "file_name": f"source-{i}.txt", "kb_id": "authorized-kb", "file_id": f"f{i}"}}
                     for i in range(count)]}
    requests = []
    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        answers = {}
        for key, question in payload["questions"].items():
            assert question["type"] == "choice"
            answers[key] = responder(key, question) if responder else choice()
        return httpx.Response(200, json={"model": "jev-1.13.0", "answers": answers,
                                        "usage": {"input_tokens": 80, "output_tokens": 12}})
    ranker.jev_client = JevClient("synthetic", transport=httpx.MockTransport(handler))
    return ranker, raw, requests


def choice(label="answer_bearing", probability=.9, confidence=.9):
    probabilities = {name: (1 - probability) / 2
                     for name in ("answer_bearing", "insufficient", "mismatched")}
    probabilities[label] = probability
    return {"type": "choice", "choice": label, "probabilities": probabilities, "confidence": confidence}


async def baseline_for(ranker, raw, context=None):
    ranker.jev_mode = "off"
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw, context)
    ranker.jev_mode = "assist"
    ranker.llm_manager.rerank.reset_mock()
    return result["results"]


@pytest.mark.asyncio
async def test_assist_keeps_complete_baseline_and_appends_at_most_two_existing_hits():
    ranker, raw, requests = fixture()
    snapshot = copy.deepcopy(raw)
    baseline = await baseline_for(ranker, raw)
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"][:10] == baseline
    assert len(result["results"]) == result["final_ranking_count"] == 12
    assert [r["id"] for r in result["results"][10:]] == ["d10", "d11"]
    assert ranker.llm_manager.rerank.await_count == len(requests) == 1
    assert len(requests[0]["questions"]) == 8
    assert [q["instructions"]["passage"] for q in requests[0]["questions"].values()] == [
        raw["dense"][i]["payload"]["text_content"] for i in range(10, 18)]
    for item in result["results"][10:]:
        assert item["payload"]["kb_id"] == "authorized-kb"
        assert item["metadata"]["decision_assist"]["probability"] == .9
        assert item["rerank_score"] != .9  # Choice signal never becomes a rerank measurement.
    info = result["scorer"]
    assert info["status"] == "ok" and info["reason"] == "added_evidence"
    assert info["model"] == "jev-1.13.0" and info["evaluated_count"] == 8
    assert info["baseline_ids"] == [item["id"] for item in baseline]
    assert info["added_ids"] == ["d10", "d11"]
    assert info["skip_reasons"] == {"candidate_limit": 7}
    assert info["comparison"]["added"][0] == {
        "id": "d10", "file_name": "source-10.txt", "snippet": snapshot["dense"][10]["payload"]["text_content"], "rank": 11}
    assert raw == snapshot


@pytest.mark.asyncio
async def test_strong_choice_accepts_contrary_evidence_but_rejects_weak_or_mismatched_signals():
    decisions = [choice("mismatched"), choice(probability=.84), choice(confidence=.84),
                 choice(probability=.85, confidence=.85), choice("insufficient"), choice()]
    ranker, raw, requests = fixture(16, lambda key, _: decisions[int(key[1:])])
    baseline = await baseline_for(ranker, raw)
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"][:10] == baseline
    assert result["scorer"]["added_ids"] == ["d13", "d15"]
    rule = requests[0]["questions"]["e0"]["instructions"]["rule"]
    assert all(term in rule for term in ("entity", "conditions", "time period", "contradicts", "negative answer"))
    assert "不适用" in requests[0]["questions"]["e3"]["instructions"]["passage"]
    assert result["scorer"]["threshold"] == SIGNAL_THRESHOLD


@pytest.mark.asyncio
async def test_non_text_long_and_empty_candidates_are_counted_without_truncating_model_input():
    ranker, raw, requests = fixture(15)
    raw["dense"][10]["payload"]["text_content"] = "x" * 4001
    raw["dense"][11]["content_type"] = "video"
    raw["dense"][12]["payload"]["text_content"] = " "
    raw["dense"][13]["payload"]["text_content"] = "c" * 4000
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    passages = [q["instructions"]["passage"] for q in requests[0]["questions"].values()]
    assert "c" * 4000 in passages and "x" * 4001 not in passages
    assert result["scorer"]["skip_reasons"] == {
        "document_too_long": 1, "non_text_source": 1, "empty_or_invalid_text": 1}
    assert result["scorer"]["evaluated_count"] == 2


@pytest.mark.asyncio
async def test_utf8_request_budget_skips_complete_candidates_and_records_reason():
    ranker, raw, requests = fixture(20)
    for item in raw["dense"][10:]:
        item["payload"]["text_content"] = "汉" * 3500
    result = await ranker.rerank("问" * 3000, raw)
    payload = requests[0]
    encoded = json.dumps({"state": payload["state"], "questions": payload["questions"]}, ensure_ascii=False).encode()
    assert len(encoded) <= MAX_INPUT_BYTES
    assert 0 < result["scorer"]["evaluated_count"] < 8
    assert result["scorer"]["skip_reasons"]["input_budget"] > 0
    assert all(q["instructions"]["passage"] == "汉" * 3500 for q in payload["questions"].values())


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [JevError("timeout"), JevError("budget_exhausted"),
                                    RuntimeError("private diagnostic")])
async def test_assist_failure_preserves_baseline_scores_order_and_no_partial_additions(failure):
    ranker, raw, _ = fixture()
    baseline = await baseline_for(ranker, raw)
    ranker.jev_client = SimpleNamespace(evaluate=AsyncMock(side_effect=failure))
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"] == baseline
    assert result["scorer"]["status"] == "fallback"
    assert result["scorer"]["added_ids"] == [] and result["scorer"]["evaluated_count"] == 0
    assert "private" not in str(result["scorer"])
    assert ranker.llm_manager.rerank.await_count == 1


@pytest.mark.asyncio
async def test_invalid_later_answer_cannot_commit_an_earlier_valid_addition():
    def respond(key, question):
        answer = choice()
        if key == "e1":
            answer["probabilities"]["answer_bearing"] = True
        return answer
    ranker, raw, _ = fixture(responder=respond)
    baseline = await baseline_for(ranker, raw)
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"] == baseline and result["scorer"]["added_ids"] == []
    assert result["scorer"]["reason"] == "invalid_probabilities"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["assist", "shadow", "replace"])
async def test_cancellation_is_never_optional_fallback(mode):
    ranker, raw, _ = fixture()
    ranker.jev_mode = mode
    entered, cancelled = asyncio.Event(), asyncio.Event()
    async def pending(*args, **kwargs):
        entered.set()
        try:
            await asyncio.Future()
        finally:
            cancelled.set()
    ranker.jev_client = SimpleNamespace(score=pending, evaluate=pending)
    task = asyncio.create_task(ranker.rerank("2026年机构甲的每日限额是否600次？", raw))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_empty_baseline_and_invalid_query_never_trigger_assist():
    ranker, raw, requests = fixture()
    ranker._apply_cross_encoder_reranking = AsyncMock(return_value=[])
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"] == [] and result["scorer"]["reason"] == "empty_baseline"
    ranker._apply_cross_encoder_reranking.return_value = raw["dense"][:10]
    for query in (" ", "q" * 4001):
        result = await ranker.rerank(query, raw)
        assert result["scorer"]["reason"] == "query_outside_bounds"
        assert result["results"] == raw["dense"][:10]
    assert requests == []


@pytest.mark.asyncio
async def test_modality_quota_is_applied_before_supplement_and_never_displaced():
    ranker, raw, _ = fixture()
    for item in raw["dense"][:2]:
        item["content_type"] = "video"
    context = SimpleNamespace(video_intent="explicit_demand")
    baseline = await baseline_for(ranker, raw, context)
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw, context)
    assert result["results"][:10] == baseline
    assert sum(item["content_type"] == "video" for item in result["results"]) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["shadow", "replace"])
async def test_internal_decision_error_keeps_baseline_in_non_strict_modes(mode):
    ranker, raw, _ = fixture()
    baseline = await baseline_for(ranker, raw)
    ranker.jev_mode = mode
    ranker.jev_client = SimpleNamespace(score=AsyncMock(side_effect=RuntimeError("private failure")))
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"] == baseline
    assert result["scorer"]["status"] == "fallback" and result["scorer"]["reason"] == "unexpected_error"
    assert "private" not in str(result["scorer"])
    assert ranker.llm_manager.rerank.await_count == 1


@pytest.mark.asyncio
async def test_shadow_comparison_uses_actual_final_ranks_and_bounded_snippets():
    from app.core.llm.jev import JevScores
    ranker, raw, _ = fixture(20)
    raw["dense"][0]["payload"]["text_content"] = "Evidence " * 100
    baseline = await baseline_for(ranker, raw)
    ranker.jev_mode = "shadow"
    ranker.jev_client = SimpleNamespace(score=AsyncMock(return_value=JevScores(
        [{"index": i, "relevance_score": i / 20} for i in range(20)],
        "jev-1.13.0", {"input_tokens": 1, "output_tokens": 1}, .01)))
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"] == baseline
    comparison = result["scorer"]["comparison"]
    assert len(comparison["baseline"]) == len(comparison["proposed"]) == 10
    assert comparison["baseline"][0]["id"] == "d0"
    assert comparison["proposed"][0]["id"] == "d19"
    assert comparison["proposed"][0]["rank"] == 1  # Original candidate.rank is not used.
    assert len(comparison["baseline"][0]["snippet"]) == 160
    assert comparison["baseline"][0]["file_name"] == "source-0.txt"
    assert {r["id"] for rows in comparison.values() for r in rows} <= {r["id"] for r in raw["dense"]}


def test_assist_configuration_is_opt_in_and_environment_validated(monkeypatch):
    from app.core.config import Settings
    assert runtime.OFF_CONFIG.rerank_mode == "off"
    assert runtime.JevConfig(intent_mode="off", rerank_mode="assist", citation_mode="off", citation_strategy="per_unit").enabled
    monkeypatch.setenv("JEV_RERANK_MODE", "assist")
    assert Settings(_env_file=None, SILICONFLOW_API_KEY="synthetic").jev_rerank_mode == "assist"


@pytest.mark.asyncio
async def test_low_signal_result_is_exact_baseline_and_reports_successful_evaluation():
    ranker, raw, requests = fixture(responder=lambda *_: choice("insufficient"))
    baseline = await baseline_for(ranker, raw)
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"] == baseline and len(requests) == 1
    assert result["scorer"]["status"] == "ok"
    assert result["scorer"]["reason"] == "no_strong_signal"
    assert result["scorer"]["evaluated_count"] == 8 and result["scorer"]["added_ids"] == []


@pytest.mark.asyncio
async def test_unranked_tail_keeps_retrieval_score_without_fabricating_model_score():
    ranker, raw, _ = fixture(23)
    for item in raw["dense"][10:20]:
        item["payload"]["text_content"] = "x" * 4001
    baseline = await baseline_for(ranker, raw)
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"][:10] == baseline
    assert result["scorer"]["added_ids"] == ["d20", "d21"]
    for item in result["results"][10:]:
        assert item["final_score"] == item["original_score"] == .01
        assert item["rerank_score"] is None and "cross_encoder_score" not in item
    assert result["scorer"]["skip_reasons"] == {"document_too_long": 10}


@pytest.mark.asyncio
async def test_actual_http_failure_is_fallback_with_baseline_intact():
    ranker, raw, _ = fixture()
    baseline = await baseline_for(ranker, raw)
    ranker.jev_client._transport = httpx.MockTransport(lambda _: httpx.Response(503))
    result = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert result["results"] == baseline
    assert result["scorer"]["reason"] == "http_503" and result["scorer"]["attempted_count"] == 8


@pytest.mark.asyncio
async def test_request_snapshot_enables_assist_and_off_does_no_decision_work():
    ranker, raw, requests = fixture()
    ranker.jev_mode = None
    token = runtime._request_config.set(runtime.OFF_CONFIG.model_copy(update={"rerank_mode": "assist"}))
    try:
        supplemented = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    finally:
        runtime._request_config.reset(token)
    assert len(supplemented["results"]) == 12
    baseline = await ranker.rerank("2026年机构甲的每日限额是否600次？", raw)
    assert baseline["scorer"] == {"mode": "off"}
    assert supplemented["results"][:10] == baseline["results"]
    assert len(requests) == 1  # Returning to off performs no extra evaluation.
