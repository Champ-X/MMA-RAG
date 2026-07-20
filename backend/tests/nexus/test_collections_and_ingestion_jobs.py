from __future__ import annotations

from fastapi.testclient import TestClient

from nexus.bootstrap import NexusContainer


def _space(api: TestClient) -> dict[str, object]:
    response = api.post("/api/v1/spaces", json={"name": "Saved scope contracts"})
    assert response.status_code == 201, response.text
    return response.json()


def _upload(api: TestClient, space_id: str, name: str, content: str) -> dict[str, object]:
    response = api.post(
        "/api/v1/sources/upload",
        data={"space_id": space_id},
        files={"file": (name, content.encode(), "text/markdown")},
    )
    assert response.status_code == 202, response.text
    return response.json()


def test_collection_crud_dynamic_resolution_and_frozen_run_scope(api: TestClient) -> None:
    space = _space(api)
    first = _upload(api, str(space["id"]), "atlas.md", "# Atlas\n\nAtlas has 42 seats.")
    second = _upload(api, str(space["id"]), "aurora.md", "# Aurora\n\nAurora has 77 seats.")
    first_source = first["source_version"]["source_id"]
    second_source = second["source_version"]["source_id"]

    created = api.post(
        f"/api/v1/spaces/{space['id']}/collections",
        json={
            "name": "Atlas shelf",
            "description": "Only approved Atlas material",
            "view_kind": "manual",
            "source_ids": [first_source],
        },
    )
    assert created.status_code == 201, created.text
    collection = created.json()
    assert collection["source_ids"] == [first_source]
    assert collection["source_count"] == 1

    search = api.post(
        "/api/v1/search",
        json={
            "query": "seats",
            "scope": {"collection_ids": [collection["id"]]},
            "quality_mode": "fast",
        },
    )
    assert search.status_code == 200, search.text
    assert {hit["evidence"]["source_id"] for hit in search.json()["hits"]} == {first_source}

    run = api.post(
        "/api/v1/runs",
        json={
            "goal": "How many Atlas seats?",
            "kind": "quick",
            "scope": {"collection_ids": [collection["id"]]},
        },
    )
    assert run.status_code == 202, run.text
    frozen = run.json()["scope"]
    assert frozen["collection_ids"] == [collection["id"]]
    assert frozen["source_ids"] == [first_source]
    snapshot = api.get(f"/api/v1/runs/{run.json()['id']}/snapshot").json()["snapshot"]
    assert snapshot["knowledge_snapshot"]["source_version_ids"] == [
        first["source_version"]["id"]
    ]
    assert snapshot["knowledge_snapshot"]["collection_revisions"] == [
        {
            "collection_id": collection["id"],
            "space_id": space["id"],
            "revision": collection["revision"],
        }
    ]

    updated = api.patch(
        f"/api/v1/collections/{collection['id']}",
        json={
            "source_ids": [first_source, second_source],
            "expected_revision": collection["revision"],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["source_count"] == 2
    assert api.get(f"/api/v1/runs/{run.json()['id']}").json()["scope"] == frozen
    stale = api.patch(
        f"/api/v1/collections/{collection['id']}",
        json={"description": "stale write", "expected_revision": collection["revision"]},
    )
    assert stale.status_code == 409

    dynamic = api.post(
        f"/api/v1/spaces/{space['id']}/collections",
        json={
            "name": "All text",
            "view_kind": "dynamic",
            "rules": [{"field": "modality", "operator": "equals", "value": "text"}],
        },
    )
    assert dynamic.status_code == 201, dynamic.text
    assert dynamic.json()["source_count"] == 2
    archived = api.delete(f"/api/v1/collections/{collection['id']}")
    assert archived.status_code == 202
    assert api.get(f"/api/v1/collections/{collection['id']}").status_code == 404
    assert api.delete(f"/api/v1/spaces/{space['id']}").status_code == 202
    frozen_search = api.post(
        f"/api/v1/runs/{run.json()['id']}/tools/knowledge_search/execute",
        json={"payload": {"query": "Atlas 42 seats"}},
    )
    assert frozen_search.status_code == 200, frozen_search.text
    assert frozen_search.json()["output_payload"]["hits"]


def test_failed_ingestion_retry_and_completed_source_reprocess(
    api: TestClient, nexus: NexusContainer
) -> None:
    space = _space(api)
    failed = nexus.ingestion.ingest_bytes(
        space_id=str(space["id"]),
        filename="retry.md",
        content=b"# Retry\n\nThe retained raw object can be parsed again.",
        mime_type="text/markdown",
        process_inline=False,
    )
    lease = nexus.control_plane.acquire_ingestion(
        failed.job.id, worker_id="failure-injector", lease_seconds=30
    )
    nexus.control_plane.fail_ingestion(
        failed.job.id,
        code="TEST_FAILURE",
        message="Injected parser outage",
        lease=lease,
    )
    retried = api.post(f"/api/v1/ingestion-jobs/{failed.job.id}/retry")
    assert retried.status_code == 202, retried.text
    assert retried.json()["status"] == "completed"
    detail = api.get(f"/api/v1/ingestion-jobs/{failed.job.id}").json()
    assert detail["attempt_count"] == 2
    event_types = [item["event_type"] for item in detail["events"]]
    assert "ingestion.failed" in event_types
    assert "ingestion.retry.requested" in event_types
    assert event_types[-1] == "ingestion.evidence.published"
    event_page = api.get(
        f"/api/v1/ingestion-jobs/{failed.job.id}/events?stream=false&after=0"
    )
    assert event_page.status_code == 200, event_page.text
    assert [item["sequence"] for item in event_page.json()["items"]] == list(
        range(1, len(event_types) + 1)
    )
    cursor_conflict = api.get(
        f"/api/v1/ingestion-jobs/{failed.job.id}/events?stream=false&after=1",
        headers={"Last-Event-ID": "2"},
    )
    assert cursor_conflict.status_code == 409

    reprocessed = api.post(f"/api/v1/sources/{detail['source_id']}/reprocess")
    assert reprocessed.status_code == 202, reprocessed.text
    assert reprocessed.json()["status"] == "completed"
    reprocess_detail = api.get(
        f"/api/v1/ingestion-jobs/{reprocessed.json()['id']}"
    ).json()
    assert reprocess_detail["events"][0]["event_type"] == "ingestion.reprocess.requested"
    evidence = api.get(
        f"/api/v1/evidence?source_id={detail['source_id']}&limit=100"
    ).json()["items"]
    assert len(evidence) == 1

    pending = nexus.ingestion.ingest_bytes(
        space_id=str(space["id"]),
        filename="cancel.md",
        content=b"# Cancel\n\nThis pending job will be cancelled.",
        mime_type="text/markdown",
        process_inline=False,
    )
    cancelled = api.post(f"/api/v1/ingestion-jobs/{pending.job.id}/cancel")
    assert cancelled.status_code == 202, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["events"][-1]["event_type"] == "ingestion.cancelled"
