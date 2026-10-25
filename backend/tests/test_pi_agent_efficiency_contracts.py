"""Verify smaller model packets without losing evidence or scope semantics."""
import asyncio
from dataclasses import replace
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.contracts import Evidence
from app.modules.pi_agent.gateway import KnowledgeGateway
from app.modules.pi_agent.payloads import agent_evidence
from app.modules.pi_agent.policy import AccessScope, ToolError
from app.modules.pi_agent.tools import InspectMedia
from test_pi_agent_search_scope import gateway, point, query
from test_pi_agent_tools import fixture_tools, request, source


def packet(source_id, **changes):
    return Evidence(source_id=source_id, file_name="audio.mp3", modality="audio",
        content="实际观察，无人声", observation="media_observation", version="v1",
        locator={"start_sec": 0, "end_sec": 30, "observed_intervals": [{"start_sec": 0, "end_sec": 30}]},
        provenance={"source_version": "v1", "question": "是否有人声？", "calls": [{"usage": {"total_tokens": 1234}}]},
        citation={"type": "audio", "media_info": {"duration": 180}}, **changes)


@pytest.mark.parametrize("checked", [False, True])
def test_model_packet_retains_text_and_evidence_boundaries_but_not_audit_usage(checked):
    evidence = packet(source().id)
    evidence.content = "保留原文" * 10000
    evidence.provenance.update(truncated=True, record_version="record-v1")
    before = evidence.model_dump()
    value = agent_evidence(evidence, checked=checked)
    assert "citation" not in value and "calls" not in value["provenance"]
    assert value["provenance"]["source_version"] == "v1"
    assert value["provenance"]["record_version"] == "record-v1" and value["provenance"]["truncated"]
    assert value["locator"] == evidence.locator
    text = ''.join(unit['text'] for unit in value['content_units']) if checked else value['content']
    assert text == evidence.content
    assert evidence.model_dump() == before


@pytest.mark.asyncio
async def test_compact_tool_result_keeps_full_audit_and_restorable_citation(tmp_path):
    tools, store, rid, _ = fixture_tools(tmp_path, answer_checks_enabled=False)
    observation = packet(source().id)
    async def read(*args, **kwargs):
        return [observation], {"status": "ok"}
    tools.gateway.read = read
    result = await tools.execute("read", "read_source", {"source_id": source().id})
    value = json.loads(result['content'][0]['text'])['evidence'][0]
    saved = store.evidence(rid)[0]
    assert "calls" not in value['provenance'] and saved.provenance['calls']
    assert tools.citation(saved)['content'] == observation.content
    assert tools.citation(saved)['media_info'] == observation.citation['media_info']
    recalled = await tools.execute("recall", "recall_evidence", {"evidence_ids": [saved.id]})
    assert json.loads(recalled['content'][0]['text'])['evidence'][0] == value


@pytest.mark.asyncio
async def test_source_results_preserve_distinct_candidates_and_scope():
    a, b, private = source(), source(fid="second"), source("b", "private")
    points = [point(a, f"a-{n}") for n in range(20)] + [point(b, "b"), point(private, "private")]
    search, _ = gateway([a, b, private], points, req=request(knowledge_base_ids=["a"]))
    passages, _ = await search.search(**query(limit=2))
    assert [e.source_id for e in passages] == [a.id, a.id]
    sources, report = await search.search(**query(limit=2, result_unit="source"))
    assert [e.source_id for e in sources] == [a.id, b.id]
    assert report['result_unit'] == 'source' and report['returned_source_count'] == 2
    assert all(e.source_id != private.id for e in sources)


@pytest.mark.asyncio
async def test_overview_is_verbatim_and_has_versioned_full_text_continuation():
    s = replace(source(), modality="audio", name="song.mp3")
    body = "索引内容" * 300 + "末尾条件不能丢失"
    class Index:
        async def scroll(self, *args, **kwargs):
            return [SimpleNamespace(id="record", payload={"file_id": s.file_id, "kb_id": s.kb_id,
                "description": body})], None
    scope = AccessScope.from_request(request(), {'a'})
    search = KnowledgeGateway(SourceCatalog([s], {'a': 'A'}), scope, Index(), None, asyncio.Semaphore(1))
    evidence, report = await search.overview(s, start=0, limit=1)
    assert report['preview_only'] and report['direct_media_observation'] is False
    assert len(evidence[0].content) == 400 and evidence[0].provenance['truncated']
    continuation = dict(report['text_continuations'][0]); continuation.pop('source_id')
    remaining, _ = await search.read(s, **continuation)
    assert (evidence[0].content + remaining[0].content).endswith('末尾条件不能丢失')
    assert evidence[0].provenance['content_types'] == ['indexed_audio_description']


def test_media_channel_cannot_default_to_expensive_both():
    with pytest.raises(ValidationError):
        InspectMedia(source_id="source", question="观察")


@pytest.mark.asyncio
async def test_successful_media_packets_are_delivered_on_later_failure(tmp_path):
    tools, store, rid, _ = fixture_tools(tmp_path, answer_checks_enabled=False)
    audio = replace(source(), modality="audio", name="audio.mp3")
    tools.catalog = SourceCatalog([audio], {'a': 'A'})
    observation = packet(audio.id)
    class Media:
        async def inspect(self, source, *, on_packet, **kwargs):
            assigned = on_packet(observation, reused=False)
            assert assigned.id == 1
            raise ToolError('media_model_unavailable', 'second packet unavailable', retryable=True)
    tools.media = Media()
    result = await tools.execute('media', 'inspect_media', {'source_id': audio.id, 'question': '观察',
        'view': 'audio', 'end_sec': 60})
    assert result['isError'] and result['details']['evidence_ids'] == [1]
    body = json.loads(result['content'][0]['text'])
    assert body['coverage'] == 'partial' and body['evidence'][0]['content'] == observation.content
    assert store.evidence(rid)[0].locator['end_sec'] == 30
    assert store.artifact(rid, result['details']['artifact_id'])['coverage'] == 'partial'
    recalled = await tools.execute('recall', 'recall_evidence', {'evidence_ids': [1]})
    assert not recalled.get('isError')


@pytest.mark.asyncio
async def test_cancelled_media_packet_is_saved_but_not_claimed_delivered(tmp_path):
    tools, store, rid, _ = fixture_tools(tmp_path, answer_checks_enabled=False)
    class Media:
        async def inspect(self, item, *, on_packet, **kwargs):
            on_packet(packet(item.id), reused=False)
            raise asyncio.CancelledError
    tools.media = Media()
    with pytest.raises(asyncio.CancelledError):
        await tools.execute('media', 'inspect_media', {'source_id': source().id,
            'question': '观察', 'view': 'visual'})
    assert len(store.evidence(rid)) == 1 and tools.delivered == {}
