"""Persistent exact observations and bounded packet execution, without paid I/O."""
import asyncio
from dataclasses import replace
import sqlite3

import pytest

from app.core.prompt_language import prompt_language
from app.modules.pi_agent import media
from app.modules.pi_agent.media_observation_store import MediaObservationStore
from app.modules.pi_agent.policy import ToolError
from test_pi_agent_media_execution import eventually, inspect, make_inspector


def persistent_inspector(monkeypatch, path, *, namespace="owner-a:scope-a", **kwargs):
    result = make_inspector(monkeypatch, **kwargs)
    result[0].observation_store = MediaObservationStore(path)
    result[0].cache_namespace = namespace
    return result


@pytest.mark.asyncio
async def test_reopened_store_reuses_observation_with_new_run_evidence_identity(tmp_path, monkeypatch):
    path = tmp_path / "observations.sqlite3"
    first, source, _, _, calls = persistent_inspector(monkeypatch, path)
    try:
        original = await inspect(first, source, on_packet=lambda packet, **_: 7)
        assert len(calls) == 1
    finally:
        await first.close()
    second, source, downloads, decodes, calls = persistent_inspector(monkeypatch, path)
    delivered = []
    def publish(packet, *, reused):
        delivered.append((packet, reused))
        return 42
    try:
        result = await inspect(second, source, on_packet=publish)
        assert result.content == original.content and result.version == original.version
        assert result.provenance["packet_evidence_ids"] == [42]
        assert result.provenance["reused_packet_evidence_ids"] == [42]
        packet, reused = delivered[0]
        assert reused and packet.id == 0 and "reused_from_evidence_id" not in packet.provenance
        assert packet.provenance["calls"] and packet.provenance["cache_origin"] == "persistent"
        assert not calls and second.ledger.media_seconds == 0
        # Authorization occurs in ToolSet, and original-version verification is
        # still performed by the download path on every new inspector/run.
        assert len(downloads) == 1 and all(command[0] == "ffprobe" for command in decodes)
    finally:
        await second.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["owner", "scope", "version", "location", "question", "model", "route", "language", "prompt", "sampling", "interval"])
async def test_persistent_observations_invalidate_exact_identity(tmp_path, monkeypatch, change):
    path = tmp_path / "observations.sqlite3"
    first, source, _, _, _ = persistent_inspector(monkeypatch, path)
    first.models._endpoint = lambda *_: {"provider": "one", "model": "raw-v1", "base_url": "https://models.invalid", "key": "private"}
    await inspect(first, source)
    await first.close()
    namespace = "owner-b:scope-a" if change == "owner" else "owner-a:scope-b" if change == "scope" else "owner-a:scope-a"
    second, source, _, _, calls = persistent_inspector(monkeypatch, path, namespace=namespace)
    second.models._endpoint = lambda *_: {"provider": "one", "model": "raw-v2" if change == "route" else "raw-v1", "base_url": "https://models.invalid", "key": "rotated-private"}
    kwargs = {}
    if change == "version":
        source = replace(source, version="v2")
    if change == "location":
        source = replace(source, bucket="new-storage")
    if change == "question":
        kwargs["question"] = "another question"
    if change == "model":
        second.settings.audio_model = "audio-v2"
    if change == "prompt":
        monkeypatch.setattr(media, "MEDIA_PROMPT_VERSION", "next")
    if change == "sampling":
        monkeypatch.setattr(media, "MEDIA_SAMPLING_VERSION", "next")
    if change == "interval":
        kwargs.update(start_sec=30, end_sec=60)
    try:
        with prompt_language("en-US" if change == "language" else "zh-CN"):
            result = await inspect(second, source, **kwargs)
        assert len(calls) == 1 and result.provenance["cache_status"] == "fresh"
        assert b"private" not in path.read_bytes()
    finally:
        await second.close()


@pytest.mark.asyncio
async def test_current_source_version_failure_precedes_persistent_hit(tmp_path, monkeypatch):
    path = tmp_path / "observations.sqlite3"
    first, source, _, _, _ = persistent_inspector(monkeypatch, path)
    await inspect(first, source)
    await first.close()
    second, source, _, _, calls = persistent_inspector(monkeypatch, path)
    def changed(*_):
        raise ToolError("source_changed", "source changed")
    second.catalog.download = changed
    try:
        with pytest.raises(ToolError, match="source changed"):
            await inspect(second, source)
        assert not calls
    finally:
        await second.close()


@pytest.mark.asyncio
async def test_parallel_failure_retains_completed_packet_across_restart(tmp_path, monkeypatch):
    path = tmp_path / "observations.sqlite3"
    both_started, first_finish = asyncio.Event(), asyncio.Event()
    active = peak = attempts = 0
    async def observe(*_args, **_kwargs):
        nonlocal active, peak, attempts
        attempts += 1
        number = attempts
        active += 1
        peak = max(peak, active)
        try:
            if number == 1:
                await first_finish.wait()
                return "completed first packet", {}
            both_started.set()
            raise ToolError("media_model_unavailable", "failed second packet", retryable=True)
        finally:
            active -= 1
    first, source, _, _, _ = persistent_inspector(monkeypatch, path, observe=observe)
    publications = []
    task = asyncio.create_task(inspect(first, source, end_sec=120,
        on_packet=lambda packet, **_: publications.append(packet.locator["start_sec"])))
    try:
        await asyncio.wait_for(both_started.wait(), 2)
        assert peak == 2 and attempts == 2
        first_finish.set()
        with pytest.raises(ToolError, match="failed second"):
            await task
        assert publications == [0] and active == 0 and attempts == 2
    finally:
        first_finish.set()
        await first.close()
        await asyncio.gather(task, return_exceptions=True)
    second, source, _, _, calls = persistent_inspector(monkeypatch, path)
    try:
        result = await inspect(second, source, end_sec=60)
        assert len(calls) == 1 and result.provenance["cache_status"] == "mixed"
        assert result.content.startswith("原文件 0–30")
        assert "completed first packet" in result.content
    finally:
        await second.close()


@pytest.mark.asyncio
async def test_packet_parallelism_is_bounded_and_output_is_ordered(tmp_path, monkeypatch):
    releases = [asyncio.Event() for _ in range(4)]
    started, active, peak = [], 0, 0
    async def observe(*_args, **_kwargs):
        nonlocal active, peak
        index = len(started)
        started.append(index)
        active += 1
        peak = max(peak, active)
        try:
            await releases[index].wait()
            return f"packet-{index}", {}
        finally:
            active -= 1
    inspector, source, _, _, _ = persistent_inspector(monkeypatch, tmp_path / "observations.sqlite3", observe=observe)
    operation = asyncio.create_task(inspect(inspector, source, end_sec=120))
    try:
        await eventually(lambda: len(started) == 2)
        releases[1].set()
        await eventually(lambda: len(started) == 3)
        releases[2].set()
        await eventually(lambda: len(started) == 4)
        releases[3].set()
        releases[0].set()
        result = await operation
        assert peak == 2 and active == 0
        assert [item["start_sec"] for item in result.locator["observed_intervals"]] == [0, 30, 60, 90]
        assert [result.content.index(f"packet-{i}") for i in range(4)] == sorted(result.content.index(f"packet-{i}") for i in range(4))
    finally:
        for release in releases:
            release.set()
        await inspector.close()
        await asyncio.gather(operation, return_exceptions=True)


@pytest.mark.asyncio
async def test_singleflight_cancellation_does_not_cache_unconfirmed_observation(tmp_path, monkeypatch):
    path = tmp_path / "observations.sqlite3"
    started, stopped = asyncio.Event(), asyncio.Event()
    async def observe(*_args, **_kwargs):
        started.set()
        try:
            await asyncio.Future()
        finally:
            stopped.set()
    inspector, source, _, _, calls = persistent_inspector(monkeypatch, path, observe=observe)
    first = asyncio.create_task(inspect(inspector, source))
    await asyncio.wait_for(started.wait(), 2)
    second = asyncio.create_task(inspect(inspector, source))
    try:
        await eventually(lambda: any(flight.waiters == 2 for key, flight in inspector.cache.flights.items()
                                    if key.startswith("observation:")))
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        assert not stopped.is_set() and len(calls) == 1
        second.cancel()
        await asyncio.gather(second, return_exceptions=True)
        assert stopped.is_set() and not inspector.cache.flights
    finally:
        await inspector.close()
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM media_observations").fetchone()[0] == 0
    reopened, source, _, _, calls = persistent_inspector(monkeypatch, path)
    try:
        await inspect(reopened, source)
        assert len(calls) == 1
    finally:
        await reopened.close()


@pytest.mark.asyncio
async def test_corrupt_cached_payload_is_not_returned_as_evidence(tmp_path, monkeypatch):
    path = tmp_path / "observations.sqlite3"
    first, source, _, _, _ = persistent_inspector(monkeypatch, path)
    await inspect(first, source)
    await first.close()
    with sqlite3.connect(path) as db:
        db.execute("UPDATE media_observations SET payload='[]'")
    second, source, _, _, calls = persistent_inspector(monkeypatch, path)
    try:
        result = await inspect(second, source)
        assert len(calls) == 1 and result.provenance["cache_status"] == "fresh"
    finally:
        await second.close()


@pytest.mark.asyncio
async def test_cache_write_failure_preserves_completed_observation_publication(tmp_path, monkeypatch):
    inspector, source, _, _, calls = persistent_inspector(monkeypatch, tmp_path / "observations.sqlite3")
    def failed_write(*_):
        raise sqlite3.OperationalError("fixture write failure")
    inspector.observation_store.put = failed_write
    published = []
    try:
        result = await inspect(inspector, source, on_packet=lambda packet, **_: published.append(packet))
        assert len(calls) == len(published) == 1 and published[0].content == result.content
        reused = await inspect(inspector, source)
        assert len(calls) == 1 and reused.provenance["cache_status"] == "reused"
    finally:
        await inspector.close()


@pytest.mark.asyncio
async def test_local_no_audio_observation_does_not_require_provider_configuration(tmp_path, monkeypatch):
    inspector, source, _, _, calls = persistent_inspector(monkeypatch, tmp_path / "observations.sqlite3", has_audio=False)
    def unavailable(*_):
        raise AssertionError("No audio provider should be needed for an absent audio track")
    inspector.models._endpoint = unavailable
    try:
        result = await inspect(inspector, source)
        assert not calls and result.locator["audio_status"] == "none"
    finally:
        await inspector.close()
