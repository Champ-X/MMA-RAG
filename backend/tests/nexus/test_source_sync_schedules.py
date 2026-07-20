from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from nexus.bootstrap import NexusContainer


def _folder_source(api: TestClient, root: Path) -> tuple[dict[str, object], dict[str, object]]:
    space = api.post("/api/v1/spaces", json={"name": "Scheduled sources"}).json()
    root.mkdir()
    (root / "guide.md").write_text("# Guide\n\nVersion one.", encoding="utf-8")
    response = api.post(
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
    assert response.status_code == 202, response.text
    return space, response.json()["items"][0]["source_version"]


def test_schedule_configuration_is_revision_safe_and_visible_on_source(
    api: TestClient, tmp_path: Path
) -> None:
    space, source = _folder_source(api, tmp_path / "scheduled-folder")
    endpoint = f"/api/v1/spaces/{space['id']}/sources/{source['source_id']}"

    assert api.get(f"{endpoint}/sync-schedule").json() == {"schedule": None}
    created = api.put(
        f"{endpoint}/sync-schedule",
        json={"interval_minutes": 360, "enabled": True},
    )
    assert created.status_code == 200, created.text
    schedule = created.json()
    assert schedule["revision"] == 1
    assert schedule["enabled"] is True
    assert schedule["last_status"] == "never"

    stale = api.put(
        f"{endpoint}/sync-schedule",
        json={"interval_minutes": 1440, "enabled": True},
    )
    assert stale.status_code == 409
    disabled = api.put(
        f"{endpoint}/sync-schedule",
        json={
            "interval_minutes": 1440,
            "enabled": False,
            "expected_revision": schedule["revision"],
        },
    ).json()
    assert disabled["revision"] == 2
    assert disabled["last_status"] == "disabled"

    listed = api.get(f"/api/v1/spaces/{space['id']}/sources").json()["items"][0]
    assert listed["sync"]["schedules"][0]["id"] == schedule["id"]
    assert listed["sync"]["schedules"][0]["enabled"] is False


def test_manual_and_scheduled_checks_record_change_history(
    api: TestClient,
    nexus: NexusContainer,
    tmp_path: Path,
) -> None:
    root = tmp_path / "changing-folder"
    space, source = _folder_source(api, root)
    endpoint = f"/api/v1/spaces/{space['id']}/sources/{source['source_id']}"
    schedule = api.put(
        f"{endpoint}/sync-schedule",
        json={"interval_minutes": 60, "enabled": True},
    ).json()

    unchanged = api.post(f"{endpoint}/sync")
    assert unchanged.status_code == 202, unchanged.text
    assert unchanged.json()["execution"]["status"] == "no_change"
    assert unchanged.json()["execution"]["new_version_count"] == 0

    (root / "guide.md").write_text("# Guide\n\nVersion two changed.", encoding="utf-8")
    changed = api.post(f"{endpoint}/sync").json()
    assert changed["execution"]["status"] == "changed"
    assert changed["execution"]["new_version_count"] == 1
    assert changed["execution"]["source_version_ids"] == [
        changed["items"][0]["source_version"]["id"]
    ]

    history = api.get(f"{endpoint}/sync-executions").json()["items"]
    assert [item["status"] for item in history[:2]] == ["changed", "no_change"]
    assert all(item["trigger"] == "manual" for item in history[:2])

    due_at = nexus.source_syncs.get(
        space_id=str(space["id"]), source_id=str(source["source_id"])
    ).next_run_at
    claimed = nexus.source_syncs.claim_due(now=due_at + timedelta(seconds=1))
    assert [item.id for item in claimed] == [schedule["id"]]
    (root / "guide.md").write_text("# Guide\n\nVersion three scheduled.", encoding="utf-8")
    scheduled = nexus.source_syncs.run_schedule(
        schedule["id"], now=due_at + timedelta(seconds=1)
    )
    assert scheduled is not None
    assert scheduled.execution.trigger == "scheduled"
    assert scheduled.execution.status == "changed"
    assert nexus.source_syncs.run_schedule(
        schedule["id"], now=due_at + timedelta(seconds=1)
    ) is None

    current = nexus.source_syncs.get(
        space_id=str(space["id"]), source_id=str(source["source_id"])
    )
    assert current.last_status == "changed"
    assert current.next_run_at > due_at


def test_snapshot_cannot_be_scheduled(api: TestClient) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Snapshots"}).json()
    source = api.post(
        "/api/v1/connectors/sync",
        json={
            "kind": "markdown",
            "space_id": space["id"],
            "title": "Static note",
            "content": "# Static\n\nNo upstream contract.",
        },
    ).json()["items"][0]["source_version"]
    response = api.put(
        f"/api/v1/spaces/{space['id']}/sources/{source['source_id']}/sync-schedule",
        json={"interval_minutes": 60, "enabled": True},
    )
    assert response.status_code == 409
