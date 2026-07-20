from __future__ import annotations

from fastapi.testclient import TestClient


def _upload(api: TestClient, space_id: str, filename: str, text: str) -> None:
    response = api.post(
        "/api/v1/sources/upload",
        data={"space_id": space_id},
        files={"file": (filename, text.encode(), "text/markdown")},
    )
    assert response.status_code == 202, response.text
    assert response.json()["job"]["status"] == "completed"


def test_evidence_catalog_searches_content_and_source_name_across_the_full_scope(
    api: TestClient,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Search workspace"}).json()
    _upload(
        api,
        space["id"],
        "regional-forecast.md",
        "# Outlook\n\nProject Cobalt reaches break-even in the eastern region.",
    )
    _upload(
        api,
        space["id"],
        "unrelated.md",
        "# Other\n\nA separate operational note.",
    )

    by_content = api.get("/api/v1/evidence", params={"query": "Cobalt", "limit": 10})
    assert by_content.status_code == 200, by_content.text
    assert len(by_content.json()["items"]) == 1
    assert "break-even" in by_content.json()["items"][0]["text_content"]

    by_source = api.get(
        "/api/v1/evidence", params={"query": "regional-forecast", "limit": 10}
    )
    assert by_source.status_code == 200
    assert len(by_source.json()["items"]) == 1

    escaped = api.get("/api/v1/evidence", params={"query": "%", "limit": 10})
    assert escaped.status_code == 200
    assert escaped.json()["items"] == []
