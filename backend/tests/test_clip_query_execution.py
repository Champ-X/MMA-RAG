"""CLIP queries preserve vectors while leaving the event loop responsive."""

import asyncio
import threading
import time
from types import SimpleNamespace

import pytest

from app.modules.retrieval.search_engine import HybridSearchEngine


@pytest.mark.asyncio
async def test_shared_clip_encoding_allows_event_loop_heartbeat():
    loop_thread = threading.get_ident()
    entered, release = threading.Event(), threading.Event()
    heartbeat, workers = [], []
    query = "  浴血黑帮 海报  "

    def encode(text):
        assert text == query
        workers.append((threading.get_ident(), threading.current_thread().name))
        entered.set()
        assert release.wait(1.0), "CLIP blocked the event-loop heartbeat"
        return [0.6, 0.8] + [0.0] * 766

    engine = HybridSearchEngine.__new__(HybridSearchEngine)
    engine.local_models = SimpleNamespace(encode_clip_text=encode)

    async def beat():
        while not entered.is_set():
            await asyncio.sleep(0)
        for _ in range(3):
            await asyncio.sleep(0)
            heartbeat.append(threading.get_ident())
        release.set()

    try:
        vector, _ = await asyncio.wait_for(asyncio.gather(
            engine._generate_clip_text_vector(query), beat(),
        ), timeout=2.0)
    finally:
        release.set()

    assert vector == [0.6, 0.8] + [0.0] * 766
    assert heartbeat == [loop_thread] * 3
    assert len(workers) == 1
    assert workers[0][0] != loop_thread and workers[0][1].startswith("clip-query")


@pytest.mark.asyncio
async def test_concurrent_clip_queries_are_serial_across_search_engines():
    loop_thread = threading.get_ident()
    active = maximum_active = 0
    lock = threading.Lock()
    threads, timeline = [], []

    def infer(query):
        nonlocal active, maximum_active
        with lock:
            active += 1
            maximum_active = max(maximum_active, active)
            threads.append(threading.get_ident())
            timeline.append(("start", query))
        try:
            time.sleep(0.03)
            return [float(len(query))] * 768
        finally:
            with lock:
                timeline.append(("end", query))
                active -= 1

    engines = [HybridSearchEngine.__new__(HybridSearchEngine) for _ in range(2)]
    for engine in engines:
        engine._generate_clip_text_vector_sync = infer
    results = await asyncio.gather(*[
        engine._generate_clip_text_vector(query)
        for engine, query in zip(engines, ["one", "second"])
    ])
    assert results == [[3.0] * 768, [6.0] * 768]
    assert maximum_active == 1 and active == 0
    assert [step for step, _ in timeline] == ["start", "end", "start", "end"]
    assert len(set(threads)) == 1 and threads[0] != loop_thread


@pytest.mark.asyncio
async def test_clip_worker_exception_propagates():
    engine = HybridSearchEngine.__new__(HybridSearchEngine)

    def fail(query):
        raise RuntimeError("CLIP unavailable")

    engine._generate_clip_text_vector_sync = fail
    with pytest.raises(RuntimeError, match="CLIP unavailable"):
        await engine._generate_clip_text_vector("poster")
