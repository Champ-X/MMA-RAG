from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import event

from nexus.bootstrap import NexusContainer
from nexus.modules.sources.domain import (
    SourceIngestionSummaryView,
    SourceProjectionView,
)
from nexus.modules.sources.health import assess_source_health


def _job(*, status: str, error: str | None = None) -> SourceIngestionSummaryView:
    return SourceIngestionSummaryView(
        id="job-1",
        status=status,
        stage="parsing",
        error_code="PARSE_FAILED" if error else None,
        error_message=error,
        attempt_count=1,
        updated_at=datetime.now(UTC),
    )


def _projection(state: str, *, active: int = 0, expected: int = 1) -> SourceProjectionView:
    return SourceProjectionView(
        state=state,
        expected_evidence_count=expected,
        active_evidence_count=active,
        release_id="release-1" if state != "not_configured" else None,
    )


def test_source_health_preserves_searchability_during_refresh_and_failure() -> None:
    refreshing = assess_source_health(
        source_status="processing",
        evidence_count=4,
        capabilities={},
        latest_job=_job(status="running"),
        projection=_projection("active", active=4, expected=4),
    )
    assert refreshing.outcome == "refreshing_with_evidence"
    assert refreshing.searchable is True

    failed = assess_source_health(
        source_status="failed",
        evidence_count=4,
        capabilities={},
        latest_job=_job(status="failed", error="Parser service timed out"),
        projection=_projection("active", active=4, expected=4),
    )
    assert failed.outcome == "refresh_failed_evidence_available"
    assert failed.severity == "warning"
    assert failed.blockers == ("Parser service timed out",)
    assert failed.primary_action == "retry_ingestion"


def test_source_health_distinguishes_exact_only_degraded_and_ready() -> None:
    exact_only = assess_source_health(
        source_status="ready",
        evidence_count=3,
        capabilities={"parse_structure": "ready", "text_index": "pending"},
        latest_job=_job(status="completed"),
        projection=_projection("not_configured", expected=3),
    )
    assert exact_only.outcome == "searchable_exact_only"
    assert exact_only.searchable is True

    degraded = assess_source_health(
        source_status="partial",
        evidence_count=3,
        capabilities={"parse_structure": "ready", "ocr": "partial"},
        latest_job=_job(status="completed"),
        projection=_projection("active", active=3, expected=3),
    )
    assert degraded.outcome == "searchable_with_capability_gaps"
    assert degraded.blockers == ("ocr: partial",)

    ready = assess_source_health(
        source_status="ready",
        evidence_count=3,
        capabilities={"parse_structure": "ready", "text_index": "ready"},
        latest_job=_job(status="completed"),
        projection=_projection("active", active=3, expected=3),
    )
    assert ready.outcome == "ready"
    assert ready.primary_action is None


def test_connected_source_can_check_upstream_without_conflating_reparse(
    api: TestClient,
    tmp_path: Path,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Refreshable sources"}).json()
    root = tmp_path / "connected-folder"
    root.mkdir()
    material = root / "guide.md"
    material.write_text("# Guide\n\nFirst upstream revision.", encoding="utf-8")

    imported = api.post(
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
    assert imported.status_code == 202, imported.text
    first = imported.json()["items"][0]["source_version"]
    assert first["sync"] == {
        "connector_kind": "folder",
        "refreshable": True,
            "scope": "source_set",
            "last_checked_at": first["sync"]["last_checked_at"],
            "schedules": [],
        }
    assert first["health"]["outcome"] == "searchable_exact_only"

    material.write_text(
        "# Guide\n\nSecond upstream revision with changed evidence.",
        encoding="utf-8",
    )
    refreshed = api.post(
        f"/api/v1/spaces/{space['id']}/sources/{first['source_id']}/sync"
    )
    assert refreshed.status_code == 202, refreshed.text
    second = refreshed.json()["items"][0]["source_version"]
    assert second["source_id"] == first["source_id"]
    assert second["version_no"] == first["version_no"] + 1
    assert second["external_version"] != first["external_version"]

    evidence = api.get(
        "/api/v1/evidence",
        params={"space_id": space["id"], "source_id": first["source_id"]},
    ).json()["items"]
    assert any("Second upstream revision" in item["text_content"] for item in evidence)


def test_snapshot_material_does_not_offer_upstream_refresh(api: TestClient) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Snapshots"}).json()
    imported = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "markdown",
            "space_id": space["id"],
            "title": "Immutable note",
            "content": "# Snapshot\n\nThis note has no upstream connector.",
        },
    )
    source = imported.json()["items"][0]["source_version"]
    assert source["sync"]["refreshable"] is False
    assert source["sync"]["scope"] == "snapshot"

    refreshed = api.post(
        f"/api/v1/spaces/{space['id']}/sources/{source['source_id']}/sync"
    )
    assert refreshed.status_code == 409


def test_source_health_register_uses_bounded_batch_queries(
    api: TestClient,
    nexus: NexusContainer,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Batch health"}).json()
    for index in range(6):
        imported = api.post(
            "/api/v1/connectors/sync",
            json={
                "kind": "markdown",
                "space_id": space["id"],
                "title": f"Material {index}",
                "content": f"# Material {index}\n\nBounded source health query.",
            },
        )
        assert imported.status_code == 202

    statements: list[str] = []

    def record_statement(*args: object) -> None:
        statements.append(str(args[2]))

    event.listen(nexus.database.engine, "before_cursor_execute", record_statement)
    try:
        response = api.get(f"/api/v1/spaces/{space['id']}/sources")
    finally:
        event.remove(nexus.database.engine, "before_cursor_execute", record_statement)

    assert response.status_code == 200
    assert len(response.json()["items"]) == 6
    assert len(statements) <= 12
