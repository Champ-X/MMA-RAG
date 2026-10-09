"""Decision receipts survive every successful chat transport and history load."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api import chat
from app.core.decision_diagnostics import chat_diagnostics, failure_diagnostics, retrieval_diagnostics
from app.core.jev_settings import JevConfig
from app.core.llm.jev import JevRequiredError


def config(**updates):
    return JevConfig(provider="openrouter", model="openai/gpt-6-luna-decisions",
                     **{"intent_mode": "adaptive", "rerank_mode": "shadow",
                        "citation_mode": "shadow", "citation_strategy": "per_unit", **updates})


ANSWER = "😀每日限额600次[1]。"
AUDIT = {
    "mode": "shadow", "diagnostic_only": True,
    "units": [{"start": 0, "end": len(ANSWER) - 1, "citation_ids": ["1"],
               "result": {"status": "evaluated", "answers": {"relation": {"choice": "contradicted"}}}}],
    "coverage": {"cited_units": 1, "evaluated_units": 1},
}
INTENT = {"mode": "adaptive", "accepted": True, "model": "openai/gpt-6-luna-decisions"}
SCORER = {"mode": "shadow", "status": "ok", "proposed_ids": ["candidate"]}


def install_runtime(monkeypatch, *, enabled=True, generation_failure=False):
    selected = config() if enabled else config(intent_mode="off", rerank_mode="off", citation_mode="off")
    monkeypatch.setattr(chat, "get_jev_config", lambda: selected)
    monkeypatch.setattr(chat, "sessions", {})
    monkeypatch.setattr("app.core.llm.jev.get_jev_client", lambda: pytest.fail("Serialization must not initialize Decision"))
    result = SimpleNamespace(context=SimpleNamespace(intent_type="factual"), processing_time=.1,
                             debug_info={"jev_decision": INTENT, "reranking_scorer": SCORER,
                                         "total_candidates": 2} if enabled else {})
    async def retrieval(**kwargs):
        yield "intent", {"jev_decision": INTENT, "stage_status": "completed"}
        yield "_result", result
    async def agent(**kwargs):
        yield "_result", SimpleNamespace(retrieval_result=result, metadata=lambda: {"enabled": True})
    async def generation(**kwargs):
        yield SimpleNamespace(type="message", data={"content": ANSWER})
        if generation_failure:
            yield SimpleNamespace(type="error", data={"error": "generation failed"})
        else:
            yield SimpleNamespace(type="done", data={"jev_citation_audit": AUDIT} if enabled else {})
    nonstream = {"success": not generation_failure, "answer": ANSWER, "references_used": [],
                 "metadata": {"jev_citation_audit": AUDIT} if enabled else {}, "error": "generation failed"}
    monkeypatch.setattr(chat, "retrieval_service", SimpleNamespace(search_stream=retrieval, search=AsyncMock(return_value=result)))
    monkeypatch.setattr(chat, "agentic_retrieval_service", SimpleNamespace(search_stream=agent, search=AsyncMock(
        return_value=SimpleNamespace(retrieval_result=result, metadata=lambda: {"enabled": True}))))
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(
        stream_generate_response=generation, generate_response=AsyncMock(return_value=nonstream)))
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    return app


async def send(client, transport, session="receipt", mode="direct"):
    fields = {"message": "每日限额是多少", "sessionId": session, "agentMode": mode}
    if transport == "nonstream":
        response = await client.post("/api/chat/message", json=fields)
        return response, response.json()
    response = await client.post("/api/chat/stream", data=fields) if transport == "post" else await client.get("/api/chat/stream", params=fields)
    return response, [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")][-1]


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["get", "post"])
async def test_stream_persists_coverage_finalized_during_generation(monkeypatch, transport):
    app = install_runtime(monkeypatch)
    async def generate(**kwargs):
        kwargs["retrieval_result"].debug_info["decision_coverage"] = {
            "version": "decision-coverage-v1", "modalities": {"audio": {"context_count": 2}}}
        yield SimpleNamespace(type="message", data={"content": ANSWER})
        yield SimpleNamespace(type="done", data={})
    monkeypatch.setattr(chat.generation_service, "stream_generate_response", generate)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        _, terminal = await send(client, transport)
        history = (await client.get("/api/chat/history", params={"sessionId": "receipt"})).json()
    assert terminal["diagnostics"]["retrieval"]["decision_coverage"]["modalities"]["audio"]["context_count"] == 2
    assert history["messages"][-1]["diagnostics"] == terminal["diagnostics"]


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["get", "post"])
@pytest.mark.parametrize("failure", ["event", "exception", "incomplete"])
async def test_stream_failure_retains_paid_final_context_checkpoint(monkeypatch, transport, failure):
    app = install_runtime(monkeypatch)
    checkpoint = {"mode": "assist", "status": "ok", "evaluated_count": 4,
                  "added_ids": ["extra"], "applied_count": 1}
    async def generate(**kwargs):
        kwargs["retrieval_result"].debug_info["context_checkpoint"] = checkpoint
        yield SimpleNamespace(type="message", data={"content": "partial"})
        if failure == "event":
            yield SimpleNamespace(type="error", data={"error": "failed after context"})
        elif failure == "exception":
            raise RuntimeError("failed after context")
    monkeypatch.setattr(chat.generation_service, "stream_generate_response", generate)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        _, terminal = await send(client, transport)
        history = (await client.get("/api/chat/history", params={"sessionId": "receipt"})).json()
    assert terminal["type"] == "error"
    assert terminal["diagnostics"]["retrieval"]["context_checkpoint"] == checkpoint
    assert history["messages"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["get", "post", "nonstream"])
@pytest.mark.parametrize("mode", ["direct", "agent"])
@pytest.mark.parametrize("enabled", [True, False])
async def test_same_receipt_in_response_history_and_legacy_aliases(monkeypatch, transport, mode, enabled):
    app = install_runtime(monkeypatch, enabled=enabled)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response, terminal = await send(client, transport, mode=mode)
        history = (await client.get("/api/chat/history", params={"sessionId": "receipt"})).json()
    assert response.status_code == 200
    saved = history["messages"][-1]
    receipt = terminal["diagnostics"]
    assert saved["content"] == ANSWER
    assert saved["diagnostics"] == receipt
    assert saved["retrieval_diagnostics"] == receipt["retrieval"]
    if enabled:
        assert receipt["retrieval"]["runs"][0]["jev_decision"] == INTENT
        assert receipt["retrieval"]["runs"][0]["reranking_scorer"] == SCORER
        unit = receipt["jev_citation_audit"]["units"][0]
        assert unit["statement"] == "😀每日限额600次[1]"
        assert unit["result"]["answers"]["relation"]["choice"] == "contradicted"
        assert "statement" not in AUDIT["units"][0]  # Original auditor receipt stays immutable.
        if transport == "nonstream":
            assert terminal["metadata"]["jev_citation_audit"] == receipt["jev_citation_audit"]
    else:
        assert "jev_citation_audit" not in receipt
        assert all(receipt["retrieval"]["runs"][0][field]["status"] == "disabled"
                   for field in ("jev_decision", "reranking_scorer"))


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["get", "post"])
@pytest.mark.parametrize("mode", ["direct", "agent"])
async def test_stream_final_additions_exclude_same_chunk_bound_by_inline_reference(monkeypatch, transport, mode):
    app = install_runtime(monkeypatch)
    monkeypatch.setattr(chat, "get_jev_config", lambda: config(rerank_mode="assist"))
    source = {"id": "bound", "content_type": "doc", "reference_name": "bound.txt",
              "payload": {"kb_id": "kb", "file_id": "file", "text_content": "Original bound input."}}
    marker = {"decision_assist": {"choice": "answer_bearing"}}
    result = SimpleNamespace(
        debug_info={"reranking_scorer": {"mode": "assist", "status": "ok", "added_ids": ["bound", "extra"]}},
        reranked_results=[{"id": "baseline"}, {**source, "metadata": marker},
                          {"id": "extra", "metadata": marker}],
    )
    async def search(**kwargs):
        yield "_result", result if mode == "direct" else SimpleNamespace(
            retrieval_result=result, metadata=lambda: {"enabled": True})
    async def generation(**kwargs):
        rows = kwargs["retrieval_result"].reranked_results
        assert [row["id"] for row in rows] == ["bound", "baseline", "extra"]
        assert rows[0]["metadata"] == {"user_reference": True}
        assert rows[-1]["metadata"].get("decision_assist")
        yield SimpleNamespace(type="message", data={"content": ANSWER})
        yield SimpleNamespace(type="done", data={"jev_citation_audit": AUDIT})
    loader = AsyncMock(return_value=[source])
    monkeypatch.setattr(chat, "retrieval_service", SimpleNamespace(search_stream=search, load_reference_materials=loader))
    monkeypatch.setattr(chat, "agentic_retrieval_service", SimpleNamespace(search_stream=search))
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(stream_generate_response=generation))
    fields = {
        "message": "@bound.txt contains the input", "sessionId": "bound-receipt", "agentMode": mode,
        "referenceFiles": json.dumps([{"kb_id": "kb", "file_id": "file", "name": "bound.txt"}]),
        "mentions": json.dumps([{"source": "knowledge", "kbId": "kb", "fileId": "file",
                                 "name": "bound.txt", "start": 0, "end": 10}]),
    }
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/chat/stream", data=fields) if transport == "post" else await client.get("/api/chat/stream", params=fields)
        history = (await client.get("/api/chat/history", params={"sessionId": "bound-receipt"})).json()
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
    terminal = events[-1]
    assert terminal["type"] == "complete", events
    receipt = terminal["diagnostics"]
    assert receipt["retrieval"]["final_added_ids"] == ["extra"]
    assert receipt["retrieval"]["runs"][0]["reranking_scorer"]["added_ids"] == ["bound", "extra"]
    saved = history["messages"][-1]
    assert saved["diagnostics"] == receipt
    assert saved["retrieval_diagnostics"] == receipt["retrieval"]
    assert saved["content"] == ANSWER
    loader.assert_awaited_once()


@pytest.mark.parametrize("debug,field,reason", [
    ({"fast_path": "standalone_greeting"}, "jev_decision", "fast_path"),
    ({"fast_path": "empty_index"}, "reranking_scorer", "fast_path"),
    ({"preplanned_query": True}, "jev_decision", "preplanned"),
    ({"total_candidates": 0, "reranking_scorer": {"mode": "off"}}, "reranking_scorer", "no_candidates"),
    ({}, "jev_decision", "not_recorded"),
])
def test_proven_skips_are_distinct_from_unknown_execution(debug, field, reason):
    result = retrieval_diagnostics(SimpleNamespace(debug_info=debug), config())
    record = result["runs"][0][field]
    assert record["reason"] == reason
    assert record["status"] == ("unavailable" if reason == "not_recorded" else "skipped")


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["get", "post", "nonstream"])
async def test_generation_failure_keeps_retrieval_diagnostics_without_saving_success(monkeypatch, transport):
    app = install_runtime(monkeypatch, generation_failure=True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        _, terminal = await send(client, transport)
    assert terminal["diagnostics"]["retrieval"]["runs"][0]["reranking_scorer"] == SCORER
    assert terminal["diagnostics"]["jev_citation_audit"]["reason"] == "generation_not_completed"
    assert chat.sessions["receipt"]["messages"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("transport", ["get", "post", "nonstream"])
async def test_strict_failure_keeps_selected_route_and_next_request_recovers(monkeypatch, transport):
    app = install_runtime(monkeypatch)
    good_service = chat.retrieval_service
    async def fail_stream(**kwargs):
        yield "intent", {"jev_decision": INTENT, "stage_status": "completed"}
        raise JevRequiredError("rerank", "timeout")
    monkeypatch.setattr(chat, "retrieval_service", SimpleNamespace(
        search_stream=fail_stream, search=AsyncMock(side_effect=JevRequiredError("rerank", "timeout"))))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response, terminal = await send(client, transport)
        receipt = terminal["diagnostics"]
        assert receipt["code"] == "jev_required_failed"
        assert receipt["fallback_used"] is False
        assert receipt["retrieval"]["jev_config"]["model"] == "openai/gpt-6-luna-decisions"
        run = receipt["retrieval"]["runs"][0]
        assert run["reranking_scorer"]["status"] == "failed"
        assert run["reranking_scorer"]["reason"] == "timeout"
        if transport != "nonstream":
            assert run["jev_decision"] == INTENT
        else:
            assert response.status_code == 502
        assert chat.sessions["receipt"]["messages"] == []
        monkeypatch.setattr(chat, "retrieval_service", good_service)
        _, recovered = await send(client, transport)
    assert "code" not in recovered["diagnostics"]
    assert len(chat.sessions["receipt"]["messages"]) == 2


def test_multiple_agent_runs_preserve_identity_and_diagnostic_projection_has_no_raw_sources():
    debug = {"retrieval_runs": [
        {"jev_decision": INTENT, "raw_prompt": "private", "api_key": "secret"},
        {"preplanned_query": True, "total_candidates": 0, "source_content": "private"},
    ]}
    result = retrieval_diagnostics(SimpleNamespace(debug_info=debug), config())
    assert len(result["runs"]) == 2
    assert result["runs"][0]["jev_decision"] == INTENT
    assert result["runs"][1]["jev_decision"]["reason"] == "preplanned"
    assert "private" not in json.dumps(result) and "secret" not in json.dumps(result)
    bad_offsets = {"units": [{"start": -1, "end": 99}, {"start": True, "end": 1}]}
    assert all("statement" not in unit for unit in chat_diagnostics(result, citation_audit=bad_offsets, answer=ANSWER)["jev_citation_audit"]["units"])


def test_final_added_ids_describe_merged_output_not_per_run_proposals():
    result = SimpleNamespace(
        debug_info={"retrieval_runs": [
            {"reranking_scorer": {"mode": "assist", "status": "ok", "added_ids": ["one", "two"]}},
            {"reranking_scorer": {"mode": "assist", "status": "ok", "added_ids": ["three", "four"]}},
        ]},
        reranked_results=[{"id": "baseline"}, {"id": "one", "metadata": {"decision_assist": {"choice": "answer_bearing"}}},
                          {"id": "three", "metadata": {"decision_assist": {"choice": "answer_bearing"}}}],
    )
    assert retrieval_diagnostics(result, config(rerank_mode="assist"))["final_added_ids"] == ["one", "three"]
    result.reranked_results = [{"id": "baseline"}]
    assert retrieval_diagnostics(result, config(rerank_mode="assist"))["final_added_ids"] == []
    assert "final_added_ids" not in retrieval_diagnostics(None, config(rerank_mode="assist"))
    assert "final_added_ids" not in retrieval_diagnostics(result, config(rerank_mode="off"))


@pytest.mark.parametrize("rerank_mode", ["assist", "shadow", "replace", "force"])
def test_required_intent_failure_marks_unreached_rerank_as_upstream_failed(rerank_mode):
    selected = config(intent_mode="force", rerank_mode=rerank_mode)
    receipt = failure_diagnostics(retrieval_diagnostics(None, selected), selected,
                                  required_failure=JevRequiredError("intent", "timeout"))
    run = receipt["retrieval"]["runs"][0]
    assert run["jev_decision"]["status"] == "failed"
    assert run["reranking_scorer"] == {
        "mode": rerank_mode, "status": "skipped", "reason": "upstream_failed",
    }


@pytest.mark.parametrize("rerank_record", [
    {"mode": "force", "status": "ok", "model": "recorded-model"},
    {"mode": "shadow", "status": "fallback", "reason": "timeout"},
    {"mode": "assist", "status": "skipped", "reason": "no_candidates"},
])
def test_required_intent_failure_does_not_relabel_existing_rerank_receipt(rerank_record):
    selected = config(intent_mode="force")
    retrieval = retrieval_diagnostics(None, selected, observed={"reranking_scorer": rerank_record})
    receipt = failure_diagnostics(retrieval, selected, required_failure=JevRequiredError("intent", "timeout"))
    assert receipt["retrieval"]["runs"][0]["reranking_scorer"] == rerank_record
    assert retrieval["runs"][0]["jev_decision"]["status"] == "unavailable"


def test_required_intent_failure_keeps_rerank_disabled_when_off():
    selected = config(intent_mode="force", rerank_mode="off")
    receipt = failure_diagnostics(retrieval_diagnostics(None, selected), selected,
                                  required_failure=JevRequiredError("intent", "timeout"))
    assert receipt["retrieval"]["runs"][0]["reranking_scorer"] == {"mode": "off", "status": "disabled"}
