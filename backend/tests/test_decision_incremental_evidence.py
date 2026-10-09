"""Production v2 compares complete baseline evidence, with bounded atomic work."""
import asyncio
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.llm.jev import JevError
from app.modules.retrieval.decision_evidence import (
    LEGACY_POLICY_VERSION, POLICY_VERSION, PROMPT_VERSION, MAX_INPUT_BYTES,
    duplicate_reason, supplement_evidence,
)
from app.modules.retrieval.reranker import Reranker


def doc(identity, text, *, source=None):
    return {'id': identity, 'content_type': 'doc', 'total_score': .02, 'final_score': .41,
            'rerank_score': .5, 'payload': {'text_content': text, 'file_id': source or identity,
                                          'kb_id': 'authorized', 'file_name': identity + '.txt'}}


def client_fixture(signals=None):
    calls = []
    async def evaluate(state, questions, *, prompt_version):
        calls.append({'state': copy.deepcopy(state), 'questions': copy.deepcopy(questions),
                      'prompt_version': prompt_version})
        answers = {}
        for key, question in questions.items():
            field = key.split('_', 1)[1]
            passage = question['instructions']['candidate']
            value = (signals or {}).get(passage, {}).get(field, .95)
            answers[key] = {'type': 'noul', 'noul': value}
        return SimpleNamespace(answers=answers, metadata=lambda: {
            'model': 'decision-test', 'usage': {'input_tokens': 100, 'output_tokens': 0},
            'route': 'typesafe', 'prompt_version': prompt_version,
        })
    return SimpleNamespace(evaluate=evaluate, timeout_s=3.0), calls


async def run(client, baseline, candidates):
    return await supplement_evidence('机构甲2026年的服务限制和例外是什么？', baseline, candidates, candidates,
                                     client_factory=lambda: client,
                                     modality=lambda row: row.get('content_type', 'doc'))


@pytest.mark.asyncio
async def test_novel_useful_evidence_preserves_baseline_and_uses_independent_nouls():
    baseline = [doc('base', '机构甲标准方案每日限额600次。')]
    candidates = [doc('same-topic', '这是服务产品介绍。'),
                  doc('paraphrase', '标准套餐每天允许六百次。'),
                  doc('exception', '机构甲2026年企业套餐不适用每日600次限制。'),
                  doc('wrong-entity', '机构乙2026年无需限额。')]
    signals = {
        candidates[0]['payload']['text_content']: {'direct_usefulness': .2},
        candidates[1]['payload']['text_content']: {'incremental_information': .2},
        candidates[3]['payload']['text_content']: {'direct_usefulness': .1},
    }
    client, calls = client_fixture(signals)
    before = copy.deepcopy((baseline, candidates))
    result, info = await run(client, baseline, candidates)
    assert result[:1] == baseline and result[0] is baseline[0]
    assert info['added_ids'] == ['exception']
    assert result[1]['final_score'] == .41 and result[1]['rerank_score'] == .5
    assert result[1]['metadata']['decision_assist']['signals'] == {
        'direct_usefulness': .95, 'incremental_information': .95,
    }
    assert 'confidence' not in result[1]['metadata']['decision_assist']
    assert len(calls) == 2 and all(len(call['questions']) == 4 for call in calls)
    assert all(call['prompt_version'] == PROMPT_VERSION for call in calls)
    assert all(call['state']['baseline'][0]['text'] == baseline[0]['payload']['text_content'] for call in calls)
    assert all(question['type'] == 'noul' for call in calls for question in call['questions'].values())
    assert info['policy_version'] == POLICY_VERSION
    assert info['usage']['input_tokens'] == 200
    assert info['candidate_decisions'][0]['file_name'] == 'same-topic.txt'
    assert [item['accepted'] for item in info['candidate_decisions']] == [False, False, True, False]
    assert (baseline, candidates) == before


@pytest.mark.asyncio
async def test_diversity_applies_only_to_additions_and_never_blends_probability_into_scores():
    client, _ = client_fixture()
    base = [doc('base', '基础额度为600。')]
    candidates = [doc('a', '新增例外甲。', source='shared'), doc('b', '新增例外乙。', source='shared'),
                  doc('c', '新增限制丙。', source='different')]
    result, info = await run(client, base, candidates)
    assert info['added_ids'] == ['a', 'c']
    assert result[0] is base[0]
    assert all(row['accepted'] for row in info['candidate_decisions'])  # Gate passed, cap still applies.


def test_dedup_preserves_negations_numbers_units_and_relationship_order():
    baseline = '机构甲向机构乙支付600元，每月结算一次，不允许提前结算。' * 3
    assert duplicate_reason(baseline, [baseline]) == 'duplicate_text'
    assert duplicate_reason('  ' + baseline + '\n', [baseline]) == 'duplicate_text'
    for changed in (baseline.replace('600', '601'), baseline.replace('不允许', '允许'),
                    baseline.replace('每月', '每日'), baseline.replace('甲向机构乙', '乙向机构甲')):
        assert duplicate_reason(changed, [baseline]) is None
    # Even a 99% overlap cannot erase a negation added immediately before a text.
    positive = '允许' + '机构甲在2026年使用该服务所规定的全部测试能力。' * 3
    assert duplicate_reason(positive, ['不' + positive]) is None
    assert duplicate_reason(baseline, ['说明。' + baseline]) == 'contained_duplicate'
    assert duplicate_reason(baseline + '但2027年停止适用。', [baseline]) is None


@pytest.mark.asyncio
async def test_duplicates_of_baseline_or_candidates_are_removed_before_calls():
    client, calls = client_fixture()
    baseline = [doc('base', '机构甲标准方案每日限额600次。')]
    candidates = [doc('copy', '机构甲标准方案每日限额600次。'), doc('a', '企业套餐不受限制。'),
                  doc('b', '企业套餐不受限制。')]
    result, info = await run(client, baseline, candidates)
    assert info['skip_reasons'] == {'duplicate_text': 2}
    assert info['added_ids'] == ['a']
    assert len(calls) == 1 and len(calls[0]['questions']) == 2


@pytest.mark.asyncio
async def test_baseline_contains_complete_text_and_all_available_media_proxies():
    client, calls = client_fixture()
    baseline = [doc('base', 'a' * 700 + '最后的关键例外。'),
                {'id': 'audio', 'content_type': 'audio', 'payload': {'transcript': '完整歌词', 'description': '音乐描述'}},
                {'id': 'video', 'content_type': 'video', 'payload': {'scene_summary': '场景摘要', 'caption': '画面描述',
                                                                    'asr_text': '完整语音', 'description': '视频描述'}}]
    _, info = await run(client, baseline, [doc('extra', '另有可用事实。')])
    assert info['baseline_comparison'] == 'complete_available_text'
    evidence = calls[0]['state']['baseline']
    assert evidence[0]['text'].endswith('最后的关键例外。')
    assert evidence[1]['text'] == '完整歌词\n音乐描述'
    assert evidence[2]['text'] == '场景摘要\n画面描述\n完整语音\n视频描述'
    assert [row['basis'] for row in evidence] == ['source_text', 'derived_text', 'derived_text']


@pytest.mark.parametrize('baseline,reason', [
    ([], 'empty_baseline'),
    ([doc('base', 'x' * 12001)], 'baseline_outside_bounds'),
    ([{'id': 'image', 'content_type': 'image', 'payload': {}}], 'baseline_text_unavailable'),
])
@pytest.mark.asyncio
async def test_incomplete_or_oversize_baseline_abstains_instead_of_comparing_a_prefix(baseline, reason):
    client = SimpleNamespace(evaluate=AsyncMock())
    result, info = await run(client, baseline, [doc('extra', '新增事实')])
    assert result is baseline and info['reason'] == reason
    client.evaluate.assert_not_awaited()


@pytest.mark.asyncio
async def test_utf8_budget_skips_whole_candidate_and_never_truncates():
    client, calls = client_fixture()
    baseline = [doc('base', '汉' * 7500)]
    huge = '词' * 3000
    _, info = await run(client, baseline, [doc('big', huge), doc('small', '新增例外。')])
    assert info['skip_reasons'] == {'input_budget': 1}
    assert info['added_ids'] == ['small']
    assert len(calls) == 1
    payload = calls[0]
    assert len(json.dumps({'state': payload['state'], 'questions': payload['questions']},
                          ensure_ascii=False).encode()) <= MAX_INPUT_BYTES
    assert payload['state']['baseline'][0]['text'] == '汉' * 7500
    assert huge not in json.dumps(payload, ensure_ascii=False)


@pytest.mark.asyncio
async def test_candidate_limit_and_microbatch_concurrency_are_bounded():
    active = peak = 0
    underlying, calls = client_fixture()
    async def evaluate(*args, **kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(.001)
            return await underlying.evaluate(*args, **kwargs)
        finally:
            active -= 1
    client = SimpleNamespace(evaluate=evaluate, timeout_s=1)
    _, info = await run(client, [doc('base', '基准事实。')], [doc(str(i), f'独立候选事实{i}。') for i in range(12)])
    assert info['candidate_count'] == info['evaluated_count'] == 8
    assert len(calls) == 4 and peak == 2 and active == 0
    assert info['skip_reasons'] == {'candidate_limit': 4}


@pytest.mark.asyncio
async def test_later_failure_preserves_partial_receipts_but_no_partial_addition():
    underlying, _ = client_fixture()
    async def evaluate(state, questions, **kwargs):
        if 'e2_direct_usefulness' in questions:
            await asyncio.sleep(.01)
            raise JevError('http_503')
        return await underlying.evaluate(state, questions, **kwargs)
    base = [doc('base', '基准。')]
    result, info = await run(SimpleNamespace(evaluate=evaluate), base,
                             [doc(str(i), f'独立事实{i}。') for i in range(4)])
    assert result is base
    assert info['reason'] == 'http_503' and info['evaluated_count'] == 0
    assert info['added_ids'] == info['candidate_decisions'] == []
    assert [row['status'] for row in info['requests']] == ['evaluated', 'failed']


@pytest.mark.parametrize('bad', [True, float('nan'), 1.2])
@pytest.mark.asyncio
async def test_injected_invalid_noul_is_atomic(bad):
    underlying, _ = client_fixture()
    async def evaluate(*args, **kwargs):
        response = await underlying.evaluate(*args, **kwargs)
        response.answers['e1_incremental_information']['noul'] = bad
        return response
    base = [doc('base', '基准。')]
    result, info = await run(SimpleNamespace(evaluate=evaluate), base,
                             [doc('first', '第一条新事实。'), doc('second', '第二条新事实。')])
    assert result is base and info['reason'] == 'invalid_score'
    assert info['added_ids'] == []


@pytest.mark.asyncio
async def test_total_deadline_cancels_and_joins_inflight_microbatches():
    entered = finished = 0
    async def evaluate(*args, **kwargs):
        nonlocal entered, finished
        entered += 1
        try:
            await asyncio.sleep(10)
        finally:
            finished += 1
    base = [doc('base', '基准。')]
    result, info = await run(SimpleNamespace(evaluate=evaluate, timeout_s=.02), base,
                             [doc(str(i), f'独立事实{i}。') for i in range(8)])
    assert result is base and info['reason'] == 'timeout'
    assert entered == finished == 2
    assert info['attempted_count'] == 4
    assert [row['status'] for row in info['requests']] == ['cancelled', 'cancelled', 'not_started', 'not_started']


@pytest.mark.asyncio
async def test_caller_cancellation_propagates_and_joins_children():
    entered, finished = asyncio.Event(), asyncio.Event()
    async def evaluate(*args, **kwargs):
        entered.set()
        try:
            await asyncio.Future()
        finally:
            finished.set()
    task = asyncio.create_task(run(SimpleNamespace(evaluate=evaluate),
                                   [doc('base', '基准。')], [doc('extra', '例外。')]))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert finished.is_set()


@pytest.mark.asyncio
async def test_reranker_explicit_v2_replay_and_off_never_calls_decision():
    from app.core.llm.manager import LLMCallResult
    ranker = Reranker()
    ranker.decision_evidence_policy = POLICY_VERSION
    ranker.llm_manager = SimpleNamespace(rerank=AsyncMock(side_effect=lambda **kw: LLMCallResult(
        success=True, data=[{'index': i, 'relevance_score': .9 - i * .02}
                            for i in range(len(kw['documents']))])))
    ranker.jev_client, calls = client_fixture()
    raw = {'dense': [doc(str(i), f'候选来源{i}提供独立事实。') for i in range(13)]}
    ranker.jev_mode = 'off'
    baseline = await ranker.rerank('问题', raw)
    assert calls == []
    ranker.jev_mode = 'assist'
    out = await ranker.rerank('问题', raw)
    assert out['scorer']['policy_version'] == POLICY_VERSION
    assert out['results'][:10] == baseline['results']
    assert out['scorer']['added_ids'] == ['10', '11']
