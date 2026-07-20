from __future__ import annotations

from fastapi.testclient import TestClient


def _run(
    api: TestClient,
    goal: str,
    *,
    parent_run_id: str | None = None,
) -> dict[str, object]:
    response = api.post(
        "/api/v1/runs",
        json={
            "goal": goal,
            "kind": "quick",
            "scope": {"space_ids": [], "global_search": True},
            "execute": False,
            "parent_run_id": parent_run_id,
        },
    )
    assert response.status_code == 202, response.text
    return response.json()


def test_conversation_metadata_search_archive_and_optimistic_revision(api: TestClient) -> None:
    first = _run(api, "First launch decision")
    second = _run(api, "Compare the supplier budgets", parent_run_id=str(first["id"]))

    listed = api.get("/api/v1/conversations")
    assert listed.status_code == 200, listed.text
    conversation = listed.json()["items"][0]
    assert conversation["id"] == first["conversation_id"]
    assert conversation["title"] == "First launch decision"
    assert conversation["run_count"] == 2
    assert conversation["latest_run_id"] == second["id"]
    assert conversation["latest_goal"] == "Compare the supplier budgets"
    assert conversation["revision"] == 1

    searched = api.get("/api/v1/conversations", params={"query": "supplier"})
    assert searched.status_code == 200
    assert [item["id"] for item in searched.json()["items"]] == [first["conversation_id"]]
    assert api.get("/api/v1/conversations", params={"query": "%"}).json()["items"] == []

    updated = api.patch(
        f"/api/v1/conversations/{first['conversation_id']}",
        json={
            "expected_revision": 1,
            "title": "Supplier launch decision",
            "pinned": True,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["title"] == "Supplier launch decision"
    assert updated.json()["pinned"] is True
    assert updated.json()["revision"] == 2

    stale = api.patch(
        f"/api/v1/conversations/{first['conversation_id']}",
        json={"expected_revision": 1, "title": "Stale title"},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["details"]["actual_revision"] == 2

    archived = api.patch(
        f"/api/v1/conversations/{first['conversation_id']}",
        json={"expected_revision": 2, "archived": True},
    )
    assert archived.status_code == 200
    assert archived.json()["revision"] == 3
    assert api.get("/api/v1/conversations").json()["items"] == []
    archived_list = api.get("/api/v1/conversations", params={"archived": True}).json()
    assert [item["id"] for item in archived_list["items"]] == [first["conversation_id"]]

    restored = api.patch(
        f"/api/v1/conversations/{first['conversation_id']}",
        json={"expected_revision": 3, "archived": False},
    )
    assert restored.status_code == 200
    assert restored.json()["archived"] is False

    archived_again = api.patch(
        f"/api/v1/conversations/{first['conversation_id']}",
        json={"expected_revision": 4, "archived": True},
    )
    assert archived_again.status_code == 200
    _run(api, "Continue the archived decision", parent_run_id=str(second["id"]))
    reactivated = api.get(f"/api/v1/conversations/{first['conversation_id']}")
    assert reactivated.status_code == 200
    assert reactivated.json()["archived"] is False
    assert reactivated.json()["revision"] == 6


def test_conversation_cursor_preserves_pinned_activity_order(api: TestClient) -> None:
    older = _run(api, "Pinned research")
    newer = _run(api, "Recent research")
    pinned = api.patch(
        f"/api/v1/conversations/{older['conversation_id']}",
        json={"expected_revision": 1, "pinned": True},
    )
    assert pinned.status_code == 200, pinned.text

    first_page = api.get("/api/v1/conversations", params={"limit": 1})
    assert first_page.status_code == 200
    payload = first_page.json()
    assert [item["id"] for item in payload["items"]] == [older["conversation_id"]]
    assert payload["page"]["next_cursor"]

    second_page = api.get(
        "/api/v1/conversations",
        params={"limit": 1, "cursor": payload["page"]["next_cursor"]},
    )
    assert second_page.status_code == 200, second_page.text
    assert [item["id"] for item in second_page.json()["items"]] == [
        newer["conversation_id"]
    ]
    assert second_page.json()["page"]["next_cursor"] is None
