"""Exact media reuse, recoverable packet delivery and real cancellation semantics."""
import asyncio
from dataclasses import replace
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.prompt_language import prompt_language
from app.modules.pi_agent import media
from app.modules.pi_agent.catalog import Source
from app.modules.pi_agent.media_cache import RunMediaCache
from app.modules.pi_agent.policy import ToolError, UsageLedger
from app.modules.pi_agent.store import RunStore


def make_inspector(monkeypatch, *, modality="audio", duration=120, has_audio=True, observe=None, concurrency=2):
    downloads, decodes, calls = [], [], []
    suffix = {"audio": ".mp3", "video": ".mp4", "image": ".jpg", "doc": ".pdf"}[modality]
    source = Source("source", "kb", "file", "sample" + suffix, modality, "v1", 3)

    def download(_storage, item, destination):
        downloads.append((item.version, destination))
        destination.write_bytes(b"raw")

    async def decode(*args):
        decodes.append(args)
        if args[0] == "ffprobe":
            return json.dumps({"format": {"duration": str(duration)}, "streams": [
                *([{"codec_type": "video"}] if modality == "video" else []),
                *([{"codec_type": "audio"}] if has_audio else [])]}).encode()
        return b"decoded"

    async def model(parts, **kwargs):
        calls.append((parts, kwargs))
        if observe:
            return await observe(parts, **kwargs)
        return "observed " + str(len(calls)), {"model": kwargs["kind"], "usage": {"total_tokens": 8}}

    async def blocking(function, *args):
        return function(*args)

    monkeypatch.setattr(media, "subprocess_bytes", decode)
    monkeypatch.setattr(media, "image_bytes", lambda _path, page: (b"image", {"page": page, "width": 32, "height": 24}))
    settings = SimpleNamespace(max_concurrent_media=concurrency, audio_model="audio-v1", vision_model="vision-v1")
    inspector = media.MediaInspector(SimpleNamespace(download=download), object(), SimpleNamespace(observe=model),
                                     UsageLedger(), settings, blocking)
    return inspector, source, downloads, decodes, calls


async def inspect(inspector, source, **kwargs):
    return await inspector.inspect(source, **{"question": "what is here?", "start_sec": 0, "end_sec": 30,
        "view": "audio", "page": 1, "span_id": "test", **kwargs})


async def eventually(predicate):
    async def wait():
        while not predicate():
            await asyncio.sleep(0)
    await asyncio.wait_for(wait(), 2)


@pytest.mark.asyncio
@pytest.mark.parametrize("modality,params", [
    ("image", {"view": "both", "end_sec": None}),
    ("image", {"view": "visual", "end_sec": None, "page": 2}),
    ("doc", {"view": "visual", "end_sec": 30}),
    ("audio", {"view": "visual"}),
    ("audio", {"page": 2}),
    ("video", {"view": "visual", "audio_question": "listen"}),
    ("video", {"view": "audio", "visual_question": "look"}),
    ("video", {"view": "both", "start_sec": float("nan")}),
    ("audio", {"end_sec": 0}),
])
async def test_inapplicable_media_parameters_fail_before_storage(monkeypatch, modality, params):
    inspector, source, downloads, _, calls = make_inspector(monkeypatch, modality=modality)
    try:
        with pytest.raises(ToolError):
            await inspect(inspector, source, **params)
        assert not downloads and not calls
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_exact_reuse_preserves_packet_identity_and_accounts_only_actual_work(monkeypatch):
    inspector, source, downloads, _, calls = make_inspector(monkeypatch)
    delivered = []

    async def persist(packet, *, reused):
        delivered.append((packet, reused))
        return packet.model_copy(update={"id": 7})

    try:
        first = await inspect(inspector, source, on_packet=persist)
        second = await inspect(inspector, source, on_packet=persist, span_id="another-call")
        assert len(downloads) == len(calls) == 1
        assert inspector.ledger.media_seconds == 30
        assert first.version == second.version and first.content == second.content
        assert [reused for _, reused in delivered] == [False, True]
        assert delivered[1][0].provenance["reused_from_evidence_id"] == 7
        assert second.provenance["packet_evidence_ids"] == second.provenance["reused_packet_evidence_ids"] == [7]
        assert first.provenance["cache_status"] == "fresh" and second.provenance["cache_status"] == "reused"
        # Consumer mutation cannot corrupt the memoized immutable observation.
        delivered[1][0].content = "corrupted caller copy"
        third = await inspect(inspector, source)
        assert third.content == first.content
    finally:
        directory = Path(inspector._directory.name)
        await inspector.close()
    assert not directory.exists()


@pytest.mark.asyncio
async def test_single_flight_survives_cancellation_of_one_waiter(monkeypatch):
    started, release, cancelled = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def observe(*_args, **_kwargs):
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return "shared observation", {}

    inspector, source, downloads, _, calls = make_inspector(monkeypatch, observe=observe)
    try:
        first = asyncio.create_task(inspect(inspector, source))
        await started.wait()
        second = asyncio.create_task(inspect(inspector, source))
        await eventually(lambda: any(flight.waiters == 2 for key, flight in inspector.cache.flights.items()
                                      if key.startswith("observation:")))
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert not cancelled.is_set()
        release.set()
        result = await second
        assert result.content.endswith("shared observation")
        assert result.provenance["cache_status"] == "reused"
        assert len(downloads) == len(calls) == 1
        assert not inspector.cache.flights
    finally:
        release.set()
        await inspector.close()


@pytest.mark.asyncio
async def test_cancelling_last_waiter_settles_acquisition_and_allows_retry(monkeypatch):
    started, settled = asyncio.Event(), asyncio.Event()

    async def observe(*_args, **_kwargs):
        started.set()
        try:
            await asyncio.Future()
        finally:
            settled.set()

    inspector, source, _, _, calls = make_inspector(monkeypatch, observe=observe)
    try:
        task = asyncio.create_task(inspect(inspector, source))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert settled.is_set() and not inspector.cache.flights and not inspector.gate.locked()
        async def recovered(*_args, **_kwargs):
            return "recovered", {}
        inspector.models.observe = recovered
        assert (await inspect(inspector, source)).content.endswith("recovered")
        assert len(calls) == 1  # Failed acquisition did not become a cache hit.
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_late_failure_publishes_previous_packet_and_retry_fills_only_gap(monkeypatch):
    attempt = 0

    async def observe(*_args, **_kwargs):
        nonlocal attempt
        attempt += 1
        if attempt == 2:
            raise ToolError("provider_failure", "fixture", retryable=True)
        return f"packet call {attempt}", {}

    inspector, source, _, _, calls = make_inspector(monkeypatch, observe=observe)
    delivery = []

    def persist(packet, *, reused):
        delivery.append((packet.locator["start_sec"], reused))
        return 10 + int(packet.locator["start_sec"])

    try:
        with pytest.raises(ToolError, match="fixture"):
            await inspect(inspector, source, end_sec=60, on_packet=persist)
        assert delivery == [(0, False)]
        result = await inspect(inspector, source, end_sec=60, on_packet=persist)
        assert delivery == [(0, False), (0, True), (30, False)]
        assert len(calls) == 3
        assert result.provenance["packet_evidence_ids"] == [10, 40]
        assert result.provenance["reused_packet_evidence_ids"] == [10]
        assert result.locator["observed_intervals"][-1]["end_sec"] == 60
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_video_channel_questions_and_reuse_are_independent(monkeypatch):
    inspector, source, _, _, calls = make_inspector(monkeypatch, modality="video")
    packets = []
    def persist(packet, *, reused):
        packets.append(packet)
        return len(packets)
    try:
        first = await inspect(inspector, source, view="both", start_sec=45, end_sec=60,
                              visual_question="What is visibly blue?", audio_question="Which instrument?", on_packet=persist)
        assert len(calls) == 2
        assert calls[0][0][0]["text"].endswith("What is visibly blue?")
        assert calls[1][0][0]["text"].endswith("Which instrument?")
        assert calls[0][1]["kind"] == "vision" and calls[1][1]["kind"] == "audio"
        assert first.locator["sampled_seconds"] == [45, 47.5, 50, 52.5, 55, 57.5]
        assert [p.locator["view"] for p in packets] == ["visual", "audio"]
        second = await inspect(inspector, source, view="both", start_sec=45, end_sec=60,
                               visual_question="What is visibly blue?", audio_question="Is there speech?")
        assert len(calls) == 3 and calls[-1][1]["kind"] == "audio"
        assert second.provenance["cache_status"] == "mixed"
        assert packets[0].content in second.content
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_audio_failure_does_not_discard_same_intervals_visual_packet(monkeypatch):
    audio_attempt = 0
    async def observe(_parts, *, kind, **_kwargs):
        nonlocal audio_attempt
        if kind == "audio":
            audio_attempt += 1
            if audio_attempt == 1:
                raise ToolError("provider_failure", "audio unavailable", retryable=True)
        return kind, {}
    inspector, source, _, _, calls = make_inspector(monkeypatch, modality="video", observe=observe)
    delivered = []
    def persist(packet, *, reused):
        delivered.append((packet.locator["view"], reused))
        return 1 if packet.locator["view"] == "visual" else 2
    try:
        with pytest.raises(ToolError):
            await inspect(inspector, source, view="both", on_packet=persist)
        assert delivered == [("visual", False)]
        await inspect(inspector, source, view="both", on_packet=persist)
        assert delivered == [("visual", False), ("visual", True), ("audio", False)]
        assert [kwargs["kind"] for _, kwargs in calls] == ["vision", "audio", "audio"]
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_cache_identity_separates_source_question_model_prompt_sampling_and_language(monkeypatch):
    inspector, source, downloads, _, calls = make_inspector(monkeypatch)
    try:
        await inspect(inspector, source)
        await inspect(inspector, replace(source, version="v2"))
        await inspect(inspector, source, question="different question")
        inspector.settings.audio_model = "audio-v2"
        await inspect(inspector, source)
        monkeypatch.setattr(media, "MEDIA_PROMPT_VERSION", "new-prompt")
        await inspect(inspector, source)
        monkeypatch.setattr(media, "MEDIA_SAMPLING_VERSION", "new-sampling")
        await inspect(inspector, source)
        with prompt_language("en-US"):
            await inspect(inspector, source)
        assert len(calls) == 7
        assert [version for version, _ in downloads] == ["v1", "v2"]
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_pdf_pages_have_distinct_cache_keys(monkeypatch):
    inspector, source, downloads, _, calls = make_inspector(monkeypatch, modality="doc")
    try:
        first = await inspect(inspector, source, view="visual", end_sec=None, page=1)
        second = await inspect(inspector, source, view="visual", end_sec=None, page=2)
        reused = await inspect(inspector, source, view="visual", end_sec=None, page=1)
        assert len(downloads) == 1 and len(calls) == 2
        assert first.locator["page"] == reused.locator["page"] == 1 and second.locator["page"] == 2
        assert reused.provenance["cache_status"] == "reused"
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_no_audio_track_is_a_probe_observation_not_a_model_call(monkeypatch):
    inspector, source, _, _, calls = make_inspector(monkeypatch, modality="video", has_audio=False)
    try:
        result = await inspect(inspector, source, view="audio")
        assert not calls and result.locator["audio_status"] == "none"
        assert not result.provenance["calls"]
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_provider_wait_does_not_hold_local_media_capacity(monkeypatch):
    released = asyncio.Event()
    async def observe(*_args, **_kwargs):
        await released.wait()
        return "observed", {}
    inspector, source, _, _, calls = make_inspector(monkeypatch, concurrency=1, observe=observe)
    try:
        task = asyncio.create_task(inspect(inspector, source))
        await eventually(lambda: len(calls) == 1)
        assert inspector.prepared_gate.locked() and not inspector.gate.locked()
        # The single prepared buffer is occupied by remote work, while a local
        # probe/download slot remains usable by an independent request.
        await asyncio.wait_for(inspector.gate.acquire(), 2)
        inspector.gate.release()
        released.set()
        await task
    finally:
        released.set()
        await inspector.close()


@pytest.mark.asyncio
async def test_four_media_calls_bound_prepared_payloads_to_two_buffers(monkeypatch):
    release = asyncio.Event()
    active, peak = 0, 0
    async def observe(*_args, **_kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await release.wait()
            return "observed", {}
        finally:
            active -= 1
    inspector, source, _, decodes, calls = make_inspector(monkeypatch, concurrency=2, observe=observe)
    tasks = [asyncio.create_task(inspect(inspector, replace(source, id=f"source-{i}"))) for i in range(4)]
    try:
        await eventually(lambda: len([key for key in inspector.cache.flights if key.startswith("observation:")]) == 4)
        await eventually(lambda: len(calls) == 2)
        # All four requests are admitted, but only two have allocated decoded
        # payloads. Remaining work waits before ffmpeg, not at the provider.
        assert sum(command[0] == "ffmpeg" for command in decodes) == 2
        assert inspector.prepared_gate.locked() and not inspector.gate.locked()
        assert active == 2 and all(not task.done() for task in tasks)
        release.set()
        await asyncio.gather(*tasks)
        assert len(calls) == 4 and peak == 2
        assert sum(command[0] == "ffmpeg" for command in decodes) == 4
        assert not inspector.prepared_gate.locked()
    finally:
        release.set()
        await inspector.close()
        await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.asyncio
async def test_cached_observation_returns_while_all_prepared_buffers_are_busy(monkeypatch):
    release = asyncio.Event()
    release.set()
    async def observe(*_args, **_kwargs):
        await release.wait()
        return "observed", {}
    inspector, source, _, _, calls = make_inspector(monkeypatch, concurrency=2, observe=observe)
    tasks = []
    try:
        await inspect(inspector, source)
        release.clear()
        tasks = [asyncio.create_task(inspect(inspector, replace(source, id=f"other-{i}"))) for i in range(2)]
        await eventually(lambda: len(calls) == 3)
        assert inspector.prepared_gate.locked()
        reused = await asyncio.wait_for(inspect(inspector, source), 2)
        assert reused.provenance["cache_status"] == "reused"
        assert len(calls) == 3 and all(not task.done() for task in tasks)
    finally:
        release.set()
        await inspector.close()
        await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.asyncio
async def test_success_is_durable_when_cancellation_wins_waiter_resume(tmp_path, monkeypatch):
    operation = None
    async def observe(*_args, **_kwargs):
        asyncio.get_running_loop().call_soon(operation.cancel)
        return "already paid complete observation", {"model": "fixture"}
    inspector, source, _, _, calls = make_inspector(monkeypatch, observe=observe)
    store = RunStore(tmp_path / "run.sqlite3")
    run, _ = store.create(owner="alice", request={"client_request_id": "cancel-publication", "session_id": "one",
                                                "message": "Inspect this."}, config={})
    store.transition(run["id"], "running")
    published = []
    def persist(packet, *, reused):
        published.append(reused)
        return store.add_evidence(run["id"], packet)
    try:
        operation = asyncio.create_task(inspect(inspector, source, on_packet=persist))
        with pytest.raises(asyncio.CancelledError):
            await operation
        assert published == [False] and len(calls) == 1
        assert len(store.evidence(run["id"])) == 1
        assert store.evidence(run["id"])[0].content.endswith("already paid complete observation")
    finally:
        await inspector.close()
    assert len(store.evidence(run["id"])) == 1  # Cleanup cannot erase paid evidence.


@pytest.mark.asyncio
async def test_cancelled_origin_still_publishes_shared_acquisition_for_live_waiter(monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    async def observe(*_args, **_kwargs):
        started.set()
        await release.wait()
        return "shared result", {}
    inspector, source, _, _, calls = make_inspector(monkeypatch, observe=observe)
    publications = []
    def first_callback(packet, *, reused):
        publications.append(("cancelled origin", reused, packet.content))
        packet.content = "caller mutation must not reach the cache"
        return 4
    def second_callback(packet, *, reused):
        publications.append(("live consumer", reused, packet.content))
        return 4
    try:
        first = asyncio.create_task(inspect(inspector, source, on_packet=first_callback))
        await started.wait()
        second = asyncio.create_task(inspect(inspector, source, on_packet=second_callback))
        await eventually(lambda: any(flight.waiters == 2 for key, flight in inspector.cache.flights.items()
                                      if key.startswith("observation:")))
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        result = await second
        assert [(origin, reused) for origin, reused, _ in publications] == [
            ("cancelled origin", False), ("live consumer", True)]
        assert all(text.endswith("shared result") for _, _, text in publications)
        assert result.content.endswith("shared result") and len(calls) == 1
        assert result.provenance["reused_packet_evidence_ids"] == [4]
    finally:
        release.set()
        await inspector.close()


@pytest.mark.asyncio
async def test_cancelled_waiter_finishes_started_durable_async_publication(monkeypatch):
    publishing, release = asyncio.Event(), asyncio.Event()
    inspector, source, _, _, _ = make_inspector(monkeypatch)
    published = []
    async def persist(packet, *, reused):
        publishing.set()
        await release.wait()
        published.append(packet.content)
        return 9
    operation = asyncio.create_task(inspect(inspector, source, on_packet=persist))
    try:
        await publishing.wait()
        operation.cancel()
        await asyncio.sleep(0)
        assert not operation.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await operation
        assert len(published) == 1 and not inspector.cache.flights
        assert not inspector.prepared_gate.locked()
    finally:
        release.set()
        await inspector.close()


@pytest.mark.asyncio
async def test_close_cancels_and_settles_active_work_before_removing_files(monkeypatch):
    started, settled = asyncio.Event(), asyncio.Event()
    async def observe(*_args, **_kwargs):
        started.set()
        try:
            await asyncio.Future()
        finally:
            settled.set()
    inspector, source, _, _, _ = make_inspector(monkeypatch, observe=observe)
    task = asyncio.create_task(inspect(inspector, source))
    await started.wait()
    directory = Path(inspector._directory.name)
    await inspector.close()
    assert settled.is_set() and task.cancelled() and not directory.exists()
    assert not inspector.cache.flights and not inspector.cache.values and not inspector._operations
    with pytest.raises(ToolError, match="已结束"):
        await inspect(inspector, source)
    await inspector.close()  # Idempotent cleanup.


@pytest.mark.asyncio
async def test_cancelling_cleanup_itself_still_settles_and_removes_files(monkeypatch):
    started, cleaning, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    async def observe(*_args, **_kwargs):
        started.set()
        try:
            await asyncio.Future()
        finally:
            cleaning.set()
            await release.wait()
    inspector, source, _, _, _ = make_inspector(monkeypatch, observe=observe)
    operation = asyncio.create_task(inspect(inspector, source))
    await started.wait()
    directory = Path(inspector._directory.name)
    cleanup = asyncio.create_task(inspector.close())
    await cleaning.wait()
    cleanup.cancel()
    await asyncio.sleep(0)
    assert not cleanup.done() and directory.exists()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await cleanup
    assert operation.cancelled() and not directory.exists()
    assert not inspector.cache.flights and not inspector._operations
    await inspector.close()


@pytest.mark.asyncio
async def test_retry_waits_for_cancelled_acquisition_cleanup():
    cache = RunMediaCache()
    started, cleaning, release_cleanup = asyncio.Event(), asyncio.Event(), asyncio.Event()
    created = 0
    async def create():
        nonlocal created
        created += 1
        if created > 1:
            return "retry"
        started.set()
        try:
            await asyncio.Future()
        finally:
            cleaning.set()
            await release_cleanup.wait()
    try:
        first = asyncio.create_task(cache.get("file", create))
        await started.wait()
        first.cancel()
        await cleaning.wait()
        second = asyncio.create_task(cache.get("file", create))
        await asyncio.sleep(0)
        assert created == 1
        release_cleanup.set()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert await second == ("retry", False)
        assert created == 2
    finally:
        release_cleanup.set()
        await cache.close()
