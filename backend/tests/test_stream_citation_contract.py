"""Exercise HTTP -> GenerationService -> StreamManager, including stored history."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api import chat
from app.modules.generation.context_builder import ContextBuilder, ReferenceMap
from app.modules.generation.service import GenerationService
from app.modules.generation.stream_manager import StreamManager


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["direct", "agent"])
@pytest.mark.parametrize("interrupt", [False, True])
@pytest.mark.parametrize("answer,used_ids", [
    ("注册步骤 [1]。如图 [2] 所示。", [1, 2]),
    ("知识库中未找到相关内容。", []),
    ("注册步骤 [1]。关于费用，知识库中未找到相关内容。", [1]),
    ("视频片段 [4]，音频说明 [3]。", [4, 3]),
    ("无法确定相关歌曲。", []),
])
async def test_preloaded_candidates_are_finalized_before_completion_and_history(
    monkeypatch, mode, interrupt, answer, used_ids,
):
    source = ReferenceMap("1", "doc", "documents/guide.pdf", "注册步骤",
                          {"kb_id": "kb-one", "chunk_id": "chunk-one"})
    picture = ReferenceMap("2", "image", "images/login.jpg", "注册页面",
                           {"kb_id": "kb-one"}, "https://example.test/login.jpg")
    audio = ReferenceMap("3", "audio", "audio/guide.mp3", "语音说明",
                         {"kb_id": "kb-one"}, "https://example.test/guide.mp3")
    video = ReferenceMap("4", "video", "videos/guide.mp4", "视频说明",
                         {"kb_id": "kb-one", "shot_start_time": 12, "shot_end_time": 24},
                         "https://example.test/guide.mp4")
    built = SimpleNamespace(context_string="context", reference_map={
                                "1": source, "2": picture, "3": audio, "4": video},
                            total_chunks=1, total_images=1)
    builder = ContextBuilder.__new__(ContextBuilder)
    builder.build_context = AsyncMock(return_value=built)
    builder.formatter = SimpleNamespace(format_user_query=lambda **kw: "context and question")
    service = GenerationService.__new__(GenerationService)
    service.context_builder = builder  # actual validate_references; no empty-reference test stub
    service.prompt_manager = SimpleNamespace(build_system_prompt=lambda *args: "system")
    service.stream_manager = StreamManager()

    async def stream_chat(**kwargs):
        midpoint = len(answer) // 2
        yield answer[:midpoint]
        yield answer[midpoint:]
        if interrupt:
            raise RuntimeError("provider interrupted")

    service.llm_manager = SimpleNamespace(stream_chat=stream_chat,
                                         registry=SimpleNamespace(get_task_model=lambda task: "test"))
    retrieval = SimpleNamespace(context=SimpleNamespace(intent_type="factual"))

    async def search_stream(**kwargs):
        yield "_result", retrieval

    async def agent_stream(**kwargs):
        yield "_result", SimpleNamespace(retrieval_result=retrieval, metadata=lambda: {"enabled": True})

    monkeypatch.setattr(chat, "sessions", {})
    monkeypatch.setattr(chat, "generation_service", service)
    monkeypatch.setattr(chat, "retrieval_service", SimpleNamespace(search_stream=search_stream))
    monkeypatch.setattr(chat, "agentic_retrieval_service", SimpleNamespace(search_stream=agent_stream))
    audit = AsyncMock(return_value=None)
    monkeypatch.setattr("app.modules.generation.service.maybe_audit_answer", audit)
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/chat/stream", params={
            "message": "注册步骤及截图", "sessionId": "citation-contract", "agentMode": mode,
        })
        import json
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
        types = [event["type"] for event in events]
        assert types.count("citation") == (1 if interrupt else 2)
        assert types.index("citation") < types.index("message")
        refs = next(event["data"]["references"] for event in events if event["type"] == "citation")
        assert [ref["id"] for ref in refs] == [1, 2, 3, 4]
        assert refs[0]["debug_info"] == {"kb_id": "kb-one", "chunk_id": "chunk-one"}
        assert refs[1]["img_url"] == picture.presigned_url
        assert refs[1]["file_path"] == "images/login.jpg"
        if interrupt:
            assert types[-1] == "error"
            assert "complete" not in types
            audit.assert_not_awaited()
        else:
            assert types[-1] == "complete"
            final = [event["data"] for event in events if event["type"] == "citation"][-1]
            assert final["replace"] is True
            assert [ref["id"] for ref in final["references"]] == used_ids
            assert types.index("message") < len(types) - 1 - types[::-1].index("citation")
            history = (await client.get("/api/chat/history", params={"sessionId": "citation-contract"})).json()
            assert history["messages"][-1]["citations"] == final["references"]
            assert chat.sessions["citation-contract"]["messages"][-1]["citations"] == final["references"]
            if 4 in used_ids:
                saved_video = next(ref for ref in final["references"] if ref["id"] == 4)
                assert saved_video["start_sec"] == 12
                assert saved_video["end_sec"] == 24
                assert saved_video["video_url"] == video.presigned_url
            audit.assert_awaited_once()


@pytest.mark.asyncio
async def test_legacy_history_filters_candidates_without_mutating_stored_messages(monkeypatch):
    references = [{"id": 1, "type": "doc"}, {"id": 2, "type": "audio"}, {"id": 3, "type": "video"}]
    messages = [
        {"role": "user", "content": "问题"},
        {"role": "assistant", "content": "知识库中未找到相关内容。", "citations": references},
        {"role": "assistant", "content": "有部分资料。[1] 其他问题未找到相关内容。", "citations": references},
        {"role": "assistant", "content": "相关视频〔3〕和音频【2】。", "citations": references},
    ]
    monkeypatch.setattr(chat, "sessions", {"old": {"messages": messages}})
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        history = (await client.get("/api/chat/history", params={"sessionId": "old"})).json()
    assert history["messages"][0] == messages[0]
    assert [message["citations"] for message in history["messages"][1:]] == [
        [], [references[0]], [references[2], references[1]],
    ]
    assert all(message["citations"] is references for message in messages[1:])
