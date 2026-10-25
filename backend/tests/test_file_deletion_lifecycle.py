"""Physical deletion and durable task retirement must succeed together."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.api import knowledge as api
from app.modules.ingestion import service as ingestion
from app.modules.ingestion.service import ProcessingStatusUnavailableError, ProcessingTaskActiveError
from app.modules.knowledge.service import KnowledgeBaseService, KnowledgeFileDeletionUnavailable
from test_processing_retirement import TransactionRedis, service, seed, seed_placeholder


@pytest.fixture
def case(monkeypatch):
    store = TransactionRedis()
    owner, reader = service(store), service(store)
    monkeypatch.setattr(ingestion, '_ingestion_service_instance', owner)
    monkeypatch.setattr(ingestion, '_status_reader_instance', reader)
    original = seed(owner)
    seed(owner, 'same-name-new-upload', file_id='new-file')
    kb = KnowledgeBaseService.__new__(KnowledgeBaseService)
    kb._ensure_kb_in_cache = lambda _kb: True
    kb._kb_id_candidates = lambda _kb: ['space']
    kb._discover_kb_id_from_bucket_async = AsyncMock(return_value=None)
    kb.minio_adapter = SimpleNamespace(
        get_bucket_for_kb=lambda _kb: 'kb-space',
        list_files=AsyncMock(return_value=[{'object_path': original['object_path']}]),
        delete_file=AsyncMock(return_value=True),
    )
    kb.vector_store = SimpleNamespace(
        client=SimpleNamespace(delete=Mock()),
        delete_video_points_by_file_id=Mock(return_value=True),
        count_kb_chunks=AsyncMock(return_value=(1, 0)),
        count_kb_audio=AsyncMock(return_value=0),
        count_kb_video=AsyncMock(return_value=0),
    )
    from app.modules.knowledge import suggested_questions
    from app.core import portrait_trigger
    monkeypatch.setattr(suggested_questions, 'remove_questions_by_file', Mock(return_value=0))
    monkeypatch.setattr(portrait_trigger, 'trigger_portrait_rebuild', Mock())
    monkeypatch.setattr(portrait_trigger, 'increment_and_maybe_trigger', Mock())
    return kb, owner, reader, original


def test_delete_retires_status_across_reader_and_restart_without_touching_same_name(case):
    kb, owner, reader, old = case
    reader._processing_status['task'] = old.copy()
    async def physical_delete(*_args):
        with pytest.raises(ValueError):
            owner.retry_video_processing('task')
        return True
    kb.minio_adapter.delete_file.side_effect = physical_delete
    assert asyncio.run(kb.delete_kb_file('space', 'file'))

    assert owner.get_processing_status_sync('task')['status'] == 'deleted'
    assert reader.get_processing_status_sync('task')['status'] == 'deleted'
    assert service(owner._processing_status_redis_client).get_processing_status_sync('task')['status'] == 'deleted'
    assert owner.get_processing_status_sync('same-name-new-upload')['status'] == 'failed'
    assert not reader.list_processing_statuses_for_kb('space')[0]['file_id'] == 'file'
    # Once committed, idempotent DELETE does not depend on a healthy object/vector store.
    kb.minio_adapter.list_files.side_effect = OSError('offline')
    assert asyncio.run(kb.delete_kb_file('space', 'file'))


def test_document_deletion_removes_hidden_checkpoints_only_for_exact_file(case):
    kb, owner, reader, original = case
    paths = [original['object_path'], '.ingestion/file/parsed.json.gz', '.ingestion/file/dense/batch.json.gz',
             '.ingestion/file-other/chunks.json.gz']
    kb.minio_adapter.list_files.return_value = [{'object_path': path} for path in paths]
    assert asyncio.run(kb.delete_kb_file('space', 'file'))
    removed = {call.args[1] for call in kb.minio_adapter.delete_file.call_args_list}
    assert removed == set(paths[:3])
    assert reader.get_processing_status_sync('task')['status'] == 'deleted'


def test_ghost_without_original_can_be_deleted_and_unknown_file_still_404(case):
    kb, owner, reader, _old = case
    kb.minio_adapter.list_files.return_value = []
    assert asyncio.run(kb.delete_kb_file('space', 'file'))
    assert reader.get_processing_status_sync('task')['status'] == 'deleted'
    assert asyncio.run(kb.delete_kb_file('space', 'unknown-file')) is False
    assert owner._processing_status_redis_client.get(owner._processing_deletion_key('unknown-file', 'space')) is None


def test_missing_failed_original_cannot_become_placeholder_but_new_upload_still_can(case):
    kb, _owner, _reader, old = case
    kb.minio_adapter.bucket_exists = lambda _bucket: True
    kb.minio_adapter.list_files.return_value = []
    kb._list_processing_statuses_for_kb_best_effort = AsyncMock(return_value=[
        old,
        {**old, 'processing_id': 'new-task', 'file_id': 'new-file', 'status': 'queued'},
        {**old, 'processing_id': 'unsaved-failure', 'file_id': None, 'storage_persisted': False},
    ])
    files = asyncio.run(kb.list_kb_files('space'))
    assert {item['id'] for item in files} == {'new-file', 'processing:unsaved-failure'}


def test_storage_false_does_not_retire_and_releases_its_reservation(case):
    kb, owner, reader, _old = case
    kb.minio_adapter.delete_file.return_value = False
    with pytest.raises(KnowledgeFileDeletionUnavailable):
        asyncio.run(kb.delete_kb_file('space', 'file'))
    assert reader.get_processing_status_sync('task')['status'] == 'failed'
    assert owner._processing_status_redis_client.get(owner._processing_deletion_key('file', 'space')) is None


def test_active_file_rejected_before_vector_or_object_deletion(case):
    kb, owner, _reader, old = case
    owner._persist_processing_status({**old, 'status': 'processing'})
    with pytest.raises(ProcessingTaskActiveError):
        asyncio.run(kb.delete_kb_file('space', 'file'))
    kb.minio_adapter.list_files.assert_not_awaited()
    kb.minio_adapter.delete_file.assert_not_awaited()
    kb.vector_store.client.delete.assert_not_called()


def test_partial_index_failure_keeps_source_and_does_not_commit(case):
    kb, owner, reader, _old = case
    kb.vector_store.delete_video_points_by_file_id.return_value = False
    with pytest.raises(KnowledgeFileDeletionUnavailable):
        asyncio.run(kb.delete_kb_file('space', 'file'))
    kb.minio_adapter.delete_file.assert_not_awaited()
    assert reader.get_processing_status_sync('task')['status'] == 'failed'
    assert owner._processing_status_redis_client.get(owner._processing_deletion_key('file', 'space')) is None


def test_delete_recovers_after_commit_and_abort_both_lose_redis(case, monkeypatch):
    kb, owner, reader, _old = case
    store = owner._processing_status_redis_client
    original_get = store.get

    async def delete_then_lose_status_store(*_args):
        monkeypatch.setattr(store, 'get', Mock(side_effect=ConnectionError('offline')))
        return True

    kb.minio_adapter.delete_file.side_effect = delete_then_lose_status_store
    with pytest.raises(ProcessingStatusUnavailableError):
        asyncio.run(kb.delete_kb_file('space', 'file'))

    monkeypatch.setattr(store, 'get', original_get)
    kb.minio_adapter.delete_file.side_effect = None
    kb.minio_adapter.list_files.return_value = []  # the first request deleted it
    with pytest.raises(ValueError):
        owner.retry_video_processing('task')
    assert asyncio.run(kb.delete_kb_file('space', 'file'))
    assert reader.get_processing_status_sync('task')['status'] == 'deleted'


def test_direct_operation_cancellation_keeps_fence_until_owner_exits(case):
    kb, owner, _reader, _old = case

    async def run():
        entered = asyncio.Event()

        async def blocked_delete(*_args):
            entered.set()
            await asyncio.Event().wait()

        kb.minio_adapter.delete_file.side_effect = blocked_delete
        operation = asyncio.create_task(kb._delete_kb_file_with_status('space', 'file'))
        await asyncio.wait_for(entered.wait(), 2)
        operation.cancel()
        with pytest.raises(asyncio.CancelledError):
            await operation
        with pytest.raises(ProcessingTaskActiveError):
            service(owner._processing_status_redis_client).begin_file_deletion('file', 'space')

    asyncio.run(run())


@pytest.mark.parametrize('cancel_during', ['begin', 'storage'])
def test_request_cancellation_waits_for_owned_deletion_before_releasing_fence(case, cancel_during):
    import threading
    kb, owner, reader, _old = case

    async def run():
        entered = asyncio.Event()
        release = threading.Event()
        loop = asyncio.get_running_loop()
        original_begin = owner.begin_file_deletion

        if cancel_during == 'begin':
            def paused_begin(*args):
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(2)
                return original_begin(*args)
            owner.begin_file_deletion = paused_begin
        else:
            async def paused_storage(*_args):
                entered.set()
                await asyncio.to_thread(release.wait, 2)
                return True
            kb.minio_adapter.delete_file.side_effect = paused_storage

        task = asyncio.create_task(kb.delete_kb_file('space', 'file'))
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done(), 'the request cannot release its fence while a worker is still deleting'
        if cancel_during == 'storage':
            with pytest.raises(ValueError):
                owner.retry_video_processing('task')
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert reader.get_processing_status_sync('task')['status'] == 'deleted'

    asyncio.run(run())


def test_api_preserves_conflict_and_storage_failure_messages(monkeypatch):
    stub = SimpleNamespace(delete_kb_file=AsyncMock(side_effect=ProcessingTaskActiveError('active')))
    monkeypatch.setattr(api, 'kb_service', stub)
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.delete_kb_file('space', 'file'))
    assert error.value.status_code == 409
    stub.delete_kb_file.side_effect = KnowledgeFileDeletionUnavailable('存储未就绪')
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.delete_kb_file('space', 'file'))
    assert error.value.status_code == 503 and error.value.detail == '存储未就绪'


def assert_no_physical_storage_access(kb):
    kb._ensure_kb_in_cache.assert_not_called()
    kb.minio_adapter.list_files.assert_not_awaited()
    kb.minio_adapter.delete_file.assert_not_awaited()
    kb.vector_store.client.delete.assert_not_called()
    kb.vector_store.delete_video_points_by_file_id.assert_not_called()


def test_api_deletes_unsaved_placeholder_idempotently_without_physical_access(case, monkeypatch):
    kb, owner, reader, old = case
    seed_placeholder(owner)
    seed_placeholder(owner, task_id='same-pdf-new-upload')
    kb._ensure_kb_in_cache = Mock(side_effect=AssertionError('placeholder must bypass storage'))
    monkeypatch.setattr(api, 'kb_service', kb)
    for _ in range(2):
        assert asyncio.run(api.delete_kb_file('space', 'processing:unsaved')) == {'message': '文件已删除'}
    assert_no_physical_storage_access(kb)
    assert reader.get_processing_status_sync('unsaved')['status'] == 'deleted'
    assert owner._load_persisted_processing_status('task') == old
    assert owner.get_processing_status_sync('same-pdf-new-upload')['status'] == 'failed'
    assert owner.get_processing_status_sync('same-name-new-upload')['status'] == 'failed'


@pytest.mark.parametrize(('kb_id', 'placeholder_id', 'updates', 'expected_code'), [
    ('space', 'processing:unknown', {}, 404),
    ('other', 'processing:unsaved', {}, 404),
    ('space', 'processing:', {}, 404),
    ('space', 'processing:unsaved', {'status': 'queued'}, 409),
    ('space', 'processing:unsaved', {'file_id': 'saved-file'}, 409),
])
def test_api_rejects_invalid_placeholder_deletion_without_physical_access(
    case, monkeypatch, kb_id, placeholder_id, updates, expected_code,
):
    kb, owner, _reader, _old = case
    seed_placeholder(owner, **updates)
    kb._ensure_kb_in_cache = Mock(side_effect=AssertionError('placeholder must bypass storage'))
    monkeypatch.setattr(api, 'kb_service', kb)
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.delete_kb_file(kb_id, placeholder_id))
    assert error.value.status_code == expected_code
    assert_no_physical_storage_access(kb)
    assert owner.get_processing_status_sync('unsaved')['status'] != 'deleted'


@pytest.mark.parametrize('unavailable_method', ['get', 'pipeline'])
def test_api_placeholder_redis_outage_is_503_without_physical_access(case, monkeypatch, unavailable_method):
    kb, owner, _reader, _old = case
    seed_placeholder(owner)
    kb._ensure_kb_in_cache = Mock(side_effect=AssertionError('placeholder must bypass storage'))
    monkeypatch.setattr(api, 'kb_service', kb)
    monkeypatch.setattr(owner._processing_status_redis_client, unavailable_method,
                        Mock(side_effect=ConnectionError('offline')))
    with pytest.raises(HTTPException) as error:
        asyncio.run(api.delete_kb_file('space', 'processing:unsaved'))
    assert error.value.status_code == 503
    assert_no_physical_storage_access(kb)
    assert owner._processing_status['unsaved']['status'] == 'failed'


def test_placeholder_list_marks_source_unsaved_and_hides_retired_task(case):
    kb, owner, reader, _old = case
    legacy = seed_placeholder(owner)
    legacy.pop('storage_persisted')
    assert owner._persist_processing_status(legacy)
    kb.minio_adapter.bucket_exists = lambda _bucket: True
    kb.minio_adapter.list_files.return_value = []
    kb._list_processing_statuses_for_kb_best_effort = AsyncMock(
        side_effect=lambda kb_id: reader.list_processing_statuses_for_kb(kb_id),
    )
    files = asyncio.run(kb.list_kb_files('space'))
    assert len(files) == 1
    assert files[0]['id'] == 'processing:unsaved'
    assert files[0]['storage_persisted'] is False
    assert asyncio.run(kb.delete_kb_file('space', files[0]['id']))
    assert asyncio.run(kb.list_kb_files('space')) == []
