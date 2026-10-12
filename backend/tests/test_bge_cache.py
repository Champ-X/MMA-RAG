"""Managed BGE cache selection must not download ONNX or accept random heads."""
import json
from types import SimpleNamespace

import pytest

from app.core import bge_cache


def complete_snapshot(path, *, weights="pytorch_model.bin"):
    path.mkdir(exist_ok=True)
    for name in (*bge_cache._REQUIRED, "tokenizer.json", weights):
        (path / name).write_bytes(b"synthetic-test-artifact")
    return path


def test_complete_cache_is_reused_without_hub_metadata_or_download(tmp_path, monkeypatch):
    snapshot = complete_snapshot(tmp_path / "snapshot")
    calls = []

    def snapshot_download(**kwargs):
        calls.append(kwargs)
        assert kwargs == {"repo_id": "BAAI/bge-m3", "local_files_only": True}
        return str(snapshot)

    monkeypatch.setattr(bge_cache, "snapshot_download", snapshot_download)
    monkeypatch.setattr(bge_cache, "hf_hub_download", lambda **kwargs: pytest.fail("complete cache must be offline"))
    assert bge_cache.managed_bge_snapshot("BAAI/bge-m3") == str(snapshot)
    assert len(calls) == 1


@pytest.mark.parametrize("missing", ["sparse_linear.pt", "colbert_linear.pt", "config.json", "tokenizer.json", "pytorch_model.bin"])
def test_incomplete_explicit_snapshot_is_rejected(tmp_path, missing):
    snapshot = complete_snapshot(tmp_path / "snapshot")
    (snapshot / missing).unlink()
    with pytest.raises(ValueError, match="incomplete"):
        bge_cache.managed_bge_snapshot(str(snapshot))


def test_incomplete_cache_downloads_only_one_weight_format_and_inference_files(tmp_path, monkeypatch):
    snapshot = complete_snapshot(tmp_path / "snapshot")
    (snapshot / "sparse_linear.pt").unlink()
    files = {*bge_cache._METADATA, "model.safetensors", "pytorch_model.bin", "onnx/model.onnx", "onnx/model.onnx_data", "tf_model.h5", "README.md"}
    calls = []
    def model_info(**kwargs):
        assert kwargs["timeout"] == 10
        return SimpleNamespace(sha=snapshot.name, siblings=[SimpleNamespace(rfilename=name) for name in files])
    monkeypatch.setattr(bge_cache, "HfApi", lambda: SimpleNamespace(model_info=model_info))

    def download(**kwargs):
        calls.append(kwargs)
        assert kwargs["etag_timeout"] == 10
        path = snapshot / kwargs["filename"]
        path.write_bytes(b"synthetic")
        return str(path)

    monkeypatch.setattr(bge_cache, "snapshot_download", lambda **kwargs: str(snapshot))
    monkeypatch.setattr(bge_cache, "hf_hub_download", download)
    assert bge_cache.managed_bge_snapshot("BAAI/bge-m3") == str(snapshot)
    selected = {call["filename"] for call in calls}
    assert "model.safetensors" in selected
    assert selected.isdisjoint({"pytorch_model.bin", "onnx/model.onnx", "onnx/model.onnx_data", "tf_model.h5", "README.md"})
    assert all(call["revision"] == snapshot.name for call in calls[1:])


def test_download_missing_sparse_head_still_fails_before_flagembedding(tmp_path, monkeypatch):
    snapshot = complete_snapshot(tmp_path / "snapshot")
    (snapshot / "sparse_linear.pt").unlink()
    monkeypatch.setattr(bge_cache, "snapshot_download", lambda **kwargs: str(snapshot))
    monkeypatch.setattr(bge_cache, "hf_hub_download", lambda **kwargs: str(snapshot / kwargs["filename"]))
    monkeypatch.setattr(bge_cache, "HfApi", lambda: SimpleNamespace(model_info=lambda **kwargs: SimpleNamespace(sha=snapshot.name, siblings=[SimpleNamespace(rfilename=name) for name in [*bge_cache._REQUIRED, "tokenizer.json", "pytorch_model.bin"]])))
    with pytest.raises(ValueError, match="sparse_linear.pt"):
        bge_cache.managed_bge_snapshot("BAAI/bge-m3")


def test_weight_index_requires_every_shard(tmp_path):
    snapshot = complete_snapshot(tmp_path / "snapshot", weights="model.safetensors.index.json")
    (snapshot / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {"a": "model-00001-of-00002.safetensors", "b": "model-00002-of-00002.safetensors"}}))
    (snapshot / "model-00001-of-00002.safetensors").write_bytes(b"part-1")
    with pytest.raises(ValueError, match="shards"):
        bge_cache.validate_bge_snapshot(snapshot)
    (snapshot / "model-00002-of-00002.safetensors").write_bytes(b"part-2")
    bge_cache.validate_bge_snapshot(snapshot)


def test_download_meter_counts_only_selected_blobs_and_resume_bytes(tmp_path, monkeypatch):
    from huggingface_hub import constants
    monkeypatch.setattr(constants, "HF_HUB_DISABLE_XET", True)
    snapshot = tmp_path / "snapshots" / ("a" * 40)
    snapshot.mkdir(parents=True)
    blobs = tmp_path / "blobs"
    blobs.mkdir()
    (blobs / (("b" * 64) + ".incomplete")).write_bytes(b"x" * 30)
    (blobs / "unrelated.incomplete").write_bytes(b"x" * 1000)
    row = SimpleNamespace(rfilename="model.safetensors", size=100, lfs=SimpleNamespace(sha256="b" * 64))
    status = bge_cache._download_status(snapshot, [row])
    assert status == {"files_completed": 0, "files_total": 1, "downloaded_bytes": 30, "total_bytes": 100}
    (snapshot / row.rfilename).write_bytes(b"x" * 100)
    assert bge_cache._download_status(snapshot, [row])["downloaded_bytes"] == 100
    monkeypatch.setattr(constants, "HF_HUB_DISABLE_XET", False)
    assert "total_bytes" not in bge_cache._download_status(snapshot, [row])
    monkeypatch.setattr(constants, "HF_HUB_DISABLE_XET", True)
    row.size = None
    assert "total_bytes" not in bge_cache._download_status(snapshot, [row])


def test_model_initialization_keeps_legacy_remote_behavior(tmp_path, monkeypatch):
    from app.core import sparse_encoder
    monkeypatch.delenv("TESSMORA_STATE_DIR", raising=False)
    monkeypatch.setattr(bge_cache, "managed_bge_snapshot", lambda _: pytest.fail("legacy behavior must be unchanged"))
    seen = []
    monkeypatch.setattr(sparse_encoder, "BGEM3FlagModel", lambda model_id, **kwargs: seen.append(model_id) or object())
    sparse_encoder.BGEM3SparseEncoder("BAAI/bge-m3")._ensure_initialized()
    assert seen == ["BAAI/bge-m3"]


def test_managed_construction_remains_lazy_and_rejects_missing_heads(tmp_path, monkeypatch):
    from app.core import sparse_encoder
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path))
    snapshot = complete_snapshot(tmp_path / "snapshot")
    (snapshot / "sparse_linear.pt").unlink()
    monkeypatch.setattr(sparse_encoder, "BGEM3FlagModel", lambda *args, **kwargs: pytest.fail("random sparse heads must never initialize"))
    encoder = sparse_encoder.BGEM3SparseEncoder(str(snapshot))
    assert encoder._model is None
    with pytest.raises(ValueError, match="sparse_linear.pt"):
        encoder._ensure_initialized()
