"""Resource fairness and telemetry, using local HTTP fixtures only."""
import asyncio
import json
import threading
import time
from types import SimpleNamespace

import httpx
import pytest

from app.modules.pi_agent import admission
from app.modules.pi_agent.admission import LegacyActivity, ProviderCapacity
from app.modules.pi_agent.config import PiSettings
from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.models import ModelTransport
from app.modules.pi_agent.policy import UsageLedger
from app.modules.pi_agent.supervisor import runtime_fingerprints, WORKER
from test_pi_agent_supervisor import make_host, request, wait_until


def collector():
    events = []
    return events, lambda kind, data, **spans: events.append({"type": kind, "data": data, **spans})


class Registry:
    def __init__(self):
        self.health = {"unchanged": True}
        self.routes = {"legacy": "unchanged"}

    def get_model_config(self, name):
        return {"type": "embedding,audio,vision", "provider": name.split(":")[0], "raw_model": name.split(":")[-1]}

    def get_provider(self, name):
        return SimpleNamespace(api_key="test-private-key", base_url="https://provider.invalid/v1")


@pytest.mark.asyncio
async def test_ordinary_traffic_gets_priority_but_cannot_starve_catalog_admission():
    activity = LegacyActivity()
    events, emit = collector()
    activity.enter()
    try:
        pending = asyncio.create_task(activity.wait(emit, resource="catalog", max_wait_seconds=.03))
        await asyncio.sleep(0)
        assert not pending.done()
        await asyncio.wait_for(pending, .2)
        assert activity.active == 1, "Admission must not alter the ordinary request's lifetime"
        assert [e["type"] for e in events] == ["resource.waiting", "resource.resumed"]
        assert events[-1]["data"]["admission"] == "aged"
        assert events[-1]["data"]["resource"] == "catalog"
    finally:
        activity.leave()


@pytest.mark.asyncio
async def test_provider_capacity_is_shared_fair_cancellable_and_provider_specific():
    capacity = ProviderCapacity(1)
    events, emit = collector()
    first = await capacity.acquire("audio", emit)
    second = asyncio.create_task(capacity.acquire("audio", emit))
    cancelled = asyncio.create_task(capacity.acquire("audio", emit))
    await asyncio.sleep(0)
    independent = await asyncio.wait_for(capacity.acquire("vision", emit), .1)
    independent.release()
    assert not second.done()
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    first.release()
    second_slot = await asyncio.wait_for(second, .1)
    second_slot.release()
    final = await asyncio.wait_for(capacity.acquire("audio", emit), .1)
    final.release()
    assert any(e["data"]["reason"] == "provider_capacity" for e in events)


@pytest.mark.asyncio
async def test_remote_model_bypasses_ordinary_http_lifetime_and_records_first_content(monkeypatch):
    activity = LegacyActivity()
    monkeypatch.setattr(admission, "legacy_activity", activity)
    activity.enter()
    usage = {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15,
             "prompt_tokens_details": {"cached_tokens": 4}}
    packets = [{"choices": [{"delta": {}, "finish_reason": None}]},
               {"choices": [{"delta": {"content": "观察"}, "finish_reason": None}]},
               {"choices": [{"delta": {"content": "结果"}, "finish_reason": "stop"}], "usage": usage}]

    def handler(req):
        assert req.headers["authorization"] == "Bearer test-private-key"
        return httpx.Response(200, content="".join("data: " + json.dumps(p) + "\n\n" for p in packets))

    registry, ledger = Registry(), UsageLedger()
    events, emit = collector()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    settings = PiSettings(audio_model="fake:audio", yield_to_legacy=True)
    models = ModelTransport(registry, settings, ledger, emit, client=client)
    try:
        text, provenance = await asyncio.wait_for(models.observe([{"type": "text", "text": "question"}],
            kind="audio", input_units=10, parent="tool:test"), .3)
        assert text == "观察结果" and provenance["usage"] == usage
        kinds = [e["type"] for e in events]
        assert kinds == ["model.started", "model.response", "model.first_content", "model.completed"]
        assert events[0]["data"]["input_bytes"] > 0
        assert events[-1]["data"]["usage"] == usage
        assert all(e["parent_span_id"] == "tool:test" for e in events)
        assert "test-private-key" not in json.dumps(events)
        assert ledger.model_requests == 1 and ledger.model_tokens == 15
        assert registry.health == {"unchanged": True} and registry.routes == {"legacy": "unchanged"}
        assert activity.active == 1
    finally:
        activity.leave()
        await models.close()


@pytest.mark.asyncio
async def test_transports_share_provider_capacity_and_waiting_cancellation_is_not_billed():
    capacity, started, release = ProviderCapacity(1), asyncio.Event(), asyncio.Event()

    async def handler(req):
        started.set()
        await release.wait()
        return httpx.Response(200, json={"data": [{"embedding": [1.0]}], "usage": {"total_tokens": 4}})

    models, ledgers = [], []
    for _ in range(2):
        ledger = UsageLedger()
        ledgers.append(ledger)
        models.append(ModelTransport(Registry(), PiSettings(embedding_model="shared:embed"), ledger,
            collector()[1], provider_capacity=capacity, client=httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    first = asyncio.create_task(models[0].embed("one", "tool:1"))
    try:
        await started.wait()
        second = asyncio.create_task(models[1].embed("two", "tool:2"))
        await asyncio.sleep(0)
        assert ledgers[1].model_requests == 0
        second.cancel()
        with pytest.raises(asyncio.CancelledError):
            await second
        release.set()
        assert await first == [1.0]
        assert await models[1].embed("three", "tool:3") == [1.0]
        assert [ledger.model_requests for ledger in ledgers] == [1, 1]
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)
        await asyncio.gather(*(model.close() for model in models))


def test_runtime_fingerprints_bind_protocol_and_settings_without_credentials():
    one = PiSettings(model_api_key="one-secret", api_token="one-token", model_base_url="https://private-one.invalid")
    two = one.model_copy(update={"model_api_key": "second-secret", "api_token": "second-token",
                                 "model_base_url": "https://private-two.invalid"})
    initial = runtime_fingerprints(one, WORKER, [{"name": "search"}], prompt="输入")
    assert {"media_cache.py", "payloads.py", "prompt_translations.json"} <= initial["runtime_files"].keys()
    assert initial == runtime_fingerprints(two, WORKER, [{"name": "search"}], prompt="输入")
    assert initial["input_bytes"] == len("输入".encode())
    assert initial["tool_schema_sha256"] != runtime_fingerprints(one, WORKER, [{"name": "read"}])["tool_schema_sha256"]
    assert initial["config_sha256"] != runtime_fingerprints(one.model_copy(update={"max_concurrent_media": 3}),
        WORKER, [{"name": "search"}])["config_sha256"]
    assert "secret" not in json.dumps(initial) and "private-one" not in json.dumps(initial)


@pytest.mark.asyncio
async def test_main_model_and_light_tools_continue_during_ordinary_stream_after_catalog(tmp_path, monkeypatch):
    activity = LegacyActivity()
    monkeypatch.setattr(admission, "legacy_activity", activity)
    script = """
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='start') console.log(JSON.stringify({type:'request',id:'admit',method:'model_request',params:{turn:1,input_bytes:123}}));
 if(m.id==='admit') console.log(JSON.stringify({type:'request',id:'usage',method:'model_usage',params:{turn:1,usage:{totalTokens:9}}}));
 if(m.id==='usage') console.log(JSON.stringify({type:'request',id:'ask',method:'tool',params:{tool_call_id:'ask',name:'ask_user',args:{question:'需要哪份资料？'}}}));
 if(m.id==='ask') {console.log(JSON.stringify({type:'settled',result:m.result.details}));process.exit();}
});
"""
    host = make_host(tmp_path, monkeypatch, script=script, legacy_priority_grace_seconds=5)
    prepare = host._prepare

    async def prepare_then_ordinary(*args):
        result = await prepare(*args)
        activity.enter()
        return result

    host._prepare = prepare_then_ordinary
    try:
        run = await host.start(request(), "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 1)
        saved = host.store.get(run["id"])
        assert saved["status"] == "needs_input" and activity.active == 1
        events = host.store.events(run["id"])
        assert not any(e["type"] == "resource.waiting" for e in events)
        assert next(e["data"]["input_bytes"] for e in events if e["type"] == "model.admitted") == 123
        assert saved["config"]["fingerprints"]["runtime_sha256"]
        assert any(e["type"] == "runtime.configured" for e in events)
        assert "provider-secret-value" not in json.dumps(events)
    finally:
        activity.leave()
        await host.close()


@pytest.mark.asyncio
async def test_cancelled_worker_releases_shared_provider_slot_for_next_run(tmp_path, monkeypatch):
    script = """
import {createInterface} from 'node:readline';
let hold=false;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='start') {
  hold=JSON.parse(m.config.prompt).current_question==='hold';
  console.log(JSON.stringify({type:'request',id:'admit',method:'model_request',params:{turn:1,input_bytes:123}}));
 }
 if(m.id==='admit' && !hold) console.log(JSON.stringify({type:'request',id:'usage',method:'model_usage',params:{turn:1,usage:{totalTokens:9}}}));
 if(m.id==='usage') console.log(JSON.stringify({type:'request',id:'ask',method:'tool',params:{tool_call_id:'ask',name:'ask_user',args:{question:'需要哪份资料？'}}}));
 if(m.id==='ask') {console.log(JSON.stringify({type:'settled',result:m.result.details}));process.exit();}
});
"""
    host = make_host(tmp_path, monkeypatch, script=script, max_concurrent_provider_requests=1)
    try:
        first = await host.start(request("hold-request").model_copy(update={"message": "hold"}), "alice")
        await wait_until(lambda: any(e["type"] == "model.admitted" for e in host.store.events(first["id"])))
        first_process = host.processes[first["id"]]
        second = await host.start(request("finish-request"), "alice")
        await wait_until(lambda: any(e["type"] == "resource.waiting" for e in host.store.events(second["id"])))
        assert host.store.get(second["id"])["status"] == "running"
        await host.cancel(first["id"], "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 2)
        assert first_process.returncode is not None
        assert host.store.get(first["id"])["state"]["usage"]["unknown_usage_requests"] == 1
        assert host.store.get(second["id"])["status"] == "needs_input"
        final = await asyncio.wait_for(host.provider_capacity.acquire("fake", collector()[1]), .1)
        final.release()
    finally:
        await host.close()


@pytest.mark.asyncio
async def test_model_route_refresh_applies_to_new_runs_without_changing_existing_observation_identity():
    class MutableRegistry(Registry):
        provider_name, raw_model, endpoint, key = "old", "raw-old", "https://old.invalid/v1", "old-fixture-key"

        def get_model_config(self, name):
            return {"type": "audio", "provider": self.provider_name, "raw_model": self.raw_model}

        def get_provider(self, name):
            return SimpleNamespace(api_key=self.key, base_url=self.endpoint)

    registry, sent = MutableRegistry(), []

    def handler(req):
        sent.append((req.url.host, json.loads(req.content)["model"], req.headers["authorization"]))
        return httpx.Response(200, content='data: {"choices":[{"delta":{"content":"observed"},"finish_reason":"stop"}],"usage":{"total_tokens":4}}\n\n')

    settings = PiSettings(audio_model="same:alias")
    transports = []
    def new_run():
        value = ModelTransport(registry, settings, UsageLedger(), collector()[1],
                               client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        transports.append(value)
        return value

    existing = new_run()
    async def observe(transport):
        return await transport.observe([{"type": "text", "text": "what?"}], kind="audio", input_units=2, parent="tool")
    try:
        await observe(existing)
        registry.provider_name, registry.raw_model = "new", "raw-new"
        registry.endpoint, registry.key = "https://new.invalid/v2", "new-fixture-key"
        await observe(existing)
        await observe(new_run())
        assert sent == [("old.invalid", "raw-old", "Bearer old-fixture-key"),
                        ("old.invalid", "raw-old", "Bearer old-fixture-key"),
                        ("new.invalid", "raw-new", "Bearer new-fixture-key")]
    finally:
        await asyncio.gather(*(transport.close() for transport in transports))


@pytest.mark.asyncio
@pytest.mark.parametrize("capacity", [1, 2])
async def test_duplicate_model_admission_does_not_wait_on_or_erase_original_permit(tmp_path, monkeypatch, capacity):
    script = """
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='start') console.log(JSON.stringify({type:'request',id:'first',method:'model_request',params:{turn:1,input_bytes:123}}));
 if(m.id==='first') console.log(JSON.stringify({type:'request',id:'duplicate',method:'model_request',params:{turn:1,input_bytes:123}}));
 if(m.id==='duplicate') {
  if(!m.error) process.exit(20);
  console.log(JSON.stringify({type:'request',id:'usage',method:'model_usage',params:{turn:1,usage:{totalTokens:9}}}));
 }
 if(m.id==='usage') console.log(JSON.stringify({type:'request',id:'ask',method:'tool',params:{tool_call_id:'ask',name:'ask_user',args:{question:'需要哪份资料？'}}}));
 if(m.id==='ask') {console.log(JSON.stringify({type:'settled',result:m.result.details}));process.exit();}
});
"""
    host = make_host(tmp_path, monkeypatch, script=script, max_concurrent_provider_requests=capacity)
    try:
        run = await host.start(request(), "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 1)
        saved = host.store.get(run["id"])
        assert saved["status"] == "needs_input" and saved["state"]["usage"]["model_requests"] == 1
        gates = []
        try:
            for _ in range(capacity):
                gates.append(await asyncio.wait_for(host.provider_capacity.acquire("fake", collector()[1]), .1))
        finally:
            for gate in gates:
                gate.release()
    finally:
        await host.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("initially_active", [False, True])
async def test_catalog_scan_shares_one_priority_grace_across_all_checkpoints(tmp_path, monkeypatch, initially_active):
    activity, entered = LegacyActivity(), threading.Event()
    monkeypatch.setattr(admission, "legacy_activity", activity)
    host = make_host(tmp_path, monkeypatch, legacy_priority_grace_seconds=.03)
    loop = asyncio.get_running_loop()
    reads = []

    def enter():
        activity.enter()
        entered.set()

    def catalog(_storage, *, checkpoint):
        checkpoint()
        reads.append("first")
        if not initially_active:
            loop.call_soon_threadsafe(enter)
            assert entered.wait(1)
        for _ in range(30):
            checkpoint()
            reads.append("next")
        return SourceCatalog([], {})

    monkeypatch.setattr(SourceCatalog, "load", catalog)
    if initially_active:
        enter()
    events, emit = collector()
    try:
        started = time.monotonic()
        await asyncio.wait_for(host._load_catalog(UsageLedger(), emit), .4)
        elapsed = time.monotonic() - started
        waits = [e for e in events if e["type"] == "resource.waiting"]
        assert len(waits) == 1, "Every catalog page must share the first contention's age"
        assert len(reads) == 31 and activity.active == 1
        assert .02 <= elapsed < .4
    finally:
        activity.leave()
        await host.close()


@pytest.mark.asyncio
async def test_aged_catalog_still_checks_cancellation_before_the_next_read(tmp_path, monkeypatch):
    activity, started, release = LegacyActivity(), threading.Event(), threading.Event()
    monkeypatch.setattr(admission, "legacy_activity", activity)
    host = make_host(tmp_path, monkeypatch, legacy_priority_grace_seconds=.02)
    reads = []

    def catalog(_storage, *, checkpoint):
        checkpoint()
        reads.append("first")
        started.set()
        assert release.wait(1)
        checkpoint()
        reads.append("second")
        return SourceCatalog([], {})

    monkeypatch.setattr(SourceCatalog, "load", catalog)
    activity.enter()
    pending = asyncio.create_task(host._load_catalog(UsageLedger(), collector()[1]))
    try:
        await wait_until(started.is_set)
        pending.cancel()
        await asyncio.sleep(0)
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(pending, .5)
        assert reads == ["first"]
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)
        activity.leave()
        await host.close()
