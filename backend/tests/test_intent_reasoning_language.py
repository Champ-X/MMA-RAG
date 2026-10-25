"""Application-owned intent explanations follow the request, preserving source text."""
import asyncio
import json
import re
from types import SimpleNamespace

import pytest

from app.core.prompt_language import get_prompt_language, prompt_language
from app.modules.retrieval.processors.intent import IntentProcessor
from app.modules.retrieval.processors.jev_intent import (
    classify_intent, merge_required_modalities,
)
from app.modules.retrieval.processors import decision_plan


def assert_language(text, language):
    assert bool(re.search(r"[\u4e00-\u9fff]", text)) == (language == "zh-CN")


@pytest.mark.parametrize("language", ["en-US", "zh-CN"])
@pytest.mark.parametrize("medium,query,expected", [
    ("visual", "Find a poster", "explicit_demand"),
    ("visual", "Explain the architecture", "implicit_enrichment"),
    ("visual", "What is the limit?", "unnecessary"),
    ("audio", "Select a theme song", "explicit_demand"),
    ("audio", "Explain the lyrics", "implicit_enrichment"),
    ("audio", "What is the limit?", "unnecessary"),
    ("video", "Find a video", "explicit_demand"),
    ("video", "Explain the film plot", "implicit_enrichment"),
    ("video", "What is the limit?", "unnecessary"),
])
def test_invalid_media_intents_use_localized_inference(language, medium, query, expected):
    with prompt_language(language):
        result = IntentProcessor()._validate_intent_analysis({medium + "_intent": "invalid"}, query)
    assert result[medium + "_intent"] == expected
    assert_language(result[medium + "_reasoning"], language)
    assert result["original_query"] == query


@pytest.mark.parametrize("medium,query,expected", [
    ("visual", "Find a poster", "explicit_demand"),
    ("visual", "Explain the architecture", "implicit_enrichment"),
    ("audio", "Select a theme song", "explicit_demand"),
    ("video", "Find a video", "explicit_demand"),
    ("video", 'Based on the plot of the film "Blood Oath," select a poster and theme song.', "implicit_enrichment"),
])
def test_keyword_correction_replaces_model_reasoning_in_request_language(medium, query, expected):
    with prompt_language("en-US"):
        result = IntentProcessor()._validate_intent_analysis(
            {medium + "_intent": "unnecessary", medium + "_reasoning": "模型原始理由"}, query)
    assert result[medium + "_intent"] == expected
    assert_language(result[medium + "_reasoning"], "en-US")


def test_model_reasoning_and_search_text_are_not_translated():
    source = "来源原文 [2] {placeholder}"
    strategies = {"dense_query": source, "sparse_keywords": ["原始词项"], "multi_view_queries": [source]}
    analysis = {"reasoning": source, "search_strategies": strategies, "sub_queries": [source]}
    for medium in ("visual", "audio", "video"):
        analysis.update({medium + "_intent": "explicit_demand", medium + "_reasoning": source})
    with prompt_language("en-US"):
        result = IntentProcessor()._validate_intent_analysis(analysis, "保留用户原话 [2]")
    for field in ("reasoning", "visual_reasoning", "audio_reasoning", "video_reasoning"):
        assert result[field] == source
    assert result["search_strategies"] == strategies
    assert result["sub_queries"] == [source]
    assert result["original_query"] == "保留用户原话 [2]"


@pytest.mark.parametrize("language", ["en-US", "zh-CN"])
@pytest.mark.parametrize("content", ["visual audio video", "architecture lyrics film", "unknown response"])
def test_manual_parser_localizes_only_generated_explanations(language, content):
    with prompt_language(language):
        result = IntentProcessor()._manual_parse_response(content)
    for medium in ("visual", "audio", "video"):
        assert_language(result[medium + "_reasoning"], language)
    assert result["reasoning"] == content
    assert result["search_strategies"]["dense_query"] == content
    assert result["search_strategies"]["sparse_keywords"] == (
        ["query", "information"] if language == "en-US" else ["查询", "信息"])


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [False, True])
async def test_shared_processor_localizes_missing_reasons_and_failures_per_request(failure):
    async def chat(**kwargs):
        before = get_prompt_language()
        await asyncio.sleep(.001)
        assert get_prompt_language() == before
        return SimpleNamespace(success=not failure, error="unavailable", data={
            "choices": [{"message": {"content": "{}"}}]})

    processor = IntentProcessor()
    processor.llm_manager = SimpleNamespace(chat=chat)

    async def run(language):
        with prompt_language(language):
            result = await processor._process_generative("保留原问题 [3]")
        for field in ("reasoning", "visual_reasoning", "audio_reasoning", "video_reasoning"):
            assert_language(result[field], language)
        assert result["original_query"] == result["search_strategies"]["dense_query"] == "保留原问题 [3]"

    await asyncio.gather(run("en-US"), run("zh-CN"))
    assert get_prompt_language() == "zh-CN"


@pytest.mark.asyncio
async def test_adaptive_planner_missing_reason_keeps_semantic_intent_with_english_explanation():
    raw = {medium + "_intent": "unnecessary" for medium in ("visual", "audio", "video")}

    async def chat(**kwargs):
        return SimpleNamespace(success=True, data={"choices": [{"message": {"content": json.dumps(raw)}}]})

    processor = IntentProcessor()
    processor.llm_manager = SimpleNamespace(chat=chat)
    with prompt_language("en-US"):
        result = await processor._process_generative("Find a poster", include_source_proposals=True)
    for medium in ("visual", "audio", "video"):
        assert result[medium + "_intent"] == "unnecessary"
        assert "without a keyword override" in result[medium + "_reasoning"]


async def evaluate_requirements(state, questions, **kwargs):
    answers = {}
    for name, question in questions.items():
        if question["type"] == "choice":
            answers[name] = {"type": "choice", "choice": "factual", "confidence": .9,
                             "probabilities": {key: .9 if key == "factual" else .025
                                               for key in question["criteria"]}}
        else:
            answers[name] = {"type": "noul", "noul": .95 if name in {"image_required", "image_helpful"} else .05}
    return SimpleNamespace(answers=answers, metadata=lambda: {})


@pytest.mark.asyncio
@pytest.mark.parametrize("language", ["en-US", "zh-CN"])
async def test_decision_classification_and_requirement_merging_localize_reasoning(language):
    query = "Find a poster 原文 [2]"
    with prompt_language(language):
        result, metadata = await classify_intent(SimpleNamespace(evaluate=evaluate_requirements), query)
        merged, applied = merge_required_modalities(
            {"visual_intent": "unnecessary", "sub_queries": [query]}, result["decision_requirements"])
    assert metadata["accepted"]
    assert result["original_query"] == result["refined_query"] == query
    assert applied == ["image"]
    assert merged["sub_queries"] == [query]
    for text in [result["reasoning"], *(result[medium + "_reasoning"] for medium in ("visual", "audio", "video")),
                 merged["visual_reasoning"]]:
        assert_language(text, language)


@pytest.mark.asyncio
@pytest.mark.parametrize("language", ["en-US", "zh-CN"])
async def test_verified_decision_explanation_localizes_without_changing_source_span(language, monkeypatch):
    monkeypatch.setattr(decision_plan, "decision_profile", lambda metadata, action: {
        "id": "test-only", "purpose": "source_" + action, "threshold": .85,
        "execution": "apply", "status": "admitted",
    })

    async def evaluate(state, questions, **kwargs):
        return SimpleNamespace(answers={key: {
            "type": "choice", "choice": "verified", "confidence": .9,
            "probabilities": {"verified": .95, "contradicted": .025, "unresolved": .025},
        } for key in questions}, metadata=lambda: {})

    span = "不要图片"
    baseline = {"visual_intent": "explicit_demand", "source_proposals": [{
        "id": "p1", "target": {"modality": "image", "scope": "global", "description": "原始来源"},
        "action": "forbid", "source_span": span, "provenance": "current_user",
    }]}
    with prompt_language(language):
        result = await decision_plan.verify_plan(span, baseline, client_factory=lambda: SimpleNamespace(evaluate=evaluate))
    assert result["visual_intent"] == "unnecessary"
    assert result["decision_plan"]["applied_ids"] == ["p1"]
    assert result["decision_requirements"]["modalities"]["image"]["source_span"] == span
    assert_language(result["visual_reasoning"], language)
