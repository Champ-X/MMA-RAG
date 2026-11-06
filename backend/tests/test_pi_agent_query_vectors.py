import asyncio
import sys
from threading import Event
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.query_vectors import LocalQueryVectors, QueryVectorUnavailable


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,module", [("sparse", "app.core.sparse_encoder"),
                                       ("clip", "app.core.local_models"), ("clap", "app.core.local_models")])
async def test_unprepared_encoders_are_not_imported_instantiated_or_loaded(monkeypatch, kind, module):
    monkeypatch.delitem(sys.modules, module, raising=False)
    with pytest.raises(QueryVectorUnavailable, match="local_model_not_ready"):
        await LocalQueryVectors().encode(kind, "query")
    assert module not in sys.modules


@pytest.mark.asyncio
async def test_exact_successful_query_vectors_are_shared_within_run_without_caching_failures(monkeypatch):
    calls = []
    def encode(query):
        calls.append(query)
        return {"sparse": {4: 1.}}
    model = SimpleNamespace(_model=object(), _initialized=True, encode_query=encode)
    monkeypatch.setitem(sys.modules, "app.core.sparse_encoder", SimpleNamespace(_sparse_encoder=model))
    vectors = LocalQueryVectors()
    results = await asyncio.gather(vectors.encode("sparse", "query"), vectors.encode("sparse", "query"))
    assert results == [{4: 1.}, {4: 1.}]
    assert calls == ["query"]
    model._initialized = False
    with pytest.raises(QueryVectorUnavailable, match="local_model_not_ready"):
        await vectors.encode("sparse", "new query")
    model._initialized = True
    assert await vectors.encode("sparse", "new query") == {4: 1.}
    assert calls == ["query", "new query"]


@pytest.mark.asyncio
async def test_native_uses_shared_loaded_runtime_and_rejects_unloaded_model(monkeypatch):
    calls = []
    runtime = SimpleNamespace(snapshot=lambda: {"clip": {"loaded": True}, "clap": {"loaded": False}},
        encode_clip_text=lambda query: calls.append(query) or [1., 0.],
        encode_clap_text=lambda query: pytest.fail("An unloaded model must not start loading"))
    monkeypatch.setitem(sys.modules, "app.core.local_models", SimpleNamespace(_runtime=runtime))
    vectors = LocalQueryVectors()
    assert await vectors.encode("clip", "shapes") == [1., 0.]
    assert calls == ["shapes"]
    with pytest.raises(QueryVectorUnavailable, match="local_model_not_ready"):
        await vectors.encode("clap", "sound")


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [{"sparse": {}}, {"sparse": {-1: 1.}}, {"sparse": {1: float("nan")}},
                                    {"sparse": {True: 1.}}, None])
async def test_invalid_local_vector_is_not_returned_or_cached(monkeypatch, value):
    model = SimpleNamespace(_model=object(), _initialized=True, encode_query=lambda query: value)
    monkeypatch.setitem(sys.modules, "app.core.sparse_encoder", SimpleNamespace(_sparse_encoder=model))
    with pytest.raises(QueryVectorUnavailable, match="invalid_local_vector"):
        await LocalQueryVectors().encode("sparse", "query")


@pytest.mark.asyncio
async def test_cancellation_settles_local_thread_before_releasing_capacity(monkeypatch):
    entered, release, completed = Event(), Event(), Event()
    def encode(query):
        entered.set()
        assert release.wait(2)
        completed.set()
        return {"sparse": {1: 1.}}
    model = SimpleNamespace(_model=object(), _initialized=True, encode_query=encode)
    monkeypatch.setitem(sys.modules, "app.core.sparse_encoder", SimpleNamespace(_sparse_encoder=model))
    vectors = LocalQueryVectors()
    task = asyncio.create_task(vectors.encode("sparse", "query"))
    await asyncio.to_thread(entered.wait, 2)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done() and vectors._lock.locked()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert completed.is_set() and not vectors._lock.locked()
    assert not vectors._values
