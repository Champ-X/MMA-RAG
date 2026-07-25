from types import SimpleNamespace

import pytest

from app.modules.agent.models import AgentDecision
from app.modules.agent.planner import parse_planner_decision
from app.modules.agent.service import AgenticRetrievalService
from app.modules.retrieval.service import RetrievalResult


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


class _FakePlanner:
    def __init__(self, decisions):
        self.decisions = list(decisions)

    async def decide(self, **_kwargs):
        return self.decisions.pop(0) if self.decisions else AgentDecision("final")


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
