"""Deletion fencing and durable task retirement, entirely in-memory Redis."""
import fnmatch
import json
from unittest.mock import Mock

import pytest
import redis

from app.modules.ingestion import service as ingestion
from app.modules.ingestion.service import (
    IngestionService, ProcessingStatusUnavailableError, ProcessingTaskActiveError,
)


class TransactionRedis:
    def __init__(self):
        self.values, self.sets, self.versions, self.ttls = {}, {}, {}, {}
        self.before_execute = None

    def _changed(self, key):
        self.versions[key] = self.versions.get(key, 0) + 1

    def get(self, key):
        return self.values.get(key)

    def mget(self, keys):
        return [self.get(key) for key in keys]

    def set(self, key, value):
        self.values[key] = value
        self.ttls.pop(key, None)
        self._changed(key)

    def setex(self, key, ttl, value):
        self.set(key, value)
        self.ttls[key] = ttl

    def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)
            self.sets.pop(key, None)
            self.ttls.pop(key, None)
            self._changed(key)

    def sadd(self, key, *values):
        self.sets.setdefault(key, set()).update(values)
        self._changed(key)

    def srem(self, key, *values):
        self.sets.setdefault(key, set()).difference_update(values)
        self._changed(key)

    def expire(self, key, ttl):
        self.ttls[key] = ttl

    def smembers(self, key):
        return self.sets.get(key, set()).copy()

    def scan_iter(self, *, match, count):
        return iter([key for key in self.values if fnmatch.fnmatch(key, match)])

    def pipeline(self):
        return Transaction(self)


class Transaction:
    def __init__(self, client):
        self.client, self.watched, self.commands = client, {}, []
        self.in_multi = False

    def watch(self, *keys):
        for key in keys:
            self.watched.setdefault(key, self.client.versions.get(key, 0))

    def unwatch(self):
        self.watched.clear()

    def multi(self):
        self.in_multi = True

    def __getattr__(self, method):
        def command(*args, **kwargs):
            if self.in_multi:
                self.commands.append((method, args, kwargs))
                return self
            return getattr(self.client, method)(*args, **kwargs)
        return command

    def execute(self):
        hook, self.client.before_execute = self.client.before_execute, None
        if hook:
            hook()
        if any(self.client.versions.get(key, 0) != version for key, version in self.watched.items()):
            raise redis.WatchError()
        for method, args, kwargs in self.commands:
            getattr(self.client, method)(*args, **kwargs)

    def reset(self):
        self.commands.clear()
        self.watched.clear()


def service(client):
    instance = IngestionService.__new__(IngestionService)
    instance._processing_status = {}
    instance._processing_status_redis_client = client
    instance._background_upload_tasks = {}
    return instance


def seed(instance, task_id="task", file_id="file", kb_id="space", status="failed"):
    row = dict(processing_id=task_id, file_id=file_id, kb_id=kb_id, source_kb_id=kb_id,
               bucket=f"kb-{kb_id}", object_path=f"videos/{file_id}_same.mp4",
               file_path="same.mp4", file_type="video", status=status,
               storage_persisted=True, error="old error", lease_id="old-lease")
    assert instance._persist_processing_status(row)
    return row


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setattr(ingestion, "_ingestion_service_instance", None)
    monkeypatch.setattr(ingestion, "_status_reader_instance", None)
    return TransactionRedis()


def test_retirement_is_exact_durable_and_visible_to_both_singletons(store, monkeypatch):
    owner, reader, stale_worker = service(store), service(store), service(store)
    old = seed(owner)
    seed(owner, "task-two", status="completed")
    seed(owner, "different-file", file_id="fresh-upload")
    seed(owner, "different-space", kb_id="other")
    reader._processing_status["task"] = old.copy()
    stale_worker._processing_status["task"] = old.copy()
    monkeypatch.setattr(ingestion, "_ingestion_service_instance", owner)
    monkeypatch.setattr(ingestion, "_status_reader_instance", reader)
    reservation = owner.begin_file_deletion("file", "space")
    assert reservation["matched_count"] == 2
    assert owner.commit_file_deletion("file", "space", reservation["token"]) == 2

    for instance in (owner, reader, stale_worker, service(store)):
        assert instance.get_processing_status_sync("task")["status"] == "deleted"
        assert instance.get_file_processing_status("file", "space") is None
        assert all(row["file_id"] != "file" for row in instance.list_processing_statuses_for_kb("space"))
    tombstone = owner.get_processing_status_sync("task")
    assert tombstone["storage_persisted"] is False and tombstone["retryable"] is False
    assert "lease_id" not in tombstone and "error" not in tombstone and "object_path" not in tombstone
    assert "task" not in store.smembers(owner._processing_status_kb_key("space"))
    assert owner._processing_status_key("task") not in store.ttls
    # A global file mapping now belonging to another KB must not be removed.
    assert store.get(owner._processing_status_file_key("file")) == "different-space"
    assert owner.get_processing_status_sync("different-space")["status"] == "failed"
    assert owner.get_processing_status_sync("different-file")["status"] == "failed"


def test_deleted_file_is_idempotent_and_stale_writers_cannot_revive_it(store):
    owner, stale = service(store), service(store)
    old = seed(owner)
    stale._processing_status["task"] = old.copy()
    reservation = owner.begin_file_deletion("file", "space")
    owner.commit_file_deletion("file", "space", reservation["token"])
    assert store.get(owner._processing_status_file_key("file")) is None
    again = service(store).begin_file_deletion("file", "space")
    assert again["already_deleted"] and again["matched_count"] == 1
    assert service(store).commit_file_deletion("file", "space", again["token"]) == 1
    assert stale._persist_processing_status({**old, "status": "processing"}) is False
    assert stale._persist_processing_status({"processing_id": "task", "status": "failed"}) is False
    with pytest.raises(ProcessingTaskActiveError):
        stale._update_processing_status("task", {"status": "failed"})
    assert stale._refresh_processing_lease("task", "old-lease") is False
    assert stale._acquire_processing_lease("task", "new-lease") is False
    with pytest.raises(ValueError):
        stale.retry_video_processing("task")
    assert not stale._background_upload_tasks
    assert stale.get_processing_status_sync("task")["status"] == "deleted"


@pytest.mark.parametrize("status", ["queued", "processing"])
def test_active_tasks_cannot_be_reserved(store, status):
    owner = service(store)
    seed(owner, status=status)
    with pytest.raises(ProcessingTaskActiveError):
        owner.begin_file_deletion("file", "space")
    assert store.get(owner._processing_deletion_key("file", "space")) is None


def test_unfinished_local_runner_blocks_even_a_terminal_status(store):
    owner = service(store)
    seed(owner)
    owner._background_upload_tasks["task"] = Mock(done=lambda: False)
    with pytest.raises(ProcessingTaskActiveError):
        owner.begin_file_deletion("file", "space")


def test_reservation_fences_retry_and_only_its_owner_can_abort(store):
    owner, retry_worker = service(store), service(store)
    old = seed(owner)
    reservation = owner.begin_file_deletion("file", "kb-space")
    with pytest.raises(ValueError):
        retry_worker.retry_video_processing("task")
    owner.abort_file_deletion("file", "space", "wrong-owner")
    assert not retry_worker._persist_processing_status({**old, "status": "queued"})
    owner.abort_file_deletion("file", "space", reservation["token"])
    assert retry_worker._persist_processing_status({**old, "status": "queued"}, expected_status="failed")


def test_abort_does_not_erase_committed_tombstone(store):
    owner = service(store)
    seed(owner)
    reservation = owner.begin_file_deletion("file", "space")
    owner.commit_file_deletion("file", "space", reservation["token"])
    owner.abort_file_deletion("file", "space", reservation["token"])
    assert service(store).begin_file_deletion("file", "space")["already_deleted"]


@pytest.mark.parametrize("missing_at_begin", [False, True])
def test_expired_task_uses_reserved_identity_snapshot(store, monkeypatch, missing_at_begin):
    owner, old_reader = service(store), service(store)
    row = seed(old_reader)
    monkeypatch.setattr(ingestion, "_status_reader_instance", old_reader)
    if missing_at_begin:
        store.delete(owner._processing_status_key("task"))
    reservation = owner.begin_file_deletion("file", "space")
    store.delete(owner._processing_status_key("task"))
    assert owner.commit_file_deletion("file", "space", reservation["token"]) == 1
    assert old_reader._processing_status["task"]["status"] == "deleted"
    assert service(store).get_processing_status_sync("task")["status"] == "deleted"


def test_reservation_rechecks_a_retry_that_wins_the_watch_race(store):
    owner = service(store)
    row = seed(owner)
    store.before_execute = lambda: store.setex(owner._processing_status_key("task"), 60,
                                              json.dumps({**row, "status": "queued"}))
    with pytest.raises(ProcessingTaskActiveError):
        owner.begin_file_deletion("file", "space")
    assert store.get(owner._processing_deletion_key("file", "space")) is None


def test_retry_cannot_launch_when_deletion_wins_its_watch_race(store):
    owner, retry_worker = service(store), service(store)
    seed(owner)
    store.before_execute = lambda: owner.begin_file_deletion("file", "space")
    with pytest.raises(ValueError):
        retry_worker.retry_video_processing("task")
    assert retry_worker.get_processing_status_sync("task")["status"] == "failed"
    assert not retry_worker._background_upload_tasks


def test_new_delete_can_resume_a_dead_same_host_owner_but_not_retry(store, monkeypatch):
    owner, restarted = service(store), service(store)
    seed(owner)
    first = owner.begin_file_deletion("file", "space")
    with pytest.raises(ProcessingTaskActiveError):
        restarted.begin_file_deletion("file", "space")
    monkeypatch.setattr(ingestion.os, "kill", Mock(side_effect=ProcessLookupError))
    second = restarted.begin_file_deletion("file", "space")
    assert second["token"] != first["token"]
    owner.abort_file_deletion("file", "space", first["token"])
    with pytest.raises(ValueError):
        restarted.retry_video_processing("task")
    assert restarted.commit_file_deletion("file", "space", second["token"]) == 1


def test_storage_failure_is_fail_closed_and_keeps_local_tombstone(store, monkeypatch):
    owner = service(store)
    seed(owner)
    reservation = owner.begin_file_deletion("file", "space")
    owner.commit_file_deletion("file", "space", reservation["token"])
    monkeypatch.setattr(store, "get", Mock(side_effect=ConnectionError("offline")))
    with pytest.raises(ProcessingStatusUnavailableError):
        service(store).begin_file_deletion("other", "space")
    with pytest.raises(ProcessingTaskActiveError):
        owner._update_processing_status("task", {"status": "processing"})
    assert owner.get_processing_status_sync("task")["status"] == "deleted"


def test_same_process_readers_recover_only_an_explicitly_settled_owner(store):
    owner, other_reader = service(store), service(store)
    seed(owner)
    first = owner.begin_file_deletion("file", "space")
    with pytest.raises(ProcessingTaskActiveError):
        other_reader.begin_file_deletion("file", "space")
    # A completed request may be unable to remove its reservation during an
    # outage. Relinquishing local ownership enables DELETE, never video retry.
    owner.release_file_deletion_owner(first["token"])
    with pytest.raises(ValueError):
        other_reader.retry_video_processing("task")
    second = other_reader.begin_file_deletion("file", "space")
    assert second["token"] != first["token"]
    other_reader.abort_file_deletion("file", "space", second["token"])


def test_unreachable_store_does_not_resurface_another_workers_retired_cache(store, monkeypatch):
    owner, stale = service(store), service(store)
    old = seed(owner)
    stale._processing_status["task"] = old.copy()
    reservation = owner.begin_file_deletion("file", "space")
    owner.commit_file_deletion("file", "space", reservation["token"])
    monkeypatch.setattr(store, "get", Mock(side_effect=ConnectionError("offline")))
    assert stale.get_processing_status_sync("task")["status"] == "error"
    assert stale.list_processing_statuses_for_kb("space") == []
    assert stale.get_file_processing_status("file", "space") is None


@pytest.mark.parametrize("first_read", ["progress", "list"])
def test_file_tombstone_covers_expired_tasks_only_cached_in_another_worker(store, first_read):
    old_worker, deleting_worker = service(store), service(store)
    old = seed(old_worker)
    # This worker is not either singleton known to the DELETE process.
    store.delete(old_worker._processing_status_key("task"),
                 old_worker._processing_status_kb_key("space"),
                 old_worker._processing_status_file_key("file"))
    reservation = deleting_worker.begin_file_deletion("file", "space")
    assert reservation["matched_count"] == 0
    deleting_worker.commit_file_deletion("file", "space", reservation["token"])
    if first_read == "progress":
        assert old_worker.get_processing_status_sync("task")["status"] == "deleted"
    else:
        assert old_worker.list_processing_statuses_for_kb("space") == []
    assert old_worker.get_processing_status_sync("task")["storage_persisted"] is False
    assert old_worker.get_file_processing_status("file", "space") is None


def test_unknown_file_reservation_can_be_aborted_without_creating_a_tombstone(store):
    owner = service(store)
    reservation = owner.begin_file_deletion("unknown", "space")
    assert reservation["matched_count"] == 0 and not reservation["already_deleted"]
    owner.abort_file_deletion("unknown", "space", reservation["token"])
    assert store.get(owner._processing_deletion_key("unknown", "space")) is None
