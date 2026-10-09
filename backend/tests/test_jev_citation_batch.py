import asyncio
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.llm.jev import JevClient, JevError
from app.modules.generation.jev_citation_batch import PROMPT_VERSION, audit_answer_batch


def provider_response(payload, *, input_tokens=1500):
    return {
        'model': 'jev-1.13.0',
        'usage': {'input_tokens': input_tokens, 'output_tokens': 30},
        'answers': {
            key: {'type': 'choice', 'choice': 'supported', 'confidence': .9,
                  'probabilities': {'supported': .9, 'contradicted': .05, 'insufficient': .05}}
            for key in payload['questions']
        },
    }


def frozen_candidate():
    path = Path(__file__).resolve().parents[1] / 'scripts' / 'jev_batch_candidate.py'
    spec = importlib.util.spec_from_file_location('jev_frozen_batch_contract', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_single_request_matches_frozen_prompt_and_keeps_sources_per_question():
    calls = []
    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        return httpx.Response(200, json=provider_response(payload))
    client = JevClient('test-key', transport=httpx.MockTransport(handler))
    references = {
        '1': {'content_type': 'doc', 'content': 'source-one-private'},
        '2': SimpleNamespace(content_type='doc', content='source-two-private'),
        '99': {'content_type': 'doc', 'content': 'unrelated-never-send'},
    }
    answer = '项目上限600次[1]。Logs last 365 days[2].'
    original = copy.deepcopy(references)
    result = await audit_answer_batch(client, answer, references)
    assert len(calls) == 1
    assert calls[0]['state'] == {}
    expected_units = [
        {'claim': '项目上限600次', 'cited_sources': {'1': 'source-one-private'}},
        {'claim': 'Logs last 365 days', 'cited_sources': {'2': 'source-two-private'}},
    ]
    candidate = frozen_candidate()
    assert calls[0]['questions'] == candidate.build_questions(expected_units, with_background=False)
    assert PROMPT_VERSION == candidate.VERSION + '-isolated'
    assert 'unrelated-never-send' not in json.dumps(calls)
    assert references == original
    assert result['strategy'] == 'batch_choice' and result['diagnostic_only']
    assert result['coverage'] == {'cited_units': 2, 'evaluated_units': 2,
                                  'not_evaluated_units': 0, 'unattributed_spans': 0}
    assert [unit['citation_ids'] for unit in result['units']] == [['1'], ['2']]
    assert all(unit['result']['choice_support_signal'] for unit in result['units'])
    assert all('metadata' not in unit['result'] for unit in result['units'])
    assert json.dumps(result).count('input_tokens') == 1
    assert result['batch_metadata']['usage']['input_tokens'] == 1500
    assert result['batch_metadata']['estimated_usd'] == pytest.approx(1500 * .042 / 1e6)
    assert client.reserved_input_tokens == 1500
    assert 'source-one-private' not in json.dumps(result)
    assert '项目上限600次' not in json.dumps(result, ensure_ascii=False)
    assert all(len(unit['claim_sha256']) == 64 for unit in result['units'])


@pytest.mark.parametrize('label,probability,expected', [
    ('supported', .8, True), ('supported', .79, False),
    ('contradicted', .9, False), ('insufficient', .9, False),
])
@pytest.mark.asyncio
async def test_support_signal_keeps_frozen_threshold_and_does_not_invent_noul(label, probability, expected):
    def handler(request):
        response = provider_response(json.loads(request.content))
        response['answers']['u0'] = {
            'type': 'choice', 'choice': label, 'confidence': probability,
            'probabilities': {key: probability if key == label else (1 - probability) / 2
                              for key in ('supported', 'contradicted', 'insufficient')},
        }
        return httpx.Response(200, json=response)
    client = JevClient('test-key', transport=httpx.MockTransport(handler))
    result = await audit_answer_batch(client, 'Claim[1].',
                                      {'1': {'content_type': 'doc', 'content': 'source'}})
    decision = result['units'][0]['result']
    assert decision['status'] == 'evaluated'
    assert decision['choice_support_signal'] is expected
    assert set(decision['answers']) == {'relation'}
    assert 'factorized_support_signal' not in decision


@pytest.mark.parametrize('answer,references,reason', [
    ('claim[9]', {}, 'missing_reference'),
    ('claim[1]', {'1': {'content_type': 'doc', 'content': ' '}}, 'empty_source'),
    ('claim[1]', {'1': {'content_type': 'image', 'content': 'caption'}}, 'non_text_source'),
    ('claim[1]', {'1': {'content_type': 'doc', 'content': 'x' * 12001}}, 'source_too_large'),
    ('x' * 4001 + '[1]', {'1': {'content_type': 'doc', 'content': 'source'}}, 'invalid_claim'),
    ('claim' + ''.join(f'[{i}]' for i in range(11)), {}, 'invalid_citation_ids'),
])
@pytest.mark.asyncio
async def test_invalid_unit_does_not_make_a_provider_call(answer, references, reason):
    client = SimpleNamespace(evaluate=AsyncMock())
    result = await audit_answer_batch(client, answer, references)
    client.evaluate.assert_not_awaited()
    assert result['units'][0]['result']['reason'] == reason
    assert result['coverage']['evaluated_units'] == 0
    assert 'batch_metadata' not in result


@pytest.mark.asyncio
async def test_invalid_units_do_not_shift_provider_answers_onto_other_offsets():
    calls = []
    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        return httpx.Response(200, json=provider_response(payload))
    client = JevClient('test-key', transport=httpx.MockTransport(handler))
    answer = 'Missing evidence[9]. Valid fact[1].'
    result = await audit_answer_batch(client, answer, {'1': {'content_type': 'doc', 'content': 'valid'}})
    assert list(calls[0]['questions']) == ['u0']
    assert calls[0]['questions']['u0']['instructions']['claim'] == 'Valid fact'
    assert result['units'][0]['result']['reason'] == 'missing_reference'
    assert result['units'][1]['result']['status'] == 'evaluated'
    assert answer[result['units'][1]['start']:result['units'][1]['end']].strip() == 'Valid fact[1]'


@pytest.mark.parametrize('max_units,expected', [(2, 2), (8, 8), (100, 8), (0, 0)])
@pytest.mark.asyncio
async def test_batch_never_exceeds_eight_units_or_the_lower_caller_limit(max_units, expected):
    calls = []
    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        return httpx.Response(200, json=provider_response(payload))
    client = JevClient('test-key', transport=httpx.MockTransport(handler))
    answer = '\n'.join(f'Claim {i}[1].' for i in range(9))
    result = await audit_answer_batch(client, answer, {'1': {'content_type': 'doc', 'content': 'source'}},
                                      max_units=max_units)
    assert len(calls) == int(expected > 0)
    if expected:
        assert len(calls[0]['questions']) == expected
    assert result['coverage']['cited_units'] == 9
    assert result['coverage']['evaluated_units'] == expected
    assert all(unit['result']['reason'] == 'unit_limit' for unit in result['units'][expected:])


@pytest.mark.parametrize('error,reason', [
    (JevError('http_429'), 'http_429'),
    (JevError('request_too_large'), 'request_too_large'),
    (RuntimeError('sensitive-provider-body'), 'diagnostic_error'),
])
@pytest.mark.asyncio
async def test_request_error_marks_all_eligible_units_without_retries(error, reason):
    client = SimpleNamespace(evaluate=AsyncMock(side_effect=error))
    result = await audit_answer_batch(client, 'First[1]. Second[2]. Missing[9].', {
        '1': {'content_type': 'doc', 'content': 'one'},
        '2': {'content_type': 'doc', 'content': 'two'},
    })
    client.evaluate.assert_awaited_once()
    assert [unit['result']['reason'] for unit in result['units']] == [reason, reason, 'missing_reference']
    assert result['coverage']['evaluated_units'] == 0
    assert 'batch_metadata' not in result
    assert 'sensitive-provider-body' not in json.dumps(result)


@pytest.mark.asyncio
async def test_incomplete_provider_response_does_not_leave_partial_success():
    calls = []
    def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        response = provider_response(payload)
        del response['answers']['u1']
        return httpx.Response(200, json=response)
    client = JevClient('test-key', transport=httpx.MockTransport(handler))
    result = await audit_answer_batch(client, 'First[1]. Second[1].',
                                      {'1': {'content_type': 'doc', 'content': 'source'}})
    assert len(calls) == 1
    assert [unit['result']['reason'] for unit in result['units']] == ['incomplete_answers'] * 2
    assert client.reserved_input_tokens > 1500
    assert 'batch_metadata' not in result


@pytest.mark.parametrize('budget,source,reason', [
    (0, 'source', 'budget_exhausted'),
    (250000, '中' * 12000, 'request_too_large'),
])
@pytest.mark.asyncio
async def test_client_budget_and_request_size_are_enforced_without_fallback(budget, source, reason):
    def handler(request):
        raise AssertionError('No network call should be attempted')
    client = JevClient('test-key', max_input_tokens=budget, transport=httpx.MockTransport(handler))
    result = await audit_answer_batch(client, 'First[1]. Second[1].',
                                      {'1': {'content_type': 'doc', 'content': source}})
    assert [unit['result']['reason'] for unit in result['units']] == [reason] * 2
    assert client.reserved_input_tokens == 0


@pytest.mark.asyncio
async def test_total_deadline_cancels_and_joins_the_single_request():
    finished = asyncio.Event()
    async def handler(request):
        try:
            await asyncio.sleep(10)
        finally:
            finished.set()
    client = JevClient('test-key', timeout_s=10, transport=httpx.MockTransport(handler))
    result = await audit_answer_batch(client, 'First[1]. Second[1].',
                                      {'1': {'content_type': 'doc', 'content': 'source'}}, timeout_s=.02)
    assert finished.is_set()
    assert [unit['result']['reason'] for unit in result['units']] == ['answer_deadline'] * 2
    assert client.reserved_input_tokens > 0
    assert 'batch_metadata' not in result


@pytest.mark.asyncio
async def test_caller_cancellation_propagates_and_joins_network_work():
    entered, finished = asyncio.Event(), asyncio.Event()
    async def handler(request):
        entered.set()
        try:
            await asyncio.sleep(10)
        finally:
            finished.set()
    client = JevClient('test-key', timeout_s=10, transport=httpx.MockTransport(handler))
    task = asyncio.create_task(audit_answer_batch(
        client, 'Claim[1].', {'1': {'content_type': 'doc', 'content': 'source'}}))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert finished.is_set()
    assert client.reserved_input_tokens > 0


@pytest.mark.asyncio
async def test_no_units_preserves_gaps_without_a_provider_call():
    client = SimpleNamespace(evaluate=AsyncMock())
    result = await audit_answer_batch(client, 'This has no citation.', {})
    client.evaluate.assert_not_awaited()
    assert result['coverage'] == {'cited_units': 0, 'evaluated_units': 0,
                                  'not_evaluated_units': 0, 'unattributed_spans': 1}
    assert result['gaps'][0]['reason'] == 'uncited_prose'
    assert 'batch_metadata' not in result


@pytest.mark.asyncio
async def test_opt_in_dispatch_uses_the_shared_client(monkeypatch):
    from app.core.config import settings
    from app.modules.generation.jev_answer_audit import maybe_audit_answer
    shared = object()
    batch = AsyncMock(return_value={'strategy': 'batch_choice'})
    monkeypatch.setattr(settings, 'jev_citation_mode', 'shadow')
    monkeypatch.setattr(settings, 'jev_citation_strategy', 'batch_choice')
    monkeypatch.setattr('app.core.llm.jev.get_jev_client', lambda: shared)
    monkeypatch.setattr('app.modules.generation.jev_citation_batch.audit_answer_batch', batch)
    result = await maybe_audit_answer('Claim[1]', {})
    from app.modules.generation.jev_answer_audit import EXTRACTOR_VERSION
    from app.modules.generation.decision_citation_sources import SOURCE_POLICY
    batch.assert_awaited_once_with(shared, 'Claim[1]', {}, timeout_s=settings.jev_timeout_s,
                                  extractor_version=EXTRACTOR_VERSION, source_policy=SOURCE_POLICY)
    assert result == {'strategy': 'batch_choice'}
