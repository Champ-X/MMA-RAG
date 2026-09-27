"""Measured stage durations survive SSE, terminal failures, and history reloads."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from app.api import chat
from app.core.llm.jev import JevRequiredError
from app.core.stage_timing import StageTimings
from app.modules.retrieval.service import RetrievalService


class Clock:
    def __init__(self):
        self.now = 100.0
        self.wall = 1_700_000_000.0

    def advance(self, seconds):
        self.now += seconds
        self.wall += seconds

    def timer(self):
        return StageTimings(monotonic=lambda: self.now, wall_time=lambda: self.wall)


def test_stage_clock_is_monotonic_frozen_and_not_restarted_by_progress():
    clock = Clock()
    timings = clock.timer()
    started = timings.start("intent")
    clock.advance(.5)
    clock.wall -= 3600  # OS clock adjustments must not corrupt durations.
    repeated = timings.start("intent")
    assert repeated["started_at"] == started["started_at"]
    assert repeated["duration_ms"] == 500
    finished = timings.finish("intent", substage_durations_ms={"recognition": 200, "rewrite": 300})
    clock.advance(10)
    timings.finish_active("failed")
    assert timings.snapshot()["intent"] == finished
    assert finished["status"] == "completed"
    assert finished["duration_ms"] == 500
    assert timings.finish("routing") is None
    assert "routing" not in timings.snapshot()
    copied = timings.snapshot()
    copied["intent"]["substage_durations_ms"]["rewrite"] = -1
    assert timings.snapshot()["intent"]["substage_durations_ms"]["rewrite"] == 300


def make_service(clock, *, failure=None):
    service = RetrievalService.__new__(RetrievalService)
    prepared = {
        "original_query": "茶叶驯化史", "refined_query": "茶叶驯化历史",
        "intent_type": "factual", "is_complex": False,
        "search_strategies": {"dense_query": "茶叶驯化历史", "multi_view_queries": [], "sparse_keywords": ["茶叶", "驯化"]},
        "stage_times": {"intent": .4, "rewrite": .9},
    }
    async def fast(*args, **kwargs):
        clock.advance(.2)
        return None
    async def preprocess(**kwargs):
        clock.advance(1.3)
        return prepared
    async def route(*args, **kwargs):
        clock.advance(.2)
        return SimpleNamespace(target_kb_ids=["tea"], confidence_scores={"tea": .9},
                               target_kbs=[{"id": "tea", "name": "茶史", "score": .9}])
    async def modality(*args, **kwargs):
        clock.advance(.1)
        return prepared, {}
    async def search(*args, **kwargs):
        clock.advance(.7)
        return {"raw_results": {"dense": [{"id": "tea-doc"}]}}
    async def rerank(*args, **kwargs):
        clock.advance(.3)
        if failure:
            raise failure
        return {"results": [{"id": "tea-doc"}], "final_ranking_count": 1}
    service._try_fast_path = fast
    service._preprocess_query = preprocess
    service._route_to_knowledge_bases = route
    service._prepare_target_modality = modality
    service._perform_hybrid_search = search
    service._apply_reranking = rerank
    service._update_retrieval_stats = lambda **kwargs: None
    return service


def install_runtime(monkeypatch, clock, *, failure=None):
    timings = clock.timer()
    monkeypatch.setattr(chat, "StageTimings", lambda: timings)
    monkeypatch.setattr(chat, "sessions", {})
    monkeypatch.setattr(chat, "retrieval_service", make_service(clock, failure=failure))
    async def generation(**kwargs):
        clock.advance(.2)
        yield SimpleNamespace(type="thought", data={"stage": "generation", "status": "building_context"})
        clock.advance(.8)
        yield SimpleNamespace(type="message", data={"content": "茶叶驯化历史回答。"})
        clock.advance(.4)
        yield SimpleNamespace(type="done", data={})
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(stream_generate_response=generation))
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    return app, timings


def parse_events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


@pytest.mark.asyncio
@pytest.mark.parametrize("multipart", [False, True])
async def test_direct_clocks_include_real_work_and_persist_full_thinking(monkeypatch, multipart):
    clock = Clock()
    app, timings = install_runtime(monkeypatch, clock)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        fields = {"message": "介绍茶叶驯化史", "sessionId": "timed", "agentMode": "direct"}
        response = await client.post("/api/chat/stream", data=fields) if multipart else await client.get("/api/chat/stream", params=fields)
        history = (await client.get("/api/chat/history", params={"sessionId": "timed"})).json()
    events = parse_events(response)
    complete = events[-1]
    assert complete["type"] == "complete"
    durations = {stage: timing["duration_ms"] for stage, timing in complete["stage_timings"].items()}
    assert durations == {"intent": 1500, "routing": 300, "retrieval": 1000, "generation": 1400}
    assert all(t["status"] == "completed" for t in complete["stage_timings"].values())
    thoughts = [event["data"] for event in events if event["type"] == "thought"]
    for stage in durations:
        running = next(e for e in thoughts if e["type"] == stage and e["data"].get("stage_timing", {}).get("status") == "processing")
        finished = [e for e in thoughts if e["type"] == stage and e["data"].get("stage_timing", {}).get("status") == "completed"][-1]
        assert running["data"]["stage_timing"]["started_at"] == finished["data"]["stage_timing"]["started_at"]
        assert finished["data"]["stage_timing"]["duration_ms"] == durations[stage]
    saved = history["messages"][-1]
    assert saved["stage_timings"] == complete["stage_timings"] == saved["thinking"]["stage_timings"]
    assert saved["thinking"]["refined_query"] == "茶叶驯化历史"
    assert saved["thinking"]["target_kbs"][0]["name"] == "茶史"
    assert saved["thinking"]["total_found"] == 1
    assert saved["thinking"]["_generation_completed"] is True
    assert saved["stage_timings"]["intent"]["substage_durations_ms"] == {"intent": 400, "rewrite": 900}
    clock.advance(99)
    assert timings.snapshot() == complete["stage_timings"]


@pytest.mark.asyncio
async def test_required_jev_failure_freezes_failed_stage_without_complete_or_saved_success(monkeypatch):
    clock = Clock()
    app, timings = install_runtime(monkeypatch, clock, failure=JevRequiredError("rerank", "timeout"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/chat/stream", params={"message": "茶叶驯化史", "sessionId": "failed", "agentMode": "direct"})
    events = parse_events(response)
    error = events[-1]
    assert error["type"] == "error"
    assert error["stage_timings"]["retrieval"]["status"] == "failed"
    assert error["stage_timings"]["retrieval"]["duration_ms"] == 1000
    assert error["stage_timings"]["intent"]["status"] == "completed"
    assert "generation" not in error["stage_timings"]
    assert not any(e["type"] in {"complete", "message"} for e in events)
    assert chat.sessions["failed"]["messages"] == []
    clock.advance(10)
    assert timings.snapshot() == error["stage_timings"]


@pytest.mark.asyncio
@pytest.mark.parametrize("strategy", ["error", "hybrid_2_way"])
async def test_total_search_failure_is_distinct_from_valid_empty_results(monkeypatch, strategy):
    clock = Clock()
    app, timings = install_runtime(monkeypatch, clock)
    calls = {"rerank": 0, "generation": 0}

    async def search(*args, **kwargs):
        clock.advance(.7)
        return {"raw_results": {}, "strategy": strategy}

    async def rerank(*args, **kwargs):
        calls["rerank"] += 1
        return {"results": []}

    async def generation(**kwargs):
        calls["generation"] += 1
        clock.advance(.2)
        yield SimpleNamespace(type="message", data={"content": "未找到相关资料。"})
        yield SimpleNamespace(type="done", data={})

    chat.retrieval_service._perform_hybrid_search = search
    chat.retrieval_service._apply_reranking = rerank
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(stream_generate_response=generation))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/chat/stream", params={
            "message": "茶叶驯化史", "agentMode": "direct", "sessionId": "search-sentinel",
        })
    events = parse_events(response)
    terminal = events[-1]
    if strategy == "error":
        assert terminal["type"] == "error"
        assert terminal["stage_timings"]["retrieval"]["status"] == "failed"
        assert terminal["stage_timings"]["retrieval"]["duration_ms"] == 700
        assert "generation" not in terminal["stage_timings"]
        assert calls == {"rerank": 0, "generation": 0}
        assert not any(event["type"] in {"message", "complete"} for event in events)
        assert chat.sessions["search-sentinel"]["messages"] == []
        clock.advance(10)
        assert timings.snapshot() == terminal["stage_timings"]
    else:
        assert terminal["type"] == "complete"
        assert terminal["stage_timings"]["retrieval"]["status"] == "completed"
        assert calls == {"rerank": 1, "generation": 1}
        assert chat.sessions["search-sentinel"]["messages"][-1]["content"] == "未找到相关资料。"


@pytest.mark.asyncio
async def test_fast_path_has_no_fabricated_routing_or_retrieval_duration(monkeypatch):
    clock = Clock()
    app, _ = install_runtime(monkeypatch, clock)
    async def fast(*args, **kwargs):
        clock.advance(.1)
        return SimpleNamespace(debug_info={"fast_path": "standalone_greeting"})
    chat.retrieval_service._try_fast_path = fast
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/chat/stream", params={"message": "你好", "agentMode": "direct"})
    complete = parse_events(response)[-1]
    assert complete["type"] == "complete"
    assert set(complete["stage_timings"]) == {"intent", "generation"}
    assert complete["stage_timings"]["intent"]["duration_ms"] == 100


@pytest.mark.asyncio
async def test_agent_rounds_are_preserved_without_inventing_direct_stage_durations(monkeypatch):
    clock = Clock()
    app, _ = install_runtime(monkeypatch, clock)
    rounds = [{"round": 1, "queries": ["茶叶起源"]}, {"round": 2, "queries": ["茶树驯化"]}]
    async def agent(**kwargs):
        yield "retrieval", {"agent_mode": True, "agent_status": "completed", "agent_rounds": rounds}
        yield "_result", SimpleNamespace(retrieval_result=SimpleNamespace(debug_info={}), metadata=lambda: {"enabled": True})
    monkeypatch.setattr(chat, "agentic_retrieval_service", SimpleNamespace(search_stream=agent))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/chat/stream", params={"message": "茶史研究", "agentMode": "agent", "sessionId": "agent"})
    complete = parse_events(response)[-1]
    assert complete["type"] == "complete"
    assert set(complete["stage_timings"]) == {"generation"}
    assert chat.sessions["agent"]["messages"][-1]["thinking"]["agent_rounds"] == rounds


@pytest.mark.asyncio
async def test_generation_without_terminal_done_is_failure(monkeypatch):
    clock = Clock()
    app, _ = install_runtime(monkeypatch, clock)
    async def incomplete(**kwargs):
        clock.advance(.4)
        yield SimpleNamespace(type="message", data={"content": "partial"})
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(stream_generate_response=incomplete))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/chat/stream", params={"message": "茶史", "agentMode": "direct", "sessionId": "incomplete"})
    events = parse_events(response)
    assert events[-1]["type"] == "error"
    assert events[-1]["stage_timings"]["generation"]["status"] == "failed"
    assert events[-1]["stage_timings"]["generation"]["duration_ms"] == 400
    assert not any(e["type"] == "complete" for e in events)
    assert chat.sessions["incomplete"]["messages"] == []


@pytest.mark.asyncio
async def test_cancelled_generation_freezes_clock_without_saving_success(monkeypatch):
    clock = Clock()
    _, timings = install_runtime(monkeypatch, clock)
    entered = asyncio.Event()
    async def pending(**kwargs):
        clock.advance(.5)
        entered.set()
        await asyncio.Future()
        yield
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(stream_generate_response=pending))
    events = []
    async def consume():
        async for line in chat._iter_chat_sse(message="茶史", knowledge_base_ids_csv=None,
                selected_files_raw=None, session_id_opt="cancelled", model=None,
                agent_mode="direct", attachment_context=None):
            events.append(json.loads(line[6:]))
    task = asyncio.create_task(consume())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert timings.snapshot()["generation"]["status"] == "cancelled"
    assert timings.snapshot()["generation"]["duration_ms"] == 500
    assert not any(e["type"] == "complete" for e in events)
    assert chat.sessions["cancelled"]["messages"] == []
