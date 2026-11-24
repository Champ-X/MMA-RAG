"""Physical page provenance survives retrieval, prompts, both transports and history."""
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api import chat
from app.core.prompt_language import prompt_language
from app.core.source_locators import source_locator_fields
from app.modules.generation.context_builder import ContextBuilder
from app.modules.generation.service import GenerationService
from app.modules.generation.stream_manager import StreamManager, _reference_map_to_frontend_refs
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter


def builder():
    result = ContextBuilder.__new__(ContextBuilder)
    result.max_context_length = 4000
    result.max_chunks = 15
    result.max_images = 5
    result.max_images_implicit = 6
    result.formatter = MultiModalFormatter()
    result.minio_adapter = SimpleNamespace(get_presigned_url=AsyncMock())
    return result


def retrieval(metadata):
    return SimpleNamespace(
        context=SimpleNamespace(intent_type="factual"), processing_time=.01,
        reranked_results=[{"id": "old-pdf-point", "content_type": "doc", "final_score": .9,
            "payload": {"kb_id": "kb-legacy", "file_id": "file-legacy", "file_path": "documents/manual.pdf",
                        "file_type": "pdf", "text_content": "Recovery code: CEDAR-17", "chunk_index": 0,
                        "metadata": metadata}}],
    )


@pytest.mark.parametrize("metadata,expected", [
    ({"page": 2}, {"page_number": 2}),
    ({"page": "1", "page_end": "2"}, {"page_number": 1, "page_end": 2}),
    ({"page_number": 7, "page_end": 7}, {"page_number": 7}),
    ({"page": 7, "page_end": 3}, {"page_number": 7}),
    ({"page": 0}, {}), ({"page": -1}, {}), ({"page": True}, {}),
    ({"page": 1.5}, {}), ({"page": "unknown"}, {}), ({"page_end": 9}, {}), ({}, {}),
])
def test_page_normalization_requires_observed_positive_start(metadata, expected):
    assert source_locator_fields({"metadata": metadata}) == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("metadata,label", [
    ({"page": 2}, "Page: 2"),
    ({"page": 1, "page_end": 2}, "Pages: 1–2"),
    ({}, "Page: unavailable"),
])
async def test_legacy_payload_keeps_exact_range_in_prompt_serializers_and_compression(metadata, label):
    source = retrieval(metadata)
    original = copy.deepcopy(source)
    context = builder()
    with prompt_language("en-US"):
        built = await context.build_context(source, "Which page contains the recovery code?")
        assert label in built.context_string
        assert "kb_id=kb-legacy" in built.context_string and "file_id=file-legacy" in built.context_string
        if "page_end" in metadata:
            assert "does not identify the exact page" in built.context_string
        context.max_context_length = 1
        assert label in await context._optimize_context_length(built.context_string, built.reference_map)
    expected = {"kb_id": "kb-legacy", "file_id": "file-legacy", **source_locator_fields(metadata)}
    for citation in (_reference_map_to_frontend_refs(built.reference_map)[0],
                     context.validate_references("CEDAR-17 [1]", built.reference_map)[0]):
        assert source_locator_fields(citation) == expected
        assert source_locator_fields(citation["debug_info"]) == expected
        assert citation["debug_info"]["chunk_id"] == "old-pdf-point"
        if not metadata:
            assert "page_number" not in citation and "page_end" not in citation
    assert source == original


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("metadata", [{"page": 2}, {"page": 1, "page_end": 2}, {}])
async def test_actual_http_generation_and_history_preserve_page_contract(monkeypatch, streaming, metadata):
    found = retrieval(metadata)
    service = GenerationService.__new__(GenerationService)
    service.context_builder = builder()
    service.prompt_manager = SimpleNamespace(build_system_prompt=lambda *args: "Answer from sources.")
    service.stream_manager = StreamManager()
    expected_label = "Pages: 1–2" if "page_end" in metadata else ("Page: 2" if metadata else "Page: unavailable")

    def check_prompt(kwargs):
        prompt = kwargs["messages"][-1]["content"]
        assert expected_label in prompt and "CEDAR-17" in prompt
        assert "file_id=file-legacy" in prompt and "kb_id=kb-legacy" in prompt

    async def completion(**kwargs):
        check_prompt(kwargs)
        return SimpleNamespace(success=True, model_used="synthetic", duration=0,
            data={"choices": [{"message": {"content": "CEDAR-17 [1]."}}]})

    async def tokens(**kwargs):
        check_prompt(kwargs)
        yield "CEDAR-17 [1]."

    async def search_stream(**kwargs):
        yield "_result", found

    service.llm_manager = SimpleNamespace(chat=completion, stream_chat=tokens,
        registry=SimpleNamespace(get_task_model=lambda task: "synthetic"))
    monkeypatch.setattr(chat, "sessions", {})
    monkeypatch.setattr(chat, "generation_service", service)
    monkeypatch.setattr(chat, "retrieval_service", SimpleNamespace(search=AsyncMock(return_value=found), search_stream=search_stream))
    monkeypatch.setattr("app.modules.generation.service.maybe_audit_answer", AsyncMock(return_value=None))
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    request = {"message": "Which page has the recovery code?", "sessionId": "pages", "agentMode": "direct", "language": "en-US"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        if streaming:
            response = await client.get("/api/chat/stream", params=request)
            events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
            assert events[-1]["type"] == "complete", events
            citations = [event["data"]["references"] for event in events if event["type"] == "citation"]
            assert len(citations) == 2
            assert citations[0] == citations[1]
            citation = citations[-1][0]
        else:
            response = await client.post("/api/chat/message", json=request)
            assert response.status_code == 200, response.text
            citation = response.json()["citations"][0]
        expected = {"kb_id": "kb-legacy", "file_id": "file-legacy", **source_locator_fields(metadata)}
        assert source_locator_fields(citation) == expected
        assert source_locator_fields(citation["debug_info"]) == expected
        assert citation["file_path"] == "documents/manual.pdf"
        history = (await client.get("/api/chat/history", params={"sessionId": "pages"})).json()
        assert history["messages"][-1]["citations"][0] == citation
