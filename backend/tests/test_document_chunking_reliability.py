"""Bounded planning and lossless budget repairs; no model or storage calls."""

import asyncio
from types import SimpleNamespace

import pytest

from app.modules.ingestion.splitters.agentic import (
    AgenticChunker,
    AgenticDocumentChunker,
    ChunkPlan,
    ChunkingConfig,
    HeuristicPlanningAgent,
    LLMPlanningAgent,
    PlanningError,
    SemanticRelation,
    build_atomic_units,
    estimate_tokens,
)


class WholeWindowPlanner:
    name = "whole-window"

    def __init__(self):
        self.calls = 0

    async def plan(self, units, config):
        self.calls += 1
        return [ChunkPlan(units[0].id, units[-1].id, title="Original topic", semantic_type="method_example")]


def _source(paragraphs=20):
    return "\n\n".join("段落" + "源" * 90 + str(index) for index in range(paragraphs)) + "\n"


def _assert_lossless_and_bounded(result, limit):
    assert result.lossless
    assert all(estimate_tokens(chunk.text) <= limit for chunk in result.chunks)
    assert result.chunks[0].start == 0
    assert result.chunks[-1].end == len(result.source)
    assert all(a.end == b.start for a, b in zip(result.chunks, result.chunks[1:]))


def test_oversized_valid_range_is_repaired_without_discarding_semantic_plan():
    planner = WholeWindowPlanner()
    result = asyncio.run(AgenticChunker(planner, ChunkingConfig(hard_max_tokens=200)).chunk(_source(7)))

    _assert_lossless_and_bounded(result, 200)
    assert result.repaired_ranges == 1
    assert result.fallback_windows == 0
    assert result.planning_calls == 1
    assert result.planner_name == "whole-window+budget-split"
    assert len(result.chunks) > 1
    assert all(chunk.title == "Original topic" for chunk in result.chunks)
    assert all(chunk.semantic_type == "method_example" for chunk in result.chunks)
    assert all(chunk.forced_split for chunk in result.chunks)


def test_repair_preserves_unchanged_plan_and_relations_once():
    class Planner:
        name = "relations"

        async def plan(self, units, config):
            return [
                ChunkPlan(units[0].id, units[-2].id, title="Topic", relations=(SemanticRelation(units[-1].id, "prerequisite_for"),)),
                ChunkPlan(units[-1].id, units[-1].id, title="Conclusion"),
            ]

    result = asyncio.run(AgenticChunker(Planner(), ChunkingConfig(hard_max_tokens=200)).chunk(_source(7)))
    _assert_lossless_and_bounded(result, 200)
    assert result.chunks[-1].title == "Conclusion"
    assert not result.chunks[-1].forced_split
    relations = [relation for chunk in result.chunks for relation in chunk.relations]
    assert relations == [{"target_chunk_local_id": result.chunks[-1].id, "relation_type": "prerequisite_for"}]


@pytest.mark.parametrize("kind", ["gap", "overlap", "unknown", "reverse", "duplicate_tail"])
def test_coverage_errors_are_never_repaired(kind):
    class BrokenPlanner:
        name = "broken"

        async def plan(self, units, config):
            if kind == "gap":
                return [ChunkPlan(units[1].id, units[-1].id)]
            if kind == "overlap":
                return [ChunkPlan(units[0].id, units[1].id), ChunkPlan(units[1].id, units[-1].id)]
            if kind == "unknown":
                return [ChunkPlan(units[0].id, "missing")]
            if kind == "reverse":
                return [ChunkPlan(units[-1].id, units[0].id)]
            return [ChunkPlan(units[0].id, units[-1].id), ChunkPlan(units[-1].id, units[-1].id)]

    result = asyncio.run(AgenticChunker(BrokenPlanner(), ChunkingConfig(hard_max_tokens=200)).chunk(_source(7)))
    _assert_lossless_and_bounded(result, 200)
    assert result.fallback_windows == 1
    assert result.repaired_ranges == 0
    assert "PlanningError" in result.warnings[0]


def test_consecutive_failures_skip_remaining_windows_but_reset_for_next_document():
    class FailingPlanner:
        name = "invalid-json"
        calls = 0

        async def plan(self, units, config):
            self.calls += 1
            raise PlanningError("invalid JSON")

    planner = FailingPlanner()
    chunker = AgenticChunker(planner, ChunkingConfig(hard_max_tokens=200, max_agent_input_tokens=512))
    for _ in range(2):
        result = asyncio.run(chunker.chunk(_source()))
        _assert_lossless_and_bounded(result, 200)
        assert result.planning_calls == 2
        assert result.skipped_windows > 0
        assert result.fallback_windows == result.skipped_windows + 2
    assert planner.calls == 4


def test_valid_repaired_plan_resets_consecutive_failure_counter():
    class IntermittentPlanner(WholeWindowPlanner):
        async def plan(self, units, config):
            plan = await super().plan(units, config)
            if self.calls % 2:
                raise PlanningError("invalid response")
            return plan

    planner = IntermittentPlanner()
    result = asyncio.run(AgenticChunker(planner, ChunkingConfig(hard_max_tokens=100, max_agent_input_tokens=512)).chunk(_source()))
    _assert_lossless_and_bounded(result, 100)
    assert result.planning_calls > 2
    assert result.skipped_windows == 0
    assert result.repaired_ranges > 0


def test_document_budget_cancels_slow_planner_and_preserves_source():
    class SlowPlanner:
        name = "slow"
        cancelled = False

        async def plan(self, units, config):
            try:
                await asyncio.Event().wait()
            finally:
                self.cancelled = True

    planner = SlowPlanner()
    result = asyncio.run(AgenticChunker(planner, ChunkingConfig(
        hard_max_tokens=200, max_agent_input_tokens=512,
        max_planning_seconds=0.01, agent_timeout_seconds=30,
    )).chunk(_source()))
    _assert_lossless_and_bounded(result, 200)
    assert planner.cancelled
    assert result.planning_calls == 1
    assert result.skipped_windows > 0
    assert any("time budget exhausted" in message for message in result.warnings)


def test_external_cancellation_does_not_fall_back():
    class CancelledPlanner:
        name = "cancelled"

        async def plan(self, units, config):
            raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(AgenticChunker(CancelledPlanner()).chunk(_source(2)))


def test_prompt_supplies_arithmetic_costs_and_timeout_comes_from_config():
    class Manager:
        async def chat(self, **kwargs):
            self.kwargs = kwargs
            return SimpleNamespace(success=True, data={"choices": [{"message": {"content": '{"chunks":[{"start_unit_id":"u_0001","end_unit_id":"u_0001"}]}'}}]})

    manager = Manager()
    config = ChunkingConfig(agent_timeout_seconds=2.5)
    units = [unit for unit in build_atomic_units("# Example\n\nSource text.") if unit.kind != "blank"]
    asyncio.run(LLMPlanningAgent(manager).plan(units, config))
    prompt = manager.kwargs["messages"][1]["content"]
    assert "budget_before=0" in prompt
    assert f"budget_after={sum(unit.token_count for unit in units)}" in prompt
    assert "end unit's budget_after minus start unit's budget_before" in prompt
    assert manager.kwargs["timeout"] == 2.5
    assert manager.kwargs["fallback"] is False


def test_adapter_records_repair_and_fallback_metrics():
    chunker = AgenticDocumentChunker(None, config=ChunkingConfig(hard_max_tokens=200), planner=WholeWindowPlanner())
    chunks = asyncio.run(chunker.chunk_parse_result({"file_type": "pdf", "markdown": _source(7)}))
    metadata = chunks[0]["metadata"]["chunking"]
    assert metadata["strategy"] == "agentic-v2"
    assert metadata["repaired_ranges"] == 1
    assert metadata["planning_calls"] == 1
    assert metadata["fallback_windows"] == 0
    assert metadata["skipped_windows"] == 0
    assert metadata["planning_seconds"] >= 0


@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan")])
def test_planning_time_budget_rejects_invalid_values(value):
    with pytest.raises(ValueError):
        ChunkingConfig(max_planning_seconds=value)


@pytest.mark.parametrize("source", ["中" * 1301, "abcd!" * 1301, "éλ🧭" * 1301, "# T\n\n" + "word " * 1301], ids=["cjk", "ascii", "unicode", "heading"])
def test_long_atomic_units_and_mixed_text_stay_lossless_and_within_ceiling(source):
    result = asyncio.run(AgenticChunker(HeuristicPlanningAgent(), ChunkingConfig(hard_max_tokens=64)).chunk(source))
    _assert_lossless_and_bounded(result, 64)
