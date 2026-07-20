from __future__ import annotations

import io
from pathlib import Path
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select

from nexus.bootstrap import NexusContainer, build_container
from nexus.config import NexusSettings
from nexus.infrastructure.celery.tasks import _sync_scheduled_news
from nexus.infrastructure.operations.service import restore_backup_to_empty
from nexus.infrastructure.postgres.models import Space
from nexus.modules.artifacts.renderers import render_artifact
from nexus.shared.domain.errors import ConflictError


def test_backup_restore_drill_to_empty_root(tmp_path: Path, nexus: NexusContainer) -> None:
    space = nexus.spaces.create(name="Restore Drill", slug="restore-drill")
    source = nexus.ingestion.ingest_bytes(
        space_id=space.id,
        filename="restore.md",
        content=b"# Restore\n\nThe authoritative raw object survives a restore drill.",
        mime_type="text/markdown",
    )
    backup = nexus.operations.backup(tmp_path / "backups")
    target_db = tmp_path / "restored" / "nexus.db"
    target_blobs = tmp_path / "restored" / "blobs"
    report = restore_backup_to_empty(
        Path(backup["path"]),
        target_database_url=f"sqlite:///{target_db}",
        target_blob_root=target_blobs,
    )
    assert report["readiness"]["search"] == "rebuild_required"

    restored = build_container(
        NexusSettings(
            environment="test",
            database_url=f"sqlite:///{target_db}",
            auto_create_schema=False,
            blob_backend="filesystem",
            blob_root=target_blobs,
            qdrant_url=None,
            redis_url=None,
            agent_runtime="native",
        )
    )
    try:
        with restored.database.transaction() as session:
            assert session.scalar(select(func.count(Space.id))) == 1
        assert restored.blob_store.get(source.source_version.object_key).startswith(b"# Restore")
    finally:
        restored.database.engine.dispose()

    with pytest.raises(ConflictError):
        restore_backup_to_empty(
            Path(backup["path"]),
            target_database_url=f"sqlite:///{target_db}",
            target_blob_root=target_blobs,
        )


def test_canonical_table_csv_xlsx_pdf_exports() -> None:
    document = {
        "schema": "nexus.block-document.v1",
        "title": "Budget Evidence",
        "blocks": [
            {"type": "heading", "level": 1, "text": "预算证据"},
            {"type": "paragraph", "text": "All values remain in the canonical revision."},
            {
                "type": "table",
                "title": "Budget",
                "columns": ["Item", "USD"],
                "rows": [["Launch", 250000], ["Reserve", 50000]],
            },
        ],
    }
    json_bytes, _, _ = render_artifact(document, "json")
    assert b"nexus.block-document.v1" in json_bytes
    csv_bytes, _, _ = render_artifact(document, "csv")
    assert "Launch,250000" in csv_bytes.decode("utf-8-sig")
    xlsx_bytes, _, _ = render_artifact(document, "xlsx")
    workbook = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=False)
    assert workbook["Budget"]["B2"].value == 250000
    pdf_bytes, _, _ = render_artifact(document, "pdf")
    assert pdf_bytes.startswith(b"%PDF")


def test_scheduled_news_reuses_connector_ingestion_boundary(tmp_path: Path) -> None:
    legacy = NexusSettings(
        _env_file=None,
        TAVILY_HOT_TOPICS_KB_ID="legacy-space",
        TAVILY_HOT_TOPICS_DEFAULT_QUERY="legacy-query",
    )
    assert legacy.scheduled_news_space_id == "legacy-space"
    assert legacy.scheduled_news_query == "legacy-query"
    settings = NexusSettings.for_test(tmp_path).model_copy(
        update={
            "scheduled_news_space_id": "space-daily",
            "scheduled_news_query": "AI research",
            "scheduled_news_topic": "news",
            "scheduled_news_time_range": "day",
            "scheduled_news_max_results": 7,
            "scheduled_news_include_full_content": True,
        }
    )

    class RecordingConnector:
        def __init__(self) -> None:
            self.call: dict[str, object] | None = None

        def sync(self, **kwargs: object) -> list[SimpleNamespace]:
            self.call = kwargs
            return [SimpleNamespace(job=SimpleNamespace(id="job-news"))]

    connector = RecordingConnector()
    result = _sync_scheduled_news(SimpleNamespace(settings=settings, connectors=connector))
    assert result == {
        "status": "scheduled",
        "space_id": "space-daily",
        "items": 1,
        "job_ids": ["job-news"],
    }
    assert connector.call == {
        "kind": "news",
        "space_id": "space-daily",
        "process_inline": False,
        "query": "AI research",
        "topic": "news",
        "time_range": "day",
        "search_depth": "advanced",
        "include_full_content": True,
        "max_results": 7,
    }

    disabled = _sync_scheduled_news(
        SimpleNamespace(
            settings=settings.model_copy(update={"scheduled_news_space_id": None}),
            connectors=connector,
        )
    )
    assert disabled["status"] == "disabled"
