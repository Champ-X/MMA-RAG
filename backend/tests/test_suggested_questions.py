"""推荐问题应围绕内容主题，不暴露上传工具生成的临时文件名。"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import asyncio
import json
import multiprocessing
import os
from pathlib import Path
import time

import pytest

from app.modules.knowledge import suggested_questions as suggestions
from app.modules.knowledge.natural_questions import make_evidence

from app.modules.knowledge.suggested_questions import (
    _fallback_questions_from_context,
    _format_file_block,
    _normalize_question_items,
    _readable_file_title,
)


TEMP_IMAGE_NAME = "codex-clipboard-9603ca4f-12d6-4da1-8066-fa9ef8131b54.png"
REAL_SCHEDULER = suggestions._schedule_background_generation


def grounded_question(text="茶树如何驯化？", *, file_id="tea", kb_id="bio", **extra):
    return {
        "text": text, "kb_id": kb_id, "kb_name": "生物科普", "file_id": file_id,
        "strategy": suggestions.SUGGESTION_STRATEGY_VERSION,
        "evidence_quote": "茶树的栽培和人工选择推动了驯化", "evidence_id": "source-tea",
        "evidence_hash": "tea-hash", **extra,
    }


def parsed_evidence(text='茶树的栽培和人工选择推动了驯化。'):
    return make_evidence(text, kb_id='bio', kb_name='生物科普', file_id='tea', kind='document')


def _concurrent_bank_writer(cache_dir, worker_id, ready):
    """A separate process simulates API and ingestion workers sharing the bank."""
    suggestions.CACHE_DIR = Path(cache_dir)
    suggestions.BANK_DIR = Path(cache_dir) / 'bank'
    original_read = suggestions._read_question_bank

    def overlapping_read(kb_id):
        result = original_read(kb_id)
        time.sleep(0.002)
        return result

    suggestions._read_question_bank = overlapping_read
    ready.wait(timeout=10)
    for index in range(8):
        question = grounded_question(file_id=f'worker-{worker_id}-file-{index}')
        assert suggestions.add_questions_to_bank('bio', [question], source='llm') == 1


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
    monkeypatch.setattr(suggestions, '_schedule_background_generation', Mock(return_value=True))
    monkeypatch.setattr(suggestions, 'sample_evidence_for_kb', AsyncMock(side_effect=AssertionError('unexpected vector sampling')))
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
async def test_default_cache_miss_schedules_actual_scope_without_expensive_calls(service):
    result = await build(service, kb_mode='manual', knowledge_base_ids=['bio'])
    assert result == {'questions': [], 'source': 'warming', 'cached': False, 'retry_after_ms': 2000}
    suggestions._schedule_background_generation.assert_called_once_with(
        service, {'id': 'bio', 'name': '生物科普'}, [])
    suggestions.llm_manager.chat.assert_not_awaited()
    service.get_kb_portraits_with_fallback.assert_not_awaited()
    service.list_kb_files.assert_not_awaited()
    service.get_file_preview_details.assert_not_awaited()
    suggestions.sample_evidence_for_kb.assert_not_awaited()


@pytest.mark.asyncio
async def test_file_scope_filters_bank_and_never_uses_whole_kb_snapshot(service):
    suggestions.add_questions_to_bank('bio', [grounded_question()], source='upload')
    suggestions.add_questions_to_bank('bio', [grounded_question('恐龙有哪些特征？', file_id='dinosaur')], source='upload')
    suggestions._write_precomputed_for_kb('bio', {'source': 'llm', 'questions': [grounded_question('范围之外的主题？', file_id='other')]})
    result = await build(service, selected_files=[{'kb_id': 'bio', 'file_id': 'tea', 'name': '茶叶驯化史.mp4'}])
    assert result['source'] == 'question_bank'
    assert result['questions'] == [{'text': '茶树如何驯化？', 'kb_name': '生物科普'}]
    suggestions._schedule_background_generation.assert_not_called()


@pytest.mark.asyncio
async def test_file_scope_cache_miss_does_not_return_other_files_questions(service):
    suggestions.add_questions_to_bank('bio', [grounded_question(file_id='other')], source='llm')
    selected = [{'kb_id': 'bio', 'file_id': 'tea', 'name': '茶叶驯化史.mp4'}]
    result = await build(service, selected_files=selected)
    assert result['questions'] == []
    assert result['source'] == 'warming'
    suggestions._schedule_background_generation.assert_called_once_with(
        service, {'id': 'bio', 'name': '生物科普'}, selected)


@pytest.mark.asyncio
async def test_unknown_kb_does_not_expose_stale_bank_or_global_fallback(service):
    suggestions.add_questions_to_bank('deleted', [grounded_question(kb_id='deleted')], source='upload')
    result = await build(service, kb_mode='manual', knowledge_base_ids=['deleted'])
    assert result['questions'] == []
    assert result['source'] == 'empty'
    suggestions._schedule_background_generation.assert_not_called()


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
    suggestions.add_questions_to_bank('bio', [grounded_question('已经删去的材料？')], source='upload')
    result = await build(service)
    assert result['questions'] == []
    suggestions._schedule_background_generation.assert_not_called()


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
    assert result['source'] == 'warming'
    assert result['questions'] == []
    assert suggestions._schedule_background_generation.call_args.args[1]['id'] == 'bio'
    suggestions.llm_manager.chat.assert_not_awaited()
    service.get_kb_portraits_with_fallback.assert_not_awaited()
    service.list_kb_files.assert_not_awaited()
    service.get_file_preview_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_global_fast_path_reads_precomputed_snapshots(service):
    suggestions._write_precomputed_for_kb('bio', {'source': 'llm', 'questions': [grounded_question()]})
    result = await build(service, kb_mode='manual', knowledge_base_ids=['bio'])
    assert result['cached'] and result['source'] == 'precomputed'
    assert result['questions'][0]['text'] == '茶树如何驯化？'
    service.get_file_preview_details.assert_not_awaited()
    suggestions._schedule_background_generation.assert_not_called()


@pytest.mark.asyncio
async def test_expired_snapshot_schedules_generation_without_awaiting_model_or_preview(service):
    suggestions._write_precomputed_for_kb('bio', {'source': 'llm', 'questions': [grounded_question('过期的旧问题？')]})
    os.utime(suggestions._precomputed_path('bio'), (1, 1))
    result = await build(service, kb_mode='manual', knowledge_base_ids=['bio'])
    assert result['source'] == 'warming'
    assert result['questions'] == []
    suggestions.llm_manager.chat.assert_not_awaited()
    service.get_file_preview_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_file_cache_miss_never_turns_filename_into_a_question(service):
    result = await build(service, selected_files=[{'kb_id': 'bio', 'file_id': 'image', 'name': TEMP_IMAGE_NAME}])
    assert result['source'] == 'warming'
    assert result['questions'] == []


@pytest.mark.asyncio
@pytest.mark.parametrize('refresh,prefer_precomputed', [(True, True), (False, False)])
async def test_explicit_generation_stores_provenance_without_polluting_kb_snapshot(service, monkeypatch, refresh, prefer_precomputed):
    generated = AsyncMock(return_value={'source': 'llm', 'questions': [grounded_question()]})
    monkeypatch.setattr(suggestions, 'generate_natural_questions', generated)
    suggestions.sample_evidence_for_kb.side_effect = None
    suggestions.sample_evidence_for_kb.return_value = [parsed_evidence()]
    result = await build(service, selected_files=[{'kb_id': 'bio', 'file_id': 'tea', 'name': '茶叶驯化史.mp4'}],
                         refresh=refresh, prefer_precomputed=prefer_precomputed)
    assert result['source'] == 'llm'
    generated.assert_awaited_once()
    evidence = generated.call_args.args[0]
    assert evidence and all(item['file_id'] == 'tea' for item in evidence)
    assert evidence[0]['text'] == '茶树的栽培和人工选择推动了驯化。'
    service.get_file_preview_details.assert_not_awaited()
    service.get_kb_portraits_with_fallback.assert_not_awaited()
    assert suggestions._read_precomputed_for_kb('bio') is None
    stored = suggestions._read_question_bank('bio')['questions']
    assert len(stored) == 1
    assert stored[0]['file_id'] == 'tea'
    assert stored[0]['evidence_quote'] == '茶树的栽培和人工选择推动了驯化'
    assert stored[0]['strategy'] == suggestions.SUGGESTION_STRATEGY_VERSION
    suggestions.sample_evidence_for_kb.assert_awaited_once_with(
        service, 'bio', '生物科普', file_ids=['tea'], limit=24)


def test_context_fallback_does_not_treat_headings_as_topics():
    questions = _fallback_questions_from_context(['生物科普'],
        ['## 知识库: 生物科普', '### 主题聚类摘要', '- (5条) 茶树起源和驯化'], [], 3)
    assert questions and '茶树起源和驯化' in questions[0]['text']
    assert all('#' not in q['text'] for q in questions)


@pytest.mark.asyncio
async def test_api_defaults_return_warming_without_generic_cards_when_caches_are_empty(service, monkeypatch):
    from app.api import knowledge as api
    monkeypatch.setattr(api, 'kb_service', service)
    result = await api.post_suggested_questions(api.SuggestedQuestionsRequest())
    assert result['source'] == 'warming'
    assert result['questions'] == []
    assert result['retry_after_ms'] == 2000
    assert 'note' not in result
    suggestions.llm_manager.chat.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('store', ['bank', 'precomputed'])
async def test_legacy_strategy_is_not_served_from_either_store(service, store):
    old_question = grounded_question('请梳理「生物科普」的资料中的重要概念和结论？', strategy='scope-fallback-v1')
    path = suggestions._bank_path('bio') if store == 'bank' else suggestions._precomputed_path('bio')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'kb_id': 'bio', 'strategy': 'scope-fallback-v1',
                                'source': 'llm', 'questions': [old_question]}), encoding='utf-8')
    result = await build(service, kb_mode='manual', knowledge_base_ids=['bio'])
    assert result['questions'] == []
    assert result['source'] == 'warming'
    suggestions._schedule_background_generation.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize('missing', ['strategy', 'file_id', 'evidence_quote'])
async def test_current_bank_does_not_serve_questions_without_provenance(service, missing):
    question = grounded_question()
    question.pop(missing)
    suggestions._write_question_bank('bio', {'questions': [question]})
    result = await build(service, kb_mode='manual', knowledge_base_ids=['bio'])
    assert result['questions'] == []
    assert result['source'] == 'warming'


def test_bank_write_discards_legacy_records_and_deduplicates_grounded_questions(service):
    suggestions._write_question_bank('bio', {'questions': [
        grounded_question('旧策略生成的历史问题？', strategy='legacy'),
    ]})
    added = suggestions.add_questions_to_bank('bio', [
        {'text': '拼凑的模板问题？'}, grounded_question(), grounded_question(),
    ], source='llm')
    assert added == 1
    stored = suggestions._read_question_bank('bio')['questions']
    assert len(stored) == 1
    assert stored[0]['file_id'] == 'tea'
    assert stored[0]['evidence_quote'] == grounded_question()['evidence_quote']


@pytest.mark.asyncio
@pytest.mark.parametrize('refresh', [False, True])
async def test_disabled_llm_returns_unavailable_without_generation(service, refresh):
    result = await build(service, use_llm=False, refresh=refresh)
    assert result == {'questions': [], 'source': 'unavailable', 'cached': False}
    suggestions._schedule_background_generation.assert_not_called()
    suggestions.llm_manager.chat.assert_not_awaited()
    service.get_file_preview_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_disabled_llm_can_still_serve_stored_questions(service):
    suggestions.add_questions_to_bank('bio', [grounded_question()], source='llm')
    result = await build(service, use_llm=False, kb_mode='manual', knowledge_base_ids=['bio'])
    assert result['source'] == 'question_bank'
    assert result['questions'] == [{'text': '茶树如何驯化？', 'kb_name': '生物科普'}]
    suggestions._schedule_background_generation.assert_not_called()


@pytest.mark.asyncio
async def test_compatibility_fast_reader_does_not_schedule_generation(service):
    result = await suggestions.get_precomputed_questions_fast(
        service, kb_mode='auto', knowledge_base_ids=[], selected_files=[], max_questions=3)
    assert result == []
    suggestions._schedule_background_generation.assert_not_called()


@pytest.mark.asyncio
async def test_generated_scope_cache_is_reused_until_parsed_content_changes(service, monkeypatch):
    suggestions.sample_evidence_for_kb.side_effect = None
    suggestions.sample_evidence_for_kb.return_value = [parsed_evidence()]
    generated = AsyncMock(return_value={'source': 'llm', 'questions': [grounded_question()]})
    monkeypatch.setattr(suggestions, 'generate_natural_questions', generated)
    scope = {'selected_files': [{'kb_id': 'bio', 'file_id': 'tea', 'name': '茶树.png'}],
             'prefer_precomputed': False}
    first = await build(service, **scope)
    second = await build(service, **scope)
    assert first['source'] == 'llm'
    assert second['source'] == 'scope_cache' and second['cached']
    assert first['revision'] == second['revision']
    generated.assert_awaited_once()
    suggestions.sample_evidence_for_kb.return_value = [parsed_evidence('野生茶树与栽培茶树的叶片形态存在差异。')]
    changed = await build(service, **scope)
    assert changed['source'] == 'llm'
    assert changed['revision'] != first['revision']
    assert generated.await_count == 2


@pytest.mark.asyncio
async def test_background_generation_deduplicates_scope_and_applies_completion_cooldown(service, monkeypatch):
    monkeypatch.setattr(suggestions, '_background_tasks', {})
    monkeypatch.setattr(suggestions, '_background_cooldowns', {})
    monkeypatch.setattr(suggestions, '_generation_semaphore', asyncio.Semaphore(2))
    started, release = asyncio.Event(), asyncio.Event()

    async def generate(*args, **kwargs):
        started.set()
        await release.wait()
        return {'questions': []}

    generated = AsyncMock(side_effect=generate)
    monkeypatch.setattr(suggestions, 'build_context_and_questions_payload', generated)
    kb = {'id': 'bio', 'name': '生物科普'}
    files = [{'kb_id': 'bio', 'file_id': 'tea'}, {'kb_id': 'bio', 'file_id': 'seed'}]
    try:
        assert REAL_SCHEDULER(service, kb, files)
        await asyncio.wait_for(started.wait(), timeout=1)
        assert REAL_SCHEDULER(service, kb, list(reversed(files)))
        assert len(suggestions._background_tasks) == 1
        generated.assert_awaited_once()
        call = generated.call_args.kwargs
        assert call['kb_mode'] == 'files' and call['refresh'] is True
        assert call['selected_files'] == files
        assert call['knowledge_base_ids'] == ['bio']
        pending = list(suggestions._background_tasks.values())
        release.set()
        await asyncio.gather(*pending)
        assert suggestions._background_tasks == {}
        assert not REAL_SCHEDULER(service, kb, files)
        key = next(iter(suggestions._background_cooldowns))
        suggestions._background_cooldowns[key] = 0
        assert REAL_SCHEDULER(service, kb, files)
        await asyncio.gather(*list(suggestions._background_tasks.values()))
        assert generated.await_count == 2
    finally:
        release.set()
        await suggestions.stop_suggestion_background_tasks()


@pytest.mark.asyncio
async def test_background_generation_bounds_concurrency_and_queued_scopes(service, monkeypatch):
    monkeypatch.setattr(suggestions, '_background_tasks', {})
    monkeypatch.setattr(suggestions, '_background_cooldowns', {})
    monkeypatch.setattr(suggestions, '_generation_semaphore', asyncio.Semaphore(2))
    monkeypatch.setattr(suggestions, 'MAX_BACKGROUND_SCOPES', 3)
    two_running, release = asyncio.Event(), asyncio.Event()
    active = 0
    peak = 0

    async def generate(*args, **kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == 2:
            two_running.set()
        try:
            await release.wait()
            return {'questions': []}
        finally:
            active -= 1

    generated = AsyncMock(side_effect=generate)
    monkeypatch.setattr(suggestions, 'build_context_and_questions_payload', generated)
    try:
        for index in range(3):
            assert REAL_SCHEDULER(service, {'id': f'kb-{index}'}, [])
        assert not REAL_SCHEDULER(service, {'id': 'over-capacity'}, [])
        await asyncio.wait_for(two_running.wait(), timeout=1)
        assert generated.await_count == 2
        assert len(suggestions._background_tasks) == 3
        pending = list(suggestions._background_tasks.values())
        release.set()
        await asyncio.gather(*pending)
        assert generated.await_count == 3 and peak == 2
        assert suggestions._background_tasks == {}
    finally:
        release.set()
        await suggestions.stop_suggestion_background_tasks()


@pytest.mark.asyncio
async def test_background_failure_is_contained_and_cooldown_prevents_retry_storm(service, monkeypatch):
    monkeypatch.setattr(suggestions, '_background_tasks', {})
    monkeypatch.setattr(suggestions, '_background_cooldowns', {})
    monkeypatch.setattr(suggestions, '_generation_semaphore', asyncio.Semaphore(2))
    generated = AsyncMock(side_effect=RuntimeError('model unavailable'))
    monkeypatch.setattr(suggestions, 'build_context_and_questions_payload', generated)
    kb = {'id': 'bio'}
    try:
        assert REAL_SCHEDULER(service, kb, [])
        await asyncio.gather(*list(suggestions._background_tasks.values()))
        assert suggestions._background_tasks == {}
        assert not REAL_SCHEDULER(service, kb, [])
        generated.assert_awaited_once()
    finally:
        await suggestions.stop_suggestion_background_tasks()


@pytest.mark.asyncio
@pytest.mark.parametrize('extension', ['png', 'mp3', 'pdf', 'mp4'])
async def test_selected_generation_uses_strict_sampler_for_every_modality(service, monkeypatch, extension):
    suggestions.sample_evidence_for_kb.side_effect = None
    suggestions.sample_evidence_for_kb.return_value = []
    generated = AsyncMock()
    monkeypatch.setattr(suggestions, 'generate_natural_questions', generated)
    result = await build(service, refresh=True,
                         selected_files=[{'kb_id': 'bio', 'file_id': 'foreign-file', 'name': f'材料.{extension}'}])
    assert result['questions'] == [] and result['note'] == 'no_parsed_evidence'
    suggestions.sample_evidence_for_kb.assert_awaited_once_with(
        service, 'bio', '生物科普', file_ids=['foreign-file'], limit=24)
    service.get_file_preview_details.assert_not_awaited()
    generated.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('remove_scope', ['file', 'kb'])
@pytest.mark.parametrize('selected', [False, True])
async def test_deletion_during_generation_prevents_resurrection_in_all_stores(service, monkeypatch, remove_scope, selected):
    suggestions.sample_evidence_for_kb.side_effect = None
    suggestions.sample_evidence_for_kb.return_value = [parsed_evidence()]
    entered, release = asyncio.Event(), asyncio.Event()

    async def generate(*args, **kwargs):
        entered.set()
        await release.wait()
        return {'source': 'llm', 'questions': [grounded_question()]}

    monkeypatch.setattr(suggestions, 'generate_natural_questions', AsyncMock(side_effect=generate))
    files = [{'kb_id': 'bio', 'file_id': 'tea', 'name': '茶树.pdf'}] if selected else []
    # There is no bank yet: invalidation must still fence already-running work.
    task = asyncio.create_task(build(service, refresh=True, kb_mode='manual',
                                    knowledge_base_ids=['bio'], selected_files=files))
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        if remove_scope == 'file':
            assert suggestions.remove_questions_by_file('bio', 'tea') == 0
        else:
            suggestions.remove_kb_question_bank('bio')
        release.set()
        result = await task
        assert result['questions'] == [] and result['note'] == 'scope_changed'
        assert suggestions._read_question_bank('bio')['questions'] == []
        assert suggestions._read_precomputed_for_kb('bio') is None
        assert list(suggestions.CACHE_DIR.glob('*.json')) == []
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_deletion_epoch_invalidates_scope_cache_even_with_same_evidence(service, monkeypatch):
    suggestions.sample_evidence_for_kb.side_effect = None
    suggestions.sample_evidence_for_kb.return_value = [parsed_evidence()]
    generated = AsyncMock(return_value={'source': 'llm', 'questions': [grounded_question()]})
    monkeypatch.setattr(suggestions, 'generate_natural_questions', generated)
    scope = dict(kb_mode='manual', knowledge_base_ids=['bio'], prefer_precomputed=False)
    first = await build(service, **scope)
    suggestions.remove_questions_by_file('bio', 'tea')
    second = await build(service, **scope)
    assert first['cache_key'] != second['cache_key']
    assert second['source'] == 'llm' and generated.await_count == 2


def test_concurrent_processes_preserve_all_bank_entries_without_temp_collisions(service):
    context = multiprocessing.get_context('spawn')
    ready = context.Barrier(3)
    workers = [context.Process(target=_concurrent_bank_writer,
                               args=(str(suggestions.CACHE_DIR), index, ready)) for index in range(3)]
    try:
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=15)
        assert all(worker.exitcode == 0 for worker in workers)
        stored = suggestions._read_question_bank('bio')['questions']
        assert len(stored) == 24
        assert len({q['file_id'] for q in stored}) == 24
        assert list(suggestions.BANK_DIR.glob('*.tmp')) == []
    finally:
        for worker in workers:
            if worker.is_alive():
                worker.terminate()
                worker.join(timeout=5)
