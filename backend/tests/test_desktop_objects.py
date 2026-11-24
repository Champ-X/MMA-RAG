"""Real disk + real HTTP contracts for desktop storage; no MinIO service needed."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import io
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlencode

from fastapi import FastAPI
from fastapi.testclient import TestClient
from minio.error import S3Error
import pytest

from app.api.objects import router
from app.core import storage_health
from app.modules.ingestion.document_checkpoints import DocumentCheckpoints
from app.modules.ingestion.storage.local_objects import LocalObjectClient
from app.modules.ingestion.storage.minio_adapter import MinIOAdapter


@pytest.fixture
def desktop(tmp_path, monkeypatch):
    monkeypatch.setenv("TESSMORA_RUNTIME_PROFILE", "desktop")
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path))
    monkeypatch.setenv("TESSMORA_DESKTOP_TOKEN", "test-instance-token-" + "a" * 40)
    app = FastAPI()
    app.include_router(router, prefix="/api/objects")
    with TestClient(app) as http:
        yield MinIOAdapter(), http, tmp_path


def upload(adapter, content=b"0123456789", path="documents/nested/source.txt"):
    return asyncio.run(adapter.upload_file(content, "source.txt", "test-kb", "documents", custom_object_path=path))


def test_real_upload_metadata_and_signed_media_roundtrip(desktop):
    adapter, http, root = desktop
    result = upload(adapter, "文件内容".encode(), "documents/中文/CON .txt")
    adapter.put_kb_metadata(result["bucket"], {"name": "研究资料", "kb_id": "test-kb"})
    adapter.set_bucket_tags(result["bucket"], {"name": "Research"})
    reopened = MinIOAdapter()
    assert reopened.get_kb_metadata(result["bucket"])["name"] == "研究资料"
    assert reopened.get_bucket_tags(result["bucket"])["name"] == "Research"
    assert asyncio.run(reopened.get_file_content(result["bucket"], result["object_path"])) == "文件内容".encode()
    response = http.get(result["presigned_url"])
    assert response.status_code == 200 and response.content == "文件内容".encode()
    assert "TESSMORA" not in result["presigned_url"] and "127.0.0.1" not in result["presigned_url"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert (root / "objects-metadata" / "catalog.sqlite3").is_file()
    assert all(path.name.isascii() for path in (root / "objects" / result["bucket"]).iterdir())
    assert storage_health.check_minio() == {"name": "minio", "backend": "filesystem", "success": True,
                                           "message": "本地文件存储读写正常"}


@pytest.mark.parametrize("requested,expected,content_range", [
    ("bytes=2-5", b"2345", "bytes 2-5/10"),
    ("bytes=7-", b"789", "bytes 7-9/10"),
    ("bytes=-3", b"789", "bytes 7-9/10"),
    ("bytes=8-999", b"89", "bytes 8-9/10"),
])
def test_media_seeking_supports_ranges_and_head(desktop, requested, expected, content_range):
    adapter, http, _ = desktop
    url = upload(adapter, path="videos/clip.mp4")["presigned_url"]
    response = http.get(url, headers={"Range": requested})
    assert response.status_code == 206 and response.content == expected
    assert response.headers["content-range"] == content_range
    assert response.headers["content-type"] == "video/mp4"
    head = http.head(url, headers={"Range": requested})
    assert head.status_code == 206 and head.content == b""
    assert head.headers["content-length"] == str(len(expected))
    assert http.get(url, headers={"Range": requested, "If-Range": '"old-version"'}).status_code == 200


@pytest.mark.parametrize("requested", ["bytes=10-", "bytes=3-1", "bytes=-0", "bytes=0-1,3-4", "items=0-1", "bytes=-"])
def test_invalid_media_ranges_fail_without_returning_entire_object(desktop, requested):
    adapter, http, _ = desktop
    response = http.get(upload(adapter)["presigned_url"], headers={"Range": requested})
    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */10"


def test_empty_file_and_active_document_delivery(desktop):
    adapter, http, _ = desktop
    response = http.get(upload(adapter, b"", "documents/empty.txt")["presigned_url"])
    assert response.status_code == 200 and response.content == b"" and response.headers["content-length"] == "0"
    response = http.get(upload(adapter, b"<script>alert(1)</script>", "documents/file.html")["presigned_url"])
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["content-security-policy"] == "sandbox; default-src 'none'"


def test_signatures_are_object_scoped_expiring_and_restart_bound(desktop, monkeypatch):
    adapter, http, _ = desktop
    url = upload(adapter)["presigned_url"]
    parts = urlsplit(url)
    assert http.get(parts.path).status_code == 403
    assert http.get(url.replace("source.txt", "other.txt")).status_code == 403
    query = parse_qs(parts.query)
    query["expires"] = ["1"]
    assert http.get(parts.path + "?" + urlencode({k: v[0] for k, v in query.items()})).status_code == 403
    monkeypatch.setenv("TESSMORA_DESKTOP_TOKEN", "new-instance-token")
    assert http.get(url).status_code == 403
    refreshed = asyncio.run(adapter.get_presigned_url("kb-test-kb", "documents/nested/source.txt"))
    assert http.get(refreshed).status_code == 200
    monkeypatch.delenv("TESSMORA_RUNTIME_PROFILE")
    assert http.get(refreshed).status_code == 404


def test_checkpoint_and_pi_versioned_streaming_contract(desktop, tmp_path):
    adapter, _, _ = desktop
    result = upload(adapter)
    client = adapter.client
    checkpoint = DocumentCheckpoints(client, bucket=result["bucket"], file_id="file-test", object_path=result["object_path"])
    asyncio.run(checkpoint.save("parsed", {"text": "可恢复", "image": b"image"}))
    assert asyncio.run(checkpoint.load("parsed")) == {"text": "可恢复", "image": b"image"}
    assert asyncio.run(checkpoint.load("missing")) is None
    version = client.stat_object(result["bucket"], result["object_path"]).etag
    stream = client.get_object(result["bucket"], result["object_path"], request_headers={"If-Match": version})
    upload(adapter, b"replacement")
    try:
        assert b"".join(stream.stream(3)) == b"0123456789"
    finally:
        stream.close()
        stream.release_conn()
    with pytest.raises(S3Error, match="PreconditionFailed"):
        client.get_object(result["bucket"], result["object_path"], request_headers={"If-Match": version})


def test_pi_catalog_downloads_real_desktop_original_with_stable_identity(desktop, tmp_path):
    from app.modules.pi_agent.catalog import SourceCatalog
    adapter, _, _ = desktop
    result = asyncio.run(adapter.upload_file(b"Research source", "source.txt", "test-kb", "documents"))
    adapter.put_kb_metadata(result["bucket"], {"name": "Research"})
    catalog = SourceCatalog.load(adapter.client)
    assert catalog.knowledge_bases["test-kb"] == "Research"
    source = next(iter(catalog.sources.values()))
    assert source.file_id == result["file_id"] and source.object_path == result["object_path"]
    destination = tmp_path / "pi-source.txt"
    catalog.download(adapter.client, source, destination)
    assert destination.read_bytes() == b"Research source"


def test_future_catalog_version_is_preserved_and_refused(desktop):
    import sqlite3
    adapter, _, _ = desktop
    with sqlite3.connect(adapter.client.database) as db:
        db.execute("PRAGMA user_version=99")
    with pytest.raises(ValueError, match="migration"):
        LocalObjectClient()
    with sqlite3.connect(adapter.client.database) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 99


def test_initial_catalog_schema_upgrades_without_changing_object_versions(tmp_path):
    import sqlite3
    root = tmp_path / "objects"
    metadata = tmp_path / "objects-metadata"
    metadata.mkdir()
    with sqlite3.connect(metadata / "catalog.sqlite3") as db:
        db.executescript("CREATE TABLE buckets(name TEXT PRIMARY KEY,created REAL,tags TEXT);"
            "CREATE TABLE objects(bucket TEXT,key TEXT,blob TEXT,size INTEGER,content_type TEXT,modified REAL,PRIMARY KEY(bucket,key));"
            "PRAGMA user_version=1;")
        db.execute("INSERT INTO buckets VALUES('kb-test',1,'{}')")
        db.execute("INSERT INTO objects VALUES('kb-test','original',?,0,'text/plain',1)", ('a' * 64,))
    LocalObjectClient(root)
    with sqlite3.connect(metadata / "catalog.sqlite3") as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 2
        assert db.execute("SELECT etag FROM objects").fetchone()[0] == 'a' * 64


def test_failed_and_concurrent_writes_keep_committed_objects_readable(desktop):
    adapter, _, _ = desktop
    result = upload(adapter)
    client = adapter.client
    with pytest.raises(IOError):
        client.put_object(result["bucket"], result["object_path"], io.BytesIO(b"short"), 100)
    assert asyncio.run(adapter.get_file_content(result["bucket"], result["object_path"])) == b"0123456789"
    def write(index):
        data = str(index).encode() * 1000
        client.put_object(result["bucket"], f"documents/{index}.txt", io.BytesIO(data), len(data))
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(write, range(12)))
    assert len(list(client.list_objects(result["bucket"], prefix="documents/", recursive=True))) == 13
    assert not list(client.staging.iterdir())


def test_object_identity_and_deletion_do_not_escape_or_remove_shared_content(desktop, tmp_path):
    adapter, _, _ = desktop
    first = upload(adapter, b"shared", "documents/first.txt")
    upload(adapter, b"shared", "documents/second.txt")
    client = adapter.client
    for key in ("../outside", "/absolute", "a/../outside", "a\\outside", "a\x00outside"):
        with pytest.raises(S3Error):
            client.put_object(first["bucket"], key, io.BytesIO(b"bad"), 3)
    with pytest.raises(S3Error):
        client.make_bucket("../outside")
    assert asyncio.run(adapter.delete_file(first["bucket"], first["object_path"]))
    assert asyncio.run(adapter.get_file_content(first["bucket"], "documents/second.txt")) == b"shared"
    with pytest.raises(S3Error, match="BucketNotEmpty"):
        client.remove_bucket(first["bucket"])
    client.remove_object(first["bucket"], "documents/second.txt")
    client.remove_bucket(first["bucket"])
    assert not client.bucket_exists(first["bucket"])


def test_symbolic_links_and_missing_state_cannot_redirect_storage(desktop, monkeypatch, tmp_path):
    adapter, _, root = desktop
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "objects" / "kb-linked").symlink_to(outside, target_is_directory=True)
    with pytest.raises(PermissionError):
        adapter.client.make_bucket("kb-linked")
    monkeypatch.delenv("TESSMORA_STATE_DIR")
    with pytest.raises(RuntimeError, match="TESSMORA_STATE_DIR"):
        LocalObjectClient()


def test_legacy_and_desktop_reference_urls_resolve_nested_keys(desktop):
    from app.api.chat import _resolve_media_presigned_url
    from app.integrations.feishu_media import _build_object_path_candidates
    adapter, http, _ = desktop
    result = upload(adapter, b"image", "videos/file-id/keyframes/frame.jpg")
    for value in (result["object_path"], f"http://legacy-storage/{result['bucket']}/{result['object_path']}?old=signature",
                  result["presigned_url"]):
        url, bucket, key = asyncio.run(_resolve_media_presigned_url(
            minio_adapter=adapter, kb_id="test-kb", file_path=value, media_prefix="images"))
        assert key == result["object_path"] and bucket == result["bucket"]
        assert http.get(url).content == b"image"
        assert result["object_path"] in _build_object_path_candidates(value, "images")


def test_server_profile_preserves_minio_constructor(monkeypatch):
    from app.modules.ingestion.storage import minio_adapter
    from unittest.mock import Mock
    monkeypatch.delenv("TESSMORA_RUNTIME_PROFILE", raising=False)
    factory = Mock()
    monkeypatch.setattr(minio_adapter.minio, "Minio", factory)
    adapter = MinIOAdapter()
    assert factory.called and adapter.client is factory.return_value
