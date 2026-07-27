from types import SimpleNamespace

import pytest

from app.modules.agent.models import AgentDecision
from app.modules.agent.planner import parse_planner_decision
from app.modules.agent.service import (
    AgenticRetrievalService,
    _merge_retrieval_results,
)
from app.modules.generation.context_builder import ContextBuilder
from app.modules.retrieval.service import (
    RetrievalResult,
    RetrievalService,
    _apply_agent_base_modality_intents,
)


def _retrieval_result(query: str, rows):
    context = SimpleNamespace(
        original_query=query,
        refined_query=query,
        intent_type="factual",
        is_complex=False,
        visual_intent="unnecessary",
        visual_reasoning="",
        audio_intent="unnecessary",
        audio_reasoning="",
        video_intent="unnecessary",
        video_reasoning="",
        search_strategies={"multi_view_queries": []},
        target_kb_ids=["kb-1"],
        target_kbs=[{"id": "kb-1", "name": "Agent 设计知识库", "score": 0.9}],
        target_file_ids=[],
        selected_files=[],
        selected_file_modalities=[],
        confidence_scores={"kb-1": 0.9},
        processing_time=0.01,
    )
    return RetrievalResult(
        context=context,
        raw_results={"dense": list(rows)},
        reranked_results=list(rows),
        processing_time=0.01,
        debug_info={"query": query},
    )


class _FakeRetrieval:
    def __init__(self):
        self.calls = []

    async def search(self, query, **kwargs):
        self.calls.append({"query": query, **kwargs})
        if "图片" in query:
            return _retrieval_result(
                query,
                [
                    {
                        "id": "image-1",
                        "content_type": "image",
                        "final_score": 0.72,
                        "payload": {
                            "kb_id": "kb-1",
                            "file_path": "images/design.png",
                            "caption": "Agent 架构图",
                        },
                    }
                ],
            )
        return _retrieval_result(
            query,
            [
                {
                    "id": "doc-shared",
                    "content_type": "doc",
                    "final_score": 0.81,
                    "payload": {
                        "kb_id": "kb-1",
                        "file_path": "documents/agent.md",
                        "text_content": f"关于 {query} 的证据",
                    },
                }
            ],
        )


class _VisualRequirementRetrieval(_FakeRetrieval):
    async def get_agent_modality_requirements(self, **_kwargs):
        return {
            "image": "implicit_enrichment",
            "audio": "unnecessary",
            "video": "unnecessary",
        }


class _OriginalQueryAnchorRetrieval(_FakeRetrieval):
    async def prepare_agent_original_query(self, **_kwargs):
        return {
            "visual_intent": "unnecessary",
            "audio_intent": "unnecessary",
            "video_intent": "unnecessary",
            "refined_query": "原问题的直接检索改写",
            "search_strategies": {"multi_view_queries": ["原问题变体"]},
        }

    async def search(self, query, **kwargs):
        self.calls.append({"query": query, **kwargs})
        if kwargs.get("preprocessing_result"):
            return _retrieval_result(
                query,
                [
                    {
                        "id": "original-query-answer",
                        "content_type": "doc",
                        "final_score": 0.15,
                        "payload": {
                            "kb_id": "kb-1",
                            "file_path": "documents/direct-answer.md",
                            "text_content": "原问题的正确答案证据",
                        },
                    }
                ],
            )
        return _retrieval_result(
            query,
            [
                {
                    "id": "planner-drift",
                    "content_type": "doc",
                    "final_score": 0.95,
                    "payload": {
                        "kb_id": "kb-1",
                        "file_path": "documents/generic.md",
                        "text_content": "与原问题无关的泛化材料",
                    },
                }
            ],
        )


class _FocusedOriginalQueryAnchorRetrieval(_OriginalQueryAnchorRetrieval):
    async def search(self, query, **kwargs):
        self.calls.append({"query": query, **kwargs})
        if kwargs.get("preprocessing_result"):
            return _retrieval_result(
                query,
                [
                    {
                        "id": f"direct-{index}",
                        "content_type": "doc",
                        "final_score": 0.9 - index * 0.05,
                        "payload": {
                            "kb_id": "kb-1",
                            "file_path": f"documents/harness-{index}.md",
                            "text_content": (
                                "Harness System 的发展历程与版本演进"
                            ),
                        },
                    }
                    for index in range(3)
                ],
            )
        return _retrieval_result(
            query,
            [
                {
                    "id": "focused-follow-up",
                    "content_type": "doc",
                    "final_score": 0.8,
                    "payload": {
                        "kb_id": "kb-1",
                        "file_path": "documents/harness-history.md",
                        "text_content": "Harness System 的关键里程碑",
                    },
                }
            ],
        )


class _FakePlanner:
    def __init__(self, decisions):
        self.decisions = list(decisions)

    async def decide(self, **_kwargs):
        return self.decisions.pop(0) if self.decisions else AgentDecision("final")


class _RecordingPlanner(_FakePlanner):
    def __init__(self, decisions):
        super().__init__(decisions)
        self.calls = []

    async def decide(self, **kwargs):
        self.calls.append(kwargs)
        return await super().decide(**kwargs)


def test_parse_planner_decision_accepts_fenced_json():
    decision = parse_planner_decision(
        """```json
        {"action":"search","reason":"缺少视觉证据","queries":["架构", "架构", "图片 架构"]}
        ```"""
    )
    assert decision is not None
    assert decision.action == "search"
    assert decision.queries == ["架构", "图片 架构"]


def test_parse_planner_decision_rejects_search_without_queries():
    assert parse_planner_decision('{"action":"search","queries":[]}') is None


@pytest.mark.asyncio
async def test_agent_iterates_and_preserves_multimodal_evidence():
    service = AgenticRetrievalService(
        _FakeRetrieval(),
        planner=_FakePlanner(
            [
                AgentDecision("search", "先找定义", ["Agent 机制"]),
                AgentDecision("search", "补充视觉证据", ["图片 Agent 架构"]),
                AgentDecision("final", "证据完整"),
            ]
        ),
        max_rounds=3,
        max_queries_per_round=2,
        max_total_queries=4,
        max_evidence=10,
    )

    result = await service.search(query="解释 Agent 架构")

    assert result.stop_reason == "evidence_sufficient"
    assert result.executed_queries == ["Agent 机制", "图片 Agent 架构"]
    merged = result.retrieval_result
    assert {item["content_type"] for item in merged.reranked_results} == {"doc", "image"}
    assert merged.context.original_query == "解释 Agent 架构"
    assert merged.context.search_strategies["agent_queries"] == result.executed_queries
    assert merged.context.target_kbs[0]["name"] == "Agent 设计知识库"
    assert merged.debug_info["agent"]["enabled"] is True


@pytest.mark.asyncio
async def test_agent_stream_preserves_knowledge_base_display_name():
    service = AgenticRetrievalService(
        _FakeRetrieval(),
        planner=_FakePlanner(
            [
                AgentDecision("search", "检索核心证据", ["Agent 机制"]),
                AgentDecision("final", "证据完整"),
            ]
        ),
        max_rounds=2,
        max_queries_per_round=2,
        max_total_queries=3,
        max_evidence=10,
    )

    events = [event async for event in service.search_stream(query="解释 Agent 架构")]
    retrieval_payload = next(payload for phase, payload in events if phase == "retrieval")

    assert retrieval_payload["target_kbs"] == [
        {"id": "kb-1", "name": "Agent 设计知识库", "score": 0.9}
    ]


@pytest.mark.asyncio
async def test_agent_stream_keeps_all_round_snapshots():
    service = AgenticRetrievalService(
        _FakeRetrieval(),
        planner=_FakePlanner(
            [
                AgentDecision("search", "先检索文本证据", ["Agent 机制"]),
                AgentDecision("search", "再补充视觉证据", ["图片 Agent 架构"]),
                AgentDecision("final", "证据完整"),
            ]
        ),
        max_rounds=3,
        max_queries_per_round=2,
        max_total_queries=4,
        max_evidence=10,
    )

    events = [event async for event in service.search_stream(query="解释 Agent 架构")]
    routing_payloads = [payload for phase, payload in events if phase == "routing"]
    retrieval_payloads = [payload for phase, payload in events if phase == "retrieval"]

    assert [row["round"] for row in routing_payloads[1]["agent_rounds"]] == [1, 2]
    assert [row["status"] for row in routing_payloads[1]["agent_rounds"]] == [
        "completed",
        "processing",
    ]
    assert routing_payloads[1]["agent_rounds"][0]["queries"] == ["Agent 机制"]

    final_rounds = retrieval_payloads[1]["agent_rounds"]
    assert [row["round"] for row in final_rounds] == [1, 2]
    assert [row["status"] for row in final_rounds] == ["completed", "completed"]
    assert final_rounds[0]["new_evidence_count"] == 1
    assert final_rounds[0]["total_evidence_count"] == 1
    assert final_rounds[1]["new_evidence_count"] == 1
    assert final_rounds[1]["total_evidence_count"] == 2
    assert final_rounds[0]["target_kbs"][0]["name"] == "Agent 设计知识库"


@pytest.mark.asyncio
async def test_agent_falls_back_to_original_query_when_planner_is_unavailable():
    retrieval = _FakeRetrieval()
    service = AgenticRetrievalService(
        retrieval,
        planner=_FakePlanner([None, AgentDecision("final", "done")]),
        max_rounds=2,
        max_queries_per_round=2,
        max_total_queries=3,
        max_evidence=10,
    )

    result = await service.search(query="原始问题")

    assert result.executed_queries == ["原始问题"]
    assert result.retrieval_result.reranked_results[0]["id"] == "doc-shared"
    assert retrieval.calls[0]["preplanned"] is True


@pytest.mark.asyncio
async def test_agent_deduplicates_repeated_evidence_and_records_hits():
    service = AgenticRetrievalService(
        _FakeRetrieval(),
        planner=_FakePlanner(
            [
                AgentDecision("search", "两种表述", ["Agent 原理", "Agent 工作机制"]),
                AgentDecision("final", "done"),
            ]
        ),
        max_rounds=2,
        max_queries_per_round=2,
        max_total_queries=3,
        max_evidence=10,
    )

    result = await service.search(query="Agent")
    rows = result.retrieval_result.reranked_results

    assert len(rows) == 1
    assert rows[0]["metadata"]["agent_hit_count"] == 2
    assert rows[0]["final_score"] > rows[0]["_agent_original_score"]


@pytest.mark.asyncio
async def test_agent_passes_previous_round_kb_ledger_to_retrieval():
    retrieval = _FakeRetrieval()
    service = AgenticRetrievalService(
        retrieval,
        planner=_FakePlanner(
            [
                AgentDecision("search", "先找电影资料", ["浴血黑帮 海报"]),
                AgentDecision("search", "再找音频资料", ["浴血黑帮 主题曲 音频"]),
                AgentDecision("final", "done"),
            ]
        ),
        max_rounds=3,
        max_queries_per_round=1,
        max_total_queries=3,
        max_evidence=10,
    )

    result = await service.search(query="为浴血黑帮挑选海报和主题曲")

    assert retrieval.calls[0]["routing_hints"]["explored_kb_counts"] == {}
    assert retrieval.calls[1]["routing_hints"]["agent_round"] == 2
    assert retrieval.calls[1]["routing_hints"]["explored_kb_counts"] == {"kb-1": 1}
    assert result.retrieval_result.debug_info["agent"]["explored_knowledge_bases"] == [
        {"id": "kb-1", "name": "Agent 设计知识库", "rounds": 2}
    ]


@pytest.mark.asyncio
async def test_agent_adds_visual_coverage_query_from_original_question_requirement():
    retrieval = _VisualRequirementRetrieval()
    service = AgenticRetrievalService(
        retrieval,
        planner=_FakePlanner(
            [
                AgentDecision("search", "先查地点文本", ["阿凡达经典取景地"]),
                AgentDecision("final", "证据完整"),
            ]
        ),
        max_rounds=2,
        max_queries_per_round=3,
        max_total_queries=4,
        max_evidence=10,
    )

    result = await service.search(query="阿凡达的经典取景地在哪里？")

    assert any("图片与相关视觉素材" in call["query"] for call in retrieval.calls)
    assert any(
        item["content_type"] == "image"
        for item in result.retrieval_result.reranked_results
    )
    assert result.retrieval_result.debug_info["agent"]["modality_requirements"]["image"] in {
        "implicit_enrichment",
        "explicit_demand",
    }
    assert retrieval.calls[0]["routing_hints"]["agent_base_modality_intents"]["image"] == "implicit_enrichment"


@pytest.mark.asyncio
async def test_agent_keeps_direct_original_query_evidence_ahead_of_planner_drift():
    retrieval = _OriginalQueryAnchorRetrieval()
    service = AgenticRetrievalService(
        retrieval,
        planner=_FakePlanner(
            [
                AgentDecision("search", "先查泛化子问题", ["泛化子查询"]),
                AgentDecision("final", "完成"),
            ]
        ),
        max_rounds=2,
        max_queries_per_round=1,
        max_total_queries=2,
        max_evidence=4,
    )

    result = await service.search(query="原问题")
    rows = result.retrieval_result.reranked_results

    assert rows[0]["id"] == "original-query-answer"
    assert rows[0]["metadata"]["agent_original_query_anchor"] is True
    assert any(row["id"] == "planner-drift" for row in rows)
    anchor_call = next(
        call for call in retrieval.calls if call.get("preprocessing_result")
    )
    assert anchor_call["query"] == "原问题"
    assert anchor_call["preplanned"] is False
    assert anchor_call["routing_hints"] == {}
    assert result.retrieval_result.debug_info["agent"]["original_query_anchor"] == {
        "enabled": True,
        "available_evidence_count": 1,
        "reserved_evidence_count": 1,
    }


@pytest.mark.asyncio
async def test_agent_plans_from_focused_original_anchor_before_expanding():
    retrieval = _FocusedOriginalQueryAnchorRetrieval()
    planner = _RecordingPlanner(
        [
            AgentDecision(
                "search",
                "仅补充时间线细节",
                [
                    "Harness System 发展历程 关键里程碑",
                    "Harness System 发展图片",
                    "Safety harness 与 climbing harness 发展历史",
                ],
            ),
            AgentDecision("final", "锚点与补充证据已足够"),
        ]
    )
    service = AgenticRetrievalService(
        retrieval,
        planner=planner,
        max_rounds=2,
        max_queries_per_round=3,
        max_total_queries=4,
        max_evidence=10,
    )

    result = await service.search(query="Harness System 的发展历程")

    assert "Harness System 的发展历程与版本演进" in planner.calls[0]["evidence_digest"]
    assert planner.calls[0]["anchor_knowledge_bases"] == [
        {"id": "kb-1", "name": "Agent 设计知识库", "score": 0.9}
    ]
    assert planner.calls[0]["max_queries"] == 1
    assert result.executed_queries == ["Harness System 发展历程 关键里程碑"]
    assert not any("Safety harness" in call["query"] for call in retrieval.calls)


@pytest.mark.asyncio
async def test_agent_can_finish_from_a_sufficient_original_query_anchor():
    retrieval = _FocusedOriginalQueryAnchorRetrieval()
    planner = _RecordingPlanner([AgentDecision("final", "直接证据已覆盖问题")])
    service = AgenticRetrievalService(
        retrieval,
        planner=planner,
        max_rounds=2,
        max_queries_per_round=3,
        max_total_queries=4,
        max_evidence=10,
    )

    result = await service.search(query="Harness System 的发展历程")

    assert result.stop_reason == "evidence_sufficient"
    assert result.executed_queries == []
    assert len(retrieval.calls) == 1
    assert result.retrieval_result.reranked_results[0]["id"] == "direct-0"
    assert "Harness System 的发展历程与版本演进" in planner.calls[0]["evidence_digest"]


def test_agent_merge_reserves_low_ranked_images_when_visual_evidence_is_required():
    document_rows = [
        {
            "id": f"doc-{index}",
            "content_type": "doc",
            "final_score": 0.99 - index / 100,
            "payload": {"text_content": f"文本证据 {index}"},
        }
        for index in range(10)
    ]
    image_rows = [
        {
            "id": f"image-{index}",
            "content_type": "image",
            "final_score": 0.2 - index / 100,
            "payload": {"caption": f"图片证据 {index}"},
        }
        for index in range(4)
    ]
    merged = _merge_retrieval_results(
        original_query="介绍阿凡达取景地",
        retrieval_results=[_retrieval_result("阿凡达", document_rows + image_rows)],
        trace=[],
        executed_queries=["阿凡达", "阿凡达 图片"],
        max_evidence=5,
        modality_requirements={"image": "implicit_enrichment"},
    )

    assert len(merged.reranked_results) == 5
    assert sum(item["content_type"] == "image" for item in merged.reranked_results) == 4


def test_agent_merge_reserves_original_query_anchor_even_when_agent_scores_higher():
    original = _retrieval_result(
        "原问题",
        [
            {
                "id": "direct-answer",
                "content_type": "doc",
                "final_score": 0.05,
                "payload": {"text_content": "原问题答案"},
            }
        ],
    )
    agent = _retrieval_result(
        "发散子问题",
        [
            {
                "id": f"generic-{index}",
                "content_type": "doc",
                "final_score": 0.99 - index / 100,
                "payload": {"text_content": f"泛化材料 {index}"},
            }
            for index in range(5)
        ],
    )

    merged = _merge_retrieval_results(
        original_query="原问题",
        retrieval_results=[original, agent],
        trace=[],
        executed_queries=["发散子问题"],
        max_evidence=4,
        original_query_anchor_count=1,
    )

    assert merged.reranked_results[0]["id"] == "direct-answer"
    assert merged.reranked_results[0]["metadata"]["agent_original_query_anchor"] is True


@pytest.mark.asyncio
async def test_context_builder_keeps_original_query_anchor_when_document_budget_is_full():
    """A low-scoring direct answer must survive Agent's high-score drift rows."""
    drift_rows = [
        {
            "id": f"drift-{index}",
            "content_type": "doc",
            "final_score": 0.99 - index * 0.01,
            "payload": {"text_content": f"泛化材料 {index}", "kb_id": "kb-1"},
            "metadata": {"agent_original_query_anchor": False},
        }
        for index in range(16)
    ]
    anchor_row = {
        "id": "direct-answer",
        "content_type": "doc",
        "final_score": 0.10,
        "payload": {"text_content": "原问题的直接答案", "kb_id": "kb-1"},
        "metadata": {"agent_original_query_anchor": True},
    }
    retrieval = SimpleNamespace(
        context=SimpleNamespace(visual_intent="unnecessary"),
        reranked_results=[*drift_rows, anchor_row],
    )

    processed = await ContextBuilder()._process_retrieval_results(retrieval)

    assert len([row for row in processed if row["content_type"] == "doc"]) == 15
    assert processed[0]["id"] == "direct-answer"
    assert any(row["id"] == "direct-answer" for row in processed)


def test_explicit_original_modality_requirement_is_preserved_on_text_subquery():
    preprocessing_result = {
        "visual_intent": "unnecessary",
        "visual_reasoning": "子查询中没有图片关键词",
        "audio_intent": "unnecessary",
        "audio_reasoning": "",
        "video_intent": "unnecessary",
        "video_reasoning": "",
    }

    updated = _apply_agent_base_modality_intents(
        preprocessing_result,
        {"image": "explicit_demand"},
    )

    assert updated["visual_intent"] == "explicit_demand"
    assert updated["visual_reasoning"] == "继承原始问题的明确模态需求"


@pytest.mark.asyncio
async def test_agent_preflight_uses_original_question_multimodal_intent():
    class _IntentProcessor:
        async def process(self, **_kwargs):
            return {
                "visual_intent": "implicit_enrichment",
                "audio_intent": "unnecessary",
                "video_intent": "unnecessary",
            }

    retrieval = RetrievalService.__new__(RetrievalService)
    retrieval.intent_processor = _IntentProcessor()

    requirements = await retrieval.get_agent_modality_requirements(
        query="阿凡达的经典取景地在哪里？",
    )

    assert requirements == {
        "image": "implicit_enrichment",
        "audio": "unnecessary",
        "video": "unnecessary",
    }
