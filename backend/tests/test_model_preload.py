"""Startup warms actual encoders and survives an individual model failure."""

from types import SimpleNamespace

import pytest

from app.core import local_models, model_preload, sparse_encoder


@pytest.mark.parametrize("failure", [None, "bge_m3", "clip", "clap"])
def test_preload_runs_inference_for_each_shared_model_and_reports_partial_failure(monkeypatch, failure):
    calls = []

    def execute(kind):
        calls.append(kind)
        if failure == kind:
            raise RuntimeError(f"{kind} inference unavailable")
        return {"state": "ready", "loaded": True, "warmed": True}

    def sparse_query(text):
        assert isinstance(text, str) and text.strip()
        execute("bge_m3")
        return {"sparse": {1: 0.5}}

    runtime = SimpleNamespace(
        warmup_clip=lambda: execute("clip"),
        warmup_clap=lambda: execute("clap"),
    )
    monkeypatch.setattr(local_models, "get_local_model_runtime", lambda: runtime)
    monkeypatch.setattr(sparse_encoder, "get_sparse_encoder", lambda: SimpleNamespace(encode_query=sparse_query))

    report = model_preload.preload_local_inference_models_sync()
    assert calls == ["bge_m3", "clip", "clap"]
    assert set(report) == {"bge_m3", "clip", "clap"}
    for kind, result in report.items():
        if kind == failure:
            assert result["state"] == "error"
            assert result["error_type"] == "RuntimeError"
        else:
            assert result["state"] == "ready"
    assert report["bge_m3"]["duration_seconds"] >= 0
