import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.contracts import Evidence, RunBudget
from app.modules.pi_agent.gateway import KnowledgeGateway
from app.modules.pi_agent.policy import BudgetLedger, ToolError
from app.modules.pi_agent.supervisor import WORKER
from test_pi_agent_supervisor import ReasoningRegistry, make_host, request
from test_pi_agent_tools import fixture_tools, source


@pytest.mark.parametrize("first,second", [
    ("check_answer", "check_answer"), ("check_answer", "recall_evidence"),
    ("recall_evidence", "check_answer"),
])
def test_closing_check_shares_the_single_recall_allowance(first, second):
    ledger = BudgetLedger(RunBudget(), answer_checks_enabled=True, finalizing=True)
    assert ledger.admit_main_model(1, 100, 256)["allow_check_answer"]
    ledger.reserve_tool(first)
    with pytest.raises(ToolError, match="收尾"):
        ledger.reserve_tool(second)
    assert ledger.closing_reads == ledger.tool_calls == 1
    admission = ledger.admit_main_model(2, 100, 256)
    assert not admission["allow_check_answer"] and not admission["allow_recall"]
    for tool in ("search", "read_source", "expand_context", "inspect_media"):
        with pytest.raises(ToolError):
            ledger.reserve_tool(tool)
    ledger.reserve_tool("submit_answer")
    assert ledger.tool_calls == 2


def test_default_closing_policy_and_admission_shape_are_unchanged():
    ledger = BudgetLedger(RunBudget(), finalizing=True)
    assert set(ledger.admit_main_model(1, 100, 256)) == {
        "allowed", "max_output_tokens", "final_turn", "allow_recall"}
    with pytest.raises(ToolError):
        ledger.reserve_tool("check_answer")
    ledger.reserve_tool("recall_evidence")
    ledger.reserve_tool("submit_answer")


@pytest.mark.parametrize("case", ["tokens", "model_slots", "tool_slots"])
def test_check_is_unavailable_when_no_closing_work_can_be_admitted(case):
    ledger = BudgetLedger(RunBudget(model_tokens=2000, output_tokens=256,
        model_requests=2, tool_calls=4), answer_checks_enabled=True, finalizing=True)
    if case == "tokens":
        ledger.model_tokens = 1200
        result = ledger.admit_main_model(1, 1000, 256)
        assert not result["allowed"] and ledger.model_requests == 0
    elif case == "model_slots":
        ledger.model_requests = 1
        result = ledger.admit_main_model(2, 100, 256)
    else:
        ledger.tool_calls = 2
        result = ledger.admit_main_model(1, 100, 256)
    assert not result["allow_check_answer"]
    with pytest.raises(ToolError):
        ledger.reserve_tool("check_answer")


@pytest.mark.asyncio
async def test_oversized_closing_check_consumes_its_slot_without_publishing_a_draft(tmp_path):
    tools, _, _, events = fixture_tools(tmp_path, RunBudget(tool_output_chars=1000))
    tools.ledger.answer_checks_enabled = True
    tools.ledger.finalizing = True
    result = await tools.execute("large", "check_answer", {"answer": "草稿" * 600,
        "status": "partial", "limitations": ["尚未找到支持"], "statements": [
            {"unit_id": "a1", "kind": "abstention"}, {"unit_id": "l1", "kind": "limitation"}]})
    assert result["isError"] and result["details"]["code"] == "tool_output_too_large"
    assert "checked_answer_span_id" not in result["details"] and tools.final_result is None
    assert tools.ledger.closing_reads == 1
    assert not any(kind == "tool.completed" for kind, _ in events)
    denied = await tools.execute("again", "check_answer", {"answer": "本次未找到支持"})
    assert denied["isError"] and denied["details"]["code"] == "research_budget_exhausted"


@pytest.mark.asyncio
@pytest.mark.parametrize("choice", ["check_answer", "recall_evidence", "same_batch", "same_batch_reverse"])
async def test_real_pi_closing_choice_returns_feedback_and_preserves_submission(tmp_path, monkeypatch, choice):
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

    host = make_host(tmp_path, monkeypatch, answer_checks_enabled=True, yield_to_legacy=False,
        budget=RunBudget(model_requests=4))
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
        assert saved["state"]["usage"]["tool_calls"] == 4
        available = lambda request: {t["function"]["name"] for t in request["tools"]}
        assert available(requests[2]) == {"check_answer", "recall_evidence", "submit_answer", "ask_user"}
        assert available(requests[3]) == {"submit_answer", "ask_user"}
        closing = next(e for e in events if e["type"] == "budget.finalizing")
        executed = [e for e in events if e["type"] == "tool.started" and e["seq"] > closing["seq"]]
        selected = "recall_evidence" if choice in {"recall_evidence", "same_batch_reverse"} else "check_answer"
        assert [e["data"]["name"] for e in executed] == [selected, "submit_answer"]
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
        if choice in {"same_batch", "same_batch_reverse"}:
            refused = "recall_evidence" if choice == "same_batch" else "check_answer"
            assert any(e["type"] == "tool.rejected" and e["data"]["name"] == refused for e in events)
    finally:
        await host.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
