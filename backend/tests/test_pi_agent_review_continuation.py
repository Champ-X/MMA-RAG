import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.contracts import Evidence
from app.modules.pi_agent.gateway import KnowledgeGateway
from app.modules.pi_agent.supervisor import WORKER
from test_pi_agent_supervisor import ReasoningRegistry, make_host, request
from test_pi_agent_tools import fixture_tools, source


@pytest.mark.asyncio
@pytest.mark.parametrize("choice", ["check_answer", "recall_evidence", "same_batch", "same_batch_reverse"])
async def test_real_pi_check_and_recall_can_both_complete_without_closing_allowances(tmp_path, monkeypatch, choice):
    requests = []
    answer = {"answer": "来源数值为17，仅限样本甲。[1]", "evidence_ids": [1],
        "statements": [{"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1"]}]}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            step = len(requests)
            calls = [("submit_answer", answer)]
            if step == 1:
                calls = [("set_answer_requirements", {"max_characters": None, "length_quote": None,
                    "required_points": ["给出原文数值及适用范围"]})]
            elif step == 2:
                calls = [("read_source", {"source_id": source().id})]
            elif step == 3:
                calls = [("recall_evidence", {"evidence_ids": [1]})] if choice == "recall_evidence" else [("check_answer", answer)]
                if choice == "same_batch":
                    calls.append(("recall_evidence", {"evidence_ids": [1]}))
                elif choice == "same_batch_reverse":
                    calls = [("recall_evidence", {"evidence_ids": [1]}), ("check_answer", answer)]
            frames = [
                {"choices": [{"index": 0, "delta": {"tool_calls": [
                    {"index": i, "id": f"closing-{step}-{i}", "type": "function", "function": {
                        "name": tool, "arguments": json.dumps(args, ensure_ascii=False)}}
                    for i, (tool, args) in enumerate(calls)]}}]},
                {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 30, "total_tokens": 130}},
            ]
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(("".join("data: " + json.dumps(f) + "\n\n" for f in frames) + "data: [DONE]\n\n").encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    class LocalRegistry(ReasoningRegistry):
        def get_provider(self, name):
            return SimpleNamespace(api_key="local-fixture-only", base_url=f"http://127.0.0.1:{server.server_port}")

    host = make_host(tmp_path, monkeypatch, answer_checks_enabled=True, yield_to_legacy=False)
    monkeypatch.setattr(SourceCatalog, "load", lambda _, **kwargs: SourceCatalog([source()], {"a": "A"}))

    async def read(_gateway, _source, **_kwargs):
        return [Evidence(source_id=source().id, modality="doc", file_name=source().name,
            content="来源数值为17，仅限样本甲。", version="fixture-v1", observation="parsed_text",
            citation={"type": "doc", "file_name": source().name})], {"status": "ok"}

    monkeypatch.setattr(KnowledgeGateway, "read", read)
    host.registry, host.worker = LocalRegistry(), WORKER
    spec = request()
    spec.knowledge_base_ids = ["a"]
    try:
        run = await host.start(spec, "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 8)
        saved, events = host.store.get(run["id"]), host.store.events(run["id"])
        assert saved["status"] == "completed" and saved["state"]["answer"] == answer["answer"]
        assert len(requests) == saved["state"]["usage"]["model_requests"] == 4
        assert saved["state"]["usage"]["model_tokens"] == 520
        assert saved["state"]["usage"]["tool_calls"] == (5 if choice.startswith("same_batch") else 4)
        available = lambda request: {t["function"]["name"] for t in request["tools"]}
        assert available(requests[2]) == available(requests[3])
        assert {"check_answer", "recall_evidence", "search", "read_source"} <= available(requests[3])
        assert not any(e["type"] == "budget.finalizing" for e in events)
        selected = "recall_evidence" if choice in {"recall_evidence", "same_batch_reverse"} else "check_answer"
        payload = next(m["content"] for m in requests[3]["messages"] if m.get("tool_call_id") == "closing-3-0")
        report = json.loads(payload)
        completion = next(e for e in events if e["type"] == "tool.completed" and e["span_id"] == "tool:closing-3-0")
        assert host.store.artifact(run["id"], completion["data"]["artifact_id"]) == report
        if selected == "check_answer":
            assert report["protocol_valid"] and report["statements"][0]["source_spans"][0]["text"] == "来源数值为17，仅限样本甲。"
            assert "not independently verified" in report["semantic_support"]
        else:
            assert report["evidence"][0]["id"] == 1
            assert report["evidence"][0]["content_units"][0]["text"] == "来源数值为17，仅限样本甲。"
        assert not any(e["type"] == "tool.rejected" for e in events)
    finally:
        await host.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
