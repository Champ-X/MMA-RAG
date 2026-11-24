"""Real PDF extraction with deterministic planning and observed physical pages."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pymupdf
import pytest

from app.core.prompt_language import prompt_language
from app.modules.generation.context_builder import ContextBuilder
from app.modules.generation.stream_manager import _reference_map_to_frontend_refs
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
from app.modules.ingestion.parsers.factory import PDFParser
from app.modules.ingestion.service import IngestionService
from app.modules.ingestion.splitters.agentic import (
    AgenticDocumentChunker, ChunkPlan, ChunkingConfig, SemanticRelation, source_from_parse_result,
)


class WholeDocumentPlanner:
    name = "deterministic-whole-document"

    async def plan(self, units, config):
        return [ChunkPlan(units[0].id, units[-1].id, title="Manual reference", semantic_type="procedure")]


def chunker(planner=None):
    return AgenticDocumentChunker(None, config=ChunkingConfig(hard_max_tokens=600), planner=planner or WholeDocumentPlanner())


@pytest.mark.asyncio
async def test_two_page_cedar_manual_is_parsed_embedded_and_cited_on_physical_page_two():
    with pymupdf.open() as document:
        document.new_page().insert_text((72, 90), "Tessmora acceptance manual")
        document.new_page().insert_text((72, 90), "Recovery code: CEDAR-17")
        data = document.tobytes()
    parsed = await PDFParser()._parse_with_pymupdf(data, "manual.pdf")
    source = source_from_parse_result(parsed)
    chunks = await chunker().chunk_parse_result(parsed)
    assert len(chunks) == 2
    assert "".join(row["text"] for row in chunks) == source.text
    assert [row["metadata"]["page_number"] for row in chunks] == [1, 2]
    assert "CEDAR-17" not in chunks[0]["text"] and "CEDAR-17" in chunks[1]["text"]
    assert "CEDAR-17" not in chunks[0]["embedding_text"]
    assert "CEDAR-17" in chunks[1]["embedding_text"]
    assert all(row["embedding_text"].startswith("[知识单元] Manual reference") for row in chunks)
    assert all("page_end" not in row["metadata"] for row in chunks)
    for row in chunks:
        span = row["metadata"]["chunking"]
        assert source.text[span["source_start"]:span["source_end"]] == row["text"]

    # Exercise the production vectorization loop with a deterministic encoder:
    # the second page must receive its own recomputed input/vector, not the
    # full parent chunk's vector copied onto both pages.
    service = IngestionService.__new__(IngestionService)
    seen_sparse = []
    def sparse(texts, **kwargs):
        seen_sparse.extend(texts)
        return [{"sparse": {17: 1.0} if "CEDAR-17" in text else {1: 1.0}} for text in texts]
    service.sparse_encoder = SimpleNamespace(encode_corpus=sparse)
    service._update_processing_status = lambda *args: None
    service._embed_ingestion = AsyncMock(side_effect=lambda texts, **kwargs: [[2.0] if "CEDAR-17" in text else [1.0] for text in texts])
    vectorized = await service._vectorize_text_chunks(chunks, "synthetic")
    assert service._embed_ingestion.call_args.args[0] == [row["embedding_text"] for row in chunks]
    assert seen_sparse == [row["text"] for row in chunks]
    assert [row["vector"] for row in vectorized["chunks"]] == [[1.0], [2.0]]
    hit = vectorized["chunks"][1]
    builder = ContextBuilder.__new__(ContextBuilder)
    builder.max_context_length, builder.max_chunks = 4000, 15
    builder.max_images = builder.max_images_implicit = 5
    builder.formatter = MultiModalFormatter()
    found = SimpleNamespace(context=SimpleNamespace(intent_type="factual"), reranked_results=[{
        "id": "physical-page-two", "content_type": "doc", "final_score": 1,
        "payload": {"text_content": hit["text"], "metadata": hit["metadata"], "file_type": "pdf",
                    "file_path": "documents/manual.pdf", "file_id": "manual", "kb_id": "synthetic"},
    }])
    with prompt_language("en-US"):
        built = await builder.build_context(found, "What recovery code is printed, and on which page?")
    assert "Page: 2" in built.context_string and "CEDAR-17" in built.context_string
    citation = _reference_map_to_frontend_refs(built.reference_map)[0]
    assert citation["page_number"] == citation["debug_info"]["page_number"] == 2
    assert citation["file_id"] == "manual" and citation["kb_id"] == "synthetic"


@pytest.mark.asyncio
async def test_rich_markdown_is_preserved_and_page_embeddings_do_not_copy_other_page_text():
    page1 = "# Procedure\n\n| Step | Action |\n| --- | --- |\n| 1 | Start safely |"
    page2 = "[Recovery guide](https://example.test/recovery): CEDAR-17"
    markdown = page1 + "\n\n" + page2
    parsed = {"file_type": "pdf", "markdown": markdown, "pages": [
        {"page": 1, "markdown": page1}, {"page": 2, "markdown": page2},
    ]}
    chunks = await chunker().chunk_parse_result(parsed)
    assert "".join(row["text"] for row in chunks) == markdown
    assert [row["metadata"]["page_number"] for row in chunks] == [1, 2]
    assert "| Step | Action |" in chunks[0]["text"] and "https://example.test" in chunks[1]["text"]
    assert "CEDAR-17" not in chunks[0]["embedding_text"]
    assert "Start safely" not in chunks[1]["embedding_text"]
    assert chunks[1]["embedding_text"].startswith("[章节] Procedure\n[知识单元] Manual reference")


@pytest.mark.asyncio
async def test_unmapped_rich_content_remains_present_without_borrowing_adjacent_page():
    markdown = "Unique first page.\n\nExtra rich content with no physical anchor.\n\nUnique second page."
    chunks = await chunker().chunk_parse_result({"file_type": "pdf", "markdown": markdown, "pages": [
        {"page": 1, "text": "Unique first page."}, {"page": 2, "text": "Unique second page."},
    ]})
    assert "".join(row["text"] for row in chunks) == markdown
    assert [row["metadata"].get("page_number") for row in chunks] == [1, None, 2]


@pytest.mark.asyncio
async def test_blank_or_missing_page_numbers_never_shift_later_physical_pages():
    chunks = await chunker().chunk_parse_result({"file_type": "pdf", "pages": [
        {"page": 1, "text": "First page."}, {"page": 2, "text": ""},
        {"page": 3, "text": "CEDAR-17 is on physical page three."},
        {"text": "Unlocated appendix."},
    ]})
    assert [row["metadata"].get("page_number") for row in chunks] == [1, 3, None]
    assert all(row["metadata"].get("page_number") != 2 for row in chunks)


@pytest.mark.parametrize("markdown,pages", [
    ("Rich **text** with preserved formatting", [{"page": 4, "text": "Rich text with preserved formatting"}]),
    ("Repeated text\n\nRepeated text", [{"page": 1, "text": "Repeated text"}, {"page": 2, "text": "Repeated text"}]),
])
def test_incompatible_or_ambiguous_page_alignment_never_guesses(markdown, pages):
    source = source_from_parse_result({"file_type": "pdf", "markdown": markdown, "pages": pages})
    assert source.text == markdown
    assert source.page_spans == ()


@pytest.mark.asyncio
async def test_page_subdivision_remaps_semantic_relations_and_keeps_each_once():
    class RelatedPlanner:
        name = "related-pages"

        async def plan(self, units, config):
            return [
                ChunkPlan(units[0].id, units[-2].id, title="Background",
                          relations=(SemanticRelation(units[-1].id, "prerequisite_for"),)),
                ChunkPlan(units[-1].id, units[-1].id, title="Conclusion"),
            ]
    chunks = await chunker(RelatedPlanner()).chunk_parse_result({"file_type": "pdf", "pages": [
        {"page": 1, "text": "First prerequisite."},
        {"page": 2, "text": "Second prerequisite."},
        {"page": 3, "text": "Conclusion."},
    ]})
    assert len(chunks) == 3
    relations = [relation for row in chunks for relation in row["metadata"]["semantic_relations"]]
    assert relations == [{"target_chunk_local_id": "chunk_0003", "relation_type": "prerequisite_for"}]
