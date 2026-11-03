"""Collection recovery must reuse identity and verify real ingestion receipts."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.modules.collection import ingestion_bridge as bridge
from app.modules.ingestion.sources.base import ContentSourceResult


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, 'backend_data_dir', lambda: tmp_path)
    value = SimpleNamespace(
        get_processing_status=AsyncMock(return_value={'status': 'not_found'}),
        prepare_file_upload=Mock(),
        launch_prepared_file_upload=Mock(return_value={'status': 'queued'}),
        retry_file_processing=Mock(return_value={'status': 'queued'}),
        minio_adapter=SimpleNamespace(client=SimpleNamespace(stat_object=Mock())),
        vector_store=SimpleNamespace(client=SimpleNamespace(count=Mock(return_value=SimpleNamespace(count=2)))),
        _background_upload_tasks={},
    )
    monkeypatch.setattr(bridge, '_service', lambda: value)
    return value


@pytest.mark.asyncio
async def test_lost_start_response_reuses_stable_file_and_processing_identity(service):
    content = ContentSourceResult(b'hello', 'article.txt', meta={'source_url': 'https://example.com', 'author': 'Original author'})
    first = await bridge.ingest_item(content, 'kb-demo', 'item-a', {'run_id': 'run-a', 'author': None})
    file_id, processing_id = bridge.ingestion_ids('demo', 'item-a')
    assert first['file_id'] == file_id and first['processing_id'] == processing_id
    args = service.launch_prepared_file_upload.call_args.kwargs
    assert args['file_id_override'] == file_id
    assert args['source_metadata']['source_url'] == 'https://example.com'
    assert args['source_metadata']['run_id'] == 'run-a'
    assert args['source_metadata']['author'] == 'Original author'
    assert bridge._read_record(processing_id)['file_id'] == file_id
    service.get_processing_status.return_value = {
        'status': 'processing', 'source_kb_id': 'kb-demo', 'file_id': file_id,
    }
    repeated = await bridge.ingest_item(content, 'kb-demo', 'item-a', {})
    assert repeated['processing_id'] == processing_id
    assert service.launch_prepared_file_upload.call_count == 1


@pytest.mark.asyncio
async def test_completed_requires_nonempty_index_and_stored_original(service):
    file_id, processing_id = bridge.ingestion_ids('demo', 'item-a')
    status = {'status': 'completed', 'kb_id': 'demo', 'file_id': file_id,
              'bucket': 'kb-demo', 'object_path': f'documents/{file_id}_a.txt',
              'result': {'vectors_stored': 0}}
    service.get_processing_status.return_value = status
    assert (await bridge.inspect_ingestion('demo', file_id, processing_id))['error_code'] == 'empty_index'
    service.get_processing_status.return_value = {**status, 'result': {'vectors_stored': 2}}
    assert (await bridge.inspect_ingestion('demo', file_id, processing_id))['status'] == 'completed'
    service.vector_store.client.count.assert_called_once()
    service.minio_adapter.client.stat_object.assert_called_once()
    # An expired Redis entry can be reconciled from the durable verified receipt.
    service.get_processing_status.return_value = {'status': 'not_found'}
    assert (await bridge.inspect_ingestion('demo', file_id, processing_id))['status'] == 'completed'


@pytest.mark.asyncio
async def test_stale_completion_receipt_does_not_claim_missing_index_is_ready(service):
    file_id, processing_id = bridge.ingestion_ids('demo', 'item-a')
    service.get_processing_status.return_value = {
        'status': 'completed', 'kb_id': 'demo', 'file_id': file_id,
        'bucket': 'kb-demo', 'object_path': 'documents/a.txt', 'result': {'vectors_stored': 2},
    }
    service.vector_store.client.count.return_value = SimpleNamespace(count=1)
    assert (await bridge.inspect_ingestion('demo', file_id, processing_id))['error_code'] == 'index_missing'


@pytest.mark.asyncio
async def test_missing_index_replays_completed_document_under_original_identity(service):
    file_id, processing_id = bridge.ingestion_ids('demo', 'item-a')
    service.get_processing_status.return_value = {
        'status': 'completed', 'kb_id': 'demo', 'file_id': file_id, 'file_type': 'md',
        'bucket': 'kb-demo', 'object_path': 'documents/a.md', 'result': {'vectors_stored': 2},
        'retry_supported': True, 'storage_persisted': True,
    }
    service.vector_store.client.count.return_value = SimpleNamespace(count=0)
    service.retry_file_processing.side_effect = ValueError('Only failed ingestion tasks may retry')
    result = await bridge.ingest_item(ContentSourceResult(b'original content', 'a.md'), 'demo', 'item-a', {})
    service.retry_file_processing.assert_not_called()
    service.prepare_file_upload.assert_called_once()
    assert service.launch_prepared_file_upload.call_args.kwargs['file_id_override'] == file_id
    assert result['file_id'] == file_id and result['processing_id'] == processing_id


@pytest.mark.asyncio
@pytest.mark.parametrize('shots,frames,complete', [(2, 3, True), (2, 2, False), (1, 4, False)])
async def test_video_completion_checks_shots_and_frames_separately(service, shots, frames, complete):
    from app.modules.ingestion.storage.vector_store import VIDEO_SHOT_COLLECTION
    file_id, processing_id = bridge.ingestion_ids('demo', 'video-a')
    service.get_processing_status.return_value = {
        'status': 'completed', 'kb_id': 'demo', 'file_id': file_id, 'file_type': 'video',
        'bucket': 'kb-demo', 'object_path': 'videos/a.mp4',
        'result': {'vectors_stored': 5, 'shots_count': 2, 'key_frames_count': 3},
    }
    service.vector_store.client.count.side_effect = lambda **kwargs: SimpleNamespace(
        count=shots if kwargs['collection_name'] == VIDEO_SHOT_COLLECTION else frames)
    result = await bridge.inspect_ingestion('demo', file_id, processing_id)
    assert (result['status'] == 'completed') is complete
    if not complete:
        assert result['error_code'] == 'index_missing'


@pytest.mark.asyncio
async def test_completed_receipt_does_not_resurrect_deleted_material(service):
    file_id, processing_id = bridge.ingestion_ids('demo', 'item-a')
    service.get_processing_status.return_value = {
        'status': 'completed', 'kb_id': 'demo', 'file_id': file_id,
        'bucket': 'kb-demo', 'object_path': 'documents/a.txt', 'result': {'vectors_stored': 1},
    }
    class MissingObject(Exception):
        code = 'NoSuchKey'
    service.minio_adapter.client.stat_object.side_effect = MissingObject()
    assert (await bridge.inspect_ingestion('demo', file_id, processing_id))['status'] == 'deleted'


@pytest.mark.asyncio
async def test_foreign_scope_and_uncertain_status_never_start_write(service):
    file_id, processing_id = bridge.ingestion_ids('demo', 'item-a')
    service.get_processing_status.return_value = {'status': 'processing', 'kb_id': 'another'}
    with pytest.raises(ValueError, match='当前空间'):
        await bridge.inspect_ingestion('demo', file_id, processing_id)
    service.get_processing_status.return_value = {'status': 'error'}
    with pytest.raises(RuntimeError, match='确认'):
        await bridge.ingest_item(ContentSourceResult(b'a', 'a.txt'), 'demo', 'item-a', {})
    service.launch_prepared_file_upload.assert_not_called()


@pytest.mark.asyncio
async def test_saved_document_retry_reuses_existing_checkpoint(service):
    file_id, processing_id = bridge.ingestion_ids('demo', 'item-a')
    service.get_processing_status.return_value = {
        'status': 'failed', 'kb_id': 'demo', 'file_id': file_id, 'retry_supported': True,
        'storage_persisted': True, 'retryable': True,
    }
    result = await bridge.ingest_item(ContentSourceResult(b'a', 'a.txt'), 'demo', 'item-a', {})
    assert result['processing_id'] == processing_id
    service.retry_file_processing.assert_called_once_with(processing_id)
    service.launch_prepared_file_upload.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_waits_for_started_background_task(service):
    _, processing_id = bridge.ingestion_ids('demo', 'item-a')
    stopped = asyncio.Event()
    async def worker():
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()
    task = asyncio.create_task(worker())
    service._background_upload_tasks[processing_id] = task
    await asyncio.sleep(0)
    await bridge.cancel_ingestion('demo', processing_id)
    assert stopped.is_set() and task.done()


@pytest.mark.asyncio
async def test_audio_replay_overwrites_the_same_index_point_with_provenance():
    from app.modules.ingestion.storage.vector_store import VectorStore
    storage = VectorStore.__new__(VectorStore)
    storage.client = Mock()
    storage.client.upsert.return_value = SimpleNamespace(operation_id=1)
    source = {'file_id': 'stable-file', 'text_vector': [0.1, 0.2], 'clap_vector': [0.3, 0.4],
              'provenance': {'source_url': 'https://example.com/audio.mp3'}}
    await storage.upsert_audio_vectors('kb-demo', [source])
    await storage.upsert_audio_vectors('kb-demo', [source])
    first, second = [call.kwargs['points'][0] for call in storage.client.upsert.call_args_list]
    assert first.id == second.id
    assert second.payload['provenance'] == source['provenance']


@pytest.mark.asyncio
async def test_video_collection_keeps_source_on_manifest_shots_and_frames(monkeypatch, tmp_path):
    import json
    from test_video_segment_pipeline import _service_fixture, _analysis
    video_service, kwargs, *_ = _service_fixture(monkeypatch, tmp_path)
    kwargs['parse_result']['duration'] = 20
    provenance = {'source_url': 'https://example.com/clip', 'source_channel': 'open_web'}
    kwargs['parse_result']['metadata'] = {'provenance': provenance}
    video_service._parse_video_scene_shot_mllm = AsyncMock(return_value=_analysis(1, 20))
    video_service._build_video_scene_shot_points.return_value['keyframe_points'] = [{'payload': {}}]
    await video_service._process_video_scene_shot(**kwargs)
    manifest = json.loads(video_service.minio_adapter.upload_file.call_args.kwargs['file_content'])
    assert manifest['provenance'] == provenance
    for writer in (video_service.vector_store.upsert_video_shot_vectors,
                   video_service.vector_store.upsert_video_keyframe_vectors):
        assert all(point['payload']['provenance'] == provenance for point in writer.call_args.args[1])
