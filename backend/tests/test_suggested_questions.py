"""推荐问题应围绕内容主题，不暴露上传工具生成的临时文件名。"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
import os

import pytest

from app.modules.knowledge import suggested_questions as suggestions

from app.modules.knowledge.suggested_questions import (
    _fallback_questions_from_context,
    _format_file_block,
    _normalize_question_items,
    _readable_file_title,
)


TEMP_IMAGE_NAME = "codex-clipboard-9603ca4f-12d6-4da1-8066-fa9ef8131b54.png"


def test_readable_file_title_hides_temporary_upload_names():
    assert _readable_file_title(TEMP_IMAGE_NAME) == ""
    assert _readable_file_title("Annual_Report_2026.pdf") == "Annual Report 2026"


def test_file_context_omits_temporary_name():
    block = _format_file_block(
        TEMP_IMAGE_NAME,
        {"caption": "根系环绕的种子状结构，内部可见胚芽形态。"},
    )

    assert TEMP_IMAGE_NAME not in block
    assert "上传图片（临时文件名已省略）" in block
    assert "根系环绕的种子状结构" in block


def test_normalization_removes_opaque_file_reference_but_keeps_topic():
    items = _normalize_question_items(
        [
            {
                "text": (
                    f"文件 {TEMP_IMAGE_NAME} 中"
                    "根系环绕的种子状结构内含什么形态？"
                )
            }
        ],
        kb_name="植物图谱",
        max_q=3,
    )

    assert items == [
        {
            "text": "根系环绕的种子状结构内含什么形态？",
            "kb_name": "植物图谱",
        }
    ]


def test_fallback_uses_caption_instead_of_temporary_file_name():
    block = _format_file_block(
        TEMP_IMAGE_NAME,
        {"caption": "根系环绕的种子状结构，内部可见胚芽形态。"},
    )

    questions = _fallback_questions_from_context(["植物图谱"], [], [block], 3)

    assert questions
    assert TEMP_IMAGE_NAME not in questions[0]["text"]
    assert "根系环绕的种子状结构" in questions[0]["text"]


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(suggestions, 'CACHE_DIR', tmp_path)
    monkeypatch.setattr(suggestions, 'BANK_DIR', tmp_path / 'bank')
    monkeypatch.setattr(suggestions, 'PRECOMPUTED_DIR', tmp_path / 'precomputed')
    monkeypatch.setattr(suggestions.llm_manager, 'chat', AsyncMock(side_effect=AssertionError('unexpected LLM call')))
    return SimpleNamespace(
        list_knowledge_bases=AsyncMock(return_value=[{'id': 'bio', 'name': '生物科普'}, {'id': 'music', 'name': '音乐'}]),
        get_kb_portraits_with_fallback=AsyncMock(side_effect=AssertionError('unexpected portrait read')),
        list_kb_files=AsyncMock(side_effect=AssertionError('unexpected file enumeration')),
        get_file_preview_details=AsyncMock(side_effect=AssertionError('unexpected preview read')),
    )


async def build(service, **overrides):
    args = dict(kb_mode='auto', knowledge_base_ids=[], selected_files=[], max_questions=3,
                use_llm=True, refresh=False, prefer_precomputed=True)
    return await suggestions.build_context_and_questions_payload(service, **{**args, **overrides})


@pytest.mark.asyncio
async def test_default_cache_miss_uses_actual_scope_without_expensive_calls(service):
    result = await build(service, kb_mode='manual', knowledge_base_ids=['bio'])
    assert result['source'] == 'scope_fallback'
    assert len(result['questions']) == 3
    assert all(q['kb_name'] == '生物科普' and '生物科普' in q['text'] for q in result['questions'])
    suggestions.llm_manager.chat.assert_not_awaited()
    service.get_kb_portraits_with_fallback.assert_not_awaited()
    service.list_kb_files.assert_not_awaited()
    service.get_file_preview_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_file_scope_filters_bank_and_never_uses_whole_kb_snapshot(service):
    suggestions.add_questions_to_bank('bio', [{'text': '茶树如何驯化？'}], source='upload', file_id='tea')
    suggestions.add_questions_to_bank('bio', [{'text': '恐龙有哪些特征？'}], source='upload', file_id='dinosaur')
    suggestions.add_questions_to_bank('bio', [{'text': '知识库包含哪些主题？'}], source='kb')
    suggestions._write_precomputed_for_kb('bio', {'questions': [{'text': '范围之外的主题？'}]})
    result = await build(service, selected_files=[{'kb_id': 'bio', 'file_id': 'tea', 'name': '茶叶驯化史.mp4'}])
    assert result['source'] == 'question_bank'
    assert result['questions'] == [{'text': '茶树如何驯化？', 'kb_name': '生物科普'}]


@pytest.mark.asyncio
async def test_unknown_kb_does_not_expose_stale_bank_or_global_fallback(service):
    suggestions.add_questions_to_bank('deleted', [{'text': '已删除的材料？'}], source='upload')
    result = await build(service, kb_mode='manual', knowledge_base_ids=['deleted'])
    assert result['questions'] == []
    assert result['source'] == 'empty'


@pytest.mark.asyncio
@pytest.mark.parametrize('kb_mode', ['manual', 'files'])
async def test_empty_explicit_scope_never_expands_to_all_libraries(service, kb_mode):
    result = await build(service, kb_mode=kb_mode)
    assert result['questions'] == []
    service.list_knowledge_bases.assert_not_awaited()


@pytest.mark.asyncio
async def test_known_empty_library_returns_no_questions_even_with_stale_bank(service):
    service.list_knowledge_bases.return_value = [{'id': 'bio', 'name': '生物科普', 'statistics': {
        'total_chunks': 0, 'total_images': 0, 'total_audio': 0, 'total_video': 0,
    }}]
    suggestions.add_questions_to_bank('bio', [{'text': '已经删去的材料？'}], source='upload')
    result = await build(service)
    assert result['questions'] == []


@pytest.mark.asyncio
@pytest.mark.parametrize('kb_mode', ['auto', 'all'])
async def test_empty_libraries_cannot_fill_global_sample_before_indexed_library(service, monkeypatch, kb_mode):
    empty_stats = {'total_chunks': 0, 'total_images': 0, 'total_audio': 0, 'total_video': 0}
    service.list_knowledge_bases.return_value = [
        {'id': f'empty-{i}', 'name': f'空库 {i}', 'statistics': empty_stats}
        for i in range(suggestions.MAX_KB_SAMPLE_GLOBAL)
    ] + [{'id': 'bio', 'name': '生物科普', 'statistics': {**empty_stats, 'total_video': 397}}]
    # This ordering previously selected eight empty libraries and discarded
    # the only indexed library before filtering, falsely reporting no scope.
    monkeypatch.setattr(suggestions.random, 'shuffle', lambda items: None)
    result = await build(service, kb_mode=kb_mode)
    assert result['source'] == 'scope_fallback'
    assert len(result['questions']) == 3
    assert all(q['kb_name'] == '生物科普' for q in result['questions'])
    suggestions.llm_manager.chat.assert_not_awaited()
    service.get_kb_portraits_with_fallback.assert_not_awaited()
    service.list_kb_files.assert_not_awaited()
    service.get_file_preview_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_global_fast_path_reads_precomputed_snapshots(service):
    suggestions._write_precomputed_for_kb('bio', {'questions': [{'text': '茶树如何驯化？'}]})
    result = await build(service)
    assert result['cached'] and result['source'] == 'precomputed'
    assert result['questions'][0]['text'] == '茶树如何驯化？'
    service.get_file_preview_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_expired_snapshot_returns_fast_metadata_without_model_or_preview(service):
    suggestions._write_precomputed_for_kb('bio', {'questions': [{'text': '过期的旧问题？'}]})
    os.utime(suggestions._precomputed_path('bio'), (1, 1))
    result = await build(service, kb_mode='manual', knowledge_base_ids=['bio'])
    assert result['source'] == 'scope_fallback'
    assert len(result['questions']) == 3
    assert all(q['text'] != '过期的旧问题？' for q in result['questions'])
    suggestions.llm_manager.chat.assert_not_awaited()
    service.get_file_preview_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_file_metadata_fallback_hides_opaque_names(service):
    result = await build(service, selected_files=[{'kb_id': 'bio', 'file_id': 'image', 'name': TEMP_IMAGE_NAME}])
    assert result['source'] == 'scope_fallback'
    assert len(result['questions']) == 3
    assert all('所选材料' in q['text'] and 'clipboard' not in q['text'] for q in result['questions'])


@pytest.mark.asyncio
@pytest.mark.parametrize('refresh,prefer_precomputed', [(True, True), (False, False)])
async def test_explicit_generation_is_preserved_and_file_snapshot_does_not_pollute_kb(service, refresh, prefer_precomputed):
    service.get_file_preview_details.side_effect = None
    service.get_file_preview_details.return_value = {'description': '资料介绍茶树起源和驯化。'}
    suggestions.llm_manager.chat.side_effect = None
    suggestions.llm_manager.chat.return_value = SimpleNamespace(success=True, data={
        'choices': [{'message': {'content': '["茶树在哪里起源？", "茶树如何驯化？", "驯化与栽培有何联系？"]'}}],
    })
    result = await build(service, selected_files=[{'kb_id': 'bio', 'file_id': 'tea', 'name': '茶叶驯化史.mp4'}],
                         refresh=refresh, prefer_precomputed=prefer_precomputed)
    assert result['source'] == 'llm'
    suggestions.llm_manager.chat.assert_awaited_once()
    service.get_file_preview_details.assert_awaited_once_with('bio', 'tea')
    service.get_kb_portraits_with_fallback.assert_not_awaited()
    assert suggestions._read_precomputed_for_kb('bio') is None


def test_context_fallback_does_not_treat_headings_as_topics():
    questions = _fallback_questions_from_context(['生物科普'],
        ['## 知识库: 生物科普', '### 主题聚类摘要', '- (5条) 茶树起源和驯化'], [], 3)
    assert questions and '茶树起源和驯化' in questions[0]['text']
    assert all('#' not in q['text'] for q in questions)


@pytest.mark.asyncio
async def test_api_defaults_return_fast_questions_when_all_caches_are_empty(service, monkeypatch):
    from app.api import knowledge as api
    monkeypatch.setattr(api, 'kb_service', service)
    result = await api.post_suggested_questions(api.SuggestedQuestionsRequest())
    assert result['source'] == 'scope_fallback'
    assert len(result['questions']) == 3
    suggestions.llm_manager.chat.assert_not_awaited()
