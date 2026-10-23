"""Online language selection is isolated, lazy-stream safe and source preserving."""
import asyncio
import json
import re
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from app.core.prompt_language import get_prompt_language, language_stream, localized, normalize_language, prompt_language
from app.core.llm.prompt import TEMPLATES as ZH_TEMPLATES
from app.core.llm.online_prompts_en import TEMPLATES as EN_TEMPLATES
from app.core.llm.prompt_engine import PromptEngine
from app.modules.generation.templates.system_prompts import SystemPromptManager
from app.modules.generation.templates.system_prompts_en import ANSWER_SCOPE_INSTRUCTIONS
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter


@pytest.mark.asyncio
async def test_context_is_request_scoped_and_propagates_to_child_work():
    assert normalize_language(None) == normalize_language("fr-FR") == "zh-CN"
    assert normalize_language("en-US") == "en-US"

    async def run(language):
        with prompt_language(language):
            await asyncio.sleep(0)
            observed = await asyncio.to_thread(get_prompt_language)
            assert observed == language
            with prompt_language("unknown"):
                assert get_prompt_language() == "zh-CN"
            await asyncio.sleep(0)
            return localized("中文", "English")

    assert await asyncio.gather(run("en-US"), run("zh-CN")) == ["English", "中文"]
    assert get_prompt_language() == "zh-CN"


@pytest.mark.asyncio
async def test_lazy_stream_context_does_not_escape_yield_and_covers_cleanup():
    cleanup = []

    async def source():
        try:
            await asyncio.sleep(0)
            yield get_prompt_language()
            await asyncio.sleep(0)
            yield get_prompt_language()
        finally:
            cleanup.append(get_prompt_language())

    en = language_stream(source(), "en-US")
    zh = language_stream(source(), "zh-CN")
    assert await anext(en) == "en-US"
    assert get_prompt_language() == "zh-CN"
    assert await anext(zh) == "zh-CN"
    assert await anext(en) == "en-US"
    await en.aclose()
    await zh.aclose()
    assert cleanup == ["en-US", "zh-CN"]
    assert get_prompt_language() == "zh-CN"


@pytest.mark.asyncio
async def test_stream_cancellation_restores_context():
    entered = asyncio.Event()
    cleanup = []

    async def source():
        try:
            entered.set()
            await asyncio.Event().wait()
            yield "unreachable"
        finally:
            cleanup.append(get_prompt_language())

    stream = language_stream(source(), "en-US")
    task = asyncio.create_task(anext(stream))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cleanup == ["en-US"]
    assert get_prompt_language() == "zh-CN"


def test_online_catalog_contracts_and_ingestion_are_unchanged():
    engine = PromptEngine()
    placeholders = lambda value: set(re.findall(r"(?<!\{)\{([a-z_]+)\}(?!\})", value))
    fields = lambda value: set(re.findall(r'"([a-z_]+)"\s*:', value))
    for key, english in EN_TEMPLATES.items():
        assert placeholders(english) == placeholders(ZH_TEMPLATES[key]), key
        assert fields(english) == fields(ZH_TEMPLATES[key]), key
        with prompt_language("en-US"):
            assert engine.get_template(key) == english
        assert engine.get_template(key) == ZH_TEMPLATES[key]
    with prompt_language("en-US"):
        for key in set(ZH_TEMPLATES) - set(EN_TEMPLATES):
            assert engine.get_template(key) == ZH_TEMPLATES[key]


def test_placeholder_spelling_in_source_is_not_interpolated_or_translated():
    engine = PromptEngine()
    user = '原始 query {attachment_context_block} {chat_history} [3] "quoted"'
    material = '来源原文 {raw_query} {chat_history} 中文内容'
    with prompt_language("en-US"):
        result = engine.render_template("one_pass_intent", chat_history="HISTORY",
                                        raw_query=user, attachment_context_block=material)
    assert user in result and material in result
    assert "Latest input: " + user in result


def test_shared_generation_objects_select_language_at_call_time():
    manager, formatter = SystemPromptManager(), MultiModalFormatter()
    source, query = '原文 Source [2] {caption}', '用中文解释这段文本 {content}'
    with prompt_language("en-US"):
        for intent in ("factual", "analysis", "comparison", "coding", "creative", "agentic"):
            for result in manager.get_prompt_variants(intent):
                assert ANSWER_SCOPE_INSTRUCTIONS in result
            assert ANSWER_SCOPE_INSTRUCTIONS in manager.optimize_prompt_for_length(manager.build_system_prompt(intent), 1)
        # Translating instructions does not silently change the existing response rule.
        assert "知识库中未找到相关内容" in manager.build_system_prompt()
        assert formatter.format_document_chunk("7", source, "原始文件.md", {}) == (
            "[Material 7] (Type: Document | Source: 原始文件.md)\nContent excerpt:\n" + formatter._clean_content(source))
        wrapped = formatter.format_user_query(query, source)
        assert query in wrapped and source in wrapped and "User question:" in wrapped
    assert "# 角色设定" in manager.build_system_prompt()
    assert "【材料 7】" in formatter.format_document_chunk("7", source, "原始文件.md", {})


@pytest.mark.asyncio
async def test_model_facing_intent_rewrite_and_planner_messages_switch_without_translating_input():
    from app.modules.retrieval.processors.intent import IntentProcessor
    from app.modules.retrieval.processors.rewriter import QueryRewriter
    from app.modules.agent.planner import AgentPlanner
    calls = []
    payload = {"intent_type": "factual", "is_complex": False, "visual_intent": "unnecessary",
               "audio_intent": "unnecessary", "video_intent": "unnecessary", "search_strategies": {},
               "refined_query": "original", "multi_view_queries": [], "keywords": ["a", "b", "c"],
               "action": "final", "reason": "enough", "queries": []}

    async def chat(**kwargs):
        await asyncio.sleep(0)
        calls.append(kwargs)
        return SimpleNamespace(success=True, data={"choices": [{"message": {"content": json.dumps(payload)}}]})

    manager = SimpleNamespace(chat=chat)
    intent, rewriter = IntentProcessor(), QueryRewriter()
    intent.llm_manager = rewriter.llm_manager = manager
    query = "保留原始 query 数字 123 [2]"
    source = "来源原文，不得翻译"
    with prompt_language("en-US"):
        await intent._process_generative(query, attachment_context_block=source, include_source_proposals=True)
        await rewriter.rewrite(query)
        await AgentPlanner(manager).decide(query=query, evidence_digest=source, executed_queries=[],
                                          round_number=1, max_rounds=3, max_queries=3)
    assert len(calls) == 3
    for call in calls:
        system, user = call["messages"]
        assert system["content"].startswith("You are ")
        assert query in user["content"]
    assert source in calls[0]["messages"][1]["content"]
    assert "Add source_proposals" in calls[0]["messages"][1]["content"]
    assert source in calls[2]["messages"][1]["content"]


@pytest.mark.asyncio
async def test_attachment_model_inputs_localize_wrappers_but_preserve_query_and_filenames(monkeypatch):
    from app.modules.chat import attachment_summarizer as attachments
    calls = []
    query = "保留用户问题 {user_message} [3]"
    filenames = ["原始图片.png", "原始音频.wav", "原始视频.mp4"]

    async def chat(**kwargs):
        calls.append(kwargs["messages"][0]["content"])
        return SimpleNamespace(success=True, data={"choices": [{"message": {"content": "模型观察原文"}}]})

    monkeypatch.setattr(attachments, "llm_manager", SimpleNamespace(chat=chat))
    monkeypatch.setattr(attachments, "inspect_attachment_media", lambda raw, kind: {"kind": kind, "source": "原始测量来源"})
    monkeypatch.setattr(attachments, "audio_input_format", lambda raw: "wav")
    monkeypatch.setattr(attachments, "validate_audio_observation", lambda *args: None)
    monkeypatch.setattr(attachments, "sample_video", lambda raw, info: ([(0, b"frame")], None))
    files = [(filenames[0], "image/png", b"\x89PNG\r\n\x1a\n1234"),
             (filenames[1], "audio/wav", b"RIFF1234WAVE"),
             (filenames[2], "video/mp4", b"1234ftyp1234")]
    with prompt_language("en-US"):
        block, items = await attachments.summarize_chat_attachments(user_message=query, files=files)
    assert len(calls) == 3
    for content in calls:
        text = "\n".join(part["text"] for part in content if part["type"] == "text")
        assert "Currently parsing: local attachment A" in text
        assert "Measured information about this file" in text
        assert query in text and "原始测量来源" in text
        assert sum(filename in text for filename in filenames) == 1
        app_text = text.replace(query, "").replace("原始测量来源", "")
        for filename in filenames:
            app_text = app_text.replace(filename, "")
        assert not re.search(r"[\u4e00-\u9fff]", app_text)
    assert [item["filename"] for item in items] == filenames
    assert all(item["status"] == "ready" for item in items)
    assert all(filename in block for filename in filenames)
    assert "模型观察原文" in block
    calls.clear()
    await attachments.summarize_chat_attachments(user_message=query, files=files[:1])
    text = next(part["text"] for part in calls[0] if part["type"] == "text")
    assert "当前正在解析：本机附件A1" in text and "本文件的实测信息" in text
    assert query in text and filenames[0] in text


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["direct", "agent"])
async def test_parallel_json_get_and_multipart_requests_keep_language_through_generation(monkeypatch, mode):
    from app.api import chat
    seen = []
    monkeypatch.setattr(chat, "sessions", {})
    result = SimpleNamespace(context=SimpleNamespace(intent_type="factual"), processing_time=.1, debug_info={})

    async def observe(stage, query):
        before = get_prompt_language()
        await asyncio.sleep(.001)
        assert get_prompt_language() == before
        seen.append((stage, query, before))

    async def search(**kwargs):
        await observe("retrieval", kwargs["query"])
        return result

    async def search_stream(**kwargs):
        await observe("retrieval", kwargs["query"])
        yield "intent", {"stage_status": "completed"}
        await asyncio.sleep(.001)
        yield "_result", result

    async def agent_search(**kwargs):
        return SimpleNamespace(retrieval_result=await search(**kwargs), metadata=lambda: {"enabled": True})

    async def agent_stream(**kwargs):
        async for stage, item in search_stream(**kwargs):
            yield stage, SimpleNamespace(retrieval_result=item, metadata=lambda: {"enabled": True}) if stage == "_result" else item

    async def generation(**kwargs):
        await observe("generation", kwargs["query"])
        return {"success": True, "answer": "answer", "references_used": [], "metadata": {}}

    async def generation_stream(**kwargs):
        await observe("generation", kwargs["query"])
        yield SimpleNamespace(type="message", data={"content": "answer"})
        await asyncio.sleep(.001)
        yield SimpleNamespace(type="done", data={})

    async def attachments(*, user_message, files):
        await observe("attachment", user_message)
        return "SOURCE 原文", [{"filename": files[0][0], "modality": "image", "status": "ready", "summary": "SOURCE 原文", "media_info": {}}]

    monkeypatch.setattr(chat, "retrieval_service", SimpleNamespace(search=search, search_stream=search_stream))
    monkeypatch.setattr(chat, "agentic_retrieval_service", SimpleNamespace(search=agent_search, search_stream=agent_stream))
    monkeypatch.setattr(chat, "generation_service", SimpleNamespace(generate_response=generation, stream_generate_response=generation_stream))
    monkeypatch.setattr(chat, "summarize_chat_attachments", attachments)
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        async def send(transport, language):
            query = f"原始 query {transport}/{language}"
            fields = {"message": query, "sessionId": query, "agentMode": mode}
            if language is not None:
                fields["language"] = language
            if transport == "json":
                response = await client.post("/api/chat/message", json=fields)
                assert response.status_code == 200 and response.json()["success"]
            else:
                response = (await client.get("/api/chat/stream", params=fields) if transport == "get" else
                            await client.post("/api/chat/stream", data=fields, files=[("files", ("原图.png", b"fake-image", "image/png"))]))
                events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
                assert events[-1]["type"] == "complete", events
            expected = language or "zh-CN"
            assert ("retrieval", query, expected) in seen
            assert ("generation", query, expected) in seen
            if transport == "multipart":
                assert ("attachment", query, expected) in seen
        await asyncio.gather(*(send(transport, language) for transport in ("json", "get", "multipart") for language in ("en-US", "zh-CN", None)))
    assert get_prompt_language() == "zh-CN"


@pytest.mark.asyncio
async def test_multipart_validation_uses_language_before_stream_begins():
    from app.api import chat
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    uploads = [("files", (f"{index}.png", b"image", "image/png")) for index in range(chat.MAX_ATTACHMENTS + 1)]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/chat/stream", data={"language": "en-US"}, files=uploads)
    assert response.status_code == 400
    assert response.json()["detail"] == f"At most {chat.MAX_ATTACHMENTS} attachments are allowed"
    assert get_prompt_language() == "zh-CN"


@pytest.mark.asyncio
@pytest.mark.parametrize("body_language,header,expected", [(None, None, "zh-CN"), (None, "en-US", "en-US"), ("zh-CN", "en-US", "zh-CN"), ("en-US", "zh-CN", "en-US")])
async def test_json_chat_language_header_fallback(monkeypatch, body_language, header, expected):
    from app.api import chat
    observed = []

    async def message(data):
        await asyncio.sleep(0)
        observed.append((data["message"], get_prompt_language()))
        return {"success": True}

    monkeypatch.setattr(chat, "_chat_message", message)
    app = FastAPI()
    app.include_router(chat.router, prefix="/api/chat")
    fields = {"message": "原始中文 query"}
    if body_language is not None:
        fields["language"] = body_language
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/chat/message", json=fields,
                                     headers={"X-Tessmora-Language": header} if header else {})
    assert response.status_code == 200
    assert observed == [(fields["message"], expected)]
    assert get_prompt_language() == "zh-CN"


@pytest.mark.asyncio
@pytest.mark.parametrize("body_language,header,expected", [(None, None, "zh-CN"), (None, "en-US", "en-US"), ("zh-CN", "en-US", "zh-CN"), ("en-US", "zh-CN", "en-US")])
async def test_retrieval_api_language_precedence(monkeypatch, body_language, header, expected):
    from app.api import retrieval
    observed = []
    async def search(**kwargs):
        await asyncio.sleep(0)
        observed.append((kwargs["query"], get_prompt_language()))
        return SimpleNamespace(context=SimpleNamespace(), reranked_results=[], processing_time=0)
    monkeypatch.setattr(retrieval, "retrieval_service", SimpleNamespace(search=search))
    app = FastAPI()
    app.include_router(retrieval.router, prefix="/api/retrieval")
    fields = {"query": "原始中文 query"}
    if body_language is not None:
        fields["language"] = body_language
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/retrieval/search", json=fields,
                                     headers={"X-Tessmora-Language": header} if header else {})
    assert response.status_code == 200
    assert observed == [(fields["query"], expected)]
