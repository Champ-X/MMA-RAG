from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.llm.manager import LLMCallResult
from app.modules.knowledge.router import KnowledgeRouter
from app.modules.knowledge.service import KnowledgeBase, KnowledgeBaseService


def _router_without_dependencies() -> KnowledgeRouter:
    return KnowledgeRouter.__new__(KnowledgeRouter)


class _MetadataMinioStub:
    def get_bucket_for_kb(self, kb_id):
        return f"kb-{kb_id}"

    def bucket_exists(self, bucket_name):
        return True

    def get_kb_metadata(self, bucket_name):
        return {
            "name": "重命名后的知识库",
            "description": "new description",
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-02T00:00:00",
        }

    def get_bucket_tags(self, bucket_name):
        return {}


@pytest.mark.asyncio
async def test_metadata_refresh_replaces_stale_instance_cache():
    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service.minio_adapter = _MetadataMinioStub()
    service._kb_storage = {
        "kb-a": KnowledgeBase(
            id="kb-a",
            name="重命名前的知识库",
            description="old description",
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-01T00:00:00",
        )
    }

    metadata = await service.get_knowledge_base_metadata("kb-a", refresh=True)

    assert metadata is not None
    assert metadata["name"] == "重命名后的知识库"
    assert service._kb_storage["kb-a"].name == "重命名后的知识库"


@pytest.mark.asyncio
async def test_router_enrichment_requests_fresh_metadata():
    class _KnowledgeServiceStub:
        def __init__(self):
            self.refresh_values = []

        async def get_knowledge_base_metadata(self, kb_id, *, refresh=False):
            self.refresh_values.append(refresh)
            return {"id": kb_id, "name": "最新知识库名称"}

    router = _router_without_dependencies()
    router.kb_service = _KnowledgeServiceStub()

    target_kbs = await router._enrich_target_kbs(["kb-a"], {"kb-a": 0.9})

    assert target_kbs == [{"id": "kb-a", "name": "最新知识库名称", "score": 0.9}]
    assert router.kb_service.refresh_values == [True]


@pytest.mark.asyncio
@pytest.mark.parametrize("fallback", ["embedding_failure", "no_portraits", "portrait_error"])
async def test_route_fallback_preserves_latest_kb_names(monkeypatch, fallback):
    router = _router_without_dependencies()
    router.llm_manager = object()
    router.kb_service = SimpleNamespace(
        list_knowledge_bases=AsyncMock(return_value=[
            {"id": "kb-a", "name": "旧知识库名称"},
            {"id": "kb-b", "name": "音乐收集"},
        ]),
        get_knowledge_base_metadata=AsyncMock(side_effect=[
            {"id": "kb-a", "name": "最新知识库名称"},
            {"id": "kb-b", "name": "音乐收集"},
        ]),
    )
    router.vector_store = SimpleNamespace(
        search_kb_portraits_topn=AsyncMock(
            return_value=[],
            side_effect=ConnectionError("Qdrant unavailable") if fallback == "portrait_error" else None,
        ),
    )
    monkeypatch.setattr("app.modules.knowledge.router.embed_queries", AsyncMock(
        return_value=LLMCallResult(
            success=fallback != "embedding_failure",
            data=None if fallback == "embedding_failure" else [[0.1, 0.2]],
        ),
    ))

    result = await router.route_query("麝香甜瓜最早来自哪里？")

    expected_method = "no_portraits_default_all" if fallback == "no_portraits" else "default_all"
    assert result.routing_method == expected_method
    assert result.target_kb_ids == ["kb-a", "kb-b"]
    assert result.target_kbs == [
        {"id": "kb-a", "name": "最新知识库名称", "score": 1.0},
        {"id": "kb-b", "name": "音乐收集", "score": 1.0},
    ]
    assert all(call.kwargs["refresh"] for call in router.kb_service.get_knowledge_base_metadata.await_args_list)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [None, ConnectionError("MinIO unavailable")])
async def test_default_routing_keeps_listed_name_when_metadata_refresh_fails(failure):
    router = _router_without_dependencies()
    router.kb_service = SimpleNamespace(
        list_knowledge_bases=AsyncMock(return_value=[{"id": "kb-a", "name": "生物科普"}]),
        get_knowledge_base_metadata=AsyncMock(return_value=None, side_effect=failure),
    )

    result = await router._default_routing()

    assert result.target_kbs == [{"id": "kb-a", "name": "生物科普", "score": 1.0}]


@pytest.mark.asyncio
async def test_default_routing_without_knowledge_bases_has_empty_display_targets():
    router = _router_without_dependencies()
    router.kb_service = SimpleNamespace(list_knowledge_bases=AsyncMock(return_value=[]))

    result = await router._default_routing()

    assert result.routing_method == "no_kb_available"
    assert result.target_kbs == []


def test_relative_normalization_keeps_close_scores_close():
    router = _router_without_dependencies()

    normalized = router._normalize_scores({"kb-a": 0.71, "kb-b": 0.70})

    assert normalized["kb-a"] == 1.0
    assert normalized["kb-b"] > 0.98


def test_multi_signal_scores_reward_cross_query_coverage():
    router = _router_without_dependencies()
    scores = router._calculate_multi_signal_scores(
        [
            [
                {"kb_id": "kb-a", "score": 0.80},
                {"kb_id": "kb-b", "score": 0.79},
            ],
            [
                {"kb_id": "kb-a", "score": 0.78},
                {"kb_id": "kb-c", "score": 0.77},
            ],
        ]
    )

    assert scores["kb-a"] > scores["kb-b"]
    assert scores["kb-a"] > scores["kb-c"]


def test_query_weights_keep_primary_signal_ahead_of_weaker_variant():
    router = _router_without_dependencies()

    scores = router._calculate_multi_signal_scores(
        [
            [{"kb_id": "kb-primary", "score": 0.80}],
            [],
            [],
            [{"kb_id": "kb-low-priority-variant", "score": 0.90}],
        ]
    )

    assert scores["kb-primary"] > scores["kb-low-priority-variant"]
    assert scores["kb-primary"] > 0.70


@pytest.mark.asyncio
async def test_close_raw_scores_route_to_two_knowledge_bases():
    router = _router_without_dependencies()

    result = await router._apply_routing_strategy(
        {"kb-a": 0.71, "kb-b": 0.70, "kb-c": 0.40},
        max_targets=2,
    )

    assert result.routing_method == "dual_kb"
    assert result.target_kb_ids == ["kb-a", "kb-b"]


@pytest.mark.asyncio
async def test_clear_raw_score_gap_routes_to_single_knowledge_base():
    router = _router_without_dependencies()

    result = await router._apply_routing_strategy(
        {"kb-a": 0.76, "kb-b": 0.60},
        max_targets=2,
    )

    assert result.routing_method == "single_kb_dominant"
    assert result.target_kb_ids == ["kb-a"]


@pytest.mark.asyncio
async def test_agent_round_one_keeps_a_single_dominant_knowledge_base():
    router = _router_without_dependencies()

    result = await router._apply_agent_exploration_strategy(
        {"kb-a": 0.76, "kb-b": 0.60, "kb-c": 0.32},
        max_targets=3,
        agent_round=1,
        explored_kb_counts={},
        modality_intents={},
        modality_inventory={},
    )

    assert result.target_kb_ids == ["kb-a"]
    assert result.routing_details["base_routing_method"] == "single_kb_dominant"


@pytest.mark.asyncio
async def test_complex_query_can_keep_three_close_candidates():
    router = _router_without_dependencies()

    result = await router._apply_routing_strategy(
        {"kb-a": 0.74, "kb-b": 0.72, "kb-c": 0.69, "kb-d": 0.30},
        max_targets=3,
    )

    assert result.routing_method == "multi_kb"
    assert result.target_kb_ids == ["kb-a", "kb-b", "kb-c"]


@pytest.mark.asyncio
async def test_agent_keeps_relevance_anchor_and_reserves_unseen_audio_kb():
    router = _router_without_dependencies()

    result = await router._apply_agent_exploration_strategy(
        {"movies": 0.76, "music": 0.55, "landscape": 0.48},
        max_targets=2,
        agent_round=2,
        explored_kb_counts={"movies": 1, "landscape": 1},
        modality_intents={"audio": "explicit_demand"},
        modality_inventory={
            "movies": {"audio": 0},
            "music": {"audio": 16},
            "landscape": {"audio": 0},
        },
    )

    assert result.routing_method == "agent_modality_coverage"
    assert result.target_kb_ids == ["movies", "music"]
    assert result.routing_details["modality_coverage_kb_ids"] == ["music"]


@pytest.mark.asyncio
async def test_agent_round_two_reserves_one_relevant_unseen_kb_without_modality_hint():
    router = _router_without_dependencies()

    result = await router._apply_agent_exploration_strategy(
        {"kb-seen": 0.75, "kb-new": 0.55, "kb-weak": 0.20},
        max_targets=2,
        agent_round=2,
        explored_kb_counts={"kb-seen": 1},
        modality_intents={},
        modality_inventory={},
    )

    assert result.routing_method == "agent_anchor_explore"
    assert result.target_kb_ids == ["kb-seen", "kb-new"]
    assert result.routing_details["exploration_kb_id"] == "kb-new"


@pytest.mark.asyncio
async def test_agent_modality_inventory_can_make_music_the_round_one_anchor():
    router = _router_without_dependencies()

    result = await router._apply_agent_exploration_strategy(
        {"landscape": 0.75, "music": 0.65},
        max_targets=2,
        agent_round=1,
        explored_kb_counts={},
        modality_intents={"audio": "explicit_demand"},
        modality_inventory={
            "landscape": {"audio": 0},
            "music": {"audio": 16},
        },
    )

    assert result.target_kb_ids[0] == "music"
    assert result.routing_details["anchor_kb_id"] == "music"


@pytest.mark.asyncio
async def test_combined_image_and_audio_query_covers_both_kb_inventories():
    router = _router_without_dependencies()

    result = await router._apply_agent_exploration_strategy(
        {"landscape": 0.75, "movies": 0.70, "music": 0.58},
        max_targets=2,
        agent_round=1,
        explored_kb_counts={},
        modality_intents={
            "image": "explicit_demand",
            "audio": "explicit_demand",
        },
        modality_inventory={
            "landscape": {"image": 20, "audio": 0},
            "movies": {"image": 10, "audio": 0},
            "music": {"image": 0, "audio": 16},
        },
    )

    assert result.target_kb_ids == ["landscape", "music"]
    assert result.routing_method == "agent_modality_coverage"
    assert result.routing_details["modality_coverage_kb_ids"] == ["music"]


@pytest.mark.asyncio
async def test_explicit_kb_scope_ignores_agent_exploration_hints():
    class _KnowledgeServiceStub:
        async def get_knowledge_base_metadata(self, kb_id, *, refresh=False):
            return {"id": kb_id, "name": kb_id}

    router = _router_without_dependencies()
    router.kb_service = _KnowledgeServiceStub()

    result = await router.route_query(
        "主题曲",
        kb_context={"kb_ids": ["movies"]},
        routing_hints={
            "agent_mode": True,
            "agent_round": 3,
            "explored_kb_counts": {"movies": 2},
            "modality_intents": {"audio": "explicit_demand"},
        },
    )

    assert result.routing_method == "explicit"
    assert result.target_kb_ids == ["movies"]
