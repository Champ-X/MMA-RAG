from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from nexus.bootstrap import NexusContainer
from nexus.modules.models.domain import ModelRequirement, ModelResponse


def _create_space(api: TestClient, name: str) -> dict[str, object]:
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
    assert response.json()["job"]["status"] == "completed"
    return response.json()


def test_space_portrait_auto_route_and_durable_follow_up(api: TestClient) -> None:
    orbital = _create_space(api, "Orbital Propulsion")
    gardens = _create_space(api, "Garden Field Notes")
    uploaded = _upload(
        api,
        str(orbital["id"]),
        "comet.md",
        "# Project Comet\n\nProject Comet launches on 2026-11-03 using an ion thruster.",
    )
    _upload(
        api,
        str(gardens["id"]),
        "orchard.md",
        "# Orchard\n\nThe pear trees need irrigation every Wednesday.",
    )

    portrait = api.get(f"/api/v1/spaces/{orbital['id']}/portrait")
    assert portrait.status_code == 200, portrait.text
    assert portrait.json()["evidence_count"] >= 1
    assert portrait.json()["clusters"]
    assert portrait.json()["clusters"][0]["samples"]
    label_tokens = {
        token.strip()
        for cluster in portrait.json()["clusters"]
        for token in cluster["label"].split("·")
    }
    assert {"the", "is", "value"}.isdisjoint(label_tokens)
    assert {"project", "comet"} <= label_tokens

    suggestions = api.get(f"/api/v1/spaces/{orbital['id']}/suggested-questions")
    assert suggestions.status_code == 200, suggestions.text
    suggested = suggestions.json()["suggestions"]
    assert suggested
    assert suggested[0]["cluster_id"] == portrait.json()["clusters"][0]["id"]
    assert suggested[0]["evidence_count"] >= 1
    assert suggested[0]["reason"] == "current_space_portrait"

    route = api.post(
        "/api/v1/spaces/route",
        json={"query": "Project Comet ion thruster launch", "limit": 2},
    )
    assert route.status_code == 200, route.text
    routed = route.json()
    assert orbital["id"] in routed["selected_space_ids"]
    assert routed["candidates"][0]["space_id"] == orbital["id"]

    first_response = api.post(
        "/api/v1/runs",
        json={
            "goal": "When does Project Comet launch?",
            "kind": "quick",
            "scope": {"space_ids": []},
            "auto_route": True,
        },
    )
    assert first_response.status_code == 202, first_response.text
    first = first_response.json()
    assert first["scope"]["space_ids"]
    assert first["request_context"]["routing_trace"]["selected_space_ids"]

    source_id = uploaded["source_version"]["source_id"]
    second_response = api.post(
        "/api/v1/runs",
        json={
            "goal": "它的具体日期是什么？",
            "kind": "quick",
            "scope": {"space_ids": [orbital["id"]]},
            "parent_run_id": first["id"],
            "attachment_source_ids": [source_id],
        },
    )
    assert second_response.status_code == 202, second_response.text
    second = second_response.json()
    assert second["conversation_id"] == first["conversation_id"]
    assert second["parent_run_id"] == first["id"]
    assert second["request_context"]["conversation_history"][0]["content"] == first["goal"]
    assert second["request_context"]["attachment_source_ids"] == [source_id]
    assert second["result"]["query_understanding"]["contextual_follow_up"] is True
    assert "Previous user question" in second["result"]["query_understanding"][
        "rewritten_query"
    ]

    conversation = api.get(f"/api/v1/conversations/{first['conversation_id']}/runs")
    assert conversation.status_code == 200
    assert [item["id"] for item in conversation.json()["items"]] == [
        first["id"],
        second["id"],
    ]


def test_intent_and_rewrite_use_their_configured_task_routes_with_fallback_guards(
    api: TestClient,
    nexus: NexusContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    space = _create_space(api, "Task-routed understanding")
    _upload(
        api,
        str(space["id"]),
        "launch.md",
        "# Launch\n\nProject Atlas launch window opens on 2027-04-12.",
    )
    roles: list[str] = []

    def complete(_request: object, requirement: ModelRequirement) -> ModelResponse:
        role = requirement.role
        roles.append(role)
        if role == "query_intent":
            payload = {
                "intent": "analysis",
                "modality_intent": "text",
                "is_complex": True,
                "keywords": ["Project Atlas", "launch window"],
                "sub_queries": ["Atlas schedule"],
            }
        else:
            payload = {
                "rewritten_query": "What is the Project Atlas launch window date?",
                "multi_view_queries": ["Project Atlas launch schedule"],
                "keywords": ["2027"],
            }
        return ModelResponse(text=json.dumps(payload), actual_model=f"task/{role}")

    monkeypatch.setattr(nexus.model_gateway, "complete", complete)
    response = api.post(
        "/api/v1/runs",
        json={
            "goal": "分析 Atlas 是什么时候发射的？",
            "kind": "quick",
            "scope": {"space_ids": [space["id"]]},
        },
    )

    assert response.status_code == 202, response.text
    understanding = response.json()["result"]["query_understanding"]
    assert roles == ["query_intent", "query_rewrite"]
    assert understanding["intent"] == "analysis"
    assert understanding["is_complex"] is True
    assert understanding["rewritten_query"] == "What is the Project Atlas launch window date?"
    assert understanding["multi_view_queries"] == ["Project Atlas launch schedule"]
    assert understanding["intent_model"] == "task/query_intent"
    assert understanding["rewrite_model"] == "task/query_rewrite"
    assert understanding["understanding_mode"] == "model_with_deterministic_guardrails"
