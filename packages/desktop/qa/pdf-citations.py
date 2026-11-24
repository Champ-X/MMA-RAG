"""Check a synthetic two-page PDF through real extraction, chunking and citations.

Run with the bundled Python. --backend can select the checkout or a frozen
runtime/backend. No cloud provider, embedding service or vector store is called.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", type=Path, default=Path(__file__).resolve().parents[3] / "backend")
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    os.environ.update({"TESSMORA_RUNTIME_PROFILE": "desktop", "TESSMORA_STATE_DIR": str((args.output / "state").resolve()),
                       "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "PRELOAD_LOCAL_MODELS_ON_STARTUP": "false"})
    sys.path.insert(0, str(args.backend.resolve()))
    from app.core.prompt_language import prompt_language
    from app.modules.ingestion.parsers.factory import PDFParser
    from app.modules.ingestion.splitters.agentic import AgenticDocumentChunker, ChunkPlan, source_from_parse_result
    from app.modules.generation.context_builder import ContextBuilder
    from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
    from app.modules.generation.stream_manager import _reference_map_to_frontend_refs

    class WholeDocumentPlanner:
        name = "synthetic-cross-page-plan"

        async def plan(self, units, config):
            return [ChunkPlan(units[0].id, units[-1].id, title="Manual reference")]

    data = (args.fixtures / "manual.pdf").read_bytes()
    parsed = await PDFParser()._parse_with_pymupdf(data, "manual.pdf")
    assert len(parsed["pages"]) == 2 and "CEDAR-17" in parsed["pages"][1]["text"]
    chunks = await AgenticDocumentChunker(None, planner=WholeDocumentPlanner()).chunk_parse_result(parsed)
    assert len(chunks) == 2 and "".join(row["text"] for row in chunks) == source_from_parse_result(parsed).text
    assert [row["metadata"]["page_number"] for row in chunks] == [1, 2]
    assert "CEDAR-17" not in chunks[0]["embedding_text"] and "CEDAR-17" in chunks[1]["embedding_text"]
    builder = ContextBuilder.__new__(ContextBuilder)
    builder.max_context_length, builder.max_chunks = 4000, 15
    builder.max_images = builder.max_images_implicit = 5
    builder.formatter = MultiModalFormatter()
    source = SimpleNamespace(context=SimpleNamespace(intent_type="factual"), reranked_results=[{
        "id": "synthetic-page-two", "content_type": "doc", "final_score": 1,
        "payload": {"file_path": "documents/manual.pdf", "file_id": "manual", "kb_id": "synthetic",
                    "file_type": "pdf", "text_content": chunks[1]["text"], "metadata": chunks[1]["metadata"]},
    }])
    with prompt_language("en-US"):
        built = await builder.build_context(source, "What recovery code is printed, and on which page?")
    assert "Page: 2" in built.context_string and "CEDAR-17" in built.context_string
    streaming = _reference_map_to_frontend_refs(built.reference_map)[0]
    validated = builder.validate_references("CEDAR-17 is printed on page 2 [1].", built.reference_map)[0]
    for citation in (streaming, validated):
        assert citation["page_number"] == citation["debug_info"]["page_number"] == 2
        assert citation["file_id"] == "manual" and citation["kb_id"] == "synthetic"
    report = {"ok": True, "python": sys.version.split()[0], "backend": str(args.backend.resolve()), "cloud_calls": 0,
        "fixture_sha256": hashlib.sha256(data).hexdigest(), "physical_pages": [1, 2],
        "chunk_count": len(chunks), "lossless": True, "embedding_inputs_page_specific": True,
        "prompt": built.context_string, "stream_citation": streaming, "validated_citation": validated,
        "scope": "Real synthetic PDF extraction and citation plumbing; no embedding inference or generated cloud answer"}
    (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"ok": True, "report": str(args.output / "report.json")}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
