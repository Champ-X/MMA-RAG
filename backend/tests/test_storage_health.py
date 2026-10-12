"""Real SDK transports with local servers: no developer storage or model calls."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from qdrant_client.http.exceptions import UnexpectedResponse, ResponseHandlingException

from app.core.config import settings
from app.core import storage_health, setup_service


@pytest.fixture
def storage_servers(monkeypatch, tmp_path):
    calls = {"origin": [], "proxy": []}

    def handler(proxy=False):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls["proxy" if proxy else "origin"].append(self.path)
                self.send_response(502 if proxy else 200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                body = {"title": "qdrant", "version": "1.16.2"} if self.path == "/" else {"result": {"collections": []}, "status": "ok", "time": 0}
                self.wfile.write(b"private-response-body" if proxy else json.dumps(body).encode())

            def log_message(self, *args):
                pass
        return Handler

    origin = ThreadingHTTPServer(("127.0.0.1", 0), handler())
    proxy = ThreadingHTTPServer(("127.0.0.1", 0), handler(True))
    threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (origin, proxy)]
    for thread in threads:
        thread.start()
    for key in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "all_proxy"):
        monkeypatch.setenv(key, f"http://127.0.0.1:{proxy.server_port}")
    # The lowercase bypass list wins, recreating the Docker-injected mismatch.
    monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1,qdrant")
    monkeypatch.setenv("no_proxy", "localhost")
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "qdrant_host", "127.0.0.1")
    monkeypatch.setattr(settings, "qdrant_port", origin.server_port)
    monkeypatch.setattr(settings, "qdrant_api_key", None)
    monkeypatch.setattr(settings, "qdrant_use_env_proxy", False)
    monkeypatch.setattr(settings, "siliconflow_api_key", "synthetic-saved-key")
    try:
        yield f"http://127.0.0.1:{origin.server_port}", calls
    finally:
        for server in (origin, proxy):
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(timeout=2)


@pytest.mark.asyncio
async def test_all_qdrant_paths_bypass_inherited_proxy_but_external_clients_keep_it(storage_servers, tmp_path):
    from app.modules.ingestion.storage.vector_store import VectorStore
    from app.modules.pi_agent.supervisor import PiSupervisor
    from app.modules.pi_agent.config import PiSettings
    base, calls = storage_servers
    assert httpx.get(base + "/collections").status_code == 502
    assert httpx.get(base + "/collections", trust_env=False).status_code == 200
    calls["proxy"].clear()
    before = len(calls["origin"])
    store = VectorStore()
    try:
        # Saved credentials must not cause collection writes on construction.
        assert len(calls["origin"]) == before
        assert store.client.get_collections().collections == []
        setup_service._assert_embedding_change_safe()
        assert storage_health.check_qdrant()["success"]
        host = PiSupervisor(PiSettings(data_dir=tmp_path / "pi"), object(), storage=object())
        try:
            assert (await host.vectors.get_collections()).collections == []
        finally:
            await host.close()
        assert calls["proxy"] == []
        assert httpx.get("http://models.example.invalid/probe").status_code == 502
        assert calls["proxy"] == ["http://models.example.invalid/probe"]
    finally:
        store.client.close()


def test_remote_qdrant_can_explicitly_opt_in_to_environment_proxy(storage_servers, monkeypatch):
    monkeypatch.setattr(settings, "qdrant_use_env_proxy", True)
    result = storage_health.check_qdrant()
    assert result["success"] is False
    assert result["http_status"] == 502
    assert "private-response-body" not in json.dumps(result)


@pytest.mark.parametrize("error,code,status", [
    (UnexpectedResponse(502, "bad gateway private-key", b"private-key", httpx.Headers()), "http_error", 502),
    (ResponseHandlingException(httpx.ConnectError("private-key")), "connection", None),
    (httpx.ReadTimeout("private-key"), "timeout", None),
    (storage_health.StorageSchemaMismatch("private-key"), "schema_mismatch", None),
])
def test_storage_failures_preserve_cause_without_leaking_response_or_url(error, code, status):
    detail = storage_health.storage_failure("qdrant", error)
    assert detail["error_code"] == code
    assert detail.get("http_status") == status
    assert "Qdrant" in detail["message"]
    assert "private-key" not in json.dumps(detail)


def test_storage_endpoint_reports_both_services_without_creating_collections(monkeypatch):
    from app.api.setup import router
    monkeypatch.setattr(storage_health, "check_qdrant", lambda: storage_health.storage_failure("qdrant", httpx.ConnectError("secret")))
    monkeypatch.setattr(storage_health, "check_minio", lambda: {"name": "minio", "success": True})
    app = FastAPI()
    app.include_router(router, prefix="/api/setup")
    with TestClient(app) as client:
        response = client.get("/api/setup/storage")
    assert response.status_code == 200
    assert response.json()["success"] is False
    assert response.json()["checks"][1]["success"] is True
    assert "secret" not in response.text


def test_storage_prepare_checks_before_constructing_store_and_closes_it(monkeypatch):
    from app.modules.ingestion.storage import vector_store
    fail = storage_health.storage_failure("minio", ConnectionError("private-key"))
    factory = Mock()
    monkeypatch.setattr(vector_store, "VectorStore", factory)
    monkeypatch.setattr(setup_service, "check_storage", lambda: {"checks": [fail]})
    with pytest.raises(storage_health.StorageUnavailable) as failure:
        setup_service._prepare_storage()
    assert failure.value.detail["name"] == "minio"
    factory.assert_not_called()
    monkeypatch.setattr(setup_service, "check_storage", lambda: {"checks": []})
    store = factory.return_value
    store.collections = {"text_chunks_agentic": {}}
    store.client.get_collections.return_value = SimpleNamespace(collections=[SimpleNamespace(name="text_chunks_agentic")])
    setup_service._prepare_storage()
    factory.assert_called_once_with(initialize_collections=False)
    store._ensure_collections.assert_called_once_with(strict=True)
    store.client.close.assert_called_once()
    store._ensure_collections.side_effect = UnexpectedResponse(403, "private-key", b"private-key", httpx.Headers())
    with pytest.raises(storage_health.StorageUnavailable) as failure:
        setup_service._prepare_storage()
    assert failure.value.detail["http_status"] == 403
    assert store.client.close.call_count == 2


@pytest.mark.parametrize("mode", ["wrong_names", "missing_sparse", "wrong_size", "http_error", "index_error"])
def test_strict_initialization_never_recreates_existing_data_and_propagates_errors(mode):
    from qdrant_client.http.models import VectorParams, Distance, SparseVectorParams
    from app.modules.ingestion.storage.vector_store import VectorStore
    store = VectorStore.__new__(VectorStore)
    store.client = Mock()
    vectors = {"dense": VectorParams(size=4, distance=Distance.COSINE)}
    store.collections = {"existing": {"vectors_config": vectors["dense"], "vector_size": 4,
                                     "sparse_vectors_config": {"sparse": SparseVectorParams()}, "payload_schema": {"kb_id": "keyword"}}}
    params = SimpleNamespace(vectors=vectors, sparse_vectors={"sparse": SparseVectorParams()})
    store.client.get_collection.return_value = SimpleNamespace(config=SimpleNamespace(params=params), payload_schema={})
    expected = storage_health.StorageSchemaMismatch
    if mode == "wrong_names":
        store.collections["existing"].update(is_multi_vector=True, vectors_config={"text_vec": vectors["dense"]})
    elif mode == "missing_sparse":
        params.sparse_vectors = {}
    elif mode == "wrong_size":
        store.collections["existing"]["vector_size"] = 8
    else:
        expected = UnexpectedResponse
        operation = store.client.get_collection if mode == "http_error" else store.client.create_payload_index
        operation.side_effect = UnexpectedResponse(502, "Bad Gateway", b"", httpx.Headers())
    with pytest.raises(expected):
        store._ensure_collections(strict=True)
    store.client.delete_collection.assert_not_called()
    store.client.create_collection.assert_not_called()
