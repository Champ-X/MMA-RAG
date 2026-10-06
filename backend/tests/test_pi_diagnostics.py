"""Check the measurement harness doesn't alter returned values or exceptions."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

path = Path(__file__).resolve().parents[2] / "scripts" / "serve-pi-diagnostics.py"
spec = importlib.util.spec_from_file_location("pi_diagnostics", path)
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


@pytest.mark.asyncio
async def test_diagnostics_preserve_results_errors_and_omit_payloads(tmp_path):
    result = object()
    async def call(model, payload):
        assert payload == {"api_key": "test-secret", "text": "private source"}
        return result
    async def stream():
        yield "first"
        yield "second"
    async def fail():
        raise ValueError("private provider body")
    target = SimpleNamespace(call=call, stream=stream, fail=fail)
    recorder = diagnostics.Recorder(tmp_path / "spans.jsonl")
    recorder.wrap(target, "call", fields=("model",))
    recorder.wrap(target, "stream")
    recorder.wrap(target, "fail")
    token = diagnostics.request_id.set("pi-control-test")
    try:
        assert await target.call("test-model", {"api_key": "test-secret", "text": "private source"}) is result
        assert [item async for item in target.stream()] == ["first", "second"]
        with pytest.raises(ValueError, match="private provider body"):
            await target.fail()
    finally:
        diagnostics.request_id.reset(token)
    raw = recorder.path.read_text()
    assert "private" not in raw and "test-secret" not in raw
    spans = [json.loads(line) for line in raw.splitlines()]
    assert [span["name"] for span in spans] == ["call", "stream", "fail"]
    assert spans[-1]["error_type"] == "ValueError"
