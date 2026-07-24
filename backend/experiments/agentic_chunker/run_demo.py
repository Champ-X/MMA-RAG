"""Run the standalone Agentic Chunker against a real Markdown document.

Example:
    PYTHONPATH=backend backend/.venv/bin/python -m experiments.agentic_chunker.run_demo \
      README.md --mode auto --output /private/tmp/agentic-readme-report.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List

from .core import (
    AgenticChunker,
    ChunkingConfig,
    HeuristicPlanningAgent,
    LLMPlanningAgent,
    estimate_tokens,
)


async def _current_repository_baseline(markdown: str) -> List[Dict[str, Any]]:
    """Call the current splitter for an apples-to-apples offline comparison.

    It only invokes the existing private splitting method; no upload, embedding
    or vector-store operation is performed.
    """

    from .repository_baseline import split_with_current_repository_policy

    return await split_with_current_repository_policy(markdown)


def _baseline_metrics(source: str, chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
    texts = [str(chunk.get("text") or "") for chunk in chunks]
    lengths = [len(text) for text in texts]
    return {
        "source_characters": len(source),
        "chunk_count": len(texts),
        "total_chunk_characters": sum(lengths),
        "duplication_ratio": round(sum(lengths) / max(1, len(source)), 4),
        "min_chunk_characters": min(lengths) if lengths else 0,
        "max_chunk_characters": max(lengths) if lengths else 0,
        "max_chunk_tokens_estimate": max((estimate_tokens(text) for text in texts), default=0),
    }


def _baseline_preview(chunks: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    previews: List[Dict[str, Any]] = []
    for index, chunk in enumerate(chunks[:limit], start=1):
        text = str(chunk.get("text") or "")
        previews.append(
            {
                "index": index,
                "char_count": len(text),
                "token_estimate": estimate_tokens(text),
                "preview": " ".join(text.strip().split())[:240],
            }
        )
    return previews


def _chunk_preview(result: Any, limit: int = 12) -> List[Dict[str, Any]]:
    previews: List[Dict[str, Any]] = []
    for chunk in result.chunks[:limit]:
        previews.append(
            {
                "id": chunk.id,
                "title": chunk.title,
                "semantic_type": chunk.semantic_type,
                "section_path": list(chunk.section_path),
                "char_count": len(chunk.text),
                "token_estimate": estimate_tokens(chunk.text),
                "relations": chunk.relations,
                "preview": " ".join(chunk.text.strip().split())[:240],
            }
        )
    return previews


async def _run(args: argparse.Namespace) -> Dict[str, Any]:
    document = Path(args.document).resolve()
    source = document.read_text(encoding="utf-8")
    config = ChunkingConfig(
        hard_max_tokens=args.hard_max_tokens,
        max_agent_input_tokens=args.max_agent_input_tokens,
        max_agent_output_tokens=args.max_agent_output_tokens,
    )
    if args.mode == "heuristic":
        planner = HeuristicPlanningAgent()
    else:
        planner = LLMPlanningAgent(model=args.model or None)

    result = await AgenticChunker(planner=planner, config=config).chunk(source)
    report: Dict[str, Any] = {
        "document": str(document),
        "mode_requested": args.mode,
        "planner_used": result.planner_name,
        "config": asdict(config),
        "agentic": result.metrics(),
        "warnings": result.warnings,
        "chunk_previews": _chunk_preview(result, args.preview_limit),
    }
    if isinstance(planner, LLMPlanningAgent):
        report["llm"] = {
            "model": planner.last_model,
            "duration_seconds": round(planner.last_duration, 3),
            "response_count": len(result.agent_responses),
        }

    if not args.skip_baseline:
        try:
            baseline_chunks = await _current_repository_baseline(source)
            report["current_repository_baseline"] = _baseline_metrics(source, baseline_chunks)
            report["current_repository_baseline_previews"] = _baseline_preview(
                baseline_chunks, args.preview_limit
            )
        except Exception as exc:
            report["current_repository_baseline_error"] = f"{type(exc).__name__}: {exc}"
    return report


def _print_summary(report: Dict[str, Any]) -> None:
    print(f"document: {report['document']}")
    print(f"planner: {report['planner_used']}")
    print("agentic:", json.dumps(report["agentic"], ensure_ascii=False))
    baseline = report.get("current_repository_baseline")
    if baseline:
        print("current_repository_baseline:", json.dumps(baseline, ensure_ascii=False))
    for preview in report["chunk_previews"]:
        print(
            f"- {preview['id']} [{preview['semantic_type']}] "
            f"{preview['title']} ({preview['token_estimate']} tok est.)"
        )
    for warning in report.get("warnings") or []:
        print("warning:", warning, file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", help="path to a real Markdown document")
    parser.add_argument(
        "--mode",
        choices=("auto", "llm", "heuristic"),
        default="auto",
        help="auto/llm calls the configured LLM and falls back safely; heuristic avoids network",
    )
    parser.add_argument("--model", default="", help="optional existing LLM registry model name")
    parser.add_argument("--hard-max-tokens", type=int, default=600)
    parser.add_argument("--max-agent-input-tokens", type=int, default=24_000)
    parser.add_argument("--max-agent-output-tokens", type=int, default=4_000)
    parser.add_argument("--skip-baseline", action="store_true")
    parser.add_argument("--preview-limit", type=int, default=12)
    parser.add_argument("--output", default="", help="write the full JSON report to this path")
    args = parser.parse_args()

    report = asyncio.run(_run(args))
    _print_summary(report)
    if args.output:
        output = Path(args.output).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
