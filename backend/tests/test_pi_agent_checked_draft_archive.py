"""Only durable draft checks may become context-archive references."""
import json

import pytest

from app.modules.pi_agent.policy import ToolError
from test_pi_agent_tools import fixture_tools, source


@pytest.mark.asyncio
@pytest.mark.parametrize("valid", [False, True])
async def test_completed_check_attests_saved_arguments_and_exact_result(tmp_path, valid):
    tools, store, run, _ = fixture_tools(tmp_path, requirement_limit=4)
    tools.emit = lambda kind, data, **kw: store.append(run, kind, data, **kw)
    await tools.execute("read", "read_source", {"source_id": source().id})
    args = {"answer": ("实际原文" if valid else "实际原文重复表达") + "[1]", "evidence_ids": [1],
            "statements": [{"unit_id": "a1", "kind": "fact", "source_spans": ["e1s1"]}]}
    result = await tools.execute("checked-draft", "check_answer", args)
    assert not result.get("isError") and not tools.final_result
    assert result["details"]["checked_answer_span_id"] == "tool:checked-draft"
    artifact = store.artifact(run, result["details"]["artifact_id"])
    assert artifact == json.loads(result["content"][0]["text"])
    assert artifact["protocol_valid"] is valid
    events = [e for e in store.events(run) if e["span_id"] == "tool:checked-draft"]
    assert [e["type"] for e in events] == ["tool.started", "tool.completed"]
    assert events[0]["data"]["args"]["answer"] == args["answer"]
    assert events[1]["data"]["artifact_id"] == result["details"]["artifact_id"]
    assert store.evidence(run)[0].content == "实际原文"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["disabled", "arguments", "budget", "output", "artifact", "event"])
async def test_rejected_or_unpersisted_checks_never_attest_archival(tmp_path, monkeypatch, failure):
    tools, store, run, _ = fixture_tools(tmp_path, answer_checks_enabled=failure != "disabled")
    def emit(kind, data, **kw):
        if failure == "event" and kind == "tool.completed":
            raise RuntimeError("event was not persisted")
        return store.append(run, kind, data, **kw)
    tools.emit = emit
    args = {"answer": "本次没有取得依据。", "evidence_ids": [], "status": "partial", "outcome": "not_found",
            "limitations": ["尚未读取材料"], "statements": [
                {"unit_id": "a1", "kind": "abstention", "source_spans": []},
                {"unit_id": "l1", "kind": "limitation", "source_spans": []}]}
    if failure == "arguments":
        args["answer"] = []
    elif failure == "budget":
        tools.ledger.tool_calls = tools.ledger.limits.tool_calls
    elif failure == "output":
        def reject_output(_size):
            raise ToolError("tool_output_too_large", "oversized result")
        monkeypatch.setattr(tools.ledger, "account_output", reject_output)
    elif failure == "artifact":
        def reject_artifact(*_args):
            raise RuntimeError("artifact was not persisted")
        monkeypatch.setattr(store, "put_artifact", reject_artifact)
    result = await tools.execute("check", "check_answer", args)
    assert result["isError"] and not tools.final_result
    assert "checked_answer_span_id" not in result["details"]
    assert not any(e["type"] == "tool.completed" for e in store.events(run))
