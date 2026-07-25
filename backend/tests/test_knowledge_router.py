import pytest

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
async def test_complex_query_can_keep_three_close_candidates():
    router = _router_without_dependencies()

    result = await router._apply_routing_strategy(
        {"kb-a": 0.74, "kb-b": 0.72, "kb-c": 0.69, "kb-d": 0.30},
        max_targets=3,
    )

    assert result.routing_method == "multi_kb"
    assert result.target_kb_ids == ["kb-a", "kb-b", "kb-c"]
