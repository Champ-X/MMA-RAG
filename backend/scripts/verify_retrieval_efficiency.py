"""Compare scheduling changes against a Git revision using fixed upstream data.

Run from the repository root:
  .venv/bin/python backend/scripts/verify_retrieval_efficiency.py --baseline HEAD

This is deterministic synthetic replay, not a live corpus quality benchmark.
No provider calls, knowledge-base writes, or changes to model settings occur.
"""
import argparse
import asyncio
import copy
import json
from pathlib import Path
import random
import subprocess
import sys
from types import ModuleType, SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.llm.manager import LLMCallResult
from app.modules.retrieval.search_engine import HybridSearchEngine
from app.modules.retrieval.reranker import Reranker
from loguru import logger

ROOT = Path(__file__).resolve().parents[2]


def original_engine(revision):
    source = subprocess.check_output(
        ["git", "show", f"{revision}:backend/app/modules/retrieval/search_engine.py"],
        cwd=ROOT, text=True,
    )
    module = ModuleType("baseline_search_engine")
    exec(compile(source, "baseline_search_engine.py", "exec"), module.__dict__)
    return module.HybridSearchEngine


def engine_instance(cls):
    engine = cls.__new__(cls)
    engine.rrf_weights = {"dense": 1.0, "sparse": .8, "visual": 1.2,
                          "audio": 1.0, "video": 1.1, "selected_file": 2.4}
    engine.rrf_k = 60
    return engine


class FixedModels:
    async def embed(self, texts):
        return LLMCallResult(success=True, data=[[float(i), 1.] for i, _ in enumerate(texts)])

    async def rerank(self, query, documents, **kwargs):
        return LLMCallResult(success=True, data=[
            {"index": i, "relevance_score": (sum(map(ord, doc)) % 97) / 100}
            for i, doc in enumerate(documents)
        ])


async def hybrid_replay(cls, upstream, intents, selected):
    engine = engine_instance(cls)
    for index, name in enumerate(upstream):
        async def branch(*args, _name=name, _index=index, **kwargs):
            await asyncio.sleep((6 - _index) * .001)
            return copy.deepcopy(upstream[_name])
        method = "_selected_file_bootstrap_search" if name == "selected_file" else f"_{name}_search"
        setattr(engine, method, branch)
    result = await engine.search(
        {"dense_query": "发布失败后的回滚步骤", "multi_view_queries": ["恢复旧版本"]},
        ["kb"], target_file_ids=["file"] if selected else None,
        selected_files=[{"file_id": "file"}] if selected else [], **intents,
    )
    reranker = Reranker()
    reranker.llm_manager = FixedModels()
    context = SimpleNamespace(**intents, selected_file_modalities=["doc"] if selected else [])
    ranked = await reranker.rerank("发布失败后的回滚步骤", result["raw_results"], context)
    assert result["strategy"] != "error"
    assert ranked["results"]
    return {
        "raw_results": result["raw_results"], "fused_results": result["fused_results"],
        "reranked_results": ranked["results"],
    }


async def dense_replay(cls, upstream):
    engine = engine_instance(cls)
    engine.llm_manager = FixedModels()
    calls = []
    async def search(**kwargs):
        index = int(kwargs["query_vector"][0])
        calls.append(kwargs)
        await asyncio.sleep((4 - index) * .001)
        return copy.deepcopy(upstream[index])
    engine.vector_store = SimpleNamespace(search_text_chunks=search)
    result = await engine._dense_search("primary", ["variant1", "variant2", "variant3"],
                                        ["kb-a", "kb-b"], ["selected-file"], "factual")
    return result, sorted(calls, key=lambda item: item["query_vector"][0])


async def verify(revision):
    baseline = original_engine(revision)
    rng = random.Random(20260910)
    modalities = {"dense": "doc", "sparse": "doc", "visual": "image",
                  "audio": "audio", "video": "video", "selected_file": "doc"}
    for case in range(48):
        upstream = {}
        for branch, modality in modalities.items():
            rows = []
            for i in range(rng.randint(5, 35)):
                document = rng.randrange(18)
                rows.append({
                    "id": f"{modality}-{document}", "content_type": modality,
                    "score": rng.choice([.1, .5, .8, .8, .9]),
                    "payload": {"text_content": f"Evidence {document}", "file_id": "file",
                                "file_path": f"{document}.md", "kb_id": "kb"},
                })
            upstream[branch] = rows
        choices = ["unnecessary", "implicit_enrichment", "explicit_demand"]
        intents = {"visual_intent": choices[case % 3],
                   "audio_intent": choices[(case // 3) % 3],
                   "video_intent": choices[(case // 9) % 3]}
        old = await hybrid_replay(baseline, upstream, intents, bool(case % 2))
        new = await hybrid_replay(HybridSearchEngine, upstream, intents, bool(case % 2))
        assert old == new, f"hybrid parity failed in case {case}"
    for case in range(12):
        upstream = [[{"id": str(rng.randrange(8)), "score": rng.choice([.5, .5, .8]),
                      "payload": {"text_content": f"Evidence {j}"}}
                     for j in range(10)] for _ in range(4)]
        old = await dense_replay(baseline, upstream)
        new = await dense_replay(HybridSearchEngine, upstream)
        assert old == new, f"dense parity failed in case {case}"
    return {
        "kind": "deterministic_synthetic_replay",
        "baseline": subprocess.check_output(["git", "rev-parse", revision], cwd=ROOT, text=True).strip(),
        "hybrid_cases": 48, "dense_cases": 12, "differences": 0,
        "compared": ["all branch candidates", "RRF scores and order", "reranked scores and order",
                     "dense query attribution", "KB/file filters", "limits and thresholds"],
        "limitation": "Fixed upstream responses; not a live corpus Recall/NDCG measurement.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default="HEAD")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    logger.remove()
    report = asyncio.run(verify(args.baseline))
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n")
    print(text)
