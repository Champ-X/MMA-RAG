from __future__ import annotations

from fastapi.testclient import TestClient

from nexus.modules.spaces.policy import policy_for
from nexus.shared.domain.enums import KnowledgeProfile, QualityMode, RunKind


def _create_space(
    api: TestClient,
    name: str,
    profile: str,
) -> dict[str, object]:
    response = api.post(
        "/api/v1/spaces",
        json={"name": name, "knowledge_profile": profile},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_policy_templates_have_real_execution_defaults() -> None:
    research = policy_for(KnowledgeProfile.RESEARCH)
    archive = policy_for(KnowledgeProfile.ARCHIVE)

    assert research.default_quality == QualityMode.DEEP
    assert research.recommended_run_kind == RunKind.RESEARCH
    assert research.auto_route_eligible is True
    assert archive.default_quality == QualityMode.FAST
    assert archive.auto_route_eligible is False
    assert "manual_scope_only" in archive.behaviors


def test_space_profile_controls_creation_and_frozen_run_defaults(api: TestClient) -> None:
    space = _create_space(api, "Long-form investigations", "research")

    assert space["default_quality"] == "deep"
    assert space["policy"] == {
        "profile": "research",
        "label": "Deep research",
        "summary": (
            "Default to planned, iterative research with stronger verification and "
            "Artifacts."
        ),
        "default_quality": "deep",
        "recommended_run_kind": "research",
        "auto_route_eligible": True,
        "behaviors": [
            "research_intent_boost",
            "deep_retrieval",
            "artifact_delivery",
        ],
    }

    response = api.post(
        "/api/v1/runs",
        json={
            "goal": "Compare the supported conclusions",
            "scope": {"space_ids": [space["id"]]},
            "execute": False,
        },
    )
    assert response.status_code == 202, response.text
    run = response.json()
    assert run["kind"] == "research"
    assert run["quality_mode"] == "deep"
    assert run["request_context"]["scope_policy"]["recommended_kind"] == "research"
    assert run["request_context"]["scope_policy"]["spaces"][0]["space_id"] == space["id"]


def test_auto_route_respects_manual_archive_and_intent_profiles(api: TestClient) -> None:
    searchable = _create_space(api, "General handbook", "searchable")
    multimodal = _create_space(api, "Visual field notes", "multimodal")
    research = _create_space(api, "Investigation desk", "research")
    archive = _create_space(api, "Historical records", "archive")

    media_response = api.post(
        "/api/v1/spaces/route",
        json={"query": "Explain the image and video evidence", "limit": 4},
    )
    assert media_response.status_code == 200, media_response.text
    media_route = media_response.json()
    assert media_route["selected_space_ids"] == [multimodal["id"]]
    assert media_route["recommended_kind"] == "quick"

    research_response = api.post(
        "/api/v1/spaces/route",
        json={"query": "Research and compare the supported claims", "limit": 4},
    )
    assert research_response.status_code == 200, research_response.text
    research_route = research_response.json()
    assert research["id"] in research_route["selected_space_ids"]
    assert research_route["recommended_kind"] == "research"
    assert research_route["recommended_quality"] == "deep"
    assert "research_intent_boost" in research_route["policy_reasons"]

    archive_candidate = next(
        candidate
        for candidate in research_route["candidates"]
        if candidate["space_id"] == archive["id"]
    )
    assert archive_candidate["auto_route_eligible"] is False
    assert archive_candidate["routing_note"] == "manual_scope_only"
    assert archive["id"] not in research_route["selected_space_ids"]
    assert searchable["id"] != multimodal["id"]


def test_route_with_only_archives_requires_explicit_scope(api: TestClient) -> None:
    archive = _create_space(api, "Cold storage", "archive")

    response = api.post(
        "/api/v1/spaces/route",
        json={"query": "Find the old agreement"},
    )
    assert response.status_code == 200, response.text
    route = response.json()
    assert route["method"] == "no_auto_route_spaces"
    assert route["selected_space_ids"] == []
    assert route["candidates"][0]["space_id"] == archive["id"]
    assert route["candidates"][0]["routing_note"] == "manual_scope_only"
