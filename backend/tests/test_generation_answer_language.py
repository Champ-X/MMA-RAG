"""Answer-language preferences reach the model independently of evidence/history."""

import asyncio
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.prompt_language import get_prompt_language, prompt_language
from app.modules.generation.context_builder import ContextBuilder
from app.modules.generation.service import GenerationService
from app.modules.generation.stream_manager import StreamEventType, StreamManager
from app.modules.generation.templates.answer_language import ANSWER_LANGUAGE_EN, ANSWER_LANGUAGE_ZH
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
from app.modules.generation.templates.system_prompts import SystemPromptManager


@pytest.mark.parametrize("language,contract", [("en-US", ANSWER_LANGUAGE_EN), ("zh-CN", ANSWER_LANGUAGE_ZH)])
@pytest.mark.parametrize("intent", ["factual", "analysis", "comparison", "coding", "creative", "agentic"])
def test_answer_language_contract_survives_all_prompt_paths(language, contract, intent):
    manager = SystemPromptManager()
    with prompt_language(language):
        prompts = manager.get_prompt_variants(intent)
        prompts += [manager._get_fallback_prompt(), manager.optimize_prompt_for_length(manager.build_system_prompt(intent), 1)]
        prompts += [MultiModalFormatter().format_system_instructions(kind) for kind in ("general", "analysis", "comparison")]
    for prompt in prompts:
        assert contract in prompt
        if language == "en-US":
            assert "translate descriptions, labels and descriptive phrases into this turn's answer language" in prompt
            assert "Preserve original filenames, work titles, necessary verbatim quotations, code and `[id]` citation IDs" in prompt
            assert not re.search(r"[\u4e00-\u9fff]", prompt)
        else:
            assert "将描述、标签和形容性短语译成本轮回答语言" in prompt
            assert "保留原始文件名、作品名、必要的原文引用、代码和 `[id]` 引用编号" in prompt


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_shared_generation_service_isolates_answer_language_and_preserves_evidence(monkeypatch, stream):
    service = GenerationService.__new__(GenerationService)
    # Chinese source/filename and old Chinese answer must not override English preference.
    source = '[Material 1] (Type: Document | Source: 浴血黑帮.md)\n原文：海报有深色的工业背景。'
    built = SimpleNamespace(context_string=source, reference_map={}, total_chunks=1, total_images=0)
    builder = ContextBuilder.__new__(ContextBuilder)
    builder.build_context = AsyncMock(return_value=built)
    builder.formatter = MultiModalFormatter()
    service.context_builder = builder
    service.prompt_manager = SystemPromptManager()
    service.stream_manager = StreamManager()
    calls = []

    async def capture(messages):
        language = get_prompt_language()
        await asyncio.sleep(.001)
        assert get_prompt_language() == language
        calls.append((language, messages))

    async def chat(**kwargs):
        await capture(kwargs["messages"])
        return SimpleNamespace(success=True, model_used="test", duration=.1,
                               data={"choices": [{"message": {"content": "answer"}}]})

    async def stream_chat(**kwargs):
        await capture(kwargs["messages"])
        yield "answer"

    service.llm_manager = SimpleNamespace(chat=chat, stream_chat=stream_chat,
                                         registry=SimpleNamespace(get_task_model=lambda task: "test"))
    monkeypatch.setattr("app.modules.generation.service.maybe_audit_answer", AsyncMock(return_value=None))
    history = [{"role": "user", "content": "上一次问题"},
               {"role": "assistant", "content": "上一次中文回答。"}]

    async def run(language, query):
        with prompt_language(language):
            arguments = dict(query=query, retrieval_result=SimpleNamespace(context=SimpleNamespace(intent_type="creative")),
                             session_id=language + query, session_context=history)
            if stream:
                events = [event async for event in service.stream_generate_response(**arguments)]
                assert events[-1].type == StreamEventType.DONE
            else:
                result = await service.generate_response(**arguments)
                assert result["success"]

    queries = [
        ("en-US", 'Based on the plot of "Blood Oath", select a poster and theme song.'),
        ("en-US", '请用中文推荐 "Blood Oath" 的海报与主题曲。'),
        ("zh-CN", "Please answer in English: recommend a poster and theme song."),
        ("zh-CN", "推荐海报和主题曲。"),
    ]
    await asyncio.gather(*(run(language, query) for language, query in queries))
    assert len(calls) == len(queries)
    for language, messages in calls:
        contract = ANSWER_LANGUAGE_EN if language == "en-US" else ANSWER_LANGUAGE_ZH
        assert contract in messages[0]["content"]
        assert messages[1:-1] == history
        assert source in messages[-1]["content"]
        query = next(query for code, query in queries if code == language and query in messages[-1]["content"])
        assert messages[-1]["content"].endswith(query)
    assert get_prompt_language() == "zh-CN"
