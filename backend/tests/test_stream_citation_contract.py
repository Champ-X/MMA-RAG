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
async def test_preloaded_citations_survive_generation_service_http_and_history(monkeypatch, mode, interrupt):
    source = ReferenceMap("1", "doc", "documents/guide.pdf", "注册步骤",
                          {"kb_id": "kb-one", "chunk_id": "chunk-one"})
    picture = ReferenceMap("2", "image", "images/login.jpg", "注册页面",
                           {"kb_id": "kb-one"}, "https://example.test/login.jpg")
    built = SimpleNamespace(context_string="context", reference_map={"1": source, "2": picture},
                            total_chunks=1, total_images=1)
    builder = ContextBuilder.__new__(ContextBuilder)
    builder.build_context = AsyncMock(return_value=built)
    builder.formatter = SimpleNamespace(format_user_query=lambda **kw: "context and question")
    service = GenerationService.__new__(GenerationService)
    service.context_builder = builder  # actual validate_references; no empty-reference test stub
    service.prompt_manager = SimpleNamespace(build_system_prompt=lambda *args: "system")
    service.stream_manager = StreamManager()

    async def stream_chat(**kwargs):
        yield "注册步骤 [1]。"
        yield "如图 [2] 所示。"
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
        assert types.count("citation") == 1
        assert types.index("citation") < types.index("message")
        refs = next(event["data"]["references"] for event in events if event["type"] == "citation")
        assert [ref["id"] for ref in refs] == [1, 2]
        assert refs[0]["debug_info"] == {"kb_id": "kb-one", "chunk_id": "chunk-one"}
        assert refs[1]["img_url"] == picture.presigned_url
        assert refs[1]["file_path"] == "images/login.jpg"
        if interrupt:
            assert types[-1] == "error"
            assert "complete" not in types
            audit.assert_not_awaited()
        else:
            assert types[-1] == "complete"
            history = (await client.get("/api/chat/history", params={"sessionId": "citation-contract"})).json()
            assert history["messages"][-1]["citations"] == refs
            audit.assert_awaited_once()
