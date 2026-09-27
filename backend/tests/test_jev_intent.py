"""Safeguards and delegation contracts; accuracy uses the frozen real API set."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.llm.jev import JevClient, JevError, JevRequiredError
from app.modules.retrieval.processors import intent as module
from app.modules.retrieval.processors.jev_intent import classify_intent


def decision(prob=.9, complex_prob=.05, context_prob=.05):
    choices={'intent_type':'factual', 'visual_intent':'unnecessary', 'audio_intent':'unnecessary', 'video_intent':'unnecessary'}
    answers={k:{'choice':v,'probabilities':{v:prob}} for k,v in choices.items()}
    answers.update(is_complex={'noul':complex_prob},needs_context={'noul':context_prob})
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
    processor=module.IntentProcessor();processor.jev_mode='adaptive'
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
    processor._process_generative.assert_awaited_once_with('继续',history,attachment)
    assert result['sub_queries']==['保留复杂分解']
    assert not result['jev_decision']['accepted']


@pytest.mark.asyncio
@pytest.mark.parametrize('reason',['timeout','budget_exhausted','invalid_probabilities'])
async def test_failure_uses_original_handler(monkeypatch,reason):
    processor=module.IntentProcessor();processor.jev_mode='adaptive'
    monkeypatch.setattr(module,'get_jev_client',lambda:None)
    monkeypatch.setattr(module,'classify_intent',AsyncMock(side_effect=JevError(reason)))
    processor._process_generative=AsyncMock(return_value={'refined_query':'原始生成式改写','sub_queries':['子查询']})
    result=await processor.process('query')
    assert result['jev_decision']['reason']==reason
    assert result['sub_queries']==['子查询']


@pytest.mark.asyncio
async def test_cancellation_does_not_start_generative_fallback(monkeypatch):
    processor=module.IntentProcessor();processor.jev_mode='adaptive'
    monkeypatch.setattr(module,'get_jev_client',lambda:None)
    monkeypatch.setattr(module,'classify_intent',AsyncMock(side_effect=asyncio.CancelledError))
    processor._process_generative=AsyncMock()
    with pytest.raises(asyncio.CancelledError):await processor.process('q')
    processor._process_generative.assert_not_awaited()


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
    assert result['jev_decision']['reason']=='uncertain_or_complex'


@pytest.mark.asyncio
@pytest.mark.parametrize('prob,complex_prob,context_prob', [
    (.74, .05, .05), (.9, .9, .05), (.9, .05, .9), (.4, .9, .9),
])
async def test_force_uses_jev_despite_each_adaptive_gate(monkeypatch, prob, complex_prob, context_prob):
    processor = module.IntentProcessor()
    processor.jev_mode = 'force'
    client = SimpleNamespace(evaluate=AsyncMock(return_value=decision(prob, complex_prob, context_prob)))
    monkeypatch.setattr(module, 'get_jev_client', lambda: client)
    processor._process_generative = AsyncMock(side_effect=AssertionError('forced stage fell back'))
    result = await processor.process('介绍一下茶叶的驯化史')
    info = result['jev_decision']
    assert info['mode'] == 'force'
    assert info['accepted'] and info['forced']
    assert info['eligible'] is False
    assert result['is_complex'] == (complex_prob >= .5)
    client.evaluate.assert_awaited_once()
    processor._process_generative.assert_not_awaited()


@pytest.mark.asyncio
async def test_force_supplies_history_and_attachment_without_silent_truncation(monkeypatch):
    processor = module.IntentProcessor()
    processor.jev_mode = 'force'
    client = SimpleNamespace(evaluate=AsyncMock(return_value=decision(context_prob=.9)))
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
    service.intent_processor=module.IntentProcessor();service.intent_processor.jev_mode='adaptive'
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
