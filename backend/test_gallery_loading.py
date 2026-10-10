"""Gallery reads must stay independent of indexing, and use small derivatives."""
import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import pytest
from PIL import Image
from app.api import knowledge
from app.modules.knowledge.service import KnowledgeBaseService
from app.modules.knowledge.thumbnails import ThumbnailCache, render_thumbnail


def png():
    buffer = BytesIO()
    Image.new('RGB', (1800, 1200), (42, 89, 143)).save(buffer, 'PNG')
    return buffer.getvalue()


def test_file_endpoint_never_waits_for_vector_statistics(monkeypatch):
    service = SimpleNamespace(
        get_knowledge_base_metadata=AsyncMock(return_value={'id': 'test'}),
        get_knowledge_base=AsyncMock(side_effect=AssertionError('statistics is not a list dependency')),
        list_kb_files=AsyncMock(return_value=[{'id': 'a'}]),
    )
    monkeypatch.setattr(knowledge, 'kb_service', service)
    assert asyncio.run(knowledge.list_kb_files('test')) == {'files': [{'id': 'a'}]}
    service.get_knowledge_base.assert_not_called()


def test_storage_outage_does_not_produce_successful_empty_list():
    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service.minio_adapter = SimpleNamespace(
        get_bucket_for_kb=lambda _: 'kb-test', bucket_exists=lambda _: True,
        list_files=AsyncMock(side_effect=ConnectionError('offline')),
    )
    with pytest.raises(RuntimeError, match='读取文件清单失败'):
        asyncio.run(service.list_kb_files('test'))


def test_thumbnail_preserves_aspect_ratio_and_reduces_decoded_pixel_budget():
    with Image.open(BytesIO(render_thumbnail(png()))) as image:
        assert image.format == 'WEBP'
        assert image.width <= 640 and image.height <= 480
        assert abs(image.width / image.height - 1.5) < .01


def test_thumbnail_requests_share_work_and_cache_is_bounded():
    async def run():
        adapter = SimpleNamespace(get_file_content=AsyncMock(return_value=png()))
        cache = ThumbnailCache(max_bytes=5000)
        thumbnails = await asyncio.gather(*[cache.get(adapter, 'bucket', 'a') for _ in range(8)])
        assert len(set(thumbnails)) == 1
        adapter.get_file_content.assert_awaited_once()
        await cache.get(adapter, 'bucket', 'a')
        adapter.get_file_content.assert_awaited_once()
        for i in range(30):
            await cache.get(adapter, 'bucket', str(i))
        assert cache.size <= cache.max_bytes
    asyncio.run(run())


def test_bucket_names_keep_all_digits_and_existing_legacy_buckets_remain_readable():
    from app.modules.ingestion.storage.minio_adapter import MinIOAdapter
    adapter = MinIOAdapter.__new__(MinIOAdapter)
    kb_id = '12345678-9abc-4def-8012-34567890abcd'
    expected = 'kb-' + kb_id
    assert adapter.bucket_name_for_kb(kb_id) == expected
    legacy = 'kb-9abc-def-0-90abcd'
    adapter.client = SimpleNamespace(bucket_exists=lambda bucket: bucket == legacy)
    assert adapter.get_bucket_for_kb(kb_id) == legacy
    other = MinIOAdapter.__new__(MinIOAdapter)
    other.client = SimpleNamespace(bucket_exists=lambda _: False)
    assert other.get_bucket_for_kb(kb_id) == expected


def test_saved_space_id_survives_reload_and_alias_lookups_do_not_duplicate_list():
    from app.modules.knowledge.service import _kb_from_meta
    kb = _kb_from_meta('kb-legacy', {'id': 'original-12345678', 'name': 'Example'})
    assert kb.id == 'original-12345678'
    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service._kb_storage = {'legacy': kb, kb.id: kb}
    result = asyncio.run(service.list_knowledge_bases(include_statistics=False))
    assert len(result) == 1 and result[0]['id'] == kb.id


def test_cold_progress_reads_do_not_initialize_ingestion_models(monkeypatch):
    import app.modules.ingestion.service as module
    monkeypatch.setattr(module, '_ingestion_service_instance', None)
    monkeypatch.setattr(module, '_status_reader_instance', None)
    monkeypatch.setattr(module.IngestionService, '__init__', Mock(side_effect=AssertionError('must not load models')))
    reader = module.get_ingestion_status_reader()
    assert reader._processing_status == {}
    assert reader._background_upload_tasks == {}
    assert module.get_ingestion_status_reader() is reader
