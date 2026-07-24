"""Production Agentic Chunker tests; they do not call a model or Qdrant."""

import asyncio

from app.modules.ingestion.splitters.agentic import (
    AgenticChunker,
    AgenticDocumentChunker,
    ChunkPlan,
    ChunkingConfig,
    HeuristicPlanningAgent,
    SemanticRelation,
    source_from_parse_result,
)
from app.modules.ingestion.storage import vector_store as vector_store_module


class _SinglePlanAgent:
    name = "single-plan-test-agent"

    async def plan(self, units, _config):
        return [
            ChunkPlan(
                start_unit_id=units[0].id,
                end_unit_id=units[-1].id,
                title="缓存穿透治理",
                semantic_type="condition_conclusion",
            )
        ]


class _InvalidPlanAgent:
    name = "invalid-plan-test-agent"

    async def plan(self, units, _config):
        return [ChunkPlan(start_unit_id=units[0].id, end_unit_id=units[0].id)]


class _TwoPlanRelationAgent:
    name = "two-plan-relation-test-agent"

    async def plan(self, units, _config):
        split = len(units) // 2
        return [
            ChunkPlan(
                start_unit_id=units[0].id,
                end_unit_id=units[split - 1].id,
                title="定义",
                semantic_type="definition_explanation",
                relations=(
                    SemanticRelation(
                        target_unit_id=units[split].id,
                        relation_type="prerequisite_for",
                    ),
                ),
            ),
            ChunkPlan(
                start_unit_id=units[split].id,
                end_unit_id=units[-1].id,
                title="治理方法",
                semantic_type="method_or_procedure",
            ),
        ]


def test_production_chunker_is_lossless_and_adds_embedding_context():
    source = "# 原理\n\n定义：缓存穿透。\n\n条件成立，因此得到结论。\n"
    result = asyncio.run(
        AgenticChunker(
            planner=_SinglePlanAgent(),
            config=ChunkingConfig(hard_max_tokens=200),
        ).chunk(source)
    )

    assert result.lossless
    assert result.chunks[0].text == source
    assert "[章节] 原理" in result.chunks[0].embedding_text
    assert "[知识单元] 缓存穿透治理" in result.chunks[0].embedding_text


def test_production_chunker_rejects_incomplete_agent_plan_and_falls_back():
    source = "# A\n\n第一段。\n\n# B\n\n第二段。\n"
    result = asyncio.run(
        AgenticChunker(
            planner=_InvalidPlanAgent(),
            config=ChunkingConfig(hard_max_tokens=200),
            fallback_planner=HeuristicPlanningAgent(),
        ).chunk(source)
    )

    assert result.lossless
    assert result.fallback_windows == 1
    assert result.planner_name == "heuristic-structure-fallback"


def test_parser_adapter_preserves_page_metadata_and_semantic_relations():
    parse_result = {
        "file_type": "pdf",
        "pages": [
            {"page": 3, "text": "# 定义\n\n缓存穿透的定义。"},
            {"page": 4, "text": "# 方法\n\n使用空值缓存治理。"},
        ],
        "metadata": {"parser": "pymupdf", "source_type": "upload"},
    }
    chunker = AgenticDocumentChunker(
        llm_manager=None,
        config=ChunkingConfig(hard_max_tokens=200),
        planner=_TwoPlanRelationAgent(),
    )
    chunks = asyncio.run(chunker.chunk_parse_result(parse_result))

    assert len(chunks) == 2
    assert chunks[0]["metadata"]["page"] == 3
    assert chunks[1]["metadata"]["page"] == 4
    assert chunks[0]["metadata"]["semantic_relations"] == [
        {"target_chunk_local_id": "chunk_0002", "relation_type": "prerequisite_for"}
    ]
    assert chunks[0]["embedding_text"].startswith("[章节] 定义")


def test_parse_source_prefers_markdown_and_preserves_page_ranges_when_needed():
    markdown_source = source_from_parse_result(
        {"markdown": "# 标题\n\n正文", "content": "should not be selected"}
    )
    assert markdown_source.origin == "markdown"
    assert markdown_source.text == "# 标题\n\n正文"

    page_source = source_from_parse_result(
        {"pages": [{"page": 7, "text": "甲"}, {"page": 8, "text": "乙"}]}
    )
    assert page_source.origin == "pages"
    assert page_source.text == "甲\n\n乙"
    assert page_source.pages_for_range(0, 1) == [7]
    assert page_source.pages_for_range(0, len(page_source.text)) == [7, 8]


def test_vector_store_configures_the_agentic_text_collection(monkeypatch):
    created = []
    indexed = []

    class _FakeQdrantClient:
        def __init__(self, **_kwargs):
            pass

        def get_collection(self, _collection_name):
            raise RuntimeError("404 Not Found")

        def create_collection(self, **kwargs):
            created.append(kwargs)

        def create_payload_index(self, **kwargs):
            indexed.append(kwargs)

    monkeypatch.setattr(vector_store_module, "QdrantClient", _FakeQdrantClient)
    store = vector_store_module.VectorStore()

    collection = vector_store_module.TEXT_CHUNK_COLLECTION
    assert collection == "text_chunks_agentic"
    assert collection in store.collections
    assert store.collections[collection]["payload_schema"]["embedding_text"]
    created_names = {item["collection_name"] for item in created}
    assert collection in created_names
    indexed_fields = {
        item["field_name"]
        for item in indexed
        if item["collection_name"] == collection
    }
    assert {"kb_id", "file_id", "text_content", "embedding_text"} <= indexed_fields
