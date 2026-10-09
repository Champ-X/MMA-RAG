"""Routing metadata must not wait for knowledge-library statistics."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.modules.knowledge.router import KnowledgeRouter
from app.modules.knowledge.service import KnowledgeBase, KnowledgeBaseService


def make_service():
    service = KnowledgeBaseService.__new__(KnowledgeBaseService)
    service._kb_storage = {
        kb_id: KnowledgeBase(
            id=kb_id, name=f"旧名称 {kb_id}", description=f"说明 {kb_id}",
            created_at="2026-01-01", updated_at="2026-01-02", user_id=owner,
        )
        for kb_id, owner in [("b", "user-1"), ("other", "user-2"), ("a", "user-1")]
    }
    service._get_kb_statistics = AsyncMock(return_value={"total_documents": 3})
    return service


@pytest.mark.asyncio
async def test_metadata_listing_keeps_fields_scope_pagination_and_order():
    service = make_service()
    service._load_from_minio = Mock(side_effect=AssertionError("cached names must survive"))

    rows = await service.list_knowledge_bases(
        user_id="user-1", offset=1, limit=1, include_statistics=False,
    )

    assert rows == [{
        "id": "a", "name": "旧名称 a", "description": "说明 a",
        "created_at": "2026-01-01", "updated_at": "2026-01-02",
    }]
    service._get_kb_statistics.assert_not_awaited()
    service._load_from_minio.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("options", [{}, {"include_statistics": True}])
async def test_library_listing_still_includes_statistics_by_default(options):
    service = make_service()

    rows = await service.list_knowledge_bases(user_id="user-1", **options)

    assert [row["id"] for row in rows] == ["b", "a"]
    assert [row["statistics"] for row in rows] == [{"total_documents": 3}] * 2
    assert [call.args[0] for call in service._get_kb_statistics.await_args_list] == ["b", "a"]


@pytest.mark.asyncio
async def test_default_routing_ignores_hung_statistics_and_refreshes_names():
    service = make_service()

    async def hung_statistics(kb_id):
        await asyncio.Event().wait()

    service._get_kb_statistics = AsyncMock(side_effect=hung_statistics)
    service.minio_adapter = SimpleNamespace(
        get_bucket_for_kb=lambda kb_id: f"kb-{kb_id}",
        bucket_exists=lambda bucket: True,
        get_kb_metadata=lambda bucket: {
            "name": f"最新名称 {bucket}", "created_at": "2026-01-01", "updated_at": "2026-01-03",
        },
    )
    router = KnowledgeRouter.__new__(KnowledgeRouter)
    router.kb_service = service

    result = await asyncio.wait_for(router._default_routing(), timeout=1)

    service._get_kb_statistics.assert_not_awaited()
    assert result.routing_method == "default_all"
    assert result.target_kb_ids == ["b", "other", "a"]
    assert result.total_candidates == 3
    assert result.confidence_scores == {"b": 1.0, "other": 1.0, "a": 1.0}
    assert result.target_kbs == [
        {"id": kb_id, "name": f"最新名称 kb-{kb_id}", "score": 1.0}
        for kb_id in ["b", "other", "a"]
    ]
