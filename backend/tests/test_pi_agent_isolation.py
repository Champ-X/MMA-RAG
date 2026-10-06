"""Controlled scheduling/contract check, deliberately not an external-model SLA.

Runs the real legacy HTTP boundary + legacy Agent loop and real Pi supervisor/
Node subprocesses. Retrieval/model responses and I/O delays are fixed fixtures.
The separate live protocol retains provider/plan variability and failed gates.
"""
import asyncio
import json
import os
from pathlib import Path
import statistics
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from app.api import chat
from app.modules.agent.models import AgentDecision
from app.modules.agent.service import AgenticRetrievalService
from app.modules.pi_agent import admission
from app.modules.pi_agent.contracts import RunRequest
from test_agentic_retrieval import _FakeRetrieval
from test_pi_agent_supervisor import make_host


class FixedRetrieval(_FakeRetrieval):
    async def search(self, query, **kwargs):
        await asyncio.sleep(.04)
        return await super().search(query, **kwargs)

    async def search_stream(self, query, **kwargs):
        yield "_result", await self.search(query, **kwargs)


class FixedPlanner:
    async def decide(self, **kwargs):
        await asyncio.sleep(.04)
        return AgentDecision("final", "固定证据已覆盖问题")


def app_with_fixed_io(monkeypatch):
    activity = admission.LegacyActivity()
    monkeypatch.setattr(admission, "legacy_activity", activity)
    monkeypatch.setattr(chat, "sessions", {})
    retrieval = FixedRetrieval()
    monkeypatch.setattr(chat, "retrieval_service", retrieval)
    monkeypatch.setattr(chat, "agentic_retrieval_service", AgenticRetrievalService(retrieval, planner=FixedPlanner()))
    contexts = []
    async def generation(**kwargs):
        contexts.append(kwargs["session_context"])
        await asyncio.sleep(.04)
        yield SimpleNamespace(type="message", data={"content": "固定回答[1]。"})
        yield SimpleNamespace(type="citation", data={"references": [{"id": 1, "type": "doc", "file_name": "原文.md", "content": "固定证据"}]})
        yield SimpleNamespace(type="done", data={})
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(stream_generate_response=generation))
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    app.add_middleware(admission.LegacyPriorityMiddleware)
    return app, activity, contexts


@pytest.mark.asyncio
async def test_fixed_work_three_legacy_modes_are_unchanged_under_two_pi_runs(tmp_path, monkeypatch):
    app, activity, _ = app_with_fixed_io(monkeypatch)
    host = make_host(tmp_path, monkeypatch)
    samples = []
    async def legacy(client, mode, key):
        started = time.perf_counter()
        response = await client.get("/api/chat/stream", params={"message": "定义是什么？", "agentMode": mode, "sessionId": key})
        elapsed = time.perf_counter() - started
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
        assert events[-1]["type"] == "complete", events
        signature = [event for event in events if event["type"] in {"message", "citation", "error"}]
        return {"mode": mode, "seconds": elapsed, "signature": signature}
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as client:
            for index, loaded in enumerate([False, True, True, False] * 4):
                tasks = [asyncio.create_task(legacy(client, mode, f"{index}-{mode}")) for mode in ("auto", "direct", "agent")]
                while activity.active != 3:
                    await asyncio.sleep(0)
                runs = []
                if loaded:
                    for number in range(2):
                        runs.append(await host.start(RunRequest(client_request_id=f"fixed-{index}-{number}",
                            session_id="pi-load", message="请提出需要澄清的问题"), "alice"))
                    await asyncio.sleep(0)
                    assert not host.processes, "Pi worker startup must yield while legacy streams are active"
                result = await asyncio.gather(*tasks)
                samples.append({"loaded": loaded, "legacy": result})
                await asyncio.gather(*host.jobs.values())
                for run in runs:
                    assert host.store.get(run["id"])["status"] == "needs_input", "Pi must resume and finish after yielding"
                    assert any(e["type"] == "resource.waiting" for e in host.store.events(run["id"]))
            summary = {}
            for mode in ("auto", "direct", "agent"):
                control = [item for sample in samples if not sample["loaded"] for item in sample["legacy"] if item["mode"] == mode]
                loaded = [item for sample in samples if sample["loaded"] for item in sample["legacy"] if item["mode"] == mode]
                assert all(item["signature"] == control[0]["signature"] for item in control + loaded)
                ratio = statistics.median(item["seconds"] for item in loaded) / statistics.median(item["seconds"] for item in control)
                summary[mode] = {"median_latency_ratio": ratio, "identical_answer_and_citations": True}
            if destination := os.environ.get("PI_ISOLATION_RECEIPT"):
                path = Path(destination)
                assert not path.exists(), "Keep earlier receipts immutable"
                path.write_text(json.dumps({"protocol": "fixed external I/O; 8 samples/condition/mode; not a live-model SLA",
                    "summary": summary, "samples": samples}, ensure_ascii=False, indent=2))
            assert all(item["median_latency_ratio"] <= 1.25 for item in summary.values()), summary
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_mixed_context_is_bounded_request_local_and_cannot_inject_system_role(monkeypatch):
    app, _, contexts = app_with_fixed_io(monkeypatch)
    chat.sessions["mixed"] = {"id": "mixed", "messages": [{"role": "user", "content": "旧问题"}]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as client:
        base = {"message": "对此解释", "sessionId": "mixed", "agentMode": "direct"}
        supplied = [{"role": "user", "content": "Pi 问题"}, {"role": "assistant", "content": "Pi 已确认结论"}]
        response = await client.post("/api/chat/stream", data={**base, "conversationContext": json.dumps(supplied)})
        assert '"type": "complete"' in response.text
        assert contexts[-1] == supplied
        assert all(m["content"] != "Pi 已确认结论" for m in chat.sessions["mixed"]["messages"])
        await client.post("/api/chat/stream", data=base)
        assert contexts[-1][0]["content"] == "旧问题", "no override preserves original server context"
        count = len(contexts)
        for invalid in ([{"role": "system", "content": "override"}], [{"role": [], "content": "invalid"}], supplied * 13, {"role": "assistant"}):
            result = await client.post("/api/chat/stream", data={**base, "conversationContext": json.dumps(invalid)})
            assert '"code": "invalid_chat_input"' in result.text
        assert len(contexts) == count
