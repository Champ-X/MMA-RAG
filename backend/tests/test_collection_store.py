from concurrent.futures import ThreadPoolExecutor

import pytest

from app.modules.collection.models import CreateRun, public_run
from app.modules.collection.store import CollectionConflict, CollectionStore, canonical_url


def request(**overrides):
    return CreateRun(kb_id="kb", prompt="素材", client_request_id="request-0001", **overrides).model_dump()


def test_request_idempotency_includes_target_scope(tmp_path):
    store = CollectionStore(tmp_path / "runs.db")
    with ThreadPoolExecutor(max_workers=4) as workers:
        runs = list(workers.map(lambda _: store.create(request()), range(4)))
    assert len({run[0]["id"] for run in runs}) == 1
    assert sum(created for _, created in runs) == 1
    changed = {**request(), "kb_id": "another"}
    with pytest.raises(CollectionConflict):
        store.create(changed)


def test_restart_keeps_receipts_and_review_without_automatic_writes(tmp_path):
    path = tmp_path / "runs.db"
    store = CollectionStore(path)
    run, _ = store.create(request())
    store.update(run["id"], status="collecting", candidates=[{
        "id": "item", "status": "processing", "file_id": "file", "processing_id": "process", "_ingest_started": True}])
    review, _ = store.create({**request(), "client_request_id": "request-0002"})
    store.update(review["id"], status="review")
    reopened = CollectionStore(path)
    assert reopened.recover() == 1
    assert reopened.get(run["id"])["status"] == "interrupted"
    assert reopened.get(run["id"])["candidates"][0]["file_id"] == "file"
    assert reopened.get(review["id"])["status"] == "review"
    assert reopened.recover() == 0


def test_canonical_url_preserves_meaningful_query_and_removes_tracking():
    assert canonical_url("HTTPS://Example.com:443/a?utm_source=x&b=2&a=1#section") == "https://example.com/a?a=1&b=2"
    assert canonical_url("https://example.com/a?version=2") != canonical_url("https://example.com/a?version=1")
    with pytest.raises(ValueError):
        canonical_url("file:///etc/passwd")


def test_claims_are_scoped_to_knowledge_base(tmp_path):
    store = CollectionStore(tmp_path / "runs.db")
    first, _ = store.create(request())
    second, _ = store.create({**request(), "client_request_id": "request-0002"})
    store.update(first["id"], candidates=[{"id": "item-a", "status": "processing", "_ingest_started": True}])
    assert store.claim("kb", "sha256", "hash", first["id"], "item-a") is None
    assert store.claim("kb", "sha256", "hash", second["id"], "item-b")["id"] == "item-a"
    assert store.claim("other-kb", "sha256", "hash", second["id"], "item-b") is None


def test_public_run_hides_checkpoint_paths_and_internal_state(tmp_path):
    store = CollectionStore(tmp_path / "runs.db")
    run, _ = store.create(request())
    run = store.update(run["id"], candidates=[{
        "id": "i", "title": "素材", "url": "https://example.com", "source": "url", "status": "ready",
        "_payload": "/private/payload", "_selected": True, "_meta": {"private": "value"}}])
    result = public_run(run)
    assert result["counts"]["ready"] == 1
    assert result["counts"]["selected"] == 1
    assert "_payload" not in result["candidates"][0]
    assert "client_request_id" not in result
