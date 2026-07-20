from __future__ import annotations

from fastapi.testclient import TestClient


def _space(api: TestClient, name: str = "Launch Evidence") -> dict[str, object]:
    response = api.post("/api/v1/spaces", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _upload(api: TestClient, space_id: str, filename: str, text: str) -> dict[str, object]:
    response = api.post(
        "/api/v1/sources/upload",
        data={"space_id": space_id},
        files={"file": (filename, text.encode(), "text/markdown")},
    )
    assert response.status_code == 202, response.text
    payload = response.json()
    assert payload["job"]["status"] == "completed"
    return payload


def test_space_ingestion_search_quick_sse_and_range(api: TestClient) -> None:
    space = _space(api)
    upload = _upload(
        api,
        str(space["id"]),
        "launch.md",
        "# Launch\n\nProject Atlas launches on 2026-09-14 with a 42 seat pilot.",
    )
    _upload(
        api,
        str(space["id"]),
        "launch-confirmation.md",
        "# Confirmation\n\nThe Atlas pilot size is 42 according to the launch approval.",
    )

    search = api.post(
        "/api/v1/search",
        json={
            "query": "Project Atlas 42 seat pilot",
            "scope": {"space_ids": [space["id"]]},
            "quality_mode": "quality",
        },
    )
    assert search.status_code == 200, search.text
    pack = search.json()
    assert pack["hits"]
    assert pack["hits"][0]["channels"] == ["exact"]
    assert pack["degraded"] is True
    assert pack["explanation"]["outcome"] == "evidence_found_degraded"
    assert pack["explanation"]["scope_evidence_count"] >= 2
    assert {item["channel"] for item in pack["channels"] if item["status"] == "unavailable"} == {
        "text_dense",
        "text_sparse",
        "image",
        "image_caption",
        "audio",
        "audio_text",
        "video",
        "video_text",
    }

    created = api.post(
        "/api/v1/runs",
        headers={"Idempotency-Key": "quick-atlas-v1"},
        json={
            "goal": "What is the Atlas pilot size?",
            "kind": "quick",
            "scope": {"space_ids": [space["id"]]},
        },
    )
    assert created.status_code == 202, created.text
    run = created.json()
    assert run["quality_mode"] == "quality"
    assert run["status"] == "completed"
    assert run["result"]["verification_status"] == "supported"
    assert run["result"]["verification_level"] == "T3"
    assert run["result"]["verification"]["cross_source"] is True
    assert run["result"]["citations"]
    assert run["result"]["quality"]["explanation"]["outcome"] == (
        "evidence_found_degraded"
    )
    snapshot = api.get(f"/api/v1/runs/{run['id']}/snapshot")
    assert snapshot.status_code == 200
    assert snapshot.json()["snapshot"]["models"]["gateway"]["pinned_setup_gateway"]["gateway"] == (
        "extractive-local-v1"
    )
    assert snapshot.json()["snapshot"]["models"]["catalog"]["routes"] == []

    replay = api.post(
        "/api/v1/runs",
        headers={"Idempotency-Key": "quick-atlas-v1"},
        json={
            "goal": "What is the Atlas pilot size?",
            "kind": "quick",
            "scope": {"space_ids": [space["id"]]},
        },
    )
    assert replay.json()["id"] == run["id"]

    tool = api.post(
        f"/api/v1/runs/{run['id']}/tools/knowledge_search/execute",
        json={
            "idempotency_key": "quick-atlas-search-tool-v1",
            "payload": {"query": "Atlas pilot size", "limit": 5},
        },
    )
    assert tool.status_code == 200, tool.text
    assert tool.json()["status"] == "completed"
    assert tool.json()["output_payload"]["hits"]
    sql = api.post(
        f"/api/v1/runs/{run['id']}/tools/sql_read/execute",
        json={
            "payload": {
                "query": "SELECT sum(value) AS total FROM input",
                "rows": [{"value": 40}, {"value": 2}],
            }
        },
    )
    assert sql.status_code == 200, sql.text
    assert sql.json()["output_payload"]["rows"] == [[42]]
    forbidden_sql = api.post(
        f"/api/v1/runs/{run['id']}/tools/sql_read/execute",
        json={"payload": {"query": "DROP TABLE input", "rows": [{"value": 1}]}},
    )
    assert forbidden_sql.status_code == 422

    events = api.get(f"/api/v1/runs/{run['id']}/events?stream=false").json()["items"]
    sequences = [event["sequence"] for event in events]
    assert sequences == sorted(set(sequences))
    after_first = api.get(
        f"/api/v1/runs/{run['id']}/events?stream=false&after={sequences[0]}"
    ).json()["items"]
    assert all(event["sequence"] > sequences[0] for event in after_first)
    conflict = api.get(
        f"/api/v1/runs/{run['id']}/events?stream=false&after=1",
        headers={"Last-Event-ID": "2"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "CURSOR_CONFLICT"

    version_id = upload["source_version"]["id"]
    partial = api.get(f"/api/v1/assets/{version_id}", headers={"Range": "bytes=0-7"})
    assert partial.status_code == 206
    assert partial.headers["content-range"].startswith("bytes 0-7/")
    assert partial.content == b"# Launch"

    source_id = upload["source_version"]["source_id"]
    deleted = api.delete(f"/api/v1/sources/{source_id}")
    assert deleted.status_code == 202, deleted.text
    assert deleted.json()["status"] == "tombstoned"
    assert api.delete(f"/api/v1/sources/{source_id}").status_code == 202
    after_delete = api.post(
        "/api/v1/search",
        json={
            "query": "2026-09-14",
            "scope": {"source_ids": [source_id]},
            "quality_mode": "quality",
        },
    )
    assert after_delete.status_code == 200
    assert after_delete.json()["hits"] == []
    assert after_delete.json()["explanation"]["outcome"] == "scope_empty"


def test_space_archive_closes_scope_but_preserves_global_source(api: TestClient) -> None:
    space = _space(api, "Archive Contract")
    upload = _upload(
        api,
        str(space["id"]),
        "durable.md",
        "# Durable source\n\nThe original remains addressable after its Space is archived.",
    )
    archived = api.delete(f"/api/v1/spaces/{space['id']}")
    assert archived.status_code == 202, archived.text
    assert archived.json()["archived"] is True
    assert archived.json()["source_count"] == 0
    assert all(
        item["id"] != space["id"] for item in api.get("/api/v1/spaces").json()["items"]
    )
    assert api.get(f"/api/v1/spaces/{space['id']}").status_code == 404
    source_version_id = upload["source_version"]["id"]
    assert api.get(f"/api/v1/source-versions/{source_version_id}").status_code == 200
    assert api.delete(f"/api/v1/spaces/{space['id']}").status_code == 202


def test_deep_research_creates_verified_artifact_and_exports(api: TestClient) -> None:
    space = _space(api, "Research Sources")
    budget_upload = _upload(
        api,
        str(space["id"]),
        "strategy.md",
        "# Strategy\n\nProject Aurora targets enterprise teams with an October 2026 launch.",
    )
    _upload(
        api,
        str(space["id"]),
        "budget.md",
        "# Budget\n\nProject Aurora has a 250000 USD launch budget for October 2026.",
    )
    response = api.post(
        "/api/v1/runs",
        json={
            "goal": "Research Project Aurora launch assumptions and budget",
            "kind": "research",
            "scope": {"space_ids": [space["id"]]},
        },
    )
    assert response.status_code == 202, response.text
    run = response.json()
    assert run["quality_mode"] == "deep"
    assert run["status"] == "completed"
    assert run["result"]["verification_level"] == "T3"
    assert run["result"]["verification_status"] == "supported"
    artifact_id = run["result"]["artifact_id"]

    canonical = api.get(f"/api/v1/artifacts/{artifact_id}/render?format=json")
    assert canonical.status_code == 200
    assert canonical.json()["schema"] == "nexus.block-document.v1"
    assert api.get(f"/api/v1/artifacts/{artifact_id}/render?format=markdown").text.startswith(
        "# Research Project Aurora"
    )
    assert "<!doctype html>" in api.get(f"/api/v1/artifacts/{artifact_id}/render?format=html").text
    pdf = api.get(f"/api/v1/artifacts/{artifact_id}/render?format=pdf")
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF")

    document = canonical.json()
    document["blocks"].append(
        {"type": "paragraph", "text": "User-reviewed conclusion.", "origin": "user"}
    )
    revised = api.patch(
        f"/api/v1/artifacts/{artifact_id}",
        json={"expected_revision_no": 1, "canonical_document": document},
    )
    assert revised.status_code == 200, revised.text
    assert revised.json()["revision_no"] == 2
    assert (
        revised.json()["evidence_revision_ids"]
        == canonical.json()["blocks"][1]["evidence_revision_ids"]
    )
    stale = api.patch(
        f"/api/v1/artifacts/{artifact_id}",
        json={"expected_revision_no": 1, "canonical_document": document},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "CONFLICT"

    budget_source_id = budget_upload["source_version"]["source_id"]
    updated_source = api.post(
        "/api/v1/sources/upload",
        data={"space_id": space["id"], "source_id": budget_source_id},
        files={
            "file": (
                "budget.md",
                b"# Budget\n\nProject Aurora has a 275000 USD revised launch budget.",
                "text/markdown",
            )
        },
    )
    assert updated_source.status_code == 202, updated_source.text
    assert updated_source.json()["source_version"]["version_no"] == 2
    update_proposal = api.get(
        f"/api/v1/artifacts/{artifact_id}/refresh-proposals"
    ).json()["items"][0]
    assert update_proposal["reason"] == "source_updated"
    assert update_proposal["diff"]["added_evidence_revision_ids"]
    accepted_update = api.post(
        f"/api/v1/artifact-refresh-proposals/{update_proposal['id']}/resolve",
        json={"accept": True},
    )
    assert accepted_update.status_code == 200
    after_update = api.get(f"/api/v1/artifacts/{artifact_id}").json()
    assert after_update["revision_no"] == 3
    assert "User-reviewed conclusion." in str(after_update["canonical_document"])
    assert not set(update_proposal["impacted_evidence_revision_ids"]).intersection(
        after_update["evidence_revision_ids"]
    )

    deleted = api.delete(f"/api/v1/sources/{budget_source_id}")
    assert deleted.status_code == 202
    assert api.get(f"/api/v1/artifacts/{artifact_id}").json()["status"] == "refresh_proposed"
    proposals = api.get(f"/api/v1/artifacts/{artifact_id}/refresh-proposals")
    assert proposals.status_code == 200
    proposal = proposals.json()["items"][0]
    assert proposal["status"] == "pending"
    assert proposal["reason"] == "source_tombstoned"
    assert proposal["diff"]["removed_evidence_revision_ids"]
    accepted = api.post(
        f"/api/v1/artifact-refresh-proposals/{proposal['id']}/resolve",
        json={"accept": True},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    refreshed = api.get(f"/api/v1/artifacts/{artifact_id}").json()
    assert refreshed["revision_no"] == 4
    assert refreshed["status"] == "candidate"
    assert "User-reviewed conclusion." in str(refreshed["canonical_document"])
    assert not set(proposal["impacted_evidence_revision_ids"]).intersection(
        refreshed["evidence_revision_ids"]
    )
