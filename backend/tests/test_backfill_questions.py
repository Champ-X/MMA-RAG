"""The offline backfill must respect source deletions while its model is running."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.knowledge import suggested_questions as suggestions
from scripts import backfill_suggested_questions as script


def question(file_id='tea', text='茶树如何从药用植物变成日常饮品？'):
    return {'text': text, 'kb_id': 'bio', 'kb_name': '生物科普', 'file_id': file_id,
            'strategy': suggestions.SUGGESTION_STRATEGY_VERSION,
            'evidence_quote': '茶树最初作为药用植物，后来逐渐被用于饮用。'}


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    monkeypatch.setattr(suggestions, 'CACHE_DIR', tmp_path)
    monkeypatch.setattr(suggestions, 'BANK_DIR', tmp_path / 'bank')
    monkeypatch.setattr(suggestions, 'PRECOMPUTED_DIR', tmp_path / 'precomputed')
    service = SimpleNamespace(list_knowledge_bases=AsyncMock(return_value=[{'id': 'bio', 'name': '生物科普'}]))
    monkeypatch.setattr(script, 'KnowledgeBaseService', lambda: service)
    monkeypatch.setattr(script, 'sample_evidence_for_kb', AsyncMock(return_value=[{'id': 'one'}, {'id': 'two'}]))
    suggestions.add_questions_to_bank('bio', [question('old', '野生茶树适合在什么环境生长？')], source='llm')


async def run_backfill(**overrides):
    await script.backfill(**{'chunk_batch_size': 1, 'out_questions_per_call': 6,
                             'calls_per_kb': 2, 'sample_limit_per_kb': 12, 'reset': False, **overrides})


@pytest.mark.asyncio
@pytest.mark.parametrize('deletion', ['file', 'kb'])
@pytest.mark.parametrize('reset', [False, True])
async def test_backfill_drops_pending_result_after_source_deletion(prepared, monkeypatch, deletion, reset):
    async def generate(*args, **kwargs):
        if deletion == 'file':
            suggestions.remove_questions_by_file('bio', 'tea')
        else:
            suggestions.remove_kb_question_bank('bio')
        return {'questions': [question()]}

    generated = AsyncMock(side_effect=generate)
    monkeypatch.setattr(script, 'generate_natural_questions', generated)
    await run_backfill(reset=reset)
    stored = suggestions._read_question_bank('bio')['questions']
    assert [q['file_id'] for q in stored] == (['old'] if deletion == 'file' else [])
    generated.assert_awaited_once()


@pytest.mark.asyncio
async def test_reset_keeps_old_bank_when_generation_fails(prepared, monkeypatch):
    monkeypatch.setattr(script, 'generate_natural_questions', AsyncMock(return_value={'questions': []}))
    await run_backfill(reset=True)
    assert [q['file_id'] for q in suggestions._read_question_bank('bio')['questions']] == ['old']
    assert suggestions._generation_epoch('bio') == 'initial'


@pytest.mark.asyncio
async def test_reset_updates_own_epoch_and_continues_later_batches(prepared, monkeypatch):
    generated = AsyncMock(side_effect=[
        {'questions': [question()]},
        {'questions': [question('seed', '种子内部的胚芽和周围的根系长什么样？')]},
    ])
    monkeypatch.setattr(script, 'generate_natural_questions', generated)
    await run_backfill(reset=True)
    assert {q['file_id'] for q in suggestions._read_question_bank('bio')['questions']} == {'tea', 'seed'}
    assert suggestions._generation_epoch('bio') != 'initial'
    assert generated.await_count == 2
