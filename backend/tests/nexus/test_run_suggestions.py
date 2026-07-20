from __future__ import annotations

from fastapi.testclient import TestClient


def _space(api: TestClient, name: str) -> dict[str, object]:
    response = api.post("/api/v1/spaces", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _upload(
    api: TestClient,
    space_id: str,
    name: str,
    content: str,
    *,
    source_id: str | None = None,
) -> dict[str, object]:
    data = {"space_id": space_id}
    if source_id:
        data["source_id"] = source_id
    response = api.post(
        "/api/v1/sources/upload",
        data=data,
        files={"file": (name, content.encode(), "text/markdown")},
    )
    assert response.status_code == 202, response.text
    assert response.json()["job"]["status"] == "completed"
    return response.json()


def test_run_suggestions_are_explainable_and_frozen_to_the_ledger(
    api: TestClient,
) -> None:
    space = _space(api, "Atlas decision room")
    uploads = []
    for index, topic in enumerate(
        ("Capacity", "Schedule", "Safety", "Budget", "Governance"),
        start=1,
    ):
        uploads.append(
            _upload(
                api,
                str(space["id"]),
                f"atlas-{index}.md",
                (
                    f"# Atlas {topic}\n\n"
                    f"Project Atlas pilot {topic.casefold()} evidence supports the launch "
                    f"decision with checkpoint {index}."
                ),
            )
        )

    created = api.post(
        "/api/v1/runs",
        json={
            "goal": "What evidence supports the Project Atlas pilot launch decision?",
            "kind": "quick",
            "scope": {"space_ids": [space["id"]]},
        },
    )
    assert created.status_code == 202, created.text
    run = created.json()
    assert run["status"] == "completed"

    response = api.get(f"/api/v1/runs/{run['id']}/suggested-questions")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["outcome"] == "available"
    assert payload["generated_from"] == "frozen_evidence_ledger"
    assert payload["scope"]["space_ids"] == [space["id"]]
    assert payload["scope"]["publish_watermark"] == run["scope"]["publish_watermark"]
    assert payload["ledger_evidence_count"] >= 4
    assert len(payload["items"]) == 3
    assert all(item["evidence_revision_ids"] for item in payload["items"])
    assert all(item["source_names"] for item in payload["items"])
    assert {
        "cross_source_comparison",
        "cited_evidence_deep_dive",
    } <= {item["reason"] for item in payload["items"]}

    before = payload["items"]
    updated_source_id = uploads[0]["source_version"]["source_id"]
    _upload(
        api,
        str(space["id"]),
        "atlas-1.md",
        "# Replacement topic\n\nThis newer revision must not rewrite an old Run suggestion.",
        source_id=str(updated_source_id),
    )
    after = api.get(f"/api/v1/runs/{run['id']}/suggested-questions")
    assert after.status_code == 200, after.text
    assert after.json()["items"] == before


def test_run_without_retrieved_evidence_has_no_synthetic_question(api: TestClient) -> None:
    space = _space(api, "Empty suggestion scope")
    created = api.post(
        "/api/v1/runs",
        json={
            "goal": "What should I ask next?",
            "kind": "quick",
            "scope": {"space_ids": [space["id"]]},
        },
    )
    assert created.status_code == 202, created.text

    response = api.get(
        f"/api/v1/runs/{created.json()['id']}/suggested-questions"
    )
    assert response.status_code == 200, response.text
    assert response.json()["outcome"] == "no_evidence_ledger"
    assert response.json()["items"] == []
