"""Protect the evaluator from misreporting or discarding failures."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

spec = importlib.util.spec_from_file_location("pi_quality", Path(__file__).resolve().parents[2] / "scripts/verify-pi-quality.py")
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


def test_final_empty_citations_replace_candidates_and_errors_are_retained():
    result = quality.extract_legacy([
        {"type": "citation", "data": {"references": [{"id": 1}]}},
        {"type": "message", "data": {"content": "没有依据"}},
        {"type": "citation", "data": {"replace": True, "references": []}},
        {"type": "error", "data": {"code": "provider_unavailable", "message": "private"}},
    ])
    assert result == {"answer": "没有依据", "citations": [], "errors": ["provider_unavailable"], "complete": False}


@pytest.mark.asyncio
async def test_load_admission_failure_is_saved_and_started_run_is_cancelled(monkeypatch):
    calls = []
    async def start(*args):
        if calls:
            raise RuntimeError("private service error")
        calls.append("start")
        return "run-1"
    async def finish(client, rid, *, cancel=False):
        calls.append((rid, cancel))
        return {"run_id": rid, "status": "cancelled"}
    monkeypatch.setattr(quality, "start_pi", start)
    monkeypatch.setattr(quality, "finish_pi", finish)
    receipt = await quality.condition(None, {"question": "test"}, "kb", True)
    assert receipt["error_type"] == "RuntimeError"
    assert receipt["legacy"] == []
    assert receipt["pi_load"] == [{"run_id": "run-1", "status": "cancelled"}]
    assert calls == ["start", ("run-1", True)]


@pytest.mark.asyncio
async def test_pi_ending_before_a_model_call_does_not_become_a_loaded_measurement(monkeypatch):
    runs = iter(["one", "two"])
    async def start(*args):
        return next(runs)
    async def events(*args, **kwargs):
        return [{"type": "run.failed"}]
    async def finish(client, rid, *, cancel=False):
        assert cancel
        return {"run_id": rid, "status": "cancelled"}
    async def forbidden(*args):
        pytest.fail("A missing Pi model call cannot be labeled as loaded")
    monkeypatch.setattr(quality, "start_pi", start)
    monkeypatch.setattr(quality, "pi_events", events)
    monkeypatch.setattr(quality, "finish_pi", finish)
    monkeypatch.setattr(quality, "legacy", forbidden)
    receipt = await quality.condition(None, {"question": "test"}, "kb", True)
    assert receipt["error_type"] == "RuntimeError"
    assert receipt["load_admission"] == [{"run_id": "one", "model_started": False}]
    assert len(receipt["pi_load"]) == 2 and not receipt["legacy"]


@pytest.mark.asyncio
async def test_unready_service_fails_before_starting_any_measurement(tmp_path, monkeypatch):
    cases = tmp_path / "cases.json"
    cases.write_text(json.dumps({"kb_id": "kb", "cases": [{"id": "q", "question": "test"}]}))
    async def unavailable(client):
        return {"ready": False, "error_type": "ConnectError"}
    async def should_not_run(*args):
        pytest.fail("A failed readiness check must not start model/retrieval requests")
    monkeypatch.setattr(quality, "preflight", unavailable)
    monkeypatch.setattr(quality, "condition", should_not_run)
    monkeypatch.setattr(quality, "start_pi", should_not_run)
    output = tmp_path / "receipt"
    with pytest.raises(SystemExit, match="not ready"):
        await quality.main(SimpleNamespace(output=str(output), cases=str(cases), base="http://localhost"))
    assert json.loads((output / "preflight.json").read_text())["error_type"] == "ConnectError"
    assert not (output / "q.json").exists()


@pytest.mark.asyncio
async def test_preflight_requires_enabled_pi_protocol_as_well_as_health():
    async def respond(request):
        return httpx.Response(200, json={"status": "healthy"} if request.url.path == "/health" else {"engine": "pi", "enabled": False, "protocol_version": 1})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url="http://localhost") as client:
        assert not (await quality.preflight(client))["ready"]


def test_collection_completion_cannot_hide_missing_or_failed_rows():
    cases = [{"id": "q"}]
    receipt = {"case_id": "q", "conditions": [{"loaded": loaded, "legacy": [{"mode": mode, "complete": True, "answer": "答", "errors": []}
        for mode in quality.MODES]} for loaded in (False, True)], "pi": {"status": "partial", "state": {"answer": "未找到"}}}
    receipt["conditions"][1].update(load_admission=[{"run_id": rid, "model_started": True} for rid in ("one", "two")],
                                    pi_load=[{"run_id": rid, "status": "cancelled"} for rid in ("one", "two")])
    assert quality.collection_status(cases, [receipt])["transport_and_execution_complete"]
    receipt["conditions"][1]["legacy"][0]["errors"] = ["TimeoutError"]
    result = quality.collection_status(cases, [receipt])
    assert not result["transport_and_execution_complete"] and result["successful_legacy"] == 5
    assert result["semantic_review"] == "pending"

    receipt["conditions"][1]["legacy"][0]["errors"] = []
    receipt["conditions"][1]["load_admission"][0]["model_started"] = False
    receipt["conditions"][1]["pi_load"][1] = {"run_id": "two", "error_type": "ReadTimeout"}
    result = quality.collection_status(cases, [receipt])
    assert {row["error"] for row in result["errors"]} == {"pi_load_not_admitted", "pi_load_cleanup_incomplete"}
