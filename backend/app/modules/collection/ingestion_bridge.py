"""Join durable collection items to the existing leased ingestion pipeline.

Only the collection host supplies stable identities. A lost response can be
reconciled without creating another object or another set of vector IDs.
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path

from app.core.runtime_paths import backend_data_dir
from app.modules.ingestion.sources.base import ContentSourceResult


def _service():
    from app.modules.ingestion.service import get_ingestion_service
    return get_ingestion_service()


def ingestion_ids(kb_id: str, item_id: str) -> tuple[str, str]:
    identity = f"collection:{kb_id.removeprefix('kb-')}:{item_id}"
    return (str(uuid.uuid5(uuid.NAMESPACE_URL, identity)),
            str(uuid.uuid5(uuid.NAMESPACE_URL, identity + ':processing')))


def _record_path(processing_id: str) -> Path:
    # UUID validation keeps the durable receipt directory independent of input paths.
    return backend_data_dir() / 'collection' / 'ingestion' / f'{uuid.UUID(processing_id)}.json'


def _read_record(processing_id: str) -> dict:
    path = _record_path(processing_id)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def _write_record(processing_id: str, record: dict) -> None:
    path = _record_path(processing_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f'.{uuid.uuid4().hex}.tmp')
    try:
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(record, stream, ensure_ascii=False, default=str)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _assert_scope(kb_id: str, record: dict, file_id: str | None = None) -> None:
    recorded_kb = record.get('source_kb_id') or record.get('kb_id')
    if recorded_kb and str(recorded_kb).removeprefix('kb-') != kb_id.removeprefix('kb-'):
        raise ValueError('素材处理任务不属于当前空间')
    if file_id and record.get('file_id') and record['file_id'] != file_id:
        raise ValueError('素材处理身份不匹配')


async def _indexed_count(service, receipt: dict) -> int:
    from qdrant_client.models import FieldCondition, Filter, MatchValue
    from app.modules.ingestion.storage.vector_store import TEXT_CHUNK_COLLECTION, VIDEO_SHOT_COLLECTION, VIDEO_KEYFRAME_COLLECTION
    kind = receipt.get('file_type') or (receipt.get('result') or {}).get('file_type')
    collection = {'image': 'image_vectors', 'audio': 'audio_vectors',
                  'video': VIDEO_SHOT_COLLECTION}.get(kind, TEXT_CHUNK_COLLECTION)
    scope = Filter(must=[
        FieldCondition(key='kb_id', match=MatchValue(value=receipt['kb_id'])),
        FieldCondition(key='file_id', match=MatchValue(value=receipt['file_id'])),
    ])

    async def count(name):
        result = await asyncio.to_thread(service.vector_store.client.count,
                                        collection_name=name, exact=True, count_filter=scope)
        return result.count

    if kind != 'video':
        return await count(collection)
    # Video receipts include both shot and keyframe points. Each collection
    # must be complete; extra points in one cannot hide missing points in the other.
    shots, frames = await asyncio.gather(count(VIDEO_SHOT_COLLECTION), count(VIDEO_KEYFRAME_COLLECTION))
    expected = receipt.get('result') or {}
    if shots < max(1, int(expected.get('shots_count') or 0)) or frames < int(expected.get('key_frames_count') or 0):
        return 0
    return shots + frames


async def inspect_ingestion(kb_id: str, file_id: str | None, processing_id: str | None,
                            *, item_id: str | None = None) -> dict:
    if item_id and not processing_id:
        file_id, processing_id = ingestion_ids(kb_id, item_id)
    if not processing_id:
        return {'status': 'not_found', 'file_id': file_id, 'processing_id': None}
    record = await asyncio.to_thread(_read_record, processing_id)
    _assert_scope(kb_id, record, file_id)
    service = _service()
    status = await service.get_processing_status(processing_id)
    _assert_scope(kb_id, status, file_id)
    if status.get('status') == 'error':
        return {**status, 'file_id': file_id, 'processing_id': processing_id}
    if status.get('status') == 'not_found' and record:
        status = dict(record)
        if status.get('status') not in {'completed', 'deleted'}:
            status.update(status='failed', error='处理记录已过期，可从已保存的采集文件重试。',
                          error_code='processing_interrupted')
    receipt = {**record, **status, 'processing_id': processing_id}
    receipt['file_id'] = receipt.get('file_id') or file_id
    # A durable completion receipt is useful only while its original still exists.
    if receipt.get('status') == 'completed':
        result = receipt.get('result') or {}
        indexed = int(result.get('vectors_stored') or receipt.get('vectors_stored') or 0)
        if indexed <= 0:
            receipt.update(status='failed', error='解析结束，但没有生成可检索的素材索引。',
                           error_code='empty_index')
        elif receipt.get('bucket') and receipt.get('object_path'):
            try:
                await asyncio.to_thread(service.minio_adapter.client.stat_object,
                                        receipt['bucket'], receipt['object_path'])
            except Exception as error:
                if getattr(error, 'code', '') in {'NoSuchKey', 'NoSuchObject', 'NoSuchBucket'}:
                    receipt.update(status='deleted', error='原素材已删除。', error_code='source_deleted')
                else:
                    return {**receipt, 'status': 'error', 'error': '暂时无法核验原素材，请稍后重试。'}
        else:
            receipt.update(status='failed', error='缺少原素材存储凭据，不能确认收录完成。',
                           error_code='missing_storage_receipt')
        if receipt.get('status') == 'completed':
            try:
                actual_count = await _indexed_count(service, receipt)
            except Exception:
                return {**receipt, 'status': 'error', 'error': '暂时无法核验素材索引，请稍后重试。'}
            if actual_count < indexed:
                receipt.update(status='failed', error='素材索引缺失或不完整，可重试恢复。',
                               error_code='index_missing')
    if record or receipt.get('status') not in {'not_found', 'error'}:
        await asyncio.to_thread(_write_record, processing_id, receipt)
    return receipt


async def ingest_item(content: ContentSourceResult, kb_id: str, item_id: str,
                      provenance: dict) -> dict:
    file_id, processing_id = ingestion_ids(kb_id, item_id)
    existing = await inspect_ingestion(kb_id, file_id, processing_id)
    if existing.get('status') in {'completed', 'queued', 'processing'}:
        return existing
    if existing.get('status') == 'error':
        raise RuntimeError('无法确认原处理状态，请稍后重试，避免重复收录。')
    service = _service()
    if (existing.get('status') == 'failed' and existing.get('retry_supported')
            and existing.get('storage_persisted') and existing.get('retryable') is not False
            and existing.get('error_code') not in {'index_missing', 'empty_index', 'missing_storage_receipt'}):
        # Verification can invalidate a completed ingestion receipt while the
        # ingestion service still reports completed. Its failed-only retry API
        # cannot repair that case; replay staged bytes below with the same IDs.
        try:
            result = service.retry_file_processing(processing_id)
            return {**result, 'file_id': file_id, 'processing_id': processing_id}
        except LookupError:
            pass  # Expired status: replay the staged bytes with the same identity.
    filename = Path(content.suggested_filename).name
    if not filename or filename in {'.', '..'}:
        raise ValueError('素材缺少有效文件名')
    source_metadata = {**(content.meta or {}), **{key: value for key, value in provenance.items() if value is not None},
                       'collection_item_id': item_id, 'source_type': 'network_collection'}
    # Binary assets never enter provenance or a model context.
    source_metadata.pop('asset_map', None)
    record = {'kb_id': kb_id, 'source_kb_id': kb_id, 'file_id': file_id,
              'processing_id': processing_id, 'file_path': filename,
              'status': 'preparing', 'source_metadata': source_metadata}
    await asyncio.to_thread(_write_record, processing_id, record)
    service.prepare_file_upload(file_content=content.content, file_path=filename,
                                kb_id=kb_id, processing_id=processing_id)
    result = service.launch_prepared_file_upload(
        file_content=content.content, file_path=filename, kb_id=kb_id,
        processing_id=processing_id, source_type='network_collection',
        source_metadata=source_metadata, file_id_override=file_id,
    )
    return {**result, 'file_id': file_id, 'processing_id': processing_id}


async def cancel_ingestion(kb_id: str, processing_id: str) -> dict:
    service = _service()
    record = await inspect_ingestion(kb_id, None, processing_id)
    task = service._background_upload_tasks.get(processing_id)
    if task and not task.done():
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        # Task done callbacks persist the cancellation before the next read.
        await asyncio.sleep(0)
    return await inspect_ingestion(kb_id, record.get('file_id'), processing_id)
