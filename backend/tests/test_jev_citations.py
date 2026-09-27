import asyncio
import json

import httpx
import pytest

from app.core.llm.jev import JevClient
from app.modules.generation.jev_citations import audit_claim


@pytest.mark.asyncio
async def test_only_cited_sources_sent_and_conflicting_independent_signals_not_accepted():
    def handler(request):
        body=json.loads(request.content)
        assert body['state']=={'claim':'600次', 'cited_sources':{'2':'限额600次。'}}
        return httpx.Response(200,json={'model':'jev-1.13.0','usage':{'input_tokens':500,'output_tokens':0},
            'answers':{'relation':{'type':'choice','choice':'supported','confidence':.99,
                                  'probabilities':{'supported':.9,'contradicted':.05,'insufficient':.05}},
                       'supported':{'type':'noul','noul':.9},'contradicted':{'type':'noul','noul':.8}}})
    client=JevClient('test',transport=httpx.MockTransport(handler))
    out=await audit_claim(client,'600次',['2','2'],{'1':'unrelated restricted-looking data','2':'限额600次。'})
    assert out['choice_support_signal'] is True
    assert out['factorized_support_signal'] is False
    assert out['diagnostic_only'] is True


@pytest.mark.asyncio
@pytest.mark.parametrize('ids,refs,reason',[
    (['1','2'],{'1':'text'},'missing_reference'),
    ([],{'1':'text'},'invalid_citation_ids'),
    (['1'],{'1':' '},'empty_source'),
    (['1'],{'1':'x'*12001},'source_too_large'),
])
async def test_uncheckable_sources_never_trigger_network(ids,refs,reason):
    def handler(request):raise AssertionError('must not send')
    client=JevClient('test',transport=httpx.MockTransport(handler))
    assert (await audit_claim(client,'claim',ids,refs))['reason']==reason
    assert client.reserved_input_tokens==0


@pytest.mark.asyncio
async def test_failure_is_unknown_and_cancellation_propagates():
    client=JevClient('test',transport=httpx.MockTransport(lambda _:httpx.Response(503)))
    result=await audit_claim(client,'claim',['1'],{'1':'text'})
    assert result=={'status':'not_evaluated','reason':'http_503'}
    assert client.reserved_input_tokens>0
    entered=asyncio.Event()
    async def handler(request):
        entered.set();await asyncio.sleep(10)
    client=JevClient('test',transport=httpx.MockTransport(handler))
    task=asyncio.create_task(audit_claim(client,'claim',['1'],{'1':'text'}))
    await entered.wait();task.cancel()
    with pytest.raises(asyncio.CancelledError):await task
