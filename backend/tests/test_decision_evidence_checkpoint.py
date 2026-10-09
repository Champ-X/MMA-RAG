import asyncio
import copy
import hashlib
import json
from types import SimpleNamespace

import httpx
import pytest

from app.core.llm.jev import JevClient
from app.modules.retrieval import decision_evidence_checkpoint as checkpoint


def doc(identity, text, **kwargs):
    return {'id': identity, 'content_type': 'doc', 'final_score': .47, 'rerank_score': .6,
            'payload': {'text_content': text, 'file_id': identity}, **kwargs}


def fake_client(roles):
    calls = []
    async def evaluate(state, questions, *, prompt_version):
        calls.append((state, questions, prompt_version))
        answers = {}
        for i, (name, q) in enumerate(questions.items()):
            role, p = roles[i] if isinstance(roles[i], tuple) else (roles[i], .95)
            answers[name] = {'type': 'choice', 'choice': role, 'confidence': p,
                            'probabilities': {key: p if key == role else (1-p)/(len(q['criteria'])-1)
                                              for key in q['criteria']}}
        return SimpleNamespace(answers=answers, metadata=lambda: {'model': 'fixed-decisions', 'usage': {'input_tokens': 100}})
    return SimpleNamespace(evaluate=evaluate), calls


@pytest.mark.asyncio
async def test_keeps_order_scores_and_full_source_provenance_for_partial_query_evidence():
    client, calls = fake_client(['qualification', 'counterevidence', 'answer', 'inapplicable'])
    candidates = [doc(str(i), text) for i, text in enumerate([
        '借书期限30天，但逾期不得续借。', '原说明中的60天并不正确，期限为30天。',
        '认证研究员可以借60天。', '该规则仅适用于其他图书馆。'])]
    original = copy.deepcopy(candidates)
    additions, receipt = await checkpoint.select_context_evidence(client, '借阅期限和续借限制是什么？', candidates, '这是原基线。')
    assert [x['id'] for x in additions] == ['0','1']
    assert candidates == original and len(calls) == 1
    assert calls[0][0] == {'query': '借阅期限和续借限制是什么？'}
    assert '这是原基线' not in json.dumps(calls, ensure_ascii=False)
    assert receipt['evaluated_count'] == 4 and receipt['accepted_ids'] == ['0','1','2']
    for added in additions:
        assert added['final_score'] == .47 and added['rerank_score'] == .6
        evidence = added['metadata']['decision_assist']
        assert evidence['excerpt'] == added['content'] == added['payload']['text_content']
        assert evidence['source_sha256'] == hashlib.sha256(added['content'].encode()).hexdigest()
        assert not evidence['partial_source']
    assert receipt['comparison_scope'] == 'actual_visible_text_only'
    assert receipt['global_novelty'] == 'not_evaluated'


@pytest.mark.asyncio
async def test_hidden_baseline_chunk_is_allowed_and_visible_paragraph_is_not_repeated():
    visible = '项目概览：' + '背景说明。' * 110
    hidden = '海棠2026年合同的退款期限是14天，超过期限不予退款。'
    source = visible + '\n\n' + hidden
    client, calls = fake_client(['answer'])
    additions, receipt = await checkpoint.select_context_evidence(client, '海棠2026年的退款期限是多少？',
        [doc('already-in-baseline', source), doc('visible-only', visible)], visible)
    assert len(additions) == 1 and additions[0]['id'] == 'already-in-baseline'
    evidence = additions[0]['metadata']['decision_assist']
    assert evidence['partial_source'] and evidence['excerpt'] == hidden
    assert source[evidence['span_start']:evidence['span_end']] == hidden
    assert receipt['skip_reasons'] == {'visible_duplicate': 1}


def test_long_source_uses_complete_paragraph_and_retains_negation_qualifier():
    middle = '河杉2.4的离线导出仅限已解密记录。未解密记录不包含在导出文件内。'
    source = '背景材料。' * 700 + '\n\n' + middle + '\n\n' + '无关附录。' * 700
    span, reason = checkpoint.select_source_span('河杉2.4导出包含未解密记录吗？', source, '')
    assert reason is None and span['excerpt'] == middle and span['partial_source']
    assert source[span['span_start']:span['span_end']] == middle
    long_unbroken = '退款规则' * 1500
    span, reason = checkpoint.select_source_span('退款规则？', long_unbroken, '')
    assert span is None and reason == 'no_unseen_bounded_paragraph'


@pytest.mark.asyncio
async def test_large_visible_context_does_not_skip_or_enter_native_payload():
    client, calls = fake_client(['answer'])
    additions, receipt = await checkpoint.select_context_evidence(client, '访问期限？',
        [doc('new', '访问期限为30天。')], 'KNOWN_BASELINE_' * 10000)
    assert len(additions) == 1 and receipt['evaluated_count'] == 1
    assert 'KNOWN_BASELINE_' not in json.dumps(calls)


@pytest.mark.parametrize('provider,model', [('typesafe','jev-1.13.0'),('openrouter','typesafe/jev-1.13'),('bailian','decision-model-preview')])
@pytest.mark.asyncio
async def test_real_native_transport_shape_is_bounded_isolated_and_nonempty(provider, model):
    calls = []
    def handle(request):
        payload = json.loads(request.content); calls.append(payload)
        assert payload['state'] == {'query':'退款期限？'}
        assert len(payload['questions']) == 1
        assert payload['questions']['e0']['instructions']['excerpt'] == '退款期限为14天。'
        q = payload['questions']['e0']
        answer = {'type':'choice','choice':'answer','confidence':1.,
                  'probabilities':{key:1. if key=='answer' else 0. for key in q['criteria']}}
        usage = {'input_tokens':100, **({} if provider=='bailian' else {'output_tokens':20})}
        return httpx.Response(200,json={'model':model,'answers':{'e0':answer},'usage':usage})
    client = JevClient('private-test', provider=provider, model=model, transport=httpx.MockTransport(handle))
    additions, receipt = await checkpoint.select_context_evidence(client, '退款期限？',
        [doc('d','退款期限为14天。'),{'id':'media','content_type':'image','content':'do not send'}], '')
    assert len(additions) == len(calls) == 1 and receipt['requests'][0]['status']=='evaluated'
    assert receipt['skip_reasons']['non_text_source'] == 1
    assert 'private-test' not in json.dumps(receipt)


@pytest.mark.parametrize('mode,expected', [('off',0),('shadow',0),('assist',1)])
@pytest.mark.asyncio
async def test_off_and_shadow_never_apply(mode, expected):
    client, calls = fake_client(['answer'])
    additions, receipt = await checkpoint.select_context_evidence(client, '期限？',[doc('d','期限14天。')],'',mode=mode)
    assert len(additions)==expected
    assert len(calls)==(0 if mode=='off' else 1)
    assert receipt['added_ids']==(['d'] if mode=='assist' else [])
    if mode=='shadow': assert receipt['proposed_ids']==['d']


@pytest.mark.asyncio
async def test_uncertain_inapplicable_or_weak_signal_not_added():
    client, _ = fake_client(['uncertain','inapplicable',('answer',.79)])
    additions, receipt = await checkpoint.select_context_evidence(client,'查询',[
        doc('u','信息不明。'),doc('w','其他范围。'),doc('s','薄弱证据。')],'')
    assert additions==[] and receipt['evaluated_count']==3 and receipt['accepted_ids']==[]


@pytest.mark.asyncio
async def test_duplicate_only_means_zero_native_requests_and_not_success():
    client = SimpleNamespace(evaluate=lambda *a,**k: pytest.fail('No network expected'))
    additions, receipt = await checkpoint.select_context_evidence(client,'q',[doc('d','Already visible.')],'Already visible.')
    assert additions==[] and receipt['status']=='skipped' and receipt['requests']==[]
    assert receipt['attempted_count']==receipt['evaluated_count']==0


def test_visible_formatting_duplicate_retains_units_and_negation():
    from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
    text='云杉站每天9点开放，18点关闭。'
    rendered=MultiModalFormatter().format_document_chunk('1',text,'source.txt',{})
    assert checkpoint.select_source_span('时间？',text,rendered)[1]=='visible_duplicate'
    assert checkpoint.select_source_span('比例？','发芽率80%。','发芽率80')[0] is not None
    assert checkpoint.select_source_span('可退款？','不可以退款。','可以退款')[0] is not None


@pytest.mark.asyncio
async def test_dense_sparse_real_payload_infers_document_and_respects_media_kind():
    client,calls=fake_client(['answer','qualification'])
    candidates=[
        {'id':'dense','content_type':None,'score':.7,'payload':{'text_content':'退款期限14天。','kb_id':'kb'}},
        {'id':'sparse','score':.6,'payload':{'text':'逾期不得退款。','kb_id':'kb'}},
        {'id':'audio','content_type':None,'payload':{'text_content':'not raw document','transcript':'音频转写'}},
        {'id':'image','content_type':'image','payload':{'text_content':'not raw document'}},
        {'id':'video','payload':{'text_content':'not raw document','scene_summary':'视频描述'}},
    ]
    original=copy.deepcopy(candidates)
    additions,receipt=await checkpoint.select_context_evidence(client,'退款期限和限制？',candidates,'')
    assert [x['id'] for x in additions]==['dense','sparse']
    assert all(x['content_type']=='doc' for x in additions)
    assert additions[0]['score']==.7 and additions[1]['score']==.6
    assert receipt['skip_reasons']['non_text_source']==3 and len(calls)==1
    assert candidates==original


@pytest.mark.asyncio
async def test_single_batch_size_caps_without_truncating_source(monkeypatch):
    monkeypatch.setattr(checkpoint,'MAX_INPUT_BYTES',3000)
    client, calls = fake_client(['answer']*10)
    candidates=[doc(str(i),f'候选{i}。'+'完整文本。'*160) for i in range(20)]
    additions, receipt=await checkpoint.select_context_evidence(client,'候选？',candidates,'')
    assert len(calls)<=1 and len(additions)<=2
    if calls:
        state,questions,_=calls[0]
        assert len(json.dumps({'state':state,'questions':questions},ensure_ascii=False).encode())<=3000
        for q in questions.values():assert q['instructions']['excerpt'] in [c['payload']['text_content'] for c in candidates]
    assert receipt['skip_reasons'].get('input_budget',0)>0


@pytest.mark.asyncio
async def test_malformed_answer_fails_whole_batch_and_no_retry():
    client,calls=fake_client(['answer','answer'])
    original=client.evaluate
    async def malformed(*args,**kwargs):
        response=await original(*args,**kwargs)
        response.answers['e1']['probabilities'].pop('uncertain')
        return response
    client.evaluate=malformed
    additions,receipt=await checkpoint.select_context_evidence(client,'q',[doc('1','first'),doc('2','second')],'')
    assert additions==[] and len(calls)==1 and receipt['status']=='fallback'
    assert receipt['reason']=='invalid_probabilities' and receipt['evaluated_count']==0


@pytest.mark.asyncio
async def test_timeout_and_cancellation_join_native_work():
    entered,finished=asyncio.Event(),asyncio.Event()
    async def evaluate(*args,**kwargs):
        entered.set()
        try: await asyncio.sleep(100)
        finally: finished.set()
    client=SimpleNamespace(evaluate=evaluate)
    additions,receipt=await checkpoint.select_context_evidence(client,'q',[doc('d','source')],'',timeout_ms=10)
    assert additions==[] and receipt['reason']=='timeout' and finished.is_set()
    finished.clear();entered.clear()
    task=asyncio.create_task(checkpoint.select_context_evidence(client,'q',[doc('d','source')],''))
    await entered.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
    assert finished.is_set()
