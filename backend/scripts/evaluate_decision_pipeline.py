"""Read-only paired live retrieval/generation against the existing local indexes.

Requires an explicit frozen protocol and --live; no saved setting, session,
document or index is written. Raw local receipts are not a public benchmark.
"""
import argparse
import asyncio
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


async def run(args):
    from app.core.jev_settings import JevConfig, _request_config
    from app.core.decision_diagnostics import retrieval_diagnostics
    from app.modules.retrieval.service import RetrievalService
    from app.modules.generation.service import GenerationService
    from loguru import logger
    logger.remove()
    protocol = json.loads(args.protocol.read_text())
    if args.output.exists():
        raise ValueError("Retain previous receipts; use a new output path")
    for name, expected in protocol["source_sha256"].items():
        assert digest(ROOT / name) == expected, f"Source drift: {name}"
    args.output.mkdir(parents=True)
    logger.add(args.output / "runtime.log", level="INFO", rotation="10 MB")
    setting_path = ROOT / "backend/data/jev_settings.json"
    setting_hash = digest(setting_path)
    retrieval, generation = RetrievalService(), GenerationService()
    summaries = []
    for case_index, case in enumerate(protocol["cases"]):
        arms = protocol["arms"]
        # Frozen rotation distributes the first-run/cache effect across arms.
        arms = arms[case_index % len(arms):] + arms[:case_index % len(arms)]
        for arm in arms:
            cfg = JevConfig(**arm["config"])
            token = _request_config.set(cfg)
            started = time.perf_counter()
            row = {"case_id": case["id"], "arm": arm["id"], "query": case["query"],
                   "config": cfg.model_dump(), "kb_context": case.get("kb_context"),
                   "protocol_sha256": digest(args.protocol)}
            try:
                result = await retrieval.search(case["query"], kb_context=case.get("kb_context"))
                generated = await generation.generate_response(case["query"], result, kb_context=case.get("kb_context"))
                context = generated.get("context_used")
                refs = getattr(context, "reference_map", {})
                row.update(success=generated.get("success", False), answer=generated.get("answer"),
                    metadata=generated.get("metadata"),
                    context_counts=dict(Counter(ref.content_type for ref in refs.values())),
                    references=[{"id": ref.id, "content_type": ref.content_type,
                                 "file_name": (ref.metadata or {}).get("file_name"),
                                 "content": ref.content} for ref in refs.values()],
                    context_string=getattr(context, "context_string", ""),
                    diagnostics=retrieval_diagnostics(result, cfg),
                    kb_ids=result.context.target_kb_ids,
                    branch_counts={key: len(items) for key, items in result.raw_results.items()},
                    retained_ids=[r.get("id") for r in result.reranked_results],
                    retrieval_debug=result.debug_info)
            except Exception as exc:
                # Keep failure denominators without provider/credential text.
                row.update(success=False, error_type=type(exc).__name__)
            finally:
                _request_config.reset(token)
            row["duration_s"] = time.perf_counter() - started
            (args.output / f"{case['id']}-{arm['id']}.json").write_text(json.dumps(row, ensure_ascii=False, indent=2))
            summary = {k: row.get(k) for k in ("case_id", "arm", "success", "duration_s", "context_counts", "branch_counts", "error_type")}
            summaries.append(summary)
            print(json.dumps(summary, ensure_ascii=False), flush=True)
            assert digest(setting_path) == setting_hash, "Saved configuration changed during evaluation"
    summary = {"protocol_sha256": digest(args.protocol), "settings_unchanged": True, "rows": summaries,
               "limitations": "Single paired live run on private corpus; generation and routing stochastic. No accuracy/SLA/cost superiority claim. Corpus unchanged by this script; external concurrent writes not controlled."}
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.live:
        parser.error("Provider calls require --live")
    asyncio.run(run(args))
