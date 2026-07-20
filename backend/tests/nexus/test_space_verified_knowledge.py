from __future__ import annotations

from fastapi.testclient import TestClient

from nexus.bootstrap import NexusContainer


def _upload(api: TestClient, space_id: str, filename: str, text: str) -> None:
    response = api.post(
        "/api/v1/sources/upload",
        data={"space_id": space_id},
        files={"file": (filename, text.encode(), "text/markdown")},
    )
    assert response.status_code == 202, response.text


def test_space_knowledge_only_compiles_t2_t3_claims_and_surfaces_attention(
    api: TestClient,
    nexus: NexusContainer,
) -> None:
    space = api.post("/api/v1/spaces", json={"name": "Verified knowledge"}).json()
    _upload(
        api,
        space["id"],
        "approval.md",
        "# Approval\n\nProject Atlas launches on 2026-09-14 with 42 pilot seats.",
    )
    _upload(
        api,
        space["id"],
        "confirmation.md",
        "# Confirmation\n\nThe approved Atlas pilot has 42 seats and starts 2026-09-14.",
    )
    run_response = api.post(
        "/api/v1/runs",
        headers={"Idempotency-Key": "verified-knowledge-run"},
        json={
            "goal": "When does Atlas launch and how many pilot seats are approved?",
            "kind": "quick",
            "scope": {"space_ids": [space["id"]]},
        },
    )
    assert run_response.status_code == 202, run_response.text
    run = run_response.json()
    assert run["result"]["verification_status"] == "supported"
    evidence_id = run["result"]["citations"][0]["evidence_revision_id"]
    nexus.runs_repository.create_claim(
        run_id=run["id"],
        text="A low-assurance observation must not enter the verified view.",
        claim_type="observation",
        verification_level="T1",
        status="supported",
        explanation="T1 is below the compilation threshold.",
        evidence_links=[{"evidence_revision_id": evidence_id, "relation": "supports"}],
    )
    conflicted = nexus.runs_repository.create_claim(
        run_id=run["id"],
        text="The launch owner remains disputed.",
        claim_type="fact",
        verification_level="T2",
        status="conflicted",
        explanation="Two sources identify different owners.",
        evidence_links=[{"evidence_revision_id": evidence_id, "relation": "conflicts"}],
    )

    response = api.get(f"/api/v1/spaces/{space['id']}/knowledge")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert {item["status"] for item in items} == {"supported", "conflicted"}
    assert all(item["verification_level"] in {"T2", "T3"} for item in items)
    assert all(item["evidence"] for item in items)
    assert all(item["evidence"][0]["locator_type"] for item in items)

    attention = api.get(
        f"/api/v1/spaces/{space['id']}/knowledge", params={"status": "attention"}
    )
    assert attention.status_code == 200
    assert [item["id"] for item in attention.json()["items"]] == [conflicted.id]
