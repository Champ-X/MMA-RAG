"""Tests for the standalone experiment; no upload, vector DB, or LLM call."""

import asyncio

from experiments.agentic_chunker.core import (
    AgenticChunker,
    ChunkPlan,
    ChunkingConfig,
    HeuristicPlanningAgent,
    SemanticRelation,
    build_atomic_units,
)


class _SinglePlanAgent:
    name = "single-plan-test-agent"

    async def plan(self, units, _config):
        return [
            ChunkPlan(
                start_unit_id=units[0].id,
                end_unit_id=units[-1].id,
                title="定义、条件与结论",
                semantic_type="condition_conclusion",
                relations=(SemanticRelation(target_unit_id=units[-1].id, relation_type="example_of"),),
            )
        ]


class _InvalidPlanAgent:
    name = "invalid-plan-test-agent"

    async def plan(self, units, _config):
        # Deliberately drops the final unit; the orchestration must reject it.
        return [
            ChunkPlan(
                start_unit_id=units[0].id,
                end_unit_id=units[0].id,
            )
        ]


class _RelatedTwoPlanAgent:
    name = "related-two-plan-test-agent"

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
                title="方法",
                semantic_type="method_or_procedure",
            ),
        ]


def test_atomic_units_cover_the_exact_markdown_source():
    source = "# 标题\n\n定义：缓存穿透。\n\n| 字段 | 含义 |\n|---|---|\n| A | B |\n\n```py\nprint(1)\n```\n"
    units = build_atomic_units(source, hard_max_tokens=200)

    assert "".join(unit.text for unit in units) == source
    assert units[0].start == 0
    assert units[-1].end == len(source)
    assert all(left.end == right.start for left, right in zip(units, units[1:]))
    assert {unit.kind for unit in units} >= {"heading", "paragraph", "table", "code"}


def test_default_hard_ceiling_is_600_estimated_tokens():
    assert ChunkingConfig().hard_max_tokens == 600


def test_agent_plan_materializes_losslessly_without_overlap():
    source = "# 原理\n\n定义与解释。\n\n条件成立，因此得到结论。\n"
    result = asyncio.run(
        AgenticChunker(
            planner=_SinglePlanAgent(),
            config=ChunkingConfig(hard_max_tokens=200),
        ).chunk(source)
    )

    assert result.lossless
    assert result.total_chunk_characters == len(source)
    assert result.fallback_windows == 0
    assert result.chunks[0].text == source
    assert "[知识单元] 定义、条件与结论" in result.chunks[0].embedding_text


def test_invalid_agent_plan_falls_back_to_structural_planner():
    source = "# A\n\n第一段。\n\n# B\n\n第二段。\n"
    result = asyncio.run(
        AgenticChunker(
            planner=_InvalidPlanAgent(),
            fallback_planner=HeuristicPlanningAgent(),
            config=ChunkingConfig(hard_max_tokens=200),
        ).chunk(source)
    )

    assert result.lossless
    assert result.fallback_windows == 1
    assert result.warnings
    assert result.planner_name == "heuristic-structure-fallback"


def test_cross_chunk_semantic_relation_is_resolved_after_materialization():
    source = "# 定义\n\n缓存穿透的定义。\n\n# 方法\n\n使用空值缓存进行治理。\n"
    result = asyncio.run(
        AgenticChunker(
            planner=_RelatedTwoPlanAgent(),
            config=ChunkingConfig(hard_max_tokens=200),
        ).chunk(source)
    )

    assert result.lossless
    assert len(result.chunks) == 2
    assert result.chunks[0].relations == [
        {"target_chunk_id": "chunk_0002", "relation_type": "prerequisite_for"}
    ]


def test_oversized_single_paragraph_is_split_without_content_loss():
    source = "# 超长段落\n\n" + "甲" * 420 + "。" + "乙" * 420
    config = ChunkingConfig(hard_max_tokens=120)
    units = build_atomic_units(source, hard_max_tokens=config.hard_max_tokens)
    result = asyncio.run(AgenticChunker(HeuristicPlanningAgent(), config).chunk(source))

    assert "".join(unit.text for unit in units) == source
    assert any(unit.forced_split for unit in units)
    assert result.lossless
    assert all(len(chunk.text) > 0 for chunk in result.chunks)
