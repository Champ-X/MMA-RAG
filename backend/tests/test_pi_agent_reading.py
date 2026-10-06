import asyncio
from dataclasses import replace
import json
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.gateway import KnowledgeGateway
from app.modules.pi_agent.policy import AccessScope, ToolError
from test_pi_agent_tools import fixture_tools, source, request


class IndexedText:
    def __init__(self, text, *, modality="doc"):
        self.calls = []
        field = {"doc": "text_content", "audio": "transcript"}[modality]
        self.point = SimpleNamespace(id="point-1", payload={"file_id": "file", "kb_id": "a",
            "chunk_index": 4, "shot_start_time": 10, "shot_end_time": 30, field: text})

    async def scroll(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return [self.point], None

    async def count(self, _collection, *, count_filter, **_kwargs):
        return SimpleNamespace(count=0 if len(count_filter.must) > 1 else 1)


def gateway(client, modality="doc"):
    item = replace(source(), modality=modality)
    catalog = SourceCatalog([item], {"a": "A"})
    scope = AccessScope.from_request(request(), {"a"})
    return KnowledgeGateway(catalog, scope, client, None, asyncio.Semaphore(1)), item


@pytest.mark.asyncio
@pytest.mark.parametrize("modality", ["doc", "audio"])
async def test_long_index_record_can_be_read_to_the_end_without_skipping_unicode(modality):
    original = "🔎Cafe\u0301原文\n" * 1700 + "最后的条件：只测试英语。"
    client = IndexedText(original, modality=modality)
    reader, item = gateway(client, modality)
    observations, report = await reader.read(item, start=4 if modality == "doc" else 0, limit=1)
    first = observations[0]
    assert first.provenance["truncated"]
    assert "只测试英语" not in first.content
    parts, versions = [first.content], [first.version]
    while report["text_continuations"]:
        continuation = report["text_continuations"][0]
        assert continuation["source_id"] == item.id
        assert continuation["text_offset"] == sum(len(part) for part in parts)
        observations, report = await reader.read(item, **{k: v for k, v in continuation.items() if k != "source_id"})
        evidence = observations[0]
        assert evidence.source_id == item.id
        assert evidence.locator["text_start"] == sum(len(part) for part in parts)
        assert evidence.locator["text_end"] == evidence.locator["text_start"] + len(evidence.content)
        assert evidence.locator["total_chars"] == first.locator["total_chars"]
        parts.append(evidence.content)
        versions.append(evidence.version)
    expected = original if modality == "doc" else "转写：" + original
    assert "".join(parts) == expected
    assert len(versions) == len(set(versions))
    assert len(client.calls) == 2
    assert observations[0].observation == ("parsed_text" if modality == "doc" else "transcript")
    assert observations[0].locator["shot_start_time"] == 10
    # Reaching the tail does not relabel this slice as the whole record.
    assert observations[0].provenance["truncated"]


@pytest.mark.asyncio
async def test_character_offset_cannot_ambiguously_apply_to_multiple_records():
    client = IndexedText("原文")
    reader, item = gateway(client)
    with pytest.raises(ToolError, match="limit=1"):
        await reader.read(item, start=4, limit=3, text_offset=1)
    assert not client.calls


@pytest.mark.asyncio
async def test_invalid_offset_and_foreign_source_cannot_produce_empty_or_cross_scope_evidence():
    client = IndexedText("原文")
    reader, item = gateway(client)
    with pytest.raises(ToolError, match="超出"):
        await reader.read(item, start=4, limit=1, text_offset=2)
    client.point.payload["kb_id"] = "different-kb"
    observations, report = await reader.read(item, start=4, limit=1, text_offset=1)
    assert observations == []
    assert report["text_continuations"] == []
    assert report["status"] == "no_index_content"


@pytest.mark.asyncio
async def test_continuation_rejects_a_changed_record_even_if_the_prefix_is_identical():
    client = IndexedText("前文" * 7000 + "旧结论")
    reader, item = gateway(client)
    _, report = await reader.read(item, start=4, limit=1)
    continuation = report["text_continuations"][0]
    client.point.payload["text_content"] = "前文" * 7000 + "新结论"
    with pytest.raises(ToolError, match="版本已改变"):
        await reader.read(item, **{k: v for k, v in continuation.items() if k != "source_id"})


@pytest.mark.asyncio
async def test_host_accepts_returned_continuation_and_registers_only_delivered_text(tmp_path):
    original = "前文" * 7000 + "最后的条件：只测试英语。"
    tools, store, run, _ = fixture_tools(tmp_path, answer_checks_enabled=False)
    reader, item = gateway(IndexedText(original))
    tools.gateway = reader
    first = await tools.execute("head", "read_source", {"source_id": item.id, "start": 4, "limit": 1})
    assert not first.get("isError")
    cursor = json.loads(first["content"][0]["text"])["text_continuations"][0]
    second = await tools.execute("tail", "read_source", cursor)
    assert not second.get("isError")
    assert second["details"]["evidence_ids"] == [2]
    pieces = store.evidence(run)
    assert "".join(piece.content for piece in pieces) == original
    accepted = await tools.execute("finish", "submit_answer", {
        "answer": "只测试英语。[2]", "evidence_ids": [2]})
    assert accepted["details"]["terminal"] == "completed"
    assert accepted["details"]["citations"][0]["content"] == pieces[1].content
