"""Continuation, transport and data coverage beyond the retired run allowances."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.config import PiSettings
from app.modules.pi_agent.contracts import RunRequest
from app.modules.pi_agent.gateway import KnowledgeGateway
from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.media import MediaInspector
from app.modules.pi_agent.policy import UsageLedger, AccessScope
from app.modules.pi_agent.tables import query_table
from app.modules.pi_agent.tools import Search, RecallEvidence, SubmitAnswer, AnswerRequirements, ReadSource
from test_pi_agent_tools import source, request
from test_pi_agent_supervisor import make_host


def test_task_size_schemas_have_no_former_quotas():
    assert 'budget' not in PiSettings.model_fields
    assert 'max_queued_runs' not in PiSettings.model_fields
    spec = RunRequest(client_request_id='long-request', session_id='one', message='文' * 50000,
        history=[{'role': 'user', 'content': str(n) * 3000} for n in range(50)], knowledge_base_ids=['kb'] * 101)
    assert len(spec.history) == 50 and len(spec.message) == 50000
    assert len(Search(query='query', source_ids=['src'] * 101, limit=50).source_ids) == 101
    assert len(RecallEvidence(evidence_ids=list(range(1, 201))).evidence_ids) == 200
    assert len(SubmitAnswer(answer='文' * 30000, evidence_ids=list(range(1, 201))).answer) == 30000
    assert AnswerRequirements(max_characters=50000, length_quote='50000字', required_points=['要求'] * 40).max_characters == 50000
    assert ReadSource(source_id='src', start=200000, text_offset=3000000, limit=50).limit == 50


@pytest.mark.asyncio
async def test_lexical_search_reaches_matches_beyond_the_old_2000_point_scan():
    calls = []
    class Index:
        async def scroll(self, _collection, **kw):
            calls.append(kw)
            start = kw['offset'] or 0
            end = min(start + kw['limit'], 2150)
            return [SimpleNamespace(id=str(i), payload={'file_id': 'file', 'kb_id': 'a',
                'text_content': 'target' if i == 2149 else 'background'}) for i in range(start, end)], end if end < 2150 else None
    s = source()
    scope = AccessScope.from_request(request(), {'a'})
    gateway = KnowledgeGateway(SourceCatalog([s], {'a': 'A'}), scope, Index(), None, asyncio.Semaphore(1))
    found, report = await gateway.search(query='target', mode='exact', modalities=['doc'],
        knowledge_base_ids=[], limit=6, span_id='search')
    assert [e.locator['point_id'] for e in found] == ['2149']
    assert not report['truncated'] and len(calls) > 16


def test_table_aggregation_covers_more_than_20000_rows_and_50_groups(tmp_path):
    table = tmp_path / 'large.csv'
    table.write_text('group,value\n' + ''.join(f'g{i % 75},1\n' for i in range(21000)))
    result = query_table(table, {'columns': [], 'filters': [], 'operation': 'sum',
        'value_column': 'value', 'group_by': 'group', 'offset': 0, 'limit': 10})
    assert result['total_rows'] == result['matched_rows'] == 21000
    assert len(result['result']) == 75 and sum(int(r['value']) for r in result['result']) == 21000


@pytest.mark.asyncio
async def test_long_media_is_processed_in_all_packets_and_remains_cancellable(tmp_path, monkeypatch):
    from dataclasses import replace
    from app.modules.pi_agent import media
    calls = []
    async def decode(*args):
        if args[0] == 'ffprobe':
            return json.dumps({'format': {'duration': '360'}, 'streams': [{'codec_type': 'audio'}]}).encode()
        return b'audio-bytes'
    monkeypatch.setattr(media, 'subprocess_bytes', decode)
    class Models:
        async def observe(self, parts, **kwargs):
            calls.append(parts[0]['text'])
            return f'观察{len(calls)}', {'model': 'fixture'}
    class Catalog:
        def download(self, _storage, _source, destination): destination.write_bytes(b'audio')
    async def blocking(fn, *args, **kwargs): return fn(*args, **kwargs)
    ledger = UsageLedger()
    inspector = MediaInspector(Catalog(), object(), Models(), ledger, PiSettings(), blocking)
    audio = replace(source(), modality='audio', name='long.mp3')
    result = await inspector.inspect(audio, question='分析', start_sec=0, end_sec=210, view='audio', page=1, span_id='test')
    assert len(calls) == 7 and ledger.media_seconds == 210
    assert result.locator['observed_intervals'][-1]['end_sec'] == 210
    assert '原文件 180–210 秒的声音观察' in result.content
    assert result.locator['next_start_sec'] == 210
    await inspector.inspect(audio, question='继续', start_sec=210, end_sec=360, view='audio', page=1, span_id='next')
    assert len(calls) == 12 and ledger.media_seconds == 360
    started = asyncio.Event()
    async def hanging(*args, **kwargs):
        started.set(); await asyncio.Future()
    inspector.models.observe = hanging
    task = asyncio.create_task(inspector.inspect(audio, question='检查', start_sec=0, end_sec=210, view='audio', page=1, span_id='cancel'))
    await started.wait(); task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert not inspector.gate.locked()


@pytest.mark.asyncio
async def test_pipe_accepts_large_frames_without_a_hidden_two_megabyte_failure(tmp_path, monkeypatch):
    script = '''
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='start') {
  console.log(JSON.stringify({type:'event',event_type:'action.delta',data:{turn:1,delta:'x'.repeat(3*1024*1024)}}));
  console.log(JSON.stringify({type:'request',id:'finish',method:'tool',params:{tool_call_id:'finish',name:'ask_user',args:{question:'Which source?'}}}));
 } else if(m.id==='finish') {console.log(JSON.stringify({type:'settled',result:m.result.details}));process.exit();}
});
'''
    host = make_host(tmp_path, monkeypatch, script=script)
    try:
        run = await host.start(request(), 'alice')
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 5)
        saved = host.store.get(run['id'])
        assert saved['status'] == 'needs_input'
        assert 'budget' not in saved['config']
        assert saved['config']['execution_policy'] == 'until_complete_or_cancelled'
        event = next(e for e in host.store.events(run['id']) if e['type'] == 'action.delta')
        assert len(event['data']['delta']) == 3 * 1024 * 1024
    finally:
        await host.close()


def test_session_restore_includes_runs_beyond_the_old_100_entry_limit(tmp_path):
    from app.modules.pi_agent.store import RunStore
    store = RunStore(tmp_path / 'runs.db')
    for index in range(105):
        store.create(owner='alice', request={'client_request_id': str(index), 'session_id': 'long-session'}, config={})
    assert len(store.list_runs('alice', 'long-session')) == 105
    assert store.list_runs('bob', 'long-session') == []


@pytest.mark.asyncio
async def test_pi_accepts_four_media_uploads_without_changing_legacy_video_validation(tmp_path, monkeypatch):
    import httpx
    from fastapi import FastAPI
    from app.api import pi_agent as api
    from app.modules.chat.media_probe import inspect_attachment_media
    from app.modules.chat import media_probe
    monkeypatch.setattr(media_probe.subprocess, 'run', lambda *args, **kwargs: SimpleNamespace(stdout=json.dumps({
        'format': {'duration': '120'}, 'streams': [{'codec_type': 'video', 'width': 1, 'height': 1}]}).encode()))
    with pytest.raises(ValueError, match='60 秒'):
        inspect_attachment_media(b'video', 'video')
    assert inspect_attachment_media(b'video', 'video', max_video_seconds=None, probe_timeout=None)['duration_seconds'] == 120
    class Host:
        settings = PiSettings(data_dir=tmp_path)
        async def blocking(self, fn, *args, **kwargs): return fn(*args, **kwargs)
        async def start(self, spec, owner): return {'attachments': spec.attachments}
    monkeypatch.setattr(api, 'host', Host)
    app = FastAPI(); app.include_router(api.router, prefix='/api/pi')
    app.dependency_overrides[api.owner_for] = lambda: 'alice'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost') as client:
        response = await client.post('/api/pi/runs', data={'request': json.dumps({
            'client_request_id': 'uploads-four', 'session_id': 's', 'message': 'Compare all four videos'}),
            'attachment_ids': json.dumps([f'video-{index}' for index in range(4)])},
            files=[('files', (f'video-{index}.mp4', b'\x00\x00\x00\x18ftypmp42' + b'0' * 24, 'video/mp4')) for index in range(4)])
    assert response.status_code == 200, response.text
    assert len(response.json()['attachments']) == 4


def test_pi_size_opt_out_preserves_type_checks_and_legacy_size_limit():
    from app.modules.chat.attachment_summarizer import _classify_attachment, MAX_AUDIO_BYTES
    data = b'ID3' + b'0' * MAX_AUDIO_BYTES
    with pytest.raises(ValueError, match='音频超过'):
        _classify_attachment('large.mp3', 'audio/mpeg', data)
    assert _classify_attachment('large.mp3', 'audio/mpeg', data, enforce_size_limits=False) == 'audio'
    with pytest.raises(ValueError, match='无法识别'):
        _classify_attachment('fake.mp3', 'audio/mpeg', b'not media', enforce_size_limits=False)
