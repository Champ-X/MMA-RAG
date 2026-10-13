"""A partial cache must never hide durable spaces after managed startup."""
import asyncio
from copy import deepcopy
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.modules.knowledge import service as module
from app.modules.ingestion.storage.minio_adapter import MinIOAdapter
from minio.error import S3Error


class CatalogStorage:
    def __init__(self):
        self.buckets = {
            f"kb-{key}": {"id": key, "name": name, "created_at": "2026-10-12", "updated_at": "2026-10-12"}
            for key, name in [("old-a", "wallpapers"), ("old-b", "旧资料")]
        }
        self.error = None
        self.reads = 0

    def list_bucket_names(self):
        self.reads += 1
        if self.error:
            raise self.error
        return list(self.buckets)

    def get_kb_metadata(self, bucket):
        return deepcopy(self.buckets[bucket])

    def get_bucket_for_kb(self, key):
        return f"kb-{key}"

    bucket_name_for_kb = get_bucket_for_kb

    def bucket_exists(self, bucket):
        return bucket in self.buckets

    def ensure_bucket_for_kb(self, key):
        self.buckets.setdefault(f"kb-{key}", {})

    def put_kb_metadata(self, bucket, data):
        self.buckets[bucket] = deepcopy(data)

    def set_bucket_tags(self, *args):
        pass


@pytest.fixture
def catalog(monkeypatch, tmp_path):
    storage = CatalogStorage()
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path))
    monkeypatch.setattr(module, "VectorStore", Mock())
    monkeypatch.setattr(module, "MinIOAdapter", lambda: storage)
    service = module.KnowledgeBaseService()
    service._get_kb_statistics = AsyncMock(return_value={})
    return service, storage


@pytest.mark.asyncio
async def test_create_sample_before_first_list_retains_all_old_spaces(catalog):
    service, storage = catalog
    before = deepcopy(storage.buckets)
    sample = await service.create_knowledge_base("Tessmora 入门示例", "sample")
    rows = await service.list_knowledge_bases(include_statistics=False)
    assert {row["id"] for row in rows} == {"old-a", "old-b", sample["id"]}
    assert all(storage.buckets[key] == value for key, value in before.items())


@pytest.mark.asyncio
async def test_open_one_space_before_list_does_not_mean_catalog_is_loaded(catalog):
    service, storage = catalog
    assert (await service.get_knowledge_base_metadata("old-a"))["name"] == "wallpapers"
    rows = await service.list_knowledge_bases(include_statistics=False)
    assert {row["id"] for row in rows} == {"old-a", "old-b"}
    assert storage.reads == 1


def test_minio_catalog_failure_is_not_an_empty_bucket_list():
    adapter = MinIOAdapter.__new__(MinIOAdapter)
    adapter.client = SimpleNamespace(list_buckets=Mock(side_effect=OSError("unavailable")))
    with pytest.raises(OSError):
        adapter.list_bucket_names()


@pytest.mark.asyncio
async def test_failed_scan_retains_partial_cache_and_retries(catalog, monkeypatch):
    service, storage = catalog
    await service.get_knowledge_base_metadata("old-a")
    original = storage.get_kb_metadata

    def fail_second_bucket(bucket):
        if bucket == "kb-old-b":
            raise OSError("storage unavailable")
        return original(bucket)

    monkeypatch.setattr(storage, "get_kb_metadata", fail_second_bucket)
    with pytest.raises(module.KnowledgeCatalogUnavailable):
        await service.list_knowledge_bases(include_statistics=False)
    assert set(service._kb_storage) == {"old-a"}
    assert not service._catalog_loaded

    monkeypatch.setattr(storage, "get_kb_metadata", original)
    rows = await service.list_knowledge_bases(include_statistics=False)
    assert {row["id"] for row in rows} == {"old-a", "old-b"}
    assert storage.reads == 2


@pytest.mark.asyncio
async def test_empty_catalog_is_loaded_once(catalog):
    service, storage = catalog
    storage.buckets.clear()
    for _ in range(2):
        assert await service.list_knowledge_bases(include_statistics=False) == []
    assert storage.reads == 1


@pytest.mark.asyncio
async def test_concurrent_first_reads_share_nonblocking_scan(catalog, monkeypatch):
    service, storage = catalog
    original = storage.list_bucket_names
    release = threading.Event()
    entered = asyncio.Event()
    loop = asyncio.get_running_loop()

    def slow_scan():
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(timeout=5), "catalog scan blocked the event loop"
        return original()

    monkeypatch.setattr(storage, "list_bucket_names", slow_scan)
    first = asyncio.create_task(service.list_knowledge_bases(include_statistics=False))
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        second = asyncio.create_task(service.list_knowledge_bases(include_statistics=False))
        await asyncio.sleep(0)
    finally:
        release.set()
    rows = await asyncio.gather(first, second)
    assert all({row["id"] for row in result} == {"old-a", "old-b"} for result in rows)
    assert storage.reads == 1


@pytest.mark.asyncio
async def test_catalog_failure_blocks_create_before_any_storage_write(catalog):
    service, storage = catalog
    before = deepcopy(storage.buckets)
    storage.error = OSError("storage unavailable")
    with pytest.raises(module.KnowledgeCatalogUnavailable):
        await service.create_knowledge_base("example", "")
    assert storage.buckets == before


@pytest.mark.asyncio
async def test_failed_create_does_not_advertise_phantom_space(catalog, monkeypatch):
    service, storage = catalog
    monkeypatch.setattr(storage, "put_kb_metadata", Mock(side_effect=OSError("write failed")))
    with pytest.raises(OSError):
        await service.create_knowledge_base("example", "")
    rows = await service.list_knowledge_bases(include_statistics=False)
    assert {row["id"] for row in rows} == {"old-a", "old-b"}


@pytest.mark.parametrize("method,client_method,missing_code,missing_value", [
    ("get_kb_metadata", "get_object", "NoSuchKey", None),
    ("get_bucket_tags", "get_bucket_tags", "NoSuchTagSet", {}),
])
def test_minio_metadata_distinguishes_absence_from_storage_failure(method, client_method, missing_code, missing_value):
    adapter = MinIOAdapter.__new__(MinIOAdapter)
    for code in (missing_code, "AccessDenied", "InternalError"):
        failure = S3Error(code, "failure", "/bucket", "request", "host", None)
        adapter.client = SimpleNamespace(**{client_method: Mock(side_effect=failure)})
        if code == missing_code:
            assert getattr(adapter, method)("kb-old-a") == missing_value
        else:
            with pytest.raises(S3Error):
                getattr(adapter, method)("kb-old-a")


def test_api_catalog_failure_is_retryable_503(catalog, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.modules.knowledge import portraits

    monkeypatch.setattr(portraits, "PortraitGenerator", Mock())
    from app.api import knowledge

    service, storage = catalog
    monkeypatch.setattr(knowledge, "kb_service", service)
    monkeypatch.setattr(service, "get_random_cover_url", AsyncMock(return_value=None))
    app = FastAPI()
    app.include_router(knowledge.router, prefix="/api/knowledge")
    with TestClient(app) as client:
        storage.error = OSError("private storage error")
        response = client.get("/api/knowledge/")
        assert response.status_code == 503
        assert "已有资料未被清空" in response.json()["detail"]
        assert "private storage error" not in response.text
        storage.error = None
        response = client.get("/api/knowledge/")
        assert response.status_code == 200
        assert {row["id"] for row in response.json()["knowledge_bases"]} == {"old-a", "old-b"}
