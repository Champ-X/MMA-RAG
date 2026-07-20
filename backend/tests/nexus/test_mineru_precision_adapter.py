from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from nexus.bootstrap import NexusContainer
from nexus.infrastructure.mineru import MinerURemoteAdapter
from nexus.infrastructure.postgres.models import (
    EvidenceAsset,
    EvidenceLocator,
    EvidenceRevision,
    ObjectManifest,
    SourceVersion,
)
from nexus.infrastructure.source_adapters import ParserRouter
from nexus.shared.domain.enums import Modality
from nexus.shared.domain.errors import CapabilityUnavailableError


@dataclass
class _Image:
    name: str
    path: str
    data: bytes


@dataclass
class _Result:
    state: str = "done"
    task_id: str = "mineru-task-1"
    markdown: str = "# Parsed document"
    content_list: list[dict[str, object]] | None = None
    images: list[_Image] | None = None
    error: str | None = None


class _Client:
    def __init__(self, result: _Result) -> None:
        self.result = result
        self.closed = False
        self.source_path: str | None = None
        self.options: dict[str, object] = {}

    def extract(self, source: str, **options: object) -> _Result:
        self.source_path = source
        self.options = options
        assert Path(source).exists()
        return self.result

    def close(self) -> None:
        self.closed = True


def test_precision_api_persists_content_list_and_derived_images(
    nexus: NexusContainer,
    api: TestClient,
) -> None:
    token = "mineru-secret-that-must-not-leak"
    image_bytes = b"\x89PNG\r\n\x1a\nparsed-image"
    table_image_bytes = b"\x89PNG\r\n\x1a\nparsed-table-image"
    chart_image_bytes = b"\x89PNG\r\n\x1a\nparsed-chart-image"
    result = _Result(
        content_list=[
            {"type": "text", "text": "Evidence on page one", "page_idx": 0},
            {
                "type": "table",
                "table_body": "<table><tr><td>42</td></tr></table>",
                "page_idx": 1,
                "bbox": [10, 20, 300, 400],
                "img_path": "images/table-1.png",
            },
            {
                "type": "image",
                "img_path": "images/figure-1.png",
                "image_caption": ["Launch architecture"],
                "page_idx": 1,
            },
            {
                "type": "chart",
                "img_path": "images/chart-1.png",
                "page_idx": 2,
            },
        ],
        images=[
            _Image("figure-1.png", "images/figure-1.png", image_bytes),
            _Image("table-1.png", "images/table-1.png", table_image_bytes),
            _Image("chart-1.png", "images/chart-1.png", chart_image_bytes),
        ],
    )
    client = _Client(result)
    captured: dict[str, str] = {}

    def factory(*, token: str, base_url: str) -> _Client:
        captured.update(token=token, base_url=base_url)
        return client

    class Captioner:
        image_configured = True

        @staticmethod
        def caption_image(content: bytes, **_: object) -> str:
            assert content in {image_bytes, chart_image_bytes}
            return (
                "A blue architecture diagram connects the retrieval and agent layers."
                if content == image_bytes
                else "A chart compares retrieval quality across systems."
            )

    adapter = MinerURemoteAdapter(token=token, client_factory=factory)
    nexus.ingestion.parser = ParserRouter(mineru=adapter, media_analyzer=Captioner())
    space = nexus.spaces.create(name="MinerU", slug="mineru")
    ingested = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="architecture.pdf",
        content=b"%PDF-1.7\ncontract fixture",
        mime_type="application/pdf",
    )

    assert ingested.job.status == "completed"
    assert captured == {"token": token, "base_url": "https://mineru.net/api/v4"}
    assert client.closed is True
    assert client.source_path is not None and not Path(client.source_path).exists()
    assert client.options == {
        "model": "vlm",
        "formula": True,
        "table": True,
        "language": "ch",
        "timeout": 900,
    }
    with nexus.database.transaction() as session:
        version = session.get(SourceVersion, ingested.source_version.id)
        assert version is not None
        manifest_text = json.dumps(version.parser_manifest)
        assert token not in manifest_text
        assert version.parser_manifest["parser"] == "mineru-precision-api-v1"
        object_manifests = list(
            session.scalars(
                select(ObjectManifest).where(
                    ObjectManifest.source_version_id == ingested.source_version.id
                )
            )
        )
        assert {item.role for item in object_manifests} == {"raw", "document_image"}
        assert {
            nexus.blob_store.get(item.object_key)
            for item in object_manifests
            if item.role == "document_image"
        } == {image_bytes, table_image_bytes, chart_image_bytes}
        image_manifest = next(
            item
            for item in object_manifests
            if item.role == "document_image"
            and nexus.blob_store.get(item.object_key) == image_bytes
        )
        asset = session.scalar(
            select(EvidenceAsset).where(EvidenceAsset.object_key == image_manifest.object_key)
        )
        assert asset is not None
        modalities = set(
            session.scalars(
                select(EvidenceRevision.modality).where(
                    EvidenceRevision.source_version_id == ingested.source_version.id
                )
            )
        )
        assert modalities == {Modality.TEXT.value, Modality.TABLE.value, Modality.IMAGE.value}
        table_row = session.scalar(
            select(EvidenceRevision).where(
                EvidenceRevision.source_version_id == ingested.source_version.id,
                EvidenceRevision.modality == Modality.TABLE.value,
            )
        )
        assert table_row is not None
        text_rows = list(
            session.scalars(
                select(EvidenceRevision).where(
                    EvidenceRevision.source_version_id == ingested.source_version.id,
                    EvidenceRevision.modality == Modality.TEXT.value,
                )
            )
        )
        assert any("blue architecture diagram" in item.text_content for item in text_rows)
        enriched_text = next(
            item for item in text_rows if "blue architecture diagram" in item.text_content
        )
        enriched_locator = session.scalar(
            select(EvidenceLocator).where(
                EvidenceLocator.evidence_revision_id == enriched_text.id
            )
        )
        assert enriched_locator is not None
        assert enriched_locator.extra["object_key"] == image_manifest.object_key
        assert image_manifest.object_key in enriched_locator.extra[
            "related_image_object_keys"
        ]
        assert len(enriched_locator.extra["related_image_object_keys"]) == 2
        assert version.parser_manifest["figure_captions_written_back"] == 2
        assert ingested.source_version.capabilities["figure_caption_writeback"] == "ready"

    source = nexus.control_plane.get_source_version(ingested.source_version.id)
    assert source.derived_image_count == 3
    assert source.published_evidence_count == 4
    assert source.cover_evidence_id is not None
    space_view = nexus.spaces.get(space.id)
    assert space_view.cover_evidence_id == source.cover_evidence_id
    assert space_view.evidence_modality_counts == {"image": 2, "table": 1, "text": 1}

    table_asset = api.get(f"/api/v1/evidence/{table_row.id}/asset")
    assert table_asset.status_code == 200
    assert table_asset.headers["content-type"] == "image/png"
    assert table_asset.content == table_image_bytes
    text_asset = api.get(f"/api/v1/evidence/{enriched_text.id}/asset")
    assert text_asset.status_code == 200
    assert text_asset.headers["content-type"] == "image/png"
    assert text_asset.content == image_bytes

    reprocessed = nexus.ingestion.reprocess(source.source_id)
    assert reprocessed.status == "completed"
    refreshed = nexus.control_plane.get_source_version(source.id)
    assert refreshed.derived_image_count == 3
    with nexus.database.transaction() as session:
        stored_assets = list(
            session.scalars(
                select(ObjectManifest).where(
                    ObjectManifest.source_version_id == source.id,
                    ObjectManifest.role == "document_image",
                )
            )
        )
    assert len(stored_assets) == 3


def test_precision_api_error_redacts_token() -> None:
    token = "do-not-expose"

    class BrokenClient(_Client):
        def extract(self, source: str, **options: object) -> _Result:
            raise RuntimeError(f"request failed with credential {token}")

    adapter = MinerURemoteAdapter(
        token=token,
        client_factory=lambda **_: BrokenClient(_Result()),
    )
    with pytest.raises(CapabilityUnavailableError) as captured:
        adapter.extract(content=b"pdf", filename="broken.pdf")
    assert token not in str(captured.value.details)
    assert "[REDACTED]" in str(captured.value.details)


def test_precision_api_recovers_zip_images_without_content_list_anchor(
    nexus: NexusContainer,
    api: TestClient,
) -> None:
    anchored = b"\x89PNG\r\n\x1a\nanchored"
    orphaned = b"\x89PNG\r\n\x1a\norphaned"
    result = _Result(
        content_list=[
            {"type": "text", "text": "A paragraph", "page_idx": 0},
            {
                "type": "image",
                "image": {"path": "/images/anchored.png"},
                "image_caption": ["Anchored figure"],
                "page_idx": 0,
            },
        ],
        images=[
            _Image("anchored.png", "./images/anchored.png", anchored),
            _Image("orphaned.png", "images/orphaned.png", orphaned),
        ],
    )
    adapter = MinerURemoteAdapter(
        token="configured",
        client_factory=lambda **_: _Client(result),
    )
    nexus.ingestion.parser = ParserRouter(mineru=adapter)
    space = nexus.spaces.create(name="Recovered figures", slug="recovered-figures")

    ingested = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="figures.pdf",
        content=b"%PDF-1.7\nfixture",
        mime_type="application/pdf",
    )

    assert ingested.job.status == "completed"
    source = nexus.control_plane.get_source_version(ingested.source_version.id)
    assert source.derived_image_count == 2
    items, _ = nexus.control_plane.list_evidence(
        space_id=space.id,
        source_id=source.source_id,
        modality=Modality.IMAGE,
        cursor=None,
        limit=20,
    )
    assert len(items) == 2
    recovered = next(
        item
        for item in items
        if "parser_asset_without_content_anchor" in item.quality_flags
    )
    assert recovered.locator.locator_type == "document_asset"
    assert recovered.locator.extra["anchor_precision"] == "document"
    assert recovered.locator.extra["mineru_image_path"] == "images/orphaned.png"
    response = api.get(f"/api/v1/evidence/{recovered.id}/asset")
    assert response.status_code == 200
    assert response.content == orphaned

    with nexus.database.transaction() as session:
        version = session.get(SourceVersion, source.id)
        assert version is not None
        assert version.parser_manifest["unanchored_images_recovered"] == 1
