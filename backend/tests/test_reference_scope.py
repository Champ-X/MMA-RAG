"""Inline inputs must survive, while discovery searches may leave their source KBs."""
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api import chat
from app.modules.retrieval.reference_materials import (
    include_reference_materials, reference_materials_context, split_reference_scope,
)
from app.modules.retrieval.service import RetrievalService


SOURCE = dict(kb_id="music", file_id="song", name="曲子.mp3", type="mp3")
MENTION = dict(source="knowledge", kbId="music", fileId="song", name="曲子.mp3", start=0, end=7)
MATERIAL = dict(id="audio-point", content_type="audio", reference_name="曲子.mp3",
                metadata={"user_reference": True}, payload={
                    "kb_id": "music", "file_id": "song", "file_path": "audios/song.mp3", "description": "宁静的山水意境",
                })


def test_inline_sources_do_not_restrict_scope_but_explicit_overlaps_and_manual_kbs_do():
    assert split_reference_scope([], [SOURCE], [MENTION], []) == ([], [SOURCE], [])
    assert split_reference_scope([SOURCE], [SOURCE], [MENTION], ["music"]) == ([SOURCE], [SOURCE], ["music"])
    assert split_reference_scope([], [SOURCE], [MENTION], ["landscape"]) == ([], [SOURCE], ["landscape"])
    assert split_reference_scope([SOURCE], None, [MENTION], ["music"]) == ([], [SOURCE], [])
    pinned = dict(kb_id="landscape", file_id="garden", name="garden.png")
    assert split_reference_scope([SOURCE, pinned], None, [MENTION], ["music", "landscape"]) == ([pinned], [SOURCE], ["landscape"])
    assert split_reference_scope([SOURCE], None, [], ["music"]) == ([SOURCE], [], ["music"])


@pytest.mark.asyncio
async def test_reference_loading_uses_each_sources_own_kb_and_never_assigns_search_scores():
    service = RetrievalService.__new__(RetrievalService)
    service.kb_router = SimpleNamespace(resolve_to_qdrant_kb_ids=AsyncMock(side_effect=lambda ids: ["canonical-" + ids[0]]))
    calls = []
    async def load(files, ids):
        calls.append((files, ids))
        return [{**copy.deepcopy(MATERIAL), "id": files[0]["file_id"], "score": 1.5, "selected_file_boost": True}]
    service.search_engine = SimpleNamespace(_selected_file_bootstrap_search=load)
    files = [SOURCE, dict(kb_id="images", file_id="garden", name="garden.png", type="png")]
    materials = await service.load_reference_materials(files)
    assert calls == [([files[0]], ["canonical-music"]), ([files[1]], ["canonical-images"])]
    assert all("score" not in item and "selected_file_boost" not in item for item in materials)
    assert "宁静的山水意境" in reference_materials_context(materials)
    assert "不是检索范围限制" in reference_materials_context(materials)
    service.search_engine._selected_file_bootstrap_search = AsyncMock(return_value=[])
    with pytest.raises(ValueError, match="无法读取引用文件"):
        await service.load_reference_materials([SOURCE])


def test_bound_evidence_survives_ranking_without_duplicate_chunks_or_losing_discoveries():
    source = copy.deepcopy(MATERIAL)
    discovery = dict(id="garden", content_type="image", payload={"kb_id": "images"})
    result = SimpleNamespace(reranked_results=[discovery, {**copy.deepcopy(source), "final_score": .5}])
    include_reference_materials(result, [source])
    include_reference_materials(result, [source])
    assert [item["id"] for item in result.reranked_results] == ["audio-point", "garden"]
    assert result.reranked_results[0]["final_score"] == .5
    assert result.reranked_results[0]["metadata"]["user_reference"]
    assert "final_score" not in source


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["direct", "agent"])
@pytest.mark.parametrize("transport", ["get", "multipart", "json", "legacy"])
@pytest.mark.parametrize("restricted", [False, True])
async def test_reference_scope_reaches_search_generation_and_history(monkeypatch, mode, transport, restricted):
    calls = []
    result = SimpleNamespace(debug_info={}, reranked_results=[], processing_time=0,
                             context=SimpleNamespace(intent_type="factual", visual_intent="explicit_demand",
                                                     audio_intent="unnecessary", video_intent="explicit_demand", target_kb_ids=[]))
    loader = AsyncMock(return_value=[copy.deepcopy(MATERIAL)])
    async def search(**kwargs):
        calls.append(kwargs)
        return result
    async def stream(**kwargs):
        calls.append(kwargs)
        yield "_result", result
    async def agent_search(**kwargs):
        await search(**kwargs)
        return SimpleNamespace(retrieval_result=result, metadata=lambda: {})
    async def agent_stream(**kwargs):
        yield "_result", await agent_search(**kwargs)
    async def generate(**kwargs):
        assert kwargs["retrieval_result"].reranked_results[0]["id"] == "audio-point"
        return {"success": True, "answer": "来源 [1]", "references_used": []}
    async def stream_generate(**kwargs):
        await generate(**kwargs)
        yield SimpleNamespace(type="message", data={"content": "来源 [1]"})
        yield SimpleNamespace(type="done", data={})
    monkeypatch.setattr(chat, "sessions", {})
    monkeypatch.setattr(chat, "retrieval_service", SimpleNamespace(search=search, search_stream=stream, load_reference_materials=loader))
    monkeypatch.setattr(chat, "agentic_retrieval_service", SimpleNamespace(search=agent_search, search_stream=agent_stream))
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(generate_response=generate, stream_generate_response=stream_generate))
    pinned = dict(kb_id="images", file_id="garden", name="garden.png", type="png")
    data = {"message": "@曲子.mp3 找一张匹配图片和一段视频", "mentions": [MENTION], "referenceFiles": [SOURCE],
            "selectedFiles": [pinned] if restricted else [], "knowledgeBaseIds": ["images"] if restricted else [],
            "sessionId": "scope", "agentMode": mode}
    if transport == "legacy":
        data.pop("referenceFiles")
        data["selectedFiles"] = [SOURCE] + data["selectedFiles"]
        data["knowledgeBaseIds"] = ["music"] + data["knowledgeBaseIds"]
    app = FastAPI(); app.include_router(chat.router, prefix="/chat")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        if transport == "json":
            response = await client.post("/chat/message", json=data)
            assert response.status_code == 200, response.text
        else:
            fields = {key: (",".join(value) if key == "knowledgeBaseIds" else json.dumps(value)) if isinstance(value, list) else value for key, value in data.items()}
            response = await client.get("/chat/stream", params=fields) if transport == "get" else await client.post("/chat/stream", data=fields)
            events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
            assert events[-1]["type"] == "complete", events
    loader.assert_awaited_once_with([SOURCE])
    assert calls[0]["kb_context"]["kb_ids"] == (["images"] if restricted else [])
    assert calls[0]["kb_context"]["selected_files"] == ([pinned] if restricted else [])
    assert calls[0]["kb_context"]["reference_files"] == [SOURCE]
    assert "宁静的山水意境" in calls[0]["attachment_context"]
    saved = chat.sessions["scope"]["messages"][0]
    assert saved["scope_version"] == 2
    assert saved["selected_files"] == ([pinned] if restricted else [])
    assert saved["reference_files"] == [SOURCE]
