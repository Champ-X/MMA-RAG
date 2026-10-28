"""Completion, retry and concurrent-ingestion contracts for portrait triggers.

The Redis cases use only a per-test UUID key prefix, never FLUSHDB. Set
PORTRAIT_TRIGGER_TEST_REDIS_URL to exercise the Lua transactions on real Redis.
HTTP and worker tests are deterministic and do not call external services.
"""

from concurrent.futures import ThreadPoolExecutor
import asyncio
import io
import json
import os
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import urllib.error
import uuid

import pytest
import redis

from app.core import portrait_trigger as trigger


SUCCESS = {"status": "success", "storage_result": {"status": "success"}}


@pytest.fixture
def isolated_redis(monkeypatch):
    url = os.environ.get("PORTRAIT_TRIGGER_TEST_REDIS_URL")
    if not url:
        pytest.skip("set PORTRAIT_TRIGGER_TEST_REDIS_URL for real Redis transaction tests")
    client = redis.Redis.from_url(url, decode_responses=True, socket_connect_timeout=2, socket_timeout=2)
    client.ping()
    prefix = f"test:portrait-trigger:{uuid.uuid4().hex}:"
    monkeypatch.setattr(trigger, "KEY_PREFIX", prefix + "delta:")
    monkeypatch.setattr(trigger, "PENDING_KEY_PREFIX", prefix + "pending:")
    monkeypatch.setattr(trigger, "_redis_client", lambda: client)
    monkeypatch.setattr(trigger.settings, "portrait_update_threshold", 50)
    try:
        yield client
    finally:
        keys = list(client.scan_iter(match=prefix + "*"))
        if keys:
            client.delete(*keys)
        client.close()


@pytest.fixture
def dispatched(monkeypatch):
    jobs = []

    def enqueue(kb_id, **options):
        jobs.append({"kb_id": kb_id, **options})
        return True

    monkeypatch.setattr(trigger, "_enqueue_portrait_task", enqueue)
    monkeypatch.setattr(trigger, "_schedule_portrait_via_sync_api", Mock(return_value=False))
    return jobs


def test_dispatch_does_not_ack_and_coalesces_until_build_completes(isolated_redis, dispatched):
    assert not trigger.increment_and_maybe_trigger("kb", 49)
    assert dispatched == []
    assert trigger.increment_and_maybe_trigger("kb", 1)
    token = dispatched[0]["trigger_token"]
    assert dispatched[0]["force_update"] is True
    assert trigger.get_portrait_delta("kb") == 50

    # Another batch arrives while the first build is queued or running.
    for _ in range(50):
        assert not trigger.increment_and_maybe_trigger("kb", 1)
    assert len(dispatched) == 1
    assert trigger.get_portrait_delta("kb") == 100

    assert trigger.complete_portrait_trigger("kb", token, SUCCESS)
    assert trigger.get_portrait_delta("kb") == 50
    assert len(dispatched) == 2
    next_token = dispatched[1]["trigger_token"]
    assert next_token != token
    # Celery redelivery of the old result cannot acknowledge the new build.
    assert not trigger.complete_portrait_trigger("kb", token, SUCCESS)
    assert trigger.get_portrait_delta("kb") == 50
    assert trigger.complete_portrait_trigger("kb", next_token, SUCCESS)
    assert trigger.get_portrait_delta("kb") == 0


def test_increments_concurrent_with_ack_are_never_erased(isolated_redis, dispatched, monkeypatch):
    monkeypatch.setattr(trigger.settings, "portrait_update_threshold", 1000)
    assert trigger.increment_and_maybe_trigger("kb", 1000)
    token = dispatched[0]["trigger_token"]
    barrier = threading.Barrier(17)

    def increment():
        barrier.wait()
        trigger.increment_and_maybe_trigger("kb", 1)

    def acknowledge():
        barrier.wait()
        assert trigger.complete_portrait_trigger("kb", token, SUCCESS)

    with ThreadPoolExecutor(max_workers=17) as pool:
        futures = [pool.submit(increment) for _ in range(16)] + [pool.submit(acknowledge)]
        for future in futures:
            future.result()
    assert trigger.get_portrait_delta("kb") == 16
    assert len(dispatched) == 1


@pytest.mark.parametrize("result", [
    {"status": "no_update_needed"},
    {"status": "failed"},
    {"status": "success", "storage_result": {"status": "failed"}},
    {"status": "success"},
])
def test_unfinished_build_does_not_ack(isolated_redis, dispatched, result):
    assert trigger.increment_and_maybe_trigger("kb", 50)
    token = dispatched[0]["trigger_token"]
    assert not trigger.complete_portrait_trigger("kb", token, result)
    assert trigger.get_portrait_delta("kb") == 50
    assert isolated_redis.exists(trigger.PENDING_KEY_PREFIX + "kb")
    # The same task token can complete after a bounded Celery retry.
    assert trigger.complete_portrait_trigger("kb", token, SUCCESS)
    assert trigger.get_portrait_delta("kb") == 0


def test_failed_transports_keep_dirty_and_allow_later_dispatch(isolated_redis, monkeypatch):
    enqueue = Mock(side_effect=[False, True])
    monkeypatch.setattr(trigger, "_enqueue_portrait_task", enqueue)
    monkeypatch.setattr(trigger, "_schedule_portrait_via_sync_api", Mock(return_value=False))
    assert not trigger.increment_and_maybe_trigger("kb", 50)
    assert trigger.get_portrait_delta("kb") == 50
    assert not isolated_redis.exists(trigger.PENDING_KEY_PREFIX + "kb")
    assert trigger.increment_and_maybe_trigger("kb", 0)
    assert trigger.get_portrait_delta("kb") == 50
    assert enqueue.call_args.kwargs["force_update"] is True


def test_expired_job_cannot_consume_replacement_claim(isolated_redis, dispatched):
    assert trigger.increment_and_maybe_trigger("kb", 50)
    old_token = dispatched[0]["trigger_token"]
    # Model lease expiration without a timing-sensitive sleep.
    isolated_redis.expire(trigger.PENDING_KEY_PREFIX + "kb", 0)
    assert trigger.increment_and_maybe_trigger("kb", 0)
    new_token = dispatched[1]["trigger_token"]
    assert not trigger.complete_portrait_trigger("kb", old_token, SUCCESS)
    assert trigger.get_portrait_delta("kb") == 50
    assert trigger.complete_portrait_trigger("kb", new_token, SUCCESS)


def test_valid_worker_renews_lease_without_consuming_delta(isolated_redis, dispatched):
    assert trigger.increment_and_maybe_trigger("kb", 50)
    token = dispatched[0]["trigger_token"]
    key = trigger.PENDING_KEY_PREFIX + "kb"
    isolated_redis.expire(key, 10)
    assert trigger.begin_portrait_trigger("kb", token)
    assert isolated_redis.ttl(key) >= trigger.PENDING_LEASE_SECONDS - 2
    assert trigger.get_portrait_delta("kb") == 50
    assert not trigger.begin_portrait_trigger("kb", "older-token")


def test_superseded_worker_never_constructs_generator_or_acknowledges(isolated_redis, dispatched, monkeypatch):
    from app.modules.knowledge import portraits

    assert trigger.increment_and_maybe_trigger("kb", 50)
    old_token = dispatched[0]["trigger_token"]
    isolated_redis.expire(trigger.PENDING_KEY_PREFIX + "kb", 0)
    assert trigger.increment_and_maybe_trigger("kb", 0)
    generator = Mock(side_effect=AssertionError("stale task must not access the index"))
    acknowledge = Mock(side_effect=AssertionError("stale task must not consume dirty work"))
    monkeypatch.setattr(portraits, "PortraitGenerator", generator)
    monkeypatch.setattr(trigger, "complete_portrait_trigger", acknowledge)

    result = portraits.build_kb_portrait_task.run("kb", force_update=True, trigger_token=old_token)

    assert result == {"status": "superseded", "kb_id": "kb"}
    assert trigger.get_portrait_delta("kb") == 50
    generator.assert_not_called()
    acknowledge.assert_not_called()


def test_worker_acknowledges_only_after_generator_completes(isolated_redis, dispatched, monkeypatch):
    from app.modules.knowledge import portraits

    assert trigger.increment_and_maybe_trigger("kb", 50)
    token = dispatched[0]["trigger_token"]
    # Concurrent ingestion is preserved even when the worker succeeds.
    trigger.increment_and_maybe_trigger("kb", 3)
    build = AsyncMock(return_value=SUCCESS)
    monkeypatch.setattr(portraits, "PortraitGenerator", lambda: SimpleNamespace(update_kb_portrait=build))
    loop = asyncio.new_event_loop()
    monkeypatch.setattr(asyncio, "get_event_loop", lambda: loop)
    try:
        result = portraits.build_kb_portrait_task.run("kb", force_update=True, trigger_token=token)
    finally:
        loop.close()

    assert result == SUCCESS
    build.assert_awaited_once_with("kb", force_update=True)
    assert trigger.get_portrait_delta("kb") == 3
    assert not isolated_redis.exists(trigger.PENDING_KEY_PREFIX + "kb")


def test_verified_empty_corpus_can_ack_completed_cleanup(isolated_redis, dispatched):
    assert trigger.increment_and_maybe_trigger("kb", 50)
    assert trigger.complete_portrait_trigger("kb", dispatched[0]["trigger_token"], {"status": "insufficient_data"})
    assert trigger.get_portrait_delta("kb") == 0


@pytest.mark.parametrize("payload, completed", [
    ({"status": "success", "clusters": 2}, True),
    ({"status": "triggered"}, False),
    ({"status": "success", "clusters": 0}, False),
    ({"status": "success", "clusters": True}, False),
    ({"status": "failed", "clusters": 2}, False),
    ([], False),
])
def test_http_fallback_requires_build_receipt(monkeypatch, payload, completed):
    response = io.BytesIO(json.dumps(payload).encode())
    response.status = 200
    monkeypatch.setattr(trigger.urllib.request, "urlopen", Mock(return_value=response))
    acknowledge = Mock(return_value=True)
    monkeypatch.setattr(trigger, "complete_portrait_trigger", acknowledge)
    assert trigger._trigger_portrait_via_sync_api("kb", "token") is completed
    if completed:
        acknowledge.assert_called_once_with("kb", "token", SUCCESS)
    else:
        acknowledge.assert_not_called()


def test_http_400_is_not_a_completed_build(monkeypatch):
    error = urllib.error.HTTPError("http://example.invalid", 400, "Bad Request", {}, None)
    monkeypatch.setattr(trigger.urllib.request, "urlopen", Mock(side_effect=error))
    acknowledge = Mock()
    monkeypatch.setattr(trigger, "complete_portrait_trigger", acknowledge)
    assert not trigger._trigger_portrait_via_sync_api("kb", "token")
    acknowledge.assert_not_called()


def test_starting_http_thread_is_not_completion(monkeypatch):
    thread = Mock()
    factory = Mock(return_value=thread)
    monkeypatch.setattr(trigger, "Thread", factory)
    acknowledge = Mock()
    monkeypatch.setattr(trigger, "complete_portrait_trigger", acknowledge)
    assert trigger._schedule_portrait_via_sync_api("kb", "token")
    thread.start.assert_called_once()
    assert factory.call_args.kwargs["kwargs"] == {"trigger_token": "token"}
    acknowledge.assert_not_called()


def test_manual_build_without_trigger_token_never_touches_redis(monkeypatch):
    client = Mock(side_effect=AssertionError("manual build must not ACK unrelated work"))
    monkeypatch.setattr(trigger, "_redis_client", client)
    assert not trigger.complete_portrait_trigger("kb", None, SUCCESS)
    client.assert_not_called()


def test_redis_outage_does_not_dispatch_untracked_work(monkeypatch):
    monkeypatch.setattr(trigger, "_redis_client", Mock(side_effect=redis.ConnectionError("unavailable")))
    enqueue = Mock()
    monkeypatch.setattr(trigger, "_enqueue_portrait_task", enqueue)
    assert not trigger.increment_and_maybe_trigger("kb", 50)
    enqueue.assert_not_called()
