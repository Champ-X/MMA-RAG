from __future__ import annotations

import base64
import gzip
import io
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from nexus.bootstrap import NexusContainer
from nexus.shared.domain.errors import ValidationError


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (24, 16), color=(43, 89, 201)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_markdown_and_folder_connectors_use_raw_first_pipeline(
    api: TestClient, nexus: NexusContainer, tmp_path: Path
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Connector Sources"}).json()
    markdown = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "markdown",
            "space_id": space["id"],
            "title": "connector-note",
            "content": "# Connector evidence\n\nThe durable connector value is 42.",
        },
    )
    assert markdown.status_code == 202, markdown.text
    item = markdown.json()["items"][0]
    assert item["job"]["status"] == "completed"
    assert item["source_version"]["connector_kind"] == "markdown"
    assert item["source_version"]["canonical_uri"].startswith("nexus:markdown:")
    stored = nexus.control_plane.get_source_version(item["source_version"]["id"])
    assert nexus.blob_store.exists(stored.object_key)

    second_space = api.post("/api/v1/spaces", json={"name": "Second Connector Scope"}).json()
    cross_space = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "markdown",
            "space_id": second_space["id"],
            "title": "connector-note",
            "content": "# Connector evidence\n\nThe durable connector value is 42.",
        },
    )
    assert cross_space.status_code == 202, cross_space.text
    cross_version = cross_space.json()["items"][0]["source_version"]
    assert cross_version["source_id"] == item["source_version"]["source_id"]
    assert set(cross_version["space_ids"]) == {space["id"], second_space["id"]}

    folder = tmp_path / "folder-connector"
    folder.mkdir()
    (folder / "alpha.md").write_text("# Alpha\n\nFolder evidence.", encoding="utf-8")
    synced = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "folder",
            "space_id": space["id"],
            "path": str(folder),
            "max_files": 10,
            "recursive": True,
            "extensions": ["md"],
        },
    )
    assert synced.status_code == 202, synced.text
    assert synced.json()["items"][0]["source_version"]["connector_kind"] == "folder"


def test_url_connector_rejects_private_networks(nexus: NexusContainer) -> None:
    try:
        nexus.connectors.validate_public_url("http://127.0.0.1/private", schemes={"http"})
    except ValidationError as exc:
        assert "non-public" in exc.message
    else:
        raise AssertionError("Loopback connector URL must be rejected")


def test_url_connector_extracts_readable_html_as_markdown(
    api: TestClient,
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Readable Web"}).json()
    url = "https://public.example/article"
    response = httpx.Response(
        200,
        request=httpx.Request("GET", url),
        headers={"content-type": "text/html; charset=utf-8"},
        content=(
            b"<html><head><title>Agent Notes</title><script>ignore()</script></head>"
            b"<body><main><h1>Evidence First</h1><p>The durable answer is 42.</p>"
            b"<a href='/source'>Primary source</a></main></body></html>"
        ),
    )
    monkeypatch.setattr(nexus.connectors, "_download", lambda _: response)
    synced = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "url",
            "space_id": space["id"],
            "url": url,
            "mode": "webpage",
            "include_links": True,
            "include_images": False,
        },
    )
    assert synced.status_code == 202, synced.text
    source = synced.json()["items"][0]["source_version"]
    assert source["mime_type"] == "text/markdown"
    assert source["display_name"].endswith(".md")
    evidence = api.get(
        "/api/v1/evidence", params={"space_id": space["id"], "source_id": source["source_id"]}
    ).json()["items"]
    assert any("durable answer is 42" in item["text_content"] for item in evidence)
    assert all("ignore()" not in item["text_content"] for item in evidence)


def test_url_connector_publishes_embedded_images_as_citable_assets(
    api: TestClient,
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Visual Web"}).json()
    url = "https://public.example/visual-article"
    image_url = "https://cdn.public.example/diagram.png?signature=private"
    image = _png()
    response = httpx.Response(
        200,
        request=httpx.Request("GET", url),
        headers={"content-type": "text/html; charset=utf-8"},
        content=(
            "<html><head><title>Visual evidence</title></head><body><main>"
            "<h1>System diagram</h1><p>Architecture context.</p>"
            f"<img src='{image_url}' alt='retrieval architecture' />"
            "</main></body></html>"
        ).encode(),
    )
    monkeypatch.setattr(nexus.connectors, "_download", lambda _: response)
    monkeypatch.setattr(
        nexus.ingestion.parser,
        "_download_remote_image",
        lambda target: (image, "image/png", target),
    )

    synced = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "url",
            "space_id": space["id"],
            "url": url,
            "mode": "webpage",
            "include_images": True,
        },
    )

    assert synced.status_code == 202, synced.text
    source = synced.json()["items"][0]["source_version"]
    assert source["derived_image_count"] == 1
    evidence = api.get(
        "/api/v1/evidence",
        params={
            "space_id": space["id"],
            "source_id": source["source_id"],
            "modality": "image",
        },
    ).json()["items"]
    assert len(evidence) == 1
    assert evidence[0]["evidence_type"] == "markdown_image"
    assert "retrieval architecture" in evidence[0]["text_content"]
    assert evidence[0]["locator"]["extra"]["image_reference"].endswith("/diagram.png")
    asset = api.get(f"/api/v1/evidence/{evidence[0]['id']}/asset")
    assert asset.status_code == 200
    assert asset.headers["content-type"].startswith("image/png")
    assert asset.content == image


def test_manual_markdown_extracts_inline_base64_image(
    api: TestClient,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Inline visual note"}).json()
    image = _png()
    encoded = base64.b64encode(image).decode()

    synced = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "markdown",
            "space_id": space["id"],
            "title": "inline-visual",
            "content": (
                "# Illustrated note\n\nThe figure is evidence.\n\n"
                f"![blue architecture](data:image/png;base64,{encoded})"
            ),
        },
    )

    assert synced.status_code == 202, synced.text
    source = synced.json()["items"][0]["source_version"]
    assert source["derived_image_count"] == 1
    evidence = api.get(
        "/api/v1/evidence",
        params={
            "space_id": space["id"],
            "source_id": source["source_id"],
            "modality": "image",
        },
    ).json()["items"]
    assert len(evidence) == 1
    assert evidence[0]["locator"]["extra"]["image_reference"] == "inline:data-uri"
    text_evidence = api.get(
        "/api/v1/evidence",
        params={
            "space_id": space["id"],
            "source_id": source["source_id"],
            "modality": "text",
        },
    ).json()["items"]
    assert all(encoded[:100] not in item["text_content"] for item in text_evidence)


def test_folder_markdown_bundles_relative_images_as_citable_assets(
    api: TestClient,
    tmp_path: Path,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Folder visual bundle"}).json()
    root = tmp_path / "visual-notes"
    assets = root / "assets"
    assets.mkdir(parents=True)
    image = _png()
    (assets / "architecture.png").write_bytes(image)
    (root / "README.md").write_text(
        "# Local architecture\n\n![retrieval flow](assets/architecture.png)",
        encoding="utf-8",
    )

    synced = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "folder",
            "space_id": space["id"],
            "path": str(root),
            "recursive": True,
            "extensions": ["md"],
            "max_files": 10,
        },
    )

    assert synced.status_code == 202, synced.text
    source = synced.json()["items"][0]["source_version"]
    assert source["derived_image_count"] == 1
    evidence = api.get(
        "/api/v1/evidence",
        params={
            "space_id": space["id"],
            "source_id": source["source_id"],
            "modality": "image",
        },
    ).json()["items"]
    assert len(evidence) == 1
    assert evidence[0]["locator"]["extra"]["image_reference"] == "inline:data-uri"
    asset = api.get(f"/api/v1/evidence/{evidence[0]['id']}/asset")
    assert asset.status_code == 200
    assert asset.content == image


def test_url_connector_does_not_decode_compressed_response_twice(
    api: TestClient,
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Compressed Web"}).json()
    url = "https://public.example/compressed"
    body = b"<html><body><main><h1>Compressed evidence</h1></main></body></html>"
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            request=request,
            headers={
                "content-type": "text/html; charset=utf-8",
                "content-encoding": "gzip",
                "content-length": str(len(gzip.compress(body))),
            },
            content=gzip.compress(body),
        )
    )
    real_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )
    monkeypatch.setattr(nexus.connectors, "validate_public_url", lambda *_args, **_kwargs: None)

    synced = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "url",
            "space_id": space["id"],
            "url": url,
            "mode": "webpage",
        },
    )

    assert synced.status_code == 202, synced.text
    assert synced.json()["items"][0]["source_version"]["mime_type"] == "text/markdown"


def test_url_connector_retries_transient_transport_failure(
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "https://public.example/transient"
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("temporary connection failure", request=request)
        return httpx.Response(
            200,
            request=request,
            headers={"content-type": "text/html; charset=utf-8"},
            content=b"<html><body><main>Recovered web evidence.</main></body></html>",
        )

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )
    monkeypatch.setattr(nexus.connectors, "validate_public_url", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "nexus.infrastructure.source_adapters.connectors.time.sleep", lambda _seconds: None
    )

    response = nexus.connectors._download(url)

    assert response.status_code == 200
    assert response.content.endswith(b"</html>")
    assert attempts == 2


def test_connector_contract_rejects_parameters_from_another_source(
    api: TestClient,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Typed connectors"}).json()
    response = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "rss",
            "space_id": space["id"],
            "feed_url": "https://public.example/feed.xml",
            "branch": "main",
        },
    )
    assert response.status_code == 422


def test_folder_connector_honors_recursive_extensions_and_exclusions(
    api: TestClient, tmp_path: Path
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Folder contract"}).json()
    root = tmp_path / "folder-options"
    nested = root / "nested"
    nested.mkdir(parents=True)
    (root / "keep.md").write_text("# Keep", encoding="utf-8")
    (root / "skip.tmp").write_text("skip", encoding="utf-8")
    (nested / "nested.md").write_text("# Nested", encoding="utf-8")

    response = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "folder",
            "space_id": space["id"],
            "path": str(root),
            "recursive": False,
            "extensions": ["md"],
            "exclude_globs": ["skip*"],
            "max_files": 20,
        },
    )
    assert response.status_code == 202, response.text
    names = [item["source_version"]["display_name"] for item in response.json()["items"]]
    assert names == ["keep.md"]


def test_rss_connector_materializes_each_entry_with_feed_specific_limit(
    api: TestClient,
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Feed contract"}).json()
    feed_url = "https://public.example/feed.xml"
    response = httpx.Response(
        200,
        request=httpx.Request("GET", feed_url),
        headers={"content-type": "application/rss+xml"},
        content=(
            b"<rss><channel>"
            b"<item><title>First item</title><link>https://public.example/1</link>"
            b"<description>First body</description></item>"
            b"<item><title>Second item</title><link>https://public.example/2</link>"
            b"<description>Second body</description></item>"
            b"</channel></rss>"
        ),
    )
    monkeypatch.setattr(nexus.connectors, "_download", lambda _: response)
    synced = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "rss",
            "space_id": space["id"],
            "feed_url": feed_url,
            "max_entries": 1,
        },
    )
    assert synced.status_code == 202, synced.text
    assert len(synced.json()["items"]) == 1
    assert synced.json()["location"] == feed_url


def test_search_connectors_receive_source_specific_options(
    api: TestClient,
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Search contracts"}).json()
    captured_news: dict[str, object] = {}
    captured_images: dict[str, object] = {}

    def fake_news(query: str, **options: object):
        captured_news.update({"query": query, **options})
        return [nexus.connectors._markdown("# News result", "news-result")]

    def fake_images(query: str, **options: object):
        captured_images.update({"query": query, **options})
        return [nexus.connectors._markdown("# Image result", "image-result")]

    monkeypatch.setattr(nexus.connectors, "_news", fake_news)
    monkeypatch.setattr(nexus.connectors, "_image_search", fake_images)

    news = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "news",
            "space_id": space["id"],
            "query": "agent systems",
            "topic": "finance",
            "time_range": "month",
            "search_depth": "basic",
            "max_results": 6,
            "include_full_content": True,
        },
    )
    images = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "image_search",
            "space_id": space["id"],
            "query": "industrial design",
            "source": "internet_archive",
            "quantity": 4,
            "image_type": "illustration",
            "order": "downloads",
            "safe_search": False,
        },
    )
    assert news.status_code == 202, news.text
    assert captured_news == {
        "query": "agent systems",
        "topic": "finance",
        "time_range": "month",
        "search_depth": "basic",
        "include_full_content": True,
        "max_items": 6,
    }
    assert images.status_code == 202, images.text
    assert captured_images == {
        "query": "industrial design",
        "source": "internet_archive",
        "image_type": "illustration",
        "order": "downloads",
        "safe_search": False,
        "max_items": 4,
    }
