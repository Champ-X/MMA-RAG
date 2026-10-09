import asyncio
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import httpx

from app.core.llm.jev import JevClient
from app.modules.generation.decision_citation_sources import SOURCE_POLICY
from app.modules.generation.jev_answer_audit import (
    EXTRACTOR_VERSION, LEGACY_EXTRACTOR_VERSION, audit_answer, extract_citation_units,
)
from app.modules.generation.jev_citation_batch import (
    TEXT_PROXY_CONTEXT, TEXT_PROXY_PROMPT_VERSION, audit_answer_batch,
)


def extract(answer):
    return extract_citation_units(answer, version=EXTRACTOR_VERSION)


@pytest.mark.parametrize('answer,claim', [
    ('如图[1]所示，背景并没有汽车。', '如图所示，背景并没有汽车。'),
    ('🎬 图像[1]里的男子没有戴帽子。', '🎬 图像里的男子没有戴帽子。'),
    ('服务上限为600[1]次/分钟，而非每秒。', '服务上限为600次/分钟，而非每秒。'),
    ('Limit is 600[1] per minute, not per second.', 'Limit is 600 per minute, not per second.'),
    ('- Audio[1] contains no spoken words.', 'Audio contains no spoken words.'),
    ('据[1][2]，只有2025年版本适用。', '据，只有2025年版本适用。'),
])
def test_complete_sentence_retains_negation_units_and_qualifiers(answer, claim):
    parsed = extract(answer)
    assert parsed['gaps'] == []
    assert len(parsed['units']) == 1
    unit = parsed['units'][0]
    assert unit['claim'] == claim
    assert answer[unit['start']:unit['end']] == answer


@pytest.mark.parametrize('answer', [
    '如图[1]所示，旁边还有另一人[2]。',
    'Limit is 600[1] per minute, or 20[2] per second.',
    '图[1]与图[1]是否相同。',
])
def test_multiple_nonadjacent_citation_groups_stay_ambiguous(answer):
    parsed = extract(answer)
    assert parsed['units'] == []
    assert parsed['gaps'] == [{'start': 0, 'end': len(answer),
                              'reason': 'ambiguous_citation_position'}]


def test_terminal_citation_does_not_lend_to_uncited_sentence_or_next_group():
    answer = '🎵 没有引用的判断。图中没有车。 [1] 下一段[2]不是原图结论。'
    parsed = extract(answer)
    assert [(u['claim'], u['citation_ids']) for u in parsed['units']] == [
        ('图中没有车。', ['1']), ('下一段不是原图结论。', ['2']),
    ]
    assert answer[parsed['gaps'][0]['start']:parsed['gaps'][0]['end']] == '🎵 没有引用的判断。'
    assert answer[parsed['units'][0]['start']:parsed['units'][0]['end']] == '图中没有车。 [1]'


def test_masking_rich_markdown_and_abbreviation_uncertainty_remains():
    answer = '# 图[1]\n```\n[1]\n```\nThe U.S. API[1] has no limit.\n`[8]` 作者[2]没有发言。'
    parsed = extract(answer)
    assert len(parsed['units']) == 1
    assert parsed['units'][0]['citation_ids'] == ['2']
    assert parsed['units'][0]['claim'] == '`[8]` 作者没有发言。'
    assert {gap['reason'] for gap in parsed['gaps']} == {
        'unsupported_markdown', 'code_fence', 'ambiguous_sentence_boundary',
    }


def test_frozen_extractor_stays_default_and_is_explicitly_available():
    answer = 'Limit is 600[1] per minute.'
    assert extract_citation_units(answer) == extract_citation_units(answer, version=LEGACY_EXTRACTOR_VERSION)
    assert extract_citation_units(answer)['units'] == []
    assert extract(answer)['units'][0]['claim'] == 'Limit is 600 per minute.'
    with pytest.raises(ValueError, match='unknown_citation_extractor_version'):
        extract_citation_units(answer, version='unversioned')


@pytest.mark.parametrize('answer', [
    'Limit is 600[1]\nper minute, not per second.',
    'Limit is 600\nper minute[1].',
    '无需验证的陈述\n据材料[1]，有另一个陈述。',
])
def test_soft_line_wraps_cannot_detach_qualifiers_or_lend_citations(answer):
    parsed = extract(answer)
    assert parsed['units'] == []
    assert parsed['gaps'] == [{'start': 0, 'end': len(answer), 'reason': 'ambiguous_line_boundary'}]


def test_list_boundaries_and_complete_sentences_across_lines_remain_separate():
    answer = '- 如图[1]所示没有车\n- 资料[2]未说明年份\n\n完整的结论[3]。\n另一个结论[4]。'
    parsed = extract(answer)
    assert parsed['gaps'] == []
    assert [unit['citation_ids'] for unit in parsed['units']] == [['1'], ['2'], ['3'], ['4']]


def fake_client():
    calls = []
    async def evaluate(state, questions, *, prompt_version):
        calls.append({'state': state, 'questions': questions, 'prompt_version': prompt_version})
        answers = {}
        for name, question in questions.items():
            answers[name] = ({'type': 'noul', 'noul': .1 if name == 'contradicted' else .9}
                             if question['type'] == 'noul' else
                             {'type': 'choice', 'choice': 'supported', 'confidence': .85,
                              'probabilities': {'supported': .9, 'contradicted': .05, 'insufficient': .05}})
        return SimpleNamespace(answers=answers, metadata=lambda: {'model': 'test-decisions'})
    return SimpleNamespace(evaluate=evaluate), calls


@pytest.mark.parametrize('auditor', [audit_answer, audit_answer_batch])
@pytest.mark.parametrize('kind,basis,limitations', [
    ('doc', 'source_text', []),
    ('image', 'derived_text', ['derived_text_only', 'original_media_not_checked']),
    ('audio', 'derived_text', ['derived_text_only', 'original_media_not_checked']),
    ('video', 'derived_text', ['derived_text_only', 'original_media_not_checked']),
])
@pytest.mark.asyncio
async def test_both_strategies_use_only_existing_cited_text_and_report_basis(auditor, kind, basis, limitations):
    client, calls = fake_client()
    references = {
        '1': SimpleNamespace(content_type=kind, content='The supplied record has no vehicle.',
                             url='https://never-fetch.invalid/original'),
        '99': {'content_type': 'doc', 'content': 'UNRELATED_PRIVATE_SOURCE'},
    }
    original = copy.deepcopy(references)
    result = await auditor(client, '材料[1]没有提及汽车。', references,
                           extractor_version=EXTRACTOR_VERSION, source_policy=SOURCE_POLICY)
    assert result['extractor_version'] == EXTRACTOR_VERSION
    assert result['source_policy'] == SOURCE_POLICY
    unit = result['units'][0]
    assert unit['evidence_basis'] == basis
    assert unit['source_modalities'] == [kind]
    assert unit['limitations'] == limitations
    assert unit['result']['status'] == 'evaluated'
    assert len(calls) == 1
    request = json.dumps(calls, ensure_ascii=False)
    assert 'The supplied record has no vehicle.' in request
    assert 'UNRELATED_PRIVATE_SOURCE' not in request
    assert 'https://never-fetch.invalid' not in request
    assert 'original image, audio or video has NOT been inspected' in request
    assert 'source_context' in request and basis in request
    assert references == original
    assert 'The supplied record' not in json.dumps(result)


@pytest.mark.parametrize('auditor', [audit_answer, audit_answer_batch])
@pytest.mark.asyncio
async def test_mixed_sources_remain_derived_and_never_retrieve_missing_reference(auditor):
    client, calls = fake_client()
    out = await auditor(client, '材料[1][2]记载了这个事实。缺失来源[9]并未提供。', {
        '1': {'content_type': 'doc', 'content': 'source'},
        '2': {'content_type': 'image', 'content': 'caption'},
    }, extractor_version=EXTRACTOR_VERSION, source_policy=SOURCE_POLICY)
    assert out['units'][0]['evidence_basis'] == 'derived_text'
    assert out['units'][0]['source_modalities'] == ['doc', 'image']
    assert out['units'][1]['result'] == {
        'status': 'not_evaluated', 'reason': 'missing_reference', 'missing_ids': ['9'],
    }
    assert len(calls) == 1


@pytest.mark.parametrize('auditor', [audit_answer, audit_answer_batch])
@pytest.mark.parametrize('kind,content,reason', [
    ('audio', '', 'empty_source'), ('video', 'x' * 12001, 'source_too_large'),
    ('unsupported', 'text', 'unsupported_source_type'),
])
@pytest.mark.asyncio
async def test_proxy_sources_never_silently_truncate_or_fabricate(auditor, kind, content, reason):
    client = SimpleNamespace(evaluate=AsyncMock())
    out = await auditor(client, '此材料[1]具有该信息。', {'1': {'content_type': kind, 'content': content}},
                        extractor_version=EXTRACTOR_VERSION, source_policy=SOURCE_POLICY)
    client.evaluate.assert_not_awaited()
    assert out['units'][0]['result']['reason'] == reason


@pytest.mark.parametrize('auditor', [audit_answer, audit_answer_batch])
@pytest.mark.asyncio
async def test_new_policy_cancellation_propagates_and_joins_work(auditor):
    entered, finished = asyncio.Event(), asyncio.Event()
    async def evaluate(*args, **kwargs):
        entered.set()
        try:
            await asyncio.sleep(10)
        finally:
            finished.set()
    task = asyncio.create_task(auditor(
        SimpleNamespace(evaluate=evaluate), '图像[1]显示人物。',
        {'1': {'content_type': 'image', 'content': 'A person.'}},
        extractor_version=EXTRACTOR_VERSION, source_policy=SOURCE_POLICY))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert finished.is_set()


@pytest.mark.parametrize('provider,model', [
    ('typesafe', 'jev-1.13.0'), ('openrouter', 'typesafe/jev-1.13'),
    ('bailian', 'decision-model-preview'),
])
@pytest.mark.asyncio
async def test_native_production_strategies_preserve_same_evidence_and_nonempty_state(provider, model):
    """Both native strategies carry identical scoped evidence and Choice rules.

    The provider rejects empty state at the transport boundary. No fallback,
    source copying into shared batch context, or mutation can hide that error.
    """
    calls = []
    def handle(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert payload['state']
        answers = {}
        for name, question in payload['questions'].items():
            answers[name] = ({'type': 'noul', 'noul': .1 if name == 'contradicted' else .9}
                             if question['type'] == 'noul' else
                             {'type': 'choice', 'choice': 'supported', 'confidence': .85,
                              'probabilities': {'supported': .9, 'contradicted': .05, 'insufficient': .05}})
        usage = {'input_tokens': 100}
        if provider != 'bailian':
            usage['output_tokens'] = 20
        return httpx.Response(200, json={'model': model, 'answers': answers, 'usage': usage})
    client = JevClient('test-key', provider=provider, model=model,
                       transport=httpx.MockTransport(handle))
    references = {
        '1': {'content_type': 'image', 'content': 'The description states that no vehicle is visible.'},
        '99': {'content_type': 'doc', 'content': 'UNRELATED_PRIVATE_SOURCE'},
    }
    original = copy.deepcopy(references)
    for auditor in (audit_answer, audit_answer_batch):
        result = await auditor(client, '材料[1]说明没有可见汽车。', references,
                               extractor_version=EXTRACTOR_VERSION, source_policy=SOURCE_POLICY)
        assert result['coverage']['evaluated_units'] == 1
    assert len(calls) == 2
    per_unit, batch = calls
    assert batch['state'] == {'context': TEXT_PROXY_CONTEXT}
    instructions = batch['questions']['u0']['instructions']
    assert instructions['rule'] == per_unit['questions']['relation']['instructions']
    assert {key: instructions[key] for key in ('claim', 'cited_sources', 'source_context')} == per_unit['state']
    assert batch['questions']['u0']['criteria'] == per_unit['questions']['relation']['criteria']
    assert result['batch_metadata']['prompt_version'] == TEXT_PROXY_PROMPT_VERSION
    assert TEXT_PROXY_PROMPT_VERSION == 'citation-batch-choice-v7-reference-text-isolated'
    assert 'UNRELATED_PRIVATE_SOURCE' not in json.dumps(calls)
    assert references == original
