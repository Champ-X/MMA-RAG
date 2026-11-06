"""Independent fault-injection checks for the durable Python/Node boundary."""
import asyncio
from dataclasses import replace
import json
from pathlib import Path
import subprocess
import threading

import pytest

from test_pi_agent_tools import fixture_tools, source


@pytest.mark.asyncio
async def test_failed_operation_commit_cannot_leave_uncommitted_evidence_citable(tmp_path, monkeypatch):
    tools, store, run_id, _ = fixture_tools(tmp_path, answer_checks_enabled=False)
    tools.durable = True
    complete = store.complete_operation
    def fail_once(*args):
        monkeypatch.setattr(store, "complete_operation", complete)
        raise RuntimeError("injected commit failure after assigning evidence")
    monkeypatch.setattr(store, "complete_operation", fail_once)
    with pytest.raises(RuntimeError, match="injected commit failure"):
        await tools.execute("read-before-crash", "read_source", {"source_id": source().id})
    assert store.evidence(run_id) == []
    # Other parallel host calls can still be draining after this one fails.
    # A rolled-back read must not grant those calls citation authority.
    answer = await tools.execute("parallel-answer", "submit_answer", {"answer": "结论[1]", "evidence_ids": [1]})
    assert answer.get("isError"), "A rolled-back source observation was accepted as a citation"
    assert not tools.final_result


@pytest.mark.asyncio
async def test_pending_steer_cannot_be_stranded_by_ask_user(tmp_path):
    tools, store, run_id, _ = fixture_tools(tmp_path, answer_checks_enabled=False)
    tools.durable = True
    with store._connection(write=True) as db:
        db.execute("UPDATE pi_runs SET config_json=? WHERE id=?", (json.dumps({"runtime": "durable"}), run_id))
    store.add_input(run_id, "alice", "new-input", "请直接比较2026年", "steer")
    question = await tools.execute("ask-during-steer", "ask_user", {"question": "比较哪一年？"})
    assert question.get("isError"), "A terminal question stranded an unapplied user input"
    assert not tools.final_result


@pytest.mark.asyncio
async def test_recovery_resolves_the_recorded_model_instead_of_a_changed_default(tmp_path, monkeypatch):
    from app.modules.pi_agent import supervisor
    from test_pi_agent_supervisor import make_host, request
    host = make_host(tmp_path, monkeypatch, runtime="durable")
    try:
        run = host.store.create(owner="alice", request=request().model_dump(),
            config={"runtime": "durable", "model": "fake:original"})[0]
        selected = []
        def resolve(registry, name, settings):
            selected.append(name)
            return {"name": name}, "key"
        monkeypatch.setattr(supervisor, "resolve_model", resolve)
        monkeypatch.setattr(host, "_schedule", lambda *args: None)
        await host.resume_pending()
        assert selected == ["fake:original"], "Resumption silently selected the current default model"
        assert host.store.get(run["id"])["status"] == "queued"
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_resuming_whole_knowledge_base_keeps_persistent_media_cache_namespace(tmp_path, monkeypatch):
    from app.modules.pi_agent import supervisor
    from app.modules.pi_agent.catalog import SourceCatalog
    from app.modules.pi_agent.contracts import RunInput
    from test_pi_agent_supervisor import make_host, request
    script = """
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='start') console.log(JSON.stringify({type:'request',id:'ask',method:'tool',params:{
  tool_call_id:'ask-'+m.config.submission_id,name:'ask_user',args:{question:'需要哪个年份？'}}}));
 else if(m.type==='response') {console.log(JSON.stringify({type:'settled',result:{}}));process.exit();}
});
"""
    host = make_host(tmp_path, monkeypatch, runtime="durable", script=script)
    monkeypatch.setattr(SourceCatalog, "load", lambda _, **kwargs: SourceCatalog([source()], {"a": "A"}))
    namespaces, inspector = [], supervisor.MediaInspector
    def capture(*args, **kwargs):
        namespaces.append(kwargs["cache_namespace"])
        return inspector(*args, **kwargs)
    monkeypatch.setattr(supervisor, "MediaInspector", capture)
    try:
        run = await host.start(request(), "alice")
        await asyncio.gather(*list(host.jobs.values()))
        assert host.store.get(run["id"])["status"] == "needs_input"
        await host.submit_input(run["id"], "alice", RunInput(request_id="reply-year", message="2026", mode="reply"))
        await asyncio.gather(*list(host.jobs.values()))
        assert host.store.get(run["id"])["status"] == "needs_input"
        assert len(namespaces) == 2
        assert namespaces[0] == namespaces[1], "Scope freezing invalidated this run's paid-media cache namespace"
    finally:
        await host.close()


def test_steer_queued_during_preparation_is_not_rejected_before_initial_admission(tmp_path):
    directory = Path(__file__).resolve().parents[2] / "agent-runtime"
    script = r'''
import {createDurableRuntime} from './src/durable.mjs';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const model = {id:'fixture', name:'fixture', api:'openai-completions', provider:'test',
 baseUrl:'http://invalid.test', reasoning:false, input:['text'], contextWindow:32000, maxTokens:1000,
 cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
const events=[];
const runtime=createDurableRuntime({runtime:'durable',run_id:'test',submission_id:'initial',storage_path:process.argv[2],
 model,prompt:'Find evidence',tools:[{name:'ask_user',description:'Ask',parameters:{type:'object',properties:{question:{type:'string'}},required:['question']}}]}, {
 emit:(type,data)=>events.push({type,data}),
 providerStream:()=>{
  const stream=createAssistantMessageEventStream();
  const message={role:'assistant',content:[{type:'toolCall',id:'ask-1',name:'ask_user',arguments:{question:'Which date?'}}],
   api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:'toolUse',
   usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:'toolUse',message});});
  return stream;
 },
 callHost:async(method,params)=>method==='model_request'?{allowed:true}:method==='model_usage'?{}:
  {content:[{type:'text',text:'accepted'}],details:{terminal:'needs_input',question:'Which date?'}}
});
const running=runtime.run();
const input=runtime.input({request_id:'queued-steer',message:'Use 2026',mode:'steer'}).then(()=>({accepted:true}),error=>({accepted:false,error:String(error.message)}));
const [result,receipt]=await Promise.all([running,input]);
console.log(JSON.stringify({result,receipt,events}));
'''
    result = subprocess.run(["node", "--input-type=module", "-", str(tmp_path / "durable.sqlite")],
        cwd=directory, input=script, text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr
    receipt = json.loads(result.stdout.strip().splitlines()[-1])
    assert receipt["receipt"]["accepted"], receipt


def default_plan_host(tmp_path, monkeypatch, provider):
    from app.modules.pi_agent.config import PiSettings
    from test_pi_durable_recovery import make_host
    host = make_host(tmp_path, monkeypatch, provider)
    # The shared legacy fixture disables plans. Restore the actual product
    # default before admission, so this exercises the shipped tool contract.
    host.settings.answer_plan_enabled = PiSettings().answer_plan_enabled
    assert host.settings.answer_plan_enabled
    return host


def input_plan(identity, quote, *, status="pending", input_quotes=None):
    return {"items": [{"id": identity, "requirement": quote, "quote": quote,
        "basis": "user_input", "status": status, "input_quotes": input_quotes or []}]}


@pytest.mark.asyncio
async def test_real_node_default_plan_survives_needs_input_and_reply_in_same_run(tmp_path, monkeypatch):
    from app.modules.pi_agent.contracts import RunInput, RunRequest
    from test_pi_durable_recovery import Provider, settled
    quote = "年份写成中文"
    provider = Provider([
        ("update_answer_plan", input_plan("year", quote)),
        ("ask_user", {"question": "需要转换哪个年份？", "options": ["2026年"]}),
        ("update_answer_plan", {"items": [{"id": "year", "status": "ready", "input_quotes": ["2026年"]}]}),
        ("submit_answer", {"answer": "二零二六年。", "evidence_ids": []}),
    ])
    host = default_plan_host(tmp_path, monkeypatch, provider)
    try:
        request = RunRequest(client_request_id="planned-reply", session_id="session", message="请将给出的年份写成中文。")
        run_id = (await host.start(request, "alice"))["id"]
        first = await settled(host, run_id, "needs_input")
        assert first["config"]["answer_plan_enabled"]
        assert first["state"]["answer_plan"]["items"][0]["status"] == "pending"
        await host.close()
        host = default_plan_host(tmp_path, monkeypatch, provider)
        await host.submit_input(run_id, "alice", RunInput(request_id="reply-2026", message="2026年", mode="reply"))
        done = await settled(host, run_id, "completed")
        assert done["id"] == run_id and done["state"]["answer"] == "二零二六年。"
        assert done["state"]["answer_plan"]["items"][0]["status"] == "ready"
        assert done["state"]["inputs"][0]["status"] == "applied"
        assert len(provider.requests) == 4
        assert "2026年" in json.dumps(provider.requests[2]["messages"], ensure_ascii=False)
        events = host.store.events(run_id)
        assert next(e["seq"] for e in events if e["type"] == "input.applied") < next(
            e["seq"] for e in events if e["type"] == "run.completed")
    finally:
        await host.close()
        provider.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("when", ["preparation", "generation"])
async def test_real_node_default_plan_applies_steer_before_final_answer(tmp_path, monkeypatch, when):
    from app.modules.pi_agent.contracts import RunInput, RunRequest
    from test_pi_durable_recovery import Provider, settled
    entered, release = threading.Event(), threading.Event()
    quote, supplement = "词语翻译成英文", "只翻译“苹果”。"
    def initial(body):
        entered.set()
        if when == "generation":
            release.wait(8)
        return "update_answer_plan", input_plan("translation", quote)
    provider = Provider([initial,
        ("update_answer_plan", {"items": [{"id": "translation", "status": "ready", "input_quotes": ["苹果"]}]}),
        ("submit_answer", {"answer": "apple", "evidence_ids": []}),
    ])
    host = default_plan_host(tmp_path, monkeypatch, provider)
    try:
        request = RunRequest(client_request_id="steer-" + when, session_id="session", message="请把词语翻译成英文。")
        run_id = (await host.start(request, "alice"))["id"]
        if when == "generation":
            async with asyncio.timeout(5):
                while not entered.is_set():
                    await asyncio.sleep(.01)
        else:
            assert run_id not in host.processes
        await host.submit_input(run_id, "alice", RunInput(request_id="steer-apple", message=supplement, mode="steer"))
        release.set()
        done = await settled(host, run_id, "completed")
        assert done["state"]["answer"] == "apple"
        assert done["state"]["inputs"][0]["status"] == "applied"
        assert supplement in json.dumps(provider.requests[1]["messages"], ensure_ascii=False)
        assert len(provider.requests) == 3
        events = host.store.events(run_id)
        applied = [event for event in events if event["type"] == "input.applied" and event["data"]["request_id"] == "steer-apple"]
        assert len(applied) == 1
        assert applied[0]["seq"] < next(event["seq"] for event in events if event["type"] == "answer.accepted")
    finally:
        release.set()
        await host.close()
        provider.close()


@pytest.mark.asyncio
async def test_real_node_cancel_with_pending_input_cannot_resume_after_host_restart(tmp_path, monkeypatch):
    from app.modules.pi_agent.contracts import RunInput, RunRequest
    from app.modules.pi_agent.store import RunConflict
    from test_pi_durable_recovery import Provider, settled
    entered, release = threading.Event(), threading.Event()
    def pending(body):
        entered.set()
        release.wait(8)
        return "ask_user", {"question": "已收到？"}
    provider = Provider([pending])
    host = default_plan_host(tmp_path, monkeypatch, provider)
    try:
        run_id = (await host.start(RunRequest(client_request_id="cancel-pending", session_id="session", message="分析资料"), "alice"))["id"]
        async with asyncio.timeout(5):
            while not entered.is_set():
                await asyncio.sleep(.01)
        await host.submit_input(run_id, "alice", RunInput(request_id="pending-input", message="只看2026年", mode="steer"))
        await host.cancel(run_id, "alice")
        release.set()
        cancelled = await settled(host, run_id, "cancelled")
        assert cancelled["state"]["inputs"][0]["status"] != "applied"
        await host.close()
        host = default_plan_host(tmp_path, monkeypatch, provider)
        await host.resume_pending()
        assert host.store.get(run_id)["status"] == "cancelled" and not host.jobs
        with pytest.raises(RunConflict):
            await host.submit_input(run_id, "alice", RunInput(request_id="after-cancel", message="继续", mode="steer"))
        assert len(provider.requests) == 1
    finally:
        release.set()
        await host.close()
        provider.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("change,expected", [("version", "source_changed"), ("permission", "scope_denied")])
async def test_real_node_recovery_stops_before_model_when_source_or_authority_changes(tmp_path, monkeypatch, change, expected):
    from app.modules.pi_agent.catalog import SourceCatalog
    from app.modules.pi_agent.contracts import RunRequest
    from test_pi_durable_recovery import Provider, settled
    entered, release = threading.Event(), threading.Event()
    def pending(body):
        entered.set()
        release.wait(8)
        return "ask_user", {"question": "已恢复？"}
    provider = Provider([pending])
    host = default_plan_host(tmp_path, monkeypatch, provider)
    monkeypatch.setattr(SourceCatalog, "load", lambda *args, **kw: SourceCatalog([source()], {"a": "A"}))
    try:
        request = RunRequest(client_request_id="source-freeze", session_id="session", message="分析资料", knowledge_base_ids=["a"])
        run_id = (await host.start(request, "alice"))["id"]
        async with asyncio.timeout(5):
            while not entered.is_set():
                await asyncio.sleep(.01)
        await host.close()
        assert host.store.get(run_id)["status"] == "queued"
        release.set()
        host = default_plan_host(tmp_path, monkeypatch, provider)
        current = replace(source(), version="v2") if change == "version" else source()
        monkeypatch.setattr(SourceCatalog, "load", lambda *args, **kw: SourceCatalog([current], {"a": "A"}))
        if change == "permission":
            host.settings.allowed_kb_ids = []
        await host.resume_pending()
        failed = await settled(host, run_id, "failed")
        assert failed["state"]["code"] == expected
        assert len(provider.requests) == 1
    finally:
        release.set()
        await host.close()
        provider.close()
