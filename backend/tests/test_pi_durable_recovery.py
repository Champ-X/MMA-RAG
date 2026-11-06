"""Durable host receipts, crash boundaries and real worker continuation."""
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
import pytest
from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.config import PiSettings
from app.modules.pi_agent.contracts import RunInput, RunRequest, Evidence
from app.modules.pi_agent.policy import PersistentUsageLedger, AccessScope
from app.modules.pi_agent.store import RunStore, RunConflict, RunNotFound
from app.modules.pi_agent.supervisor import PiSupervisor
from app.modules.pi_agent.tools import ToolSet
from test_pi_agent_tools import source
from test_pi_agent_supervisor import Registry, Vectors


def request():
    return RunRequest(client_request_id='durable-request', session_id='session', message='比较结果')


def run_record(store):
    run = store.create(owner='alice', request=request().model_dump(), config={
        'runtime': 'durable', 'scope_ready': False, 'model': 'fake:test',
        'answer_plan_enabled': False, 'answer_checks_enabled': False})[0]
    store.transition(run['id'], 'running')
    return run['id']


def tools_for(store, run_id, gateway):
    return ToolSet(run_id, store, SourceCatalog([source()], {'a': 'A'}),
        AccessScope.from_request(request(), {'a'}), PersistentUsageLedger(store, run_id), gateway, None,
        lambda event, data, **kw: store.append(run_id, event, data, **kw), None)


@pytest.mark.asyncio
async def test_completed_tool_response_replays_without_io_or_new_evidence(tmp_path):
    class Gateway:
        calls = 0
        async def read(self, original, **args):
            self.calls += 1
            return [Evidence(source_id=original.id, modality='doc', file_name=original.name,
                content='原始证据', version='v1', observation='parsed_text')], {'status': 'ok'}
    store, gateway = RunStore(tmp_path / 'runs.sqlite'), Gateway()
    run_id = run_record(store)
    args = {'source_id': source().id}
    response = await tools_for(store, run_id, gateway).execute('read-1', 'read_source', args)
    assert not response.get('isError')
    events = store.events(run_id)
    reopened = RunStore(store.path)
    restored = tools_for(reopened, run_id, gateway)
    assert await restored.execute('read-1', 'read_source', args) == response
    assert gateway.calls == 1 and list(restored.delivered) == [1]
    assert reopened.events(run_id) == events
    conflict = await restored.execute('read-1', 'read_source', {'source_id': 'different'})
    assert conflict['details']['code'] == 'operation_conflict' and gateway.calls == 1


@pytest.mark.asyncio
async def test_receipt_failure_rolls_back_evidence_artifact_and_acceptance(tmp_path, monkeypatch):
    store = RunStore(tmp_path / 'runs.sqlite')
    run_id = run_record(store)
    tools = tools_for(store, run_id, None)
    monkeypatch.setattr(store, 'complete_operation', lambda *args: (_ for _ in ()).throw(OSError('disk failure')))
    with pytest.raises(OSError):
        await tools.execute('ask-1', 'ask_user', {'question': '哪一年？'})
    assert tools.final_result is None
    assert 'accepted_result' not in store.get(run_id)['state']
    assert not any(event['type'] in {'question.accepted', 'tool.completed'} for event in store.events(run_id))
    assert store.operation_results(run_id) == []


@pytest.mark.asyncio
async def test_unconfirmed_media_call_is_not_automatically_repaid(tmp_path):
    store = RunStore(tmp_path / 'runs.sqlite')
    run_id = run_record(store)
    args = {'source_id': source().id, 'question': '画面是什么？', 'view': 'visual'}
    store.begin_operation(run_id, 'media-1', 'inspect_media', args)
    tools = tools_for(RunStore(store.path), run_id, None)
    result = await tools.execute('media-1', 'inspect_media', args)
    assert result['details']['code'] == 'operation_interrupted'
    assert tools.ledger.model_requests == 0
    assert await tools.execute('media-1', 'inspect_media', args) == result


def test_attempt_receipts_keep_unknown_usage_and_ids_after_restart(tmp_path):
    store = RunStore(tmp_path / 'runs.sqlite')
    run_id = run_record(store)
    ledger = PersistentUsageLedger(store, run_id)
    ledger.start_model(1)
    ledger.settle_model(1, {'totalTokens': 12, 'cost': {'total': .01, 'totalFromProvider': True}})
    ledger.start_model(-1)
    restored = PersistentUsageLedger(RunStore(store.path), run_id)
    assert restored.snapshot()['model_tokens'] == 12
    assert restored.snapshot()['model_requests'] == 2
    assert restored.snapshot()['unknown_usage_requests'] == 1
    with pytest.raises(ValueError):
        restored.start_model(1)
    cost = next(item for item in store.model_attempts(run_id) if item['turn'] == 1)['usage']['cost']
    assert cost == {'total': .01, 'totalFromProvider': True}


def test_inputs_are_idempotent_scoped_and_cancelled_sessions_stay_closed(tmp_path):
    store = RunStore(tmp_path / 'runs.sqlite')
    run_id = run_record(store)
    with pytest.raises(RunNotFound):
        store.add_input(run_id, 'mallory', 'input-id-1', '只看今年', 'steer')
    first, created = store.add_input(run_id, 'alice', 'input-id-1', '只看今年', 'steer')
    assert created
    assert store.add_input(run_id, 'alice', 'input-id-1', '只看今年', 'steer') == (first, False)
    assert '只看今年' not in store.effective_request(run_id)['message']
    store.acknowledge_input(run_id, 'input-id-1', 'applied')
    assert store.effective_request(run_id)['message'].endswith('只看今年')
    assert store.get(run_id)['state']['inputs'][0]['status'] == 'applied'
    with pytest.raises(RunConflict):
        store.add_input(run_id, 'alice', 'input-id-1', '改成去年', 'steer')
    store.close_session('alice', 'session')
    with pytest.raises(RunConflict):
        store.add_input(run_id, 'alice', 'input-id-2', '继续', 'steer')
    store.recover_interrupted(resume_durable=True)
    assert store.get(run_id)['status'] == 'cancelled' and not store.pending_runs()


def test_core_rollback_preserves_durable_work_without_consuming_retries(tmp_path):
    store = RunStore(tmp_path / 'runs.sqlite')
    run_id = run_record(store)
    store.recover_interrupted(resume_durable=False)
    paused = store.get(run_id)
    assert paused['status'] == 'queued' and paused['state']['runtime_paused']
    assert not paused['state'].get('recovery_failures')
    assert store.events(run_id)[-1]['data']['runtime_paused'] is True
    for _ in range(6):
        store.recover_interrupted(resume_durable=False)
    assert store.get(run_id) == paused
    store.recover_interrupted(resume_durable=True)
    resumed = store.get(run_id)
    assert resumed['status'] == 'queued' and not resumed['state'].get('runtime_paused')
    assert resumed['state']['recovery_failures'] == 1
    assert store.events(run_id)[-1]['data']['runtime_paused'] is False


@pytest.mark.asyncio
async def test_core_rollback_refuses_input_without_mutating_waiting_task(tmp_path):
    host = PiSupervisor(PiSettings(data_dir=tmp_path, model='fake:test', runtime='core'),
        Registry(), storage=object(), vector_client=Vectors())
    try:
        run_id = run_record(host.store)
        host.store.transition(run_id, 'needs_input', state={'question': '哪一年？'})
        before = host.store.get(run_id)
        from app.modules.pi_agent.policy import ToolError
        with pytest.raises(ToolError, match='durable'):
            await host.submit_input(run_id, 'alice', RunInput(request_id='reply-2026', message='2026年', mode='reply'))
        await host.resume_pending()
        assert host.store.get(run_id) == before and not host.store.inputs(run_id)
        assert not host.jobs
    finally:
        await host.close()


class Provider:
    def __init__(self, responses):
        self.requests, self.responses = [], responses
        provider = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                provider.requests.append(body)
                index = len(provider.requests) - 1
                response = provider.responses[min(index, len(provider.responses) - 1)]
                if callable(response):
                    response = response(body)
                name, args = response
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.end_headers()
                frames = [
                    {'choices': [{'index': 0, 'delta': {'tool_calls': [{'index': 0, 'id': f'call-{index}', 'type': 'function',
                        'function': {'name': name, 'arguments': json.dumps(args, ensure_ascii=False)}}]}}]},
                    {'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}],
                     'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120}}]
                try:
                    self.wfile.write((''.join('data: ' + json.dumps(frame) + '\n\n' for frame in frames) + 'data: [DONE]\n\n').encode())
                except (BrokenPipeError, ConnectionResetError):
                    pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)


def make_host(tmp_path, monkeypatch, provider):
    monkeypatch.setattr(SourceCatalog, 'load', lambda *args, **kw: SourceCatalog([], {}))
    class LocalRegistry(Registry):
        def get_provider(self, name):
            return SimpleNamespace(api_key='local-test', base_url=f'http://127.0.0.1:{provider.server.server_port}')
    return PiSupervisor(PiSettings(data_dir=tmp_path, model='fake:test', runtime='durable',
        answer_plan_enabled=False, yield_to_legacy=False), LocalRegistry(), storage=object(), vector_client=Vectors())


async def settled(host, run_id, status):
    async with asyncio.timeout(15):
        while host.store.get(run_id)['status'] != status:
            if host.store.get(run_id)['status'] == 'failed':
                raise AssertionError(host.store.get(run_id))
            await asyncio.sleep(.01)
        job = host.jobs.get(run_id)
        if job:
            await asyncio.shield(job)
    return host.store.get(run_id)


@pytest.mark.asyncio
async def test_real_durable_worker_reply_after_host_restart_keeps_conversation(tmp_path, monkeypatch):
    provider = Provider([('ask_user', {'question': '哪一年？', 'options': ['2026']}),
        ('submit_answer', {'answer': '未找到2026年的依据。', 'status': 'partial', 'outcome': 'not_found', 'evidence_ids': [], 'limitations': ['当前范围没有资料。']})])
    host = make_host(tmp_path, monkeypatch, provider)
    try:
        run_id = (await host.start(request(), 'alice'))['id']
        old = await settled(host, run_id, 'needs_input')
        await host.close()
        host = make_host(tmp_path, monkeypatch, provider)
        reply = RunInput(request_id='reply-2026', message='2026年', mode='reply')
        await host.submit_input(run_id, 'alice', reply)
        done = await settled(host, run_id, 'partial')
        assert done['id'] == run_id and done['seq'] > old['seq']
        assert len(provider.requests) == 2
        assert '比较结果' in json.dumps(provider.requests[-1], ensure_ascii=False)
        assert '2026年' in json.dumps(provider.requests[-1], ensure_ascii=False)
        assert done['state']['usage']['model_requests'] == 2
        assert done['state']['inputs'][0]['status'] == 'applied'
        await host.submit_input(run_id, 'alice', reply)
        assert len(provider.requests) == 2
    finally:
        await host.close()
        provider.close()


@pytest.mark.asyncio
async def test_real_durable_worker_shutdown_resumes_pending_generation(tmp_path, monkeypatch):
    started, release = threading.Event(), threading.Event()
    def delayed(body):
        started.set()
        release.wait(8)
        return 'ask_user', {'question': '已恢复？'}
    provider = Provider([delayed, ('ask_user', {'question': '已恢复？'})])
    host = make_host(tmp_path, monkeypatch, provider)
    try:
        run_id = (await host.start(request(), 'alice'))['id']
        async with asyncio.timeout(5):
            while not started.is_set():
                await asyncio.sleep(.01)
        await host.close()
        assert host.store.get(run_id)['status'] == 'queued'
        release.set()
        host = make_host(tmp_path, monkeypatch, provider)
        await host.resume_pending()
        done = await settled(host, run_id, 'needs_input')
        assert done['state']['usage']['model_requests'] == 2
        assert done['state']['usage']['unknown_usage_requests'] >= 1
        assert len(provider.requests) == 2
    finally:
        release.set()
        await host.close()
        provider.close()
