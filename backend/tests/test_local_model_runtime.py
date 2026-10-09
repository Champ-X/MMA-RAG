"""Local inference is shared and safe without downloading any model weights."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import threading
import time
from types import SimpleNamespace

import pytest
import torch

from app.core.local_models import LocalModelRuntime


@pytest.fixture(autouse=True)
def prevent_real_model_loading(monkeypatch):
    def unexpected_load(self):
        raise AssertionError("unit tests must not load model weights")

    monkeypatch.setattr(LocalModelRuntime, "_load_clip_pair", unexpected_load)
    monkeypatch.setattr(LocalModelRuntime, "_load_clap_pair", unexpected_load)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)


@pytest.mark.parametrize("kind", ["clip", "clap"])
def test_concurrent_sessions_load_once_and_serialize_model_use(monkeypatch, kind):
    runtime = LocalModelRuntime()
    pair = (object(), object())
    loaded, release = threading.Event(), threading.Event()
    barrier = threading.Barrier(4)
    loads = 0
    active = 0
    maximum_active = 0

    def load():
        nonlocal loads
        loads += 1
        loaded.set()
        assert release.wait(2)
        return (*pair, "local")

    monkeypatch.setattr(runtime, f"_load_{kind}_pair", load)

    def use():
        nonlocal active, maximum_active
        barrier.wait(timeout=2)
        with getattr(runtime, f"{kind}_session")() as acquired:
            active += 1
            maximum_active = max(maximum_active, active)
            assert acquired == pair
            # Snapshot must be available during inference, including for this thread.
            assert runtime.snapshot()[kind]["loaded"]
            time.sleep(0.01)
            active -= 1
            return acquired

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(use) for _ in range(4)]
        try:
            assert loaded.wait(2)
            snapshot = runtime.snapshot()[kind]
            assert snapshot["state"] == "loading"
            assert not snapshot["loaded"]
            assert loads == 1
        finally:
            release.set()
        assert all(future.result(timeout=2) == pair for future in futures)

    assert loads == maximum_active == 1
    assert runtime.snapshot()[kind]["load_count"] == 1


def test_clip_and_clap_do_not_share_an_execution_lock(monkeypatch):
    runtime = LocalModelRuntime()
    monkeypatch.setattr(runtime, "_load_clip_pair", lambda: (object(), object(), "local"))
    monkeypatch.setattr(runtime, "_load_clap_pair", lambda: (object(), object(), "local"))
    clip_entered, release_clip = threading.Event(), threading.Event()

    def hold_clip():
        with runtime.clip_session():
            clip_entered.set()
            assert release_clip.wait(2)

    def use_clap():
        with runtime.clap_session():
            return "available"

    with ThreadPoolExecutor(max_workers=2) as pool:
        clip = pool.submit(hold_clip)
        try:
            assert clip_entered.wait(2)
            assert pool.submit(use_clap).result(timeout=1) == "available"
        finally:
            release_clip.set()
        clip.result(timeout=2)


@pytest.mark.parametrize("kind", ["clip", "clap"])
def test_failed_initialization_is_not_published_and_next_request_can_retry(monkeypatch, kind):
    runtime = LocalModelRuntime()
    model, processor = object(), object()
    attempts = 0

    def load():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OSError("processor cache incomplete")
        return model, processor, "local"

    monkeypatch.setattr(runtime, f"_load_{kind}_pair", load)
    with pytest.raises(OSError, match="cache incomplete"):
        with getattr(runtime, f"{kind}_session")():
            pytest.fail("a failed model must not reach inference")
    failed = runtime.snapshot()[kind]
    assert not failed["loaded"] and not failed["warmed"]
    assert failed["load_count"] == 0
    assert failed["error_type"] == "OSError"

    with getattr(runtime, f"{kind}_session")() as pair:
        assert pair == (model, processor)
    recovered = runtime.snapshot()[kind]
    assert recovered["loaded"]
    assert recovered["load_count"] == 1
    assert recovered["load_attempts"] == attempts == 2


def install_fake_models(monkeypatch, runtime):
    calls = {"clip": [], "clap": []}

    def make_pair(kind, dimensions):
        class Processor:
            def tokenizer(self, text, **kwargs):
                assert kwargs == {"return_tensors": "pt", "padding": True, "truncation": True}
                calls[kind].append(("tokenize", text))
                return {"input_ids": torch.tensor([[1, 2]])}

            def __call__(self, *, text):
                calls[kind].append(("tokenize", text))
                return {"input_ids": [[1, 2]]}

        def infer(**inputs):
            assert isinstance(inputs["input_ids"], torch.Tensor)
            calls[kind].append(("inference", inputs["input_ids"].tolist()))
            return torch.tensor([[3.0, 4.0] + [0.0] * (dimensions - 2)])

        model = SimpleNamespace(
            parameters=lambda: iter([SimpleNamespace(device=torch.device("cpu"))]),
            get_text_features=infer,
        )
        return model, Processor(), "local"

    for kind, dimensions in (("clip", 768), ("clap", 512)):
        pair = make_pair(kind, dimensions)
        monkeypatch.setattr(runtime, f"_load_{kind}_pair", lambda pair=pair: pair)
    return calls


@pytest.mark.parametrize("kind,dimensions", [("clip", 768), ("clap", 512)])
def test_warmup_runs_real_encoding_once_and_query_vectors_keep_existing_contract(monkeypatch, kind, dimensions):
    runtime = LocalModelRuntime()
    calls = install_fake_models(monkeypatch, runtime)
    warmup = getattr(runtime, f"warmup_{kind}")
    warmup()
    assert [step for step, _ in calls[kind]] == ["tokenize", "inference"]
    assert warmup()["warmed"]
    assert len(calls[kind]) == 2, "already warm models should not run another startup inference"

    query = "  浴血黑帮 海报与主题曲  "
    vector = getattr(runtime, f"encode_{kind}_text")(query)
    assert vector == pytest.approx([0.6, 0.8] + [0.0] * (dimensions - 2))
    assert calls[kind][-2][1] == (query if kind == "clip" else [query])
    snapshot = runtime.snapshot()[kind]
    assert snapshot["state"] == "ready"
    assert snapshot["load_count"] == snapshot["warmup_count"] == 1


@pytest.mark.parametrize("kind", ["clip", "clap"])
@pytest.mark.parametrize("recovery", ["warmup", "query"])
def test_failed_warmup_can_recover_without_discarding_loaded_weights(monkeypatch, kind, recovery):
    runtime = LocalModelRuntime()
    install_fake_models(monkeypatch, runtime)
    with getattr(runtime, f"{kind}_session")() as (model, _):
        infer = model.get_text_features

    def fail(**inputs):
        raise RuntimeError("temporary inference failure")

    model.get_text_features = fail
    with pytest.raises(RuntimeError, match="temporary inference failure"):
        getattr(runtime, f"warmup_{kind}")()
    failed = runtime.snapshot()[kind]
    assert failed["loaded"] and not failed["warmed"]
    assert failed["warmup_count"] == 0

    model.get_text_features = infer
    if recovery == "warmup":
        getattr(runtime, f"warmup_{kind}")()
    else:
        assert getattr(runtime, f"encode_{kind}_text")("a real query")[:2] == pytest.approx([0.6, 0.8])
    recovered = runtime.snapshot()[kind]
    assert recovered["state"] == "ready" and recovered["warmed"]
    assert recovered["load_count"] == 1
    assert recovered["warmup_count"] == (1 if recovery == "warmup" else 0)
    assert recovered["warmup_attempts"] == (2 if recovery == "warmup" else 1)
    assert recovered["error_type"] is None


@pytest.mark.parametrize("kind", ["clip", "clap"])
@pytest.mark.parametrize("recovery", ["warmup", "query"])
def test_ready_model_recovers_from_query_failure_by_running_inference_again(monkeypatch, kind, recovery):
    runtime = LocalModelRuntime()
    calls = install_fake_models(monkeypatch, runtime)
    warmup = getattr(runtime, f"warmup_{kind}")
    encode = getattr(runtime, f"encode_{kind}_text")
    warmup()
    with getattr(runtime, f"{kind}_session")() as (model, _):
        infer = model.get_text_features

    def fail(**inputs):
        raise RuntimeError("temporary query inference failure")

    model.get_text_features = fail
    with pytest.raises(RuntimeError, match="temporary query inference failure"):
        encode("a real query")
    failed = runtime.snapshot()[kind]
    assert failed["state"] == "error" and failed["error_type"] == "RuntimeError"
    assert failed["loaded"] and failed["warmed"]

    model.get_text_features = infer
    warmup() if recovery == "warmup" else encode("a later query")
    recovered = runtime.snapshot()[kind]
    assert recovered["state"] == "ready" and recovered["error_type"] is None
    assert recovered["loaded"] and recovered["warmed"]
    assert recovered["load_count"] == 1
    assert sum(step == "inference" for step, _ in calls[kind]) == 2
    expected_warmups = 2 if recovery == "warmup" else 1
    assert recovered["warmup_count"] == recovered["warmup_attempts"] == expected_warmups


@pytest.mark.parametrize("processor_missing", [False, True])
def test_cached_pair_avoids_network_and_only_downloads_missing_component(processor_missing):
    calls = []
    model, processor = object(), object()

    class Model:
        @staticmethod
        def from_pretrained(model_id, **kwargs):
            calls.append(("model", model_id, kwargs))
            return model

    class Processor:
        @staticmethod
        def from_pretrained(model_id, **kwargs):
            calls.append(("processor", model_id, kwargs))
            if processor_missing and kwargs.get("local_files_only"):
                raise OSError("not cached")
            return processor

    pair = LocalModelRuntime._cached_pretrained_pair(Model, Processor, "existing/model")
    assert pair[:2] == (model, processor)
    assert calls[:2] == [
        ("model", "existing/model", {"local_files_only": True}),
        ("processor", "existing/model", {"local_files_only": True}),
    ]
    assert calls[2:] == ([("processor", "existing/model", {})] if processor_missing else [])


def test_non_cache_loader_error_does_not_trigger_a_network_retry():
    calls = []

    class BrokenModel:
        @staticmethod
        def from_pretrained(model_id, **kwargs):
            calls.append(kwargs)
            raise RuntimeError("incompatible architecture")

    with pytest.raises(RuntimeError, match="incompatible architecture"):
        LocalModelRuntime._cached_pretrained_pair(BrokenModel, object, "existing/model")
    assert calls == [{"local_files_only": True}]


def test_warmed_runtime_is_reused_by_independent_ingestion_and_search_instances(monkeypatch):
    from app.core import local_models
    from app.modules.ingestion import service
    from app.modules.retrieval import search_engine

    runtime = LocalModelRuntime()
    calls = install_fake_models(monkeypatch, runtime)
    monkeypatch.setattr(local_models, "_runtime", runtime)
    for name in ("ParserFactory", "MinIOAdapter", "VectorStore"):
        monkeypatch.setattr(service, name, lambda: object())
    monkeypatch.setattr(service, "AgenticDocumentChunker", lambda manager: object())
    monkeypatch.setattr(service, "get_sparse_encoder", lambda: object())
    monkeypatch.setattr(search_engine, "VectorStore", lambda: object())
    monkeypatch.setattr(search_engine, "KnowledgeBaseService", lambda: object())
    monkeypatch.setattr(search_engine, "get_sparse_encoder", lambda: object())

    services = [service.IngestionService() for _ in range(2)]
    engines = [search_engine.HybridSearchEngine() for _ in range(2)]
    runtime.warmup_clip()
    runtime.warmup_clap()
    for ingestion in services + [engine.ingestion_service for engine in engines]:
        assert ingestion._get_clap_text_vector("music")[:2] == pytest.approx([0.6, 0.8])
    for engine in engines:
        assert engine._generate_clip_text_vector_sync("poster")[:2] == pytest.approx([0.6, 0.8])

    assert runtime.snapshot()["clip"]["load_count"] == 1
    assert runtime.snapshot()["clap"]["load_count"] == 1
    assert sum(step == "inference" for step, _ in calls["clip"]) == 3
    assert sum(step == "inference" for step, _ in calls["clap"]) == 5
    assert services[0]._processing_status is not services[1]._processing_status


@pytest.mark.asyncio
async def test_clap_query_keeps_event_loop_responsive_and_failure_falls_back():
    from app.modules.ingestion.service import IngestionService

    ingestion = IngestionService.__new__(IngestionService)
    loop_thread = threading.get_ident()
    entered, release = threading.Event(), threading.Event()
    calls = []

    def infer(text):
        calls.append((text, threading.get_ident(), threading.current_thread().name))
        entered.set()
        assert release.wait(2), "CLAP inference blocked the event loop"
        if text == "unavailable":
            raise RuntimeError("CLAP unavailable")
        return [1.0] + [0.0] * 511

    ingestion._get_clap_text_vector = infer
    assert await ingestion.get_clap_text_vector_for_query(" ") is None
    assert calls == []

    async def heartbeat():
        while not entered.is_set():
            await asyncio.sleep(0)
        release.set()

    try:
        vector, _ = await asyncio.wait_for(asyncio.gather(
            ingestion.get_clap_text_vector_for_query("  music  "), heartbeat(),
        ), timeout=3)
    finally:
        release.set()
    assert vector == [1.0] + [0.0] * 511
    assert calls[0][0] == "music"
    assert calls[0][1] != loop_thread and calls[0][2].startswith("clap-query")
    assert await ingestion.get_clap_text_vector_for_query("unavailable") is None
