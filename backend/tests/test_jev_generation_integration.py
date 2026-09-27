from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.generation.service import GenerationService
from app.modules.generation.stream_manager import StreamManager, StreamEventType


def service():
    s=GenerationService.__new__(GenerationService)
    built=SimpleNamespace(context_string='context',reference_map={},total_chunks=0,total_images=0)
    s.context_builder=SimpleNamespace(build_context=AsyncMock(return_value=built),
        formatter=SimpleNamespace(format_user_query=lambda **kw:'input'),validate_references=lambda *args:[])
    s.prompt_manager=SimpleNamespace(build_system_prompt=lambda *args:'system')
    s.stream_manager=StreamManager()
    s.llm_manager=SimpleNamespace(registry=SimpleNamespace(get_task_model=lambda task:'test'))
    return s


@pytest.mark.asyncio
async def test_stream_diagnostics_only_after_body_and_citations_before_done(monkeypatch):
    s=service();events=[]
    async def stream(**kwargs):
        yield 'first';yield 'second'
    s.llm_manager.stream_chat=stream
    async def audit(answer,refs):
        assert answer=='firstsecond'
        types = [event.type for event in events]
        assert types.count(StreamEventType.CITATION) == 1
        assert types.index(StreamEventType.CITATION) < types.index(StreamEventType.MESSAGE)
        assert events[-1].type == StreamEventType.MESSAGE
        assert sum(e.type==StreamEventType.MESSAGE for e in events)==2
        return {'diagnostic_only':True}
    monkeypatch.setattr('app.modules.generation.service.maybe_audit_answer',audit)
    async for e in s.stream_generate_response('q',SimpleNamespace(context=SimpleNamespace()),'test'):
        events.append(e)
    assert events[-1].type==StreamEventType.DONE
    assert events[-1].data['jev_citation_audit']=={'diagnostic_only':True}
    assert sum(e.type==StreamEventType.DONE for e in events)==1


@pytest.mark.asyncio
async def test_partial_generation_error_has_no_audit_or_done(monkeypatch):
    s=service()
    async def stream(**kwargs):
        yield 'partial'
        raise RuntimeError('provider failure')
    s.llm_manager.stream_chat=stream
    audit=AsyncMock();monkeypatch.setattr('app.modules.generation.service.maybe_audit_answer',audit)
    events=[e async for e in s.stream_generate_response('q',SimpleNamespace(context=SimpleNamespace()),'failed')]
    assert events[-1].type==StreamEventType.ERROR
    assert not any(e.type==StreamEventType.DONE for e in events)
    audit.assert_not_awaited()


@pytest.mark.asyncio
async def test_nonstream_preserves_answer_and_references_on_diagnostic_failure(monkeypatch):
    s=service();refs=[{'id':1}]
    s.context_builder.validate_references=lambda *args:refs
    s.llm_manager.chat=AsyncMock(return_value=SimpleNamespace(success=True,model_used='test',duration=.1,
        data={'choices':[{'message':{'content':'unchanged[1]'}}]}))
    monkeypatch.setattr('app.modules.generation.service.maybe_audit_answer',AsyncMock(return_value={'status':'not_evaluated','reason':'timeout'}))
    result=await s.generate_response('q',SimpleNamespace(context=SimpleNamespace()))
    assert result['success'] and result['answer']=='unchanged[1]' and result['references_used'] is refs
    assert result['metadata']['jev_citation_audit']['reason']=='timeout'


@pytest.mark.asyncio
async def test_off_mode_never_initializes_a_jev_client(monkeypatch):
    from app.core.config import settings
    from app.modules.generation.jev_answer_audit import maybe_audit_answer
    monkeypatch.setattr(settings,'jev_citation_mode','off')
    def fail():raise AssertionError('should not get client')
    monkeypatch.setattr('app.core.llm.jev.get_jev_client',fail)
    assert await maybe_audit_answer('answer',{}) is None
