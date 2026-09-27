import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.generation.jev_answer_audit import extract_citation_units, audit_answer


def test_wrong_attribution_cannot_borrow_evidence_from_other_sentence():
    parsed = extract_citation_units('限额600次[2]。日志保留365天[1]。')
    assert [(u['claim'],u['citation_ids']) for u in parsed['units']]==[('限额600次',['2']),('日志保留365天',['1'])]
    assert not parsed['gaps']


def test_uncited_sentence_never_inherits_later_citation_and_decimal_is_not_split():
    answer='没有出处的结论。参数为2.5毫秒。 [1][2]\n这个结论没有引用。'
    parsed=extract_citation_units(answer)
    assert len(parsed['units'])==1
    assert parsed['units'][0]['claim']=='参数为2.5毫秒。'
    assert parsed['units'][0]['citation_ids']==['1','2']
    assert len(parsed['gaps'])==2
    unit=parsed['units'][0]
    assert answer[unit['start']:unit['end']].strip()=='参数为2.5毫秒。 [1][2]'


def test_code_links_tables_and_headings_are_not_claims():
    answer='# 标题[1]\n```python\nx=[1]\n```\n|内容[1]|\n[1](https://example.org)\n`a[7]` 默认3次[2]。'
    parsed=extract_citation_units(answer)
    assert len(parsed['units'])==1
    assert parsed['units'][0]['citation_ids']==['2']
    assert parsed['units'][0]['claim']=='`a[7]` 默认3次'
    assert len(parsed['gaps'])>=5


@pytest.mark.parametrize('marker', ['1. ', '12. ', '2) ', '- '])
def test_list_marker_is_neither_a_sentence_boundary_nor_uncited_prose(marker):
    answer = f'{marker}Limit is 600[1].'
    parsed = extract_citation_units(answer)
    assert not parsed['gaps']
    assert len(parsed['units']) == 1
    unit = parsed['units'][0]
    assert unit['claim'] == 'Limit is 600'
    assert answer[unit['start']:unit['end']] == f'{marker}Limit is 600[1]'


@pytest.mark.parametrize('claim', [
    'The U.S. limit is 600',
    'Atlas v1 has a limit of 600, e.g. 600 requests each day',
    'Dr. Smith set the limit to 600',
    'Document No. 3 specifies 600 requests',
])
def test_abbreviations_do_not_remove_entities_or_conditions(claim):
    parsed = extract_citation_units(f'{claim}[1].')
    assert not parsed['gaps']
    assert [unit['claim'] for unit in parsed['units']] == [claim]


@pytest.mark.parametrize('answer', [
    'The office is in the U.S. It has a limit of 600[1].',
    'The U.S. API limit is 600[1].',
    'J. Smith set the limit to 600[1].',
])
def test_ambiguous_abbreviation_endings_never_audit_a_detached_claim(answer):
    parsed = extract_citation_units(answer)
    assert not parsed['units']
    assert parsed['gaps'] == [{'start': 0, 'end': answer.index('[1]') + 3,
                              'reason': 'ambiguous_sentence_boundary'}]


def test_ambiguous_prior_sentence_does_not_hide_a_later_clear_sentence():
    answer = 'The office is in the U.S. Local rules apply. Limit is 600[1].'
    parsed = extract_citation_units(answer)
    assert [unit['claim'] for unit in parsed['units']] == ['Limit is 600']
    assert len(parsed['gaps']) == 1
    assert parsed['gaps'][0]['reason'] == 'uncited_prose'
    assert answer[:parsed['gaps'][0]['end']] == 'The office is in the U.S. Local rules apply.'


@pytest.mark.parametrize('separator', [', ', '，', '、'])
def test_comma_separated_citations_belong_to_the_same_claim(separator):
    answer = f'Limit is 600[1]{separator}[2].'
    parsed = extract_citation_units(answer)
    assert not parsed['gaps']
    assert len(parsed['units']) == 1
    assert parsed['units'][0]['claim'] == 'Limit is 600'
    assert parsed['units'][0]['citation_ids'] == ['1', '2']


@pytest.mark.asyncio
async def test_punctuation_and_ambiguous_claims_never_call_the_model(monkeypatch):
    audit = AsyncMock(return_value={'status': 'evaluated'})
    monkeypatch.setattr('app.modules.generation.jev_answer_audit.audit_claim', audit)
    out = await audit_answer(None, '，；：[1]\nThe U.S. API limit is 600[1].',
                             {'1': {'content_type': 'doc', 'content': 'Other limit is 600'}})
    audit.assert_not_awaited()
    assert out['extractor_version'] == 'trailing-citations-v2'
    assert out['coverage']['evaluated_units'] == 0
    assert {gap['reason'] for gap in out['gaps']} == {
        'citation_without_claim', 'ambiguous_sentence_boundary'}


@pytest.mark.parametrize('answer', [
    'Limit is 600[1] per second.',
    'Limit is 600[1] per second[2].',
    '服务上限为600[1]次/分钟。',
    '服务上限为600[1]次/分钟[2]。',
    'The U.S.[1] limit is 600[2].',
])
@pytest.mark.asyncio
async def test_nonterminal_citations_do_not_audit_claims_without_qualifiers(monkeypatch, answer):
    audit = AsyncMock(return_value={'status': 'evaluated'})
    monkeypatch.setattr('app.modules.generation.jev_answer_audit.audit_claim', audit)
    out = await audit_answer(None, answer, {
        '1': {'content_type': 'doc', 'content': 'Daily limit is 600.'},
        '2': {'content_type': 'doc', 'content': 'Daily limit is 600.'},
    })
    audit.assert_not_awaited()
    assert not out['units']
    assert out['gaps'][0]['reason'] == 'ambiguous_citation_position'


def test_new_sentence_after_ambiguous_citation_recovers_coverage():
    answer = 'Limit is 600[1] per second. Logs last 365 days[2].'
    parsed = extract_citation_units(answer)
    assert [unit['claim'] for unit in parsed['units']] == ['Logs last 365 days']
    assert parsed['units'][0]['citation_ids'] == ['2']
    assert parsed['gaps'][0]['reason'] == 'ambiguous_citation_position'


@pytest.mark.parametrize('answer', [
    'Limit is 600.[1] Logs last 365 days[2].',
    '上限600。 [1] 日志保留365天[2]。',
])
def test_citation_after_terminal_punctuation_still_belongs_to_prior_sentence(answer):
    parsed = extract_citation_units(answer)
    assert len(parsed['units']) == 2
    assert not parsed['gaps']
    assert [unit['citation_ids'] for unit in parsed['units']] == [['1'], ['2']]


@pytest.mark.asyncio
async def test_deadline_cancels_and_joins_tasks_and_preserves_partial_results(monkeypatch):
    finished=asyncio.Event()
    async def audit(client,claim,ids,refs):
        if ids==['1']: return {'status':'evaluated'}
        try: await asyncio.sleep(10)
        finally: finished.set()
    monkeypatch.setattr('app.modules.generation.jev_answer_audit.audit_claim',audit)
    refs={str(i):{'content_type':'doc','content':'text'} for i in [1,2]}
    out=await audit_answer(None,'第一句[1]。第二句[2]。',refs,timeout_s=.02)
    assert out['coverage']=={'cited_units':2,'evaluated_units':1,'not_evaluated_units':1,'unattributed_spans':0}
    assert out['units'][1]['result']['reason']=='answer_deadline'
    assert finished.is_set()


@pytest.mark.asyncio
async def test_cancel_propagates_and_no_orphan_network_tasks(monkeypatch):
    entered=asyncio.Event();finished=asyncio.Event()
    async def audit(*args):
        entered.set()
        try: await asyncio.sleep(10)
        finally: finished.set()
    monkeypatch.setattr('app.modules.generation.jev_answer_audit.audit_claim',audit)
    task=asyncio.create_task(audit_answer(None,'A[1]',{'1':{'content_type':'doc','content':'text'}}))
    await entered.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert finished.is_set()


@pytest.mark.asyncio
async def test_caps_media_scope_and_no_claim_text_in_diagnostics(monkeypatch):
    audit=AsyncMock(return_value={'status':'evaluated'})
    monkeypatch.setattr('app.modules.generation.jev_answer_audit.audit_claim',audit)
    out=await audit_answer(None,'secretA[1]。B[2]。C[3]。',{
        '1':SimpleNamespace(content_type='doc',content='authorized text'),
        '2':SimpleNamespace(content_type='image',content='caption'),
        '3':SimpleNamespace(content_type='doc',content='other')},max_units=2)
    audit.assert_awaited_once_with(None,'secretA',['1'],{'1':'authorized text'})
    assert out['units'][1]['result']['reason']=='non_text_source'
    assert out['units'][2]['result']['reason']=='unit_limit'
    assert 'secretA' not in str(out) and 'authorized text' not in str(out)
