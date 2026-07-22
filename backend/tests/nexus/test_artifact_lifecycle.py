from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import event

from nexus.bootstrap import NexusContainer
from nexus.modules.artifacts.domain import summarize_artifact_coverage


def _document(*, supported: bool = True, user_block: bool = False) -> dict[str, object]:
    blocks: list[dict[str, object]] = [
        {"type": "heading", "level": 1, "text": "Evidence report", "origin": "generated"},
        {
            "type": "paragraph",
            "text": "A supported conclusion.",
            "origin": "generated",
            "evidence_revision_ids": ["evidence-1"] if supported else [],
        },
    ]
    if user_block:
        blocks.append({"type": "paragraph", "text": "Editorial note.", "origin": "user"})
    return {"schema": "nexus.block-document.v1", "title": "Evidence report", "blocks": blocks}


def test_artifact_coverage_counts_content_support_without_treating_headings_as_claims() -> None:
    coverage = summarize_artifact_coverage(
        _document(supported=True, user_block=True), ["evidence-1", "evidence-2"]
    )
    assert coverage.content_block_count == 2
    assert coverage.supported_block_count == 1
    assert coverage.coverage_percent == 50
    assert coverage.bound_evidence_count == 1
    assert coverage.user_block_count == 1


def test_artifact_publish_is_explicit_revision_safe_and_reversible(
    api: TestClient,
    nexus: NexusContainer,
) -> None:
    artifact = nexus.runs_repository.create_artifact(
        run_id=None,
        title="Publication candidate",
        artifact_type="research_report",
        canonical_document=_document(),
        evidence_revision_ids=["evidence-1"],
    )
    fetched = api.get(f"/api/v1/artifacts/{artifact.id}")
    assert fetched.status_code == 200
    assert fetched.json()["coverage"] == {
        "content_block_count": 1,
        "supported_block_count": 1,
        "coverage_percent": 100,
        "bound_evidence_count": 1,
        "user_block_count": 0,
    }

    published = api.patch(
        f"/api/v1/artifacts/{artifact.id}/status",
        json={"expected_revision_no": 1, "status": "published"},
    )
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    assert api.patch(
        f"/api/v1/artifacts/{artifact.id}/status",
        json={"expected_revision_no": 1, "status": "published"},
    ).status_code == 200

    revised = api.patch(
        f"/api/v1/artifacts/{artifact.id}",
        json={
            "expected_revision_no": 1,
            "canonical_document": _document(user_block=True),
        },
    )
    assert revised.status_code == 200
    assert revised.json()["status"] == "candidate"
    assert revised.json()["coverage"]["coverage_percent"] == 50
    assert api.patch(
        f"/api/v1/artifacts/{artifact.id}/status",
        json={"expected_revision_no": 1, "status": "published"},
    ).status_code == 409

    republished = api.patch(
        f"/api/v1/artifacts/{artifact.id}/status",
        json={"expected_revision_no": 2, "status": "published"},
    )
    assert republished.status_code == 200
    returned = api.patch(
        f"/api/v1/artifacts/{artifact.id}/status",
        json={"expected_revision_no": 2, "status": "candidate"},
    )
    assert returned.status_code == 200
    assert returned.json()["status"] == "candidate"


def test_artifact_without_supported_evidence_cannot_be_published(
    api: TestClient,
    nexus: NexusContainer,
) -> None:
    artifact = nexus.runs_repository.create_artifact(
        run_id=None,
        title="Unsupported draft",
        artifact_type="research_report",
        canonical_document=_document(supported=False),
        evidence_revision_ids=[],
    )
    response = api.patch(
        f"/api/v1/artifacts/{artifact.id}/status",
        json={"expected_revision_no": 1, "status": "published"},
    )
    assert response.status_code == 409
    assert "evidence-supported" in response.json()["error"]["message"]


def test_artifact_render_response_names_the_delivery_revision(
    api: TestClient,
    nexus: NexusContainer,
) -> None:
    artifact = nexus.runs_repository.create_artifact(
        run_id=None,
        title="Board Packet: Q3/Alpha?",
        artifact_type="research_report",
        canonical_document=_document(),
        evidence_revision_ids=["evidence-1"],
    )
    pdf = api.get(f"/api/v1/artifacts/{artifact.id}/render?format=pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-disposition"] == (
        "attachment; filename="
        f"\"board-packet-q3-alpha-candidate-v1-{artifact.revision_id[:8]}.pdf\""
    )
    assert pdf.headers["x-nexus-artifact-id"] == artifact.id
    assert pdf.headers["x-nexus-artifact-revision"] == artifact.revision_id
    assert pdf.headers["x-nexus-artifact-revision-no"] == "1"
    assert pdf.headers["x-nexus-artifact-status"] == "candidate"
    assert pdf.headers["x-nexus-artifact-coverage"] == "100"
    assert pdf.headers["x-nexus-artifact-evidence-count"] == "1"
    assert pdf.headers["x-nexus-artifact-render-format"] == "pdf"

    html = api.get(f"/api/v1/artifacts/{artifact.id}/render?format=html")
    assert html.status_code == 200
    assert html.headers["content-disposition"].startswith("inline; filename=")
    assert html.headers["content-disposition"].endswith(f"{artifact.revision_id[:8]}.html\"")


def test_artifact_template_derives_layout_without_rebinding_evidence(
    api: TestClient,
    nexus: NexusContainer,
) -> None:
    source = nexus.runs_repository.create_artifact(
        run_id=None,
        title="Source report",
        artifact_type="research_report",
        canonical_document=_document(),
        evidence_revision_ids=["evidence-1"],
    )
    catalog = api.get("/api/v1/artifact-templates")
    assert catalog.status_code == 200
    assert [item["id"] for item in catalog.json()["items"]] == [
        "evidence_brief",
        "decision_memo",
        "review_packet",
    ]

    response = api.post(
        "/api/v1/artifacts/from-template",
        json={
            "source_artifact_id": source.id,
            "template_id": "decision_memo",
            "title": "Launch decision",
            "review_text": "Proceed with the launch. Owner: Regional GM.",
        },
    )
    assert response.status_code == 201, response.text
    derived = response.json()
    assert derived["id"] != source.id
    assert derived["artifact_type"] == "decision_memo"
    assert derived["status"] == "candidate"
    assert derived["evidence_revision_ids"] == ["evidence-1"]
    assert derived["canonical_document"]["template"] == {
        "id": "decision_memo",
        "version": 1,
        "source_artifact_id": source.id,
    }
    assert derived["coverage"]["supported_block_count"] == 1
    assert derived["coverage"]["user_block_count"] == 1
    assert any(
        block.get("text") == "Proceed with the launch. Owner: Regional GM."
        and block.get("origin") == "user"
        for block in derived["canonical_document"]["blocks"]
    )
    recursive = api.post(
        "/api/v1/artifacts/from-template",
        json={
            "source_artifact_id": derived["id"],
            "template_id": "evidence_brief",
            "title": "Second-generation layout",
        },
    )
    assert recursive.status_code == 409
    assert "original source Artifact" in recursive.json()["error"]["message"]


def test_artifact_template_rejects_an_unsupported_source(
    api: TestClient,
    nexus: NexusContainer,
) -> None:
    source = nexus.runs_repository.create_artifact(
        run_id=None,
        title="Unsupported draft",
        artifact_type="research_report",
        canonical_document=_document(supported=False),
        evidence_revision_ids=[],
    )
    response = api.post(
        "/api/v1/artifacts/from-template",
        json={
            "source_artifact_id": source.id,
            "template_id": "evidence_brief",
            "title": "Derived brief",
        },
    )
    assert response.status_code == 409
    assert "evidence-supported" in response.json()["error"]["message"]


def test_artifact_studio_list_uses_bounded_batch_queries(
    api: TestClient,
    nexus: NexusContainer,
) -> None:
    for index in range(6):
        nexus.runs_repository.create_artifact(
            run_id=None,
            title=f"Report {index}",
            artifact_type="research_report",
            canonical_document=_document(),
            evidence_revision_ids=["evidence-1"],
        )

    statements: list[str] = []

    def record_statement(*args: object) -> None:
        statements.append(str(args[2]))

    event.listen(nexus.database.engine, "before_cursor_execute", record_statement)
    try:
        response = api.get("/api/v1/artifacts")
    finally:
        event.remove(nexus.database.engine, "before_cursor_execute", record_statement)

    assert response.status_code == 200
    assert len(response.json()["items"]) == 6
    assert len(statements) <= 5
