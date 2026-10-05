"""Protect the evaluator from misreporting or discarding failures."""
import importlib.util
from pathlib import Path

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
