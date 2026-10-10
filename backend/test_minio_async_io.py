"""MinIO 适配器不应在 FastAPI 的事件循环线程执行同步网络 I/O。"""

import asyncio
import threading

from app.modules.ingestion.storage.minio_adapter import MinIOAdapter


class _FakePresignClient:
    def presigned_get_object(self, **_kwargs):
        return "http://minio.test/presigned"


class _FakeResponse:
    def __init__(self):
        self.read_thread_id = None
        self.closed = False
        self.released = False

    def read(self):
        self.read_thread_id = threading.get_ident()
        return b"video-bytes"

    def close(self):
        self.closed = True

    def release_conn(self):
        self.released = True


class _FakeClient:
    def __init__(self):
        self.put_thread_id = None
        self.remove_thread_id = None
        self.response = _FakeResponse()

    def bucket_exists(self, _bucket):
        return True

    def make_bucket(self, _bucket):
        raise AssertionError("bucket already exists")

    def put_object(self, **_kwargs):
        self.put_thread_id = threading.get_ident()

    def get_object(self, _bucket, _object_path):
        return self.response

    def remove_object(self, _bucket, _object_path):
        self.remove_thread_id = threading.get_ident()


def _adapter_with_fake_client():
    adapter = MinIOAdapter.__new__(MinIOAdapter)
    adapter.client = _FakeClient()
    adapter._presign_client = _FakePresignClient()
    return adapter


def test_upload_file_runs_sync_minio_put_in_a_worker_thread():
    adapter = _adapter_with_fake_client()
    event_loop_thread_id = threading.get_ident()

    result = asyncio.run(
        adapter.upload_file(
            file_content=b"video",
            file_path="sample.mp4",
            kb_id="kb-video",
            file_type="videos",
        )
    )

    assert result["bucket"] == "kb-video"
    assert adapter.client.put_thread_id is not None
    assert adapter.client.put_thread_id != event_loop_thread_id


def test_get_file_content_runs_sync_minio_read_in_a_worker_thread():
    adapter = _adapter_with_fake_client()
    event_loop_thread_id = threading.get_ident()

    content = asyncio.run(adapter.get_file_content("kb-video", "videos/sample.mp4"))

    assert content == b"video-bytes"
    assert adapter.client.response.read_thread_id is not None
    assert adapter.client.response.read_thread_id != event_loop_thread_id
    assert adapter.client.response.closed is True
    assert adapter.client.response.released is True


def test_delete_file_runs_sync_minio_delete_in_a_worker_thread():
    adapter = _adapter_with_fake_client()
    event_loop_thread_id = threading.get_ident()

    deleted = asyncio.run(adapter.delete_file("kb-video", "videos/sample.mp4"))

    assert deleted is True
    assert adapter.client.remove_thread_id is not None
    assert adapter.client.remove_thread_id != event_loop_thread_id


def test_list_files_consumes_lazy_iterator_in_worker_thread():
    from types import SimpleNamespace
    adapter = _adapter_with_fake_client()
    observed_threads = []
    def list_objects(*_args, **_kwargs):
        observed_threads.append(threading.get_ident())
        yield SimpleNamespace(object_name='images/a.png', size=10, last_modified=None, etag='etag')
    adapter.client.list_objects = list_objects
    result = asyncio.run(adapter.list_files('kb-test'))
    assert result[0]['object_path'] == 'images/a.png'
    assert observed_threads and observed_threads[0] != threading.get_ident()


def test_list_failure_is_not_reported_as_empty_bucket():
    import pytest
    adapter = _adapter_with_fake_client()
    def unavailable(*_args, **_kwargs):
        raise ConnectionError('storage unavailable')
    adapter.client.list_objects = unavailable
    with pytest.raises(ConnectionError):
        asyncio.run(adapter.list_files('kb-test'))


def test_bucket_check_outage_is_not_reported_as_missing_bucket():
    import pytest
    from minio.error import S3Error
    adapter = _adapter_with_fake_client()
    def unavailable(_bucket):
        raise S3Error('ServiceUnavailable', 'offline', '', '', '', None)
    adapter.client.bucket_exists = unavailable
    with pytest.raises(S3Error):
        adapter.bucket_exists('kb-test')
