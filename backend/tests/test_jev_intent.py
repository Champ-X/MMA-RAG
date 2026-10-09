"""Safeguards and delegation contracts; accuracy uses the frozen real API set."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.llm.jev import JevClient, JevError, JevRequiredError
from app.modules.retrieval.processors import intent as module
from app.modules.retrieval.processors.jev_intent import classify_intent, intent_questions, merge_required_modalities
from test_decision_plan import proposal


def decision(prob=.9, complex_prob=.05, context_prob=.05, *, signals=None, confidence=.9):
    categories = intent_questions()['intent_type']['criteria']
    answers = {'intent_type': {'type': 'choice', 'choice': 'factual',
                              'probabilities': {key: prob if key == 'factual' else (1-prob)/4
                                                for key in categories}, 'confidence': confidence}}
    values = {key: .05 for key, question in intent_questions().items() if question['type'] == 'noul'}
    values.update(is_complex=complex_prob, needs_context=context_prob)
    values.update(signals or {})
    for modality in ('image', 'audio', 'video'):
        if values[modality + '_required'] >= .85 and modality + '_helpful' not in (signals or {}):
            values[modality + '_helpful'] = .95
    answers.update({key: {'type': 'noul', 'noul': value} for key, value in values.items()})
    return SimpleNamespace(answers=answers,metadata=lambda:{'prompt_version':'test'})


@pytest.mark.asyncio
@pytest.mark.parametrize('prob,complex_prob,context_prob,accepted',[(.9,.05,.05,True),(.74,.05,.05,False),(.9,.21,.05,False),(.9,.05,.21,False)])
async def test_all_fields_and_both_fallback_gates(prob,complex_prob,context_prob,accepted):
    client=SimpleNamespace(evaluate=AsyncMock(return_value=decision(prob,complex_prob,context_prob)))
    analysis, info=await classify_intent(client,'不要图片，查询image_timeout默认值')
    assert info['accepted']==accepted
    assert analysis['refined_query']=='不要图片，查询image_timeout默认值'
    assert analysis['sub_queries']==[]


@pytest.mark.asyncio
async def test_accepted_semantic_decision_survives_keyword_validator(monkeypatch):
    processor=module.IntentProcessor();processor.jev_mode='force'
    client=SimpleNamespace(evaluate=AsyncMock(return_value=decision()))
    monkeypatch.setattr(module,'get_jev_client',lambda:client)
    processor._process_generative=AsyncMock(side_effect=AssertionError('unnecessary generator'))
    result=await processor.process('不要图片，只查image_timeout参数')
    assert result['visual_intent']=='unnecessary'
    assert result['jev_decision']['accepted']


@pytest.mark.asyncio
@pytest.mark.parametrize('history,attachment',[([{'role':'user','content':'上一个问题'}],None),([], '用户附件描述')])
async def test_history_and_attachments_never_call_jev(monkeypatch,history,attachment):
    processor=module.IntentProcessor();processor.jev_mode='adaptive'
    monkeypatch.setattr(module,'get_jev_client',lambda:pytest.fail('context sent to closed classifier'))
    processor._process_generative=AsyncMock(return_value={'sub_queries':['保留复杂分解']})
    result=await processor.process('继续',history,attachment)
    processor._process_generative.assert_awaited_once_with('继续',history,attachment,include_source_proposals=True)
    assert result['sub_queries']==['保留复杂分解']
    assert not result['jev_decision']['accepted']


@pytest.mark.asyncio
@pytest.mark.parametrize('reason',['timeout','budget_exhausted','invalid_probabilities'])
async def test_failure_uses_original_handler(monkeypatch,reason):
    processor=module.IntentProcessor();processor.jev_mode='adaptive'
    monkeypatch.setattr(module,'get_jev_client',lambda:SimpleNamespace(evaluate=AsyncMock(side_effect=JevError(reason))))
    processor._process_generative=AsyncMock(return_value={'refined_query':'原始生成式改写','sub_queries':['子查询'], 'source_proposals':[proposal()]})
    result=await processor.process('不要图片')
    assert result['jev_decision']['reason']==reason
    assert result['sub_queries']==['子查询']


@pytest.mark.asyncio
async def test_cancellation_does_not_repeat_generative_plan(monkeypatch):
    processor=module.IntentProcessor();processor.jev_mode='adaptive'
    monkeypatch.setattr(module,'get_jev_client',lambda:SimpleNamespace(evaluate=AsyncMock(side_effect=asyncio.CancelledError)))
    processor._process_generative=AsyncMock(return_value={'source_proposals':[proposal()]})
    with pytest.raises(asyncio.CancelledError):await processor.process('不要图片')
    processor._process_generative.assert_awaited_once()


@pytest.mark.parametrize('answer',[{'type':'choice','choice':'a','probabilities':{'a':.4,'b':.6},'confidence':.5}, {'type':'choice','choice':'a','probabilities':{'a':True,'b':0},'confidence':.5}, {'type':'choice','choice':'a','probabilities':{'a':.9},'confidence':.5}, {'type':'choice','choice':'a','probabilities':{'a':.8,'b':.8},'confidence':.5}])
def test_typed_choice_rejects_malformed_or_nonmaximal_selection(answer):
    with pytest.raises(JevError):JevClient._validate_answer(answer,{'type':'choice','criteria':{'a':'A','b':'B'}})


def test_rounded_choice_and_continuous_score():
    JevClient._validate_answer({'type':'choice','choice':'a','probabilities':{'a':.34,'b':.33,'c':.34},'confidence':.34},{'type':'choice','criteria':{'a':'A','b':'B','c':'C'}})
    JevClient._validate_answer({'type':'score','score':.5,'probabilities':{'0':.5,'1':.5},'confidence':.5},{'type':'score','criteria':['low','high']})
    with pytest.raises(JevError):JevClient._validate_answer({'type':'score','score':2,'probabilities':{'0':.5,'1':.5},'confidence':.5},{'type':'score','criteria':['low','high']})


@pytest.mark.asyncio
async def test_uncertain_result_keeps_generator_decomposition(monkeypatch):
    processor=module.IntentProcessor();processor.jev_mode='adaptive'
    monkeypatch.setattr(module,'get_jev_client',lambda:SimpleNamespace(evaluate=AsyncMock(return_value=decision(complex_prob=.9))))
    processor._process_generative=AsyncMock(return_value={'sub_queries':['事实A','事实B']})
    result=await processor.process('比较两个版本，并解释差异')
    assert result['sub_queries']==['事实A','事实B']
    assert result['jev_decision']['reason']=='no_proposals'


@pytest.mark.asyncio
@pytest.mark.parametrize('prob,complex_prob,context_prob', [
    (.74, .05, .05), (.9, .9, .05), (.9, .05, .9), (.4, .9, .9),
])
async def test_force_successful_call_abstains_when_semantic_gate_fails(monkeypatch, prob, complex_prob, context_prob):
    processor = module.IntentProcessor()
    processor.jev_mode = 'force'
    client = SimpleNamespace(evaluate=AsyncMock(return_value=decision(prob, complex_prob, context_prob)))
    monkeypatch.setattr(module, 'get_jev_client', lambda: client)
    processor._process_generative = AsyncMock(side_effect=AssertionError('forced stage fell back'))
    with pytest.raises(JevRequiredError) as error:
        await processor.process('介绍一下茶叶的驯化史')
    assert error.value.reason == 'uncertain_decision'
    info = error.value.decision_info
    assert info['forced'] and not info['accepted'] and not info['eligible']
    assert info['requirements']['planning']['complex_signal'] == complex_prob
    assert '介绍一下' not in str(info)
    client.evaluate.assert_awaited_once()
    processor._process_generative.assert_not_awaited()


@pytest.mark.asyncio
async def test_force_supplies_history_and_attachment_without_silent_truncation(monkeypatch):
    processor = module.IntentProcessor()
    processor.jev_mode = 'force'
    client = SimpleNamespace(evaluate=AsyncMock(return_value=decision(signals={'image_required': .95})))
    monkeypatch.setattr(module, 'get_jev_client', lambda: client)
    processor._process_generative = AsyncMock()
    history = [{'role': 'user', 'content': '介绍一下茶叶的驯化史'},
               {'role': 'assistant', 'content': '已有资料覆盖茶树的起源。'}]
    attachment = '用户图片内容：古茶树产地分布图'
    result = await processor.process('结合这张图继续', history, attachment)
    state, questions = client.evaluate.call_args.args
    assert state == {'query': '结合这张图继续', 'chat_history': history, 'attachment_context': attachment}
    assert 'already supplied is not missing' in questions['needs_context']['instructions']
    assert all('chat_history' in question['instructions'] for question in questions.values())
    assert result['jev_decision']['history_messages'] == 2
    assert result['jev_decision']['context_chars'] == sum(len(m['content']) for m in history) + len(attachment)
    assert result['jev_decision']['accepted']
    processor._process_generative.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('query,history,attachment,reason', [
    (' ', None, None, 'query_outside_bounds'),
    ('q' * 4001, None, None, 'query_outside_bounds'),
    (None, None, None, 'query_outside_bounds'),
    ('q', [{'role': 'user', 'content': 'h'}] * 13, None, 'context_outside_bounds'),
    ('q', [{'role': 'user', 'content': 'h' * 4001}], 'a' * 4000, 'context_outside_bounds'),
    ('q', None, 'a' * 8001, 'context_outside_bounds'),
    ('q', {'role': 'user', 'content': 'h'}, None, 'invalid_context'),
    ('q', [{'role': 'tool', 'content': 'h'}], None, 'invalid_context'),
    ('q', [{'role': [], 'content': 'h'}], None, 'invalid_context'),
    ('q', [{'role': 'user', 'content': None}], None, 'invalid_context'),
    ('q', None, {'secret': 'attachment'}, 'invalid_context'),
])
async def test_force_rejects_invalid_or_oversized_input_before_network(monkeypatch, query, history, attachment, reason):
    processor = module.IntentProcessor()
    processor.jev_mode = 'force'
    client = SimpleNamespace(evaluate=AsyncMock())
    monkeypatch.setattr(module, 'get_jev_client', lambda: client)
    processor._process_generative = AsyncMock()
    with pytest.raises(JevRequiredError) as error:
        await processor.process(query, history, attachment)
    assert error.value.stage == 'intent'
    assert error.value.reason == reason
    client.evaluate.assert_not_awaited()
    processor._process_generative.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('reason', ['timeout', 'budget_exhausted', 'invalid_probabilities', 'missing_key', 'http_429'])
async def test_force_failure_stops_without_generative_fallback(monkeypatch, reason):
    processor = module.IntentProcessor()
    processor.jev_mode = 'force'
    monkeypatch.setattr(module, 'get_jev_client', lambda: SimpleNamespace(evaluate=AsyncMock(side_effect=JevError(reason))))
    processor._process_generative = AsyncMock()
    with pytest.raises(JevRequiredError) as error:
        await processor.process('介绍一下茶叶的驯化史')
    assert error.value.stage == 'intent'
    assert error.value.reason == reason
    processor._process_generative.assert_not_awaited()


@pytest.mark.asyncio
async def test_force_unexpected_error_is_sanitized_and_cancellation_propagates(monkeypatch):
    processor = module.IntentProcessor()
    processor.jev_mode = 'force'
    evaluate = AsyncMock(side_effect=ValueError('private provider response'))
    monkeypatch.setattr(module, 'get_jev_client', lambda: SimpleNamespace(evaluate=evaluate))
    processor._process_generative = AsyncMock()
    with pytest.raises(JevRequiredError) as error:
        await processor.process('q')
    assert 'private provider response' not in str(error.value)
    evaluate.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await processor.process('q')
    processor._process_generative.assert_not_awaited()


@pytest.mark.asyncio
async def test_fast_path_still_runs_rewriter_and_exposes_local_diagnostics(monkeypatch):
    from app.modules.retrieval.service import RetrievalService
    service=RetrievalService.__new__(RetrievalService)
    service.intent_processor=module.IntentProcessor();service.intent_processor.jev_mode='force'
    monkeypatch.setattr(module,'get_jev_client',lambda:SimpleNamespace(evaluate=AsyncMock(return_value=decision())))
    service.query_rewriter=SimpleNamespace(rewrite=AsyncMock(return_value={'refined_query':'查询参数默认值','keywords':['参数'],'multi_view_queries':['参数取值']}))
    result=await service._preprocess_query('不要图片，只查image_timeout',[])
    assert result['visual_intent']=='unnecessary'
    assert result['refined_query']=='查询参数默认值'
    assert result['search_strategies']['multi_view_queries']==['参数取值']
    assert result['jev_decision']['accepted']
    service.query_rewriter.rewrite.assert_awaited_once()


def test_shared_budget_between_retrieval_stages(monkeypatch):
    import app.core.llm.jev as client_module
    from app.core.config import settings
    from app.modules.retrieval.reranker import Reranker
    shared=JevClient('test',max_input_tokens=1234)
    monkeypatch.setattr(client_module,'_shared_client',shared)
    monkeypatch.setattr(settings,'jev_rerank_mode','replace')
    assert Reranker().jev_client is module.get_jev_client() is shared


@pytest.mark.asyncio
async def test_independent_source_requirements_do_not_compete_with_each_other(monkeypatch):
    """A categorical majority must not hide a second requested medium."""
    processor = module.IntentProcessor(); processor.jev_mode = 'force'
    response = decision(signals={'image_required': .97, 'audio_required': .95,
                                 'video_forbidden': .98, 'grounding_required': .93})
    monkeypatch.setattr(module, 'get_jev_client', lambda: SimpleNamespace(evaluate=AsyncMock(return_value=response)))
    processor._process_generative = AsyncMock(side_effect=AssertionError('unnecessary planner'))
    result = await processor.process('依据访谈选插图及对应录音；不要视频')
    assert (result['visual_intent'], result['audio_intent'], result['video_intent']) == (
        'explicit_demand', 'explicit_demand', 'unnecessary')
    requirements = result['decision_requirements']
    assert requirements['modalities']['video']['status'] == 'forbidden'
    assert all(item['action'] == 'adopted' for item in requirements['modalities'].values())
    assert requirements['planning']['grounding_state'] == 'positive'
    assert requirements is result['jev_decision']['requirements']


@pytest.mark.asyncio
@pytest.mark.parametrize('signals,status', [
    ({'image_required': .5}, 'uncertain'),
    ({'image_forbidden': .5}, 'uncertain'),
    ({'image_helpful': .5}, 'uncertain'),
    ({'image_required': .9, 'image_forbidden': .9}, 'conflict'),
    ({'image_helpful': .9, 'image_forbidden': .9}, 'conflict'),
    ({'image_required': .9, 'image_helpful': .1}, 'conflict'),
    ({'image_required': .9, 'image_helpful': .5}, 'uncertain'),
])
async def test_force_does_not_convert_ambiguity_or_conflict_to_no_media(monkeypatch, signals, status):
    processor = module.IntentProcessor(); processor.jev_mode = 'force'
    evaluate = AsyncMock(return_value=decision(signals=signals))
    monkeypatch.setattr(module, 'get_jev_client', lambda: SimpleNamespace(evaluate=evaluate))
    processor._process_generative = AsyncMock()
    with pytest.raises(JevRequiredError) as error:
        await processor.process('Find the appropriate evidence')
    assert error.value.reason == 'uncertain_decision'
    record = error.value.decision_info['requirements']['modalities']['image']
    assert record['status'] == status
    assert record['action'] == 'abstained'
    assert record['effective_intent'] is None
    evaluate.assert_awaited_once()
    processor._process_generative.assert_not_awaited()


@pytest.mark.asyncio
async def test_complex_request_keeps_plan_and_adds_only_certain_independent_requirements(monkeypatch):
    from copy import deepcopy
    baseline = {'intent_type': 'comparison', 'is_complex': True, 'sub_queries': ['source A', 'source B'],
                'search_strategies': {'dense_query': 'resolved comparison', 'multi_view_queries': ['fact A']},
                'visual_intent': 'explicit_demand', 'audio_intent': 'unnecessary',
                'video_intent': 'implicit_enrichment', 'target_kb_ids': ['authorized']}
    original = deepcopy(baseline)
    response = decision(complex_prob=.96, signals={'image_helpful': .5, 'audio_required': .94})
    legacy, info = await classify_intent(SimpleNamespace(evaluate=AsyncMock(return_value=response)), 'Compare sources and find matching recordings')
    result, applied = merge_required_modalities(baseline, legacy['decision_requirements'])
    assert result['sub_queries'] == original['sub_queries']
    assert result['search_strategies'] == original['search_strategies']
    assert result['target_kb_ids'] == original['target_kb_ids']
    assert result['visual_intent'] == 'explicit_demand'
    assert result['video_intent'] == 'implicit_enrichment'
    assert result['audio_intent'] == 'explicit_demand'
    assert baseline == original
    assert not info['accepted'] and applied == ['audio']
    assert result['decision_requirements']['modalities']['audio']['action'] == 'added_required'
    assert result['decision_requirements']['task']['action'] == 'retained_baseline'


@pytest.mark.asyncio
@pytest.mark.parametrize('context_signal', [.16, .5, .99])
async def test_unresolved_context_never_adds_a_requirement_to_the_resolved_baseline(monkeypatch, context_signal):
    response = decision(context_prob=context_signal, signals={'audio_required': .99})
    legacy, _ = await classify_intent(SimpleNamespace(evaluate=AsyncMock(return_value=response)), 'Use the second one')
    result, applied = merge_required_modalities({'audio_intent': 'unnecessary', 'sub_queries': ['resolved task']}, legacy['decision_requirements'])
    assert result['audio_intent'] == 'unnecessary'
    assert result['sub_queries'] == ['resolved task']
    assert not applied


@pytest.mark.asyncio
@pytest.mark.parametrize('helpful,expected_status', [(.12, 'conflict'), (.6, 'uncertain')])
async def test_required_implies_helpful_is_a_consistency_constraint_not_independent_confidence(monkeypatch, helpful, expected_status):
    response = decision(complex_prob=.99, signals={'audio_required': .97, 'audio_helpful': helpful})
    legacy, _ = await classify_intent(SimpleNamespace(evaluate=AsyncMock(return_value=response)), 'Find the requested source material')
    result, applied = merge_required_modalities({'audio_intent': 'unnecessary', 'sub_queries': ['base']}, legacy['decision_requirements'])
    assert result['audio_intent'] == 'unnecessary'
    assert result['sub_queries'] == ['base']
    assert result['decision_requirements']['modalities']['audio']['status'] == expected_status
    assert not applied


@pytest.mark.asyncio
async def test_conflicts_retain_baseline_and_cannot_override_existing_exclusions(monkeypatch):
    response = decision(complex_prob=.95, signals={'image_forbidden': .99, 'audio_required': .99})
    legacy, _ = await classify_intent(SimpleNamespace(evaluate=AsyncMock(return_value=response)), 'Use the appropriate source restrictions')
    result, applied = merge_required_modalities({
        'visual_intent': 'explicit_demand', 'audio_intent': 'unnecessary', 'excluded_modalities': ['audio']}, legacy['decision_requirements'])
    assert result['visual_intent'] == 'explicit_demand'
    assert result['audio_intent'] == 'unnecessary'
    records = result['decision_requirements']['modalities']
    assert records['image']['action'] == records['audio']['action'] == 'conflict_retained_baseline'
    assert not applied


@pytest.mark.asyncio
@pytest.mark.parametrize('confidence', [.01, .5, .99])
async def test_choice_confidence_is_observed_not_a_second_accuracy_estimate(confidence):
    response = decision(confidence=confidence, signals={'grounding_required': .5})
    _, info = await classify_intent(SimpleNamespace(evaluate=AsyncMock(return_value=response)), 'lookup q')
    assert info['accepted']
    assert info['requirements']['task']['confidence'] == confidence
    assert info['requirements']['planning']['grounding_state'] == 'uncertain'


@pytest.mark.asyncio
@pytest.mark.parametrize('value,accepted', [(.15, True), (.150001, False), (.849999, False), (.85, True)])
async def test_frozen_signal_bands_have_explicit_boundaries(value, accepted):
    response = decision(signals={'image_helpful': value})
    _, info = await classify_intent(SimpleNamespace(evaluate=AsyncMock(return_value=response)), 'query')
    assert info['accepted'] is accepted


@pytest.mark.asyncio
async def test_partial_malformed_batch_cannot_add_any_requirement(monkeypatch):
    response = decision(signals={'audio_required': .99})
    del response.answers['video_forbidden']
    with pytest.raises(JevError, match='incomplete_answers'):
        await classify_intent(SimpleNamespace(evaluate=AsyncMock(return_value=response)), 'query')


@pytest.mark.asyncio
async def test_off_is_the_original_processor_without_new_calls_or_policy(monkeypatch):
    processor = module.IntentProcessor(); processor.jev_mode = 'off'
    baseline = {'intent_type': 'analysis', 'is_complex': True, 'visual_intent': 'implicit_enrichment',
                'sub_queries': ['a', 'b'], 'search_strategies': {'dense_query': 'baseline'}}
    processor._process_generative = AsyncMock(return_value=dict(baseline))
    monkeypatch.setattr(module, 'get_jev_client', lambda: pytest.fail('off must not create Decision client'))
    result = await processor.process('Explain', [{'role': 'user', 'content': 'context'}], 'attachment')
    assert result == {**baseline, 'jev_decision': {'mode': 'off', 'accepted': False}}
    processor._process_generative.assert_awaited_once_with('Explain', [{'role': 'user', 'content': 'context'}], 'attachment')
