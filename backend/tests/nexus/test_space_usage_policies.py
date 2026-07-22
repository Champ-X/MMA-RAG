from __future__ import annotations

import pytest
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


def _upload(api: TestClient, space_id: str, filename: str, text: str) -> None:
    response = api.post(
        "/api/v1/sources/upload",
        data={"space_id": space_id},
        files={"file": (filename, text.encode(), "text/markdown")},
    )
    assert response.status_code == 202, response.text
    assert response.json()["job"]["status"] == "completed"


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


def test_auto_route_bridges_chinese_visual_pet_query_to_english_caption_space(
    api: TestClient,
) -> None:
    dog_gallery = _create_space(api, "Dog gallery", "searchable")
    landscapes = _create_space(api, "Landscape photos", "searchable")
    papers = _create_space(api, "Research papers", "research")
    recipes = _create_space(api, "Recipe notebook", "searchable")

    _upload(
        api,
        str(dog_gallery["id"]),
        "cute-dog.md",
        (
            "# Cute dog photo\n\n"
            "Image Cute-Dog-pet.jpg. Visual description: a small fluffy white dog, "
            "an adorable cute puppy sitting on green grass."
        ),
    )
    _upload(
        api,
        str(landscapes["id"]),
        "mountain.md",
        "# Mountain lake\n\nA blue lake, mountain ridge, forest and dramatic sky.",
    )
    _upload(
        api,
        str(papers["id"]),
        "retrieval.md",
        "# Retrieval paper\n\nAgentic retrieval, reranking, citations and reasoning.",
    )
    _upload(
        api,
        str(recipes["id"]),
        "snacks.md",
        "# Snack ideas\n\nA kitchen note about biscuits, tea, and weekend groceries.",
    )

    response = api.post(
        "/api/v1/spaces/route",
        json={"query": "找一下可爱小白狗", "limit": 3},
    )
    assert response.status_code == 200, response.text
    route = response.json()

    assert route["selected_space_ids"][0] == dog_gallery["id"]
    assert len(route["candidates"]) == 3
    assert "dominant gap" in route["selection_reason"]
    assert route["candidates"][0]["space_id"] == dog_gallery["id"]
    assert route["candidates"][0]["selected_for_search"] is True
    assert route["candidates"][1]["selected_for_search"] is False
    assert route["candidates"][0]["score"] > route["candidates"][1]["score"]
    assert route["candidates"][0]["score_components"]["lexical"] > 0
    assert route["candidates"][0]["score_contributions"]["lexical"] > 0
    assert sum(route["candidates"][0]["score_contributions"].values()) == pytest.approx(
        route["candidates"][0]["score"],
        abs=0.00001,
    )
    assert {"dog", "puppy", "white"} & set(route["candidates"][0]["matched_terms"])
    assert "白色" not in route["candidates"][0]["profile"]

    landscape_response = api.post(
        "/api/v1/spaces/route",
        json={"query": "找一下山水风景照片", "limit": 3},
    )
    assert landscape_response.status_code == 200, landscape_response.text
    landscape_route = landscape_response.json()
    assert landscape_route["selected_space_ids"][0] == landscapes["id"]
    assert landscape_route["candidates"][0]["space_id"] == landscapes["id"]
    assert {"landscape", "mountain", "lake"} & set(
        landscape_route["candidates"][0]["matched_terms"],
    )

    research_response = api.post(
        "/api/v1/spaces/route",
        json={"query": "研究 agentic retrieval reranking citations", "limit": 3},
    )
    assert research_response.status_code == 200, research_response.text
    research_route = research_response.json()
    assert research_route["selected_space_ids"][0] == papers["id"]
    assert research_route["candidates"][0]["space_id"] == papers["id"]
    assert research_route["recommended_kind"] == "research"
    assert research_route["recommended_quality"] == "deep"


def test_auto_route_run_creation_overrides_stale_scope_with_current_router(
    api: TestClient,
) -> None:
    dog_gallery = _create_space(api, "Dog gallery", "searchable")
    stale_scope = _create_space(api, "Old low confidence scope", "searchable")

    _upload(
        api,
        str(dog_gallery["id"]),
        "cute-dog.md",
        (
            "# Cute dog photo\n\n"
            "Image Cute-Dog-pet.jpg. Visual description: a small fluffy white dog, "
            "an adorable cute puppy sitting on green grass."
        ),
    )
    _upload(
        api,
        str(stale_scope["id"]),
        "stale.md",
        "# Stale route\n\nA project note about old PDF pages and unrelated cats.",
    )

    response = api.post(
        "/api/v1/runs",
        json={
            "goal": "找一下可爱小白狗",
            "scope": {"space_ids": [stale_scope["id"]]},
            "auto_route": True,
            "execute": False,
        },
    )
    assert response.status_code == 202, response.text
    run = response.json()

    assert run["scope"]["space_ids"] == [dog_gallery["id"]]
    assert run["scope"]["global_search"] is False
    assert run["request_context"]["routing_trace"]["selected_space_ids"] == [
        dog_gallery["id"],
    ]
    assert run["request_context"]["routing_trace"]["candidates"][0]["space_id"] == dog_gallery["id"]
    assert run["request_context"]["scope_policy"]["spaces"][0]["space_id"] == dog_gallery["id"]


def test_low_confidence_auto_route_limits_selected_scope_and_candidates(
    api: TestClient,
) -> None:
    spaces = [
        _create_space(api, "Untrained workspace A", "searchable"),
        _create_space(api, "Untrained workspace B", "searchable"),
        _create_space(api, "Untrained workspace C", "searchable"),
        _create_space(api, "Untrained workspace D", "searchable"),
    ]

    response = api.post(
        "/api/v1/spaces/route",
        json={"query": "completely unrelated cold-start request", "limit": 2},
    )
    assert response.status_code == 200, response.text
    route = response.json()

    assert route["method"] == "all_low_safe_broadening"
    assert "capped at 2" in route["selection_reason"]
    assert len(route["selected_space_ids"]) == 2
    assert len(route["candidates"]) == 2
    assert route["selected_space_ids"] == [
        candidate["space_id"] for candidate in route["candidates"]
    ]
    assert set(route["selected_space_ids"]).issubset({space["id"] for space in spaces})


def test_multi_space_route_keeps_selection_to_top_two_while_showing_candidates(
    api: TestClient,
) -> None:
    spaces = [
        _create_space(api, "Alpha workspace A", "searchable"),
        _create_space(api, "Alpha workspace B", "searchable"),
        _create_space(api, "Alpha workspace C", "searchable"),
    ]
    for index, space in enumerate(spaces, start=1):
        _upload(
            api,
            str(space["id"]),
            f"alpha-{index}.md",
            "# Alpha routing note\n\nShared alpha route evidence about policy scoring and retrieval.",
        )

    response = api.post(
        "/api/v1/spaces/route",
        json={"query": "alpha route evidence policy scoring", "limit": 3},
    )
    assert response.status_code == 200, response.text
    route = response.json()

    assert route["method"] == "multi_space_cluster_match"
    assert "capped at 2" in route["selection_reason"]
    assert len(route["selected_space_ids"]) == 2
    assert len(route["candidates"]) == 3
    assert route["selected_space_ids"] == [
        candidate["space_id"] for candidate in route["candidates"][:2]
    ]
    assert [
        candidate["selected_for_search"] for candidate in route["candidates"]
    ] == [True, True, False]

    single_response = api.post(
        "/api/v1/spaces/route",
        json={"query": "alpha route evidence policy scoring", "limit": 1},
    )
    assert single_response.status_code == 200, single_response.text
    single_route = single_response.json()
    assert "capped at 1" in single_route["selection_reason"]
    assert len(single_route["selected_space_ids"]) == 1
    assert len(single_route["candidates"]) == 1
    assert single_route["candidates"][0]["selected_for_search"] is True


def test_route_with_only_archives_requires_explicit_scope(api: TestClient) -> None:
    archive = _create_space(api, "Cold storage", "archive")

    response = api.post(
        "/api/v1/spaces/route",
        json={"query": "Find the old agreement"},
    )
    assert response.status_code == 200, response.text
    route = response.json()
    assert route["method"] == "no_auto_route_spaces"
    assert "manual-scope only" in route["selection_reason"]
    assert route["selected_space_ids"] == []
    assert route["candidates"][0]["selected_for_search"] is False
    assert route["candidates"][0]["space_id"] == archive["id"]
    assert route["candidates"][0]["routing_note"] == "manual_scope_only"
