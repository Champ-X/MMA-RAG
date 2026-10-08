"""Real production model adapters; public vectors stay in isolated local files."""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import json
import os
import time
from pathlib import Path

from .retrieval_runner import BM25Retriever, RetrievalAttemptError, allowed, unit_hits
from .retrieval_schema import canonical, digest, require

_observations = contextvars.ContextVar("retrieval_eval_provider_observations", default=None)


class ModelCalls:
    """Call existing provider routes with fallback disabled and record actual usage."""
    def __init__(self):
        from app.core.llm.manager import llm_manager
        self.manager = llm_manager
        self.models = {task: llm_manager.registry.get_task_model(task) for task in ("embedding", "reranking")}
        self.stack = {}
        for task, model in self.models.items():
            cfg = llm_manager.registry.get_model_config(model)
            provider = llm_manager.registry.get_provider(cfg["provider"])
            self.stack[task] = {"model": model, "provider": cfg["provider"], "raw_model": llm_manager.registry.get_raw_model_name(model)}
            client = getattr(provider, "client", None)
            if client is not None and hasattr(client, "event_hooks") and not getattr(client, "_retrieval_eval_observer", False):
                client.event_hooks.setdefault("response", []).append(self._observe)
                client._retrieval_eval_observer = True

    @staticmethod
    async def _observe(response):
        observations = _observations.get()
        if observations is None:
            return
        await response.aread()
        receipt = {"status_code": response.status_code, "request_id": response.headers.get("x-request-id"),
                   "endpoint": response.request.url.path}
        try:
            body = response.json()
            receipt["usage"] = body.get("usage") or body.get("meta", {}).get("usage") if isinstance(body.get("meta", {}), dict) else body.get("usage")
            receipt["response_model"] = body.get("model")
            if response.request.url.path.endswith("/embeddings") and response.is_success:
                data = body.get("data", [])
                if [v.get("index") for v in data] != list(range(len(data))):
                    receipt["contract_error"] = "embedding_index_order"
        except (ValueError, TypeError, AttributeError):
            receipt["usage"] = None
        observations.append(receipt)

    async def invoke(self, method: str, **kwargs):
        observations = []
        token = _observations.set(observations)
        started = time.perf_counter()
        try:
            result = await getattr(self.manager, method)(fallback=False, total_timeout=120, **kwargs)
        finally:
            _observations.reset(token)
        if any(r.get("contract_error") for r in observations):
            result.success = False
            result.error_category = "embedding_index_order"
        known, unknown = 0, 0
        for observed in observations:
            usage = observed.get("usage") or {}
            count = usage.get("total_tokens")
            if isinstance(count, int) and count >= 0:
                known += count
            else:
                unknown += 1
        receipt = {"success": result.success, "model": result.model_used, "duration_seconds": time.perf_counter() - started,
                   "error_category": result.error_category, "status_code": result.status_code,
                   "usage": {"known_tokens": known, "unknown_usage_calls": unknown or int(not observations)}, "provider_receipts": observations}
        return result, receipt


async def _embed_batch(calls: ModelCalls, texts: list[str], cache: Path):
    import numpy as np
    key = digest({"inputs": texts, "model": calls.stack["embedding"]})
    path, receipt_path, pending = cache / (key + ".npy"), cache / (key + ".json"), cache / (key + ".pending")
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        require(receipt["success"], f"embedding batch previously failed ({key}); preserve receipt and use a new explicit experiment cache")
        require(path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == receipt["vector_sha256"], "cached vector checksum mismatch")
        return np.load(path, allow_pickle=False), receipt
    require(not pending.exists(), f"unconfirmed prior embedding attempt {key}; inspect its live process before taking recovery action")
    pending.write_text(json.dumps({"input_sha256": digest(texts), "rows": len(texts), "model": calls.stack["embedding"], "pid": os.getpid()}) + "\n")
    result, receipt = await calls.invoke("embed", texts=texts, model=calls.models["embedding"])
    receipt.update(input_sha256=digest(texts), rows=len(texts))
    if result.success:
        vectors = np.asarray(result.data, dtype=np.float32)
        if vectors.ndim != 2 or vectors.shape[0] != len(texts) or not np.isfinite(vectors).all() or (np.linalg.norm(vectors, axis=1) == 0).any():
            receipt.update(success=False, error_category="invalid_vector_response")
        else:
            with path.open("xb") as stream:
                np.save(stream, vectors, allow_pickle=False)
            receipt.update(vector_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), dimensions=vectors.shape[1])
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    pending.unlink()
    require(receipt["success"], f"embedding request failed: {receipt['error_category']}; receipt {receipt_path.name}")
    return vectors, receipt


async def prepare_dense(dataset, destination: Path, *, batch_size: int = 32, concurrency: int = 2, progress=print):
    import numpy as np
    require(1 <= batch_size <= 32 and 1 <= concurrency <= 4, "embedding batch/concurrency outside protocol limits")
    destination.mkdir(parents=True, exist_ok=True)
    cache = destination / "batches"
    cache.mkdir(exist_ok=True)
    calls = ModelCalls()
    protocol = {"schema_version": "retrieval-dense-index-1", "dataset_fingerprint": dataset.fingerprint,
                "model": calls.stack["embedding"], "batch_size": batch_size, "concurrency": concurrency,
                "input_policy": "title-plus-original-unit-v1", "index_kind": "exact-cosine-numpy-local-isolated"}
    manifest_path = destination / "protocol.json"
    if manifest_path.exists():
        require(json.loads(manifest_path.read_text()) == protocol, "dense preparation protocol changed")
    else:
        manifest_path.write_text(json.dumps(protocol, indent=2) + "\n")
    # Lock remains held over real provider calls; stale lock files alone do not block resumption.
    import fcntl
    with (destination / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        hits = unit_hits(dataset)
        sequences = {"corpus": [dataset.sources[h["source_id"]].get("metadata", {}).get("title", "") + "\n" + h["content"] for h in hits],
                     "queries": [c["query"] for c in dataset.cases]}
        receipts = {}
        for name, texts in sequences.items():
            output = destination / (name + ".npy")
            receipt_file = destination / (name + "-receipts.json")
            if output.exists() and receipt_file.exists():
                saved = json.loads(receipt_file.read_text())
                require(saved["vector_sha256"] == hashlib.sha256(output.read_bytes()).hexdigest(), "dense matrix hash changed")
                receipts[name] = saved
                continue
            semaphore = asyncio.Semaphore(concurrency)
            stopped = asyncio.Event()
            batches = [texts[i:i + batch_size] for i in range(0, len(texts), batch_size)]
            async def one(index, batch):
                async with semaphore:
                    if stopped.is_set():
                        return None
                    try:
                        vectors, receipt = await _embed_batch(calls, batch, cache)
                    except BaseException:
                        stopped.set()
                        raise
                    progress(f"{name} {index + 1}/{len(batches)} rows={len(batch)} seconds={receipt['duration_seconds']:.2f}")
                    return vectors, receipt
            tasks = [asyncio.create_task(one(i, batch)) for i, batch in enumerate(batches)]
            try:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                failures = [result for result in results if isinstance(result, BaseException)]
                if failures:
                    raise failures[0]
            except BaseException:
                # Let already admitted calls finish and preserve their receipts before propagating failure.
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                raise
            matrix = np.concatenate([item[0] for item in results])
            with output.open("wb") as stream:
                np.save(stream, matrix, allow_pickle=False)
            saved = {"batches": [item[1] for item in results], "rows": len(texts), "dimensions": matrix.shape[1],
                     "vector_sha256": hashlib.sha256(output.read_bytes()).hexdigest()}
            receipt_file.write_text(json.dumps(saved, indent=2) + "\n")
            receipts[name] = saved
        summary = {**protocol, "matrices": {k: {field: v[field] for field in ("rows", "dimensions", "vector_sha256")} for k, v in receipts.items()},
                   "usage": {key: sum(b["usage"][key] for r in receipts.values() for b in r["batches"]) for key in ("known_tokens", "unknown_usage_calls")}}
        (destination / "manifest.json").write_text(json.dumps(summary, indent=2) + "\n")
        return summary


class DenseRetriever:
    def __init__(self, dataset, index: Path, *, profile: str):
        import numpy as np
        self.np = np
        manifest = json.loads((index / "manifest.json").read_text())
        require(manifest["dataset_fingerprint"] == dataset.fingerprint, "dense index dataset mismatch")
        matrices = {}
        for name in ("corpus", "queries"):
            path = index / (name + ".npy")
            require(hashlib.sha256(path.read_bytes()).hexdigest() == manifest["matrices"][name]["vector_sha256"], "dense matrix hash mismatch")
            matrix = np.load(path, allow_pickle=False)
            matrices[name] = matrix / np.linalg.norm(matrix, axis=1, keepdims=True)
        self.corpus, self.queries = matrices["corpus"], matrices["queries"]
        self.hits = unit_hits(dataset)
        require(self.corpus.ndim == self.queries.ndim == 2 and self.corpus.shape[1] == self.queries.shape[1], "invalid dense matrix dimensions")
        require(self.corpus.shape[0] == len(self.hits) and self.queries.shape[0] == len(dataset.cases), "dense matrix row count mismatch")
        require(np.isfinite(self.corpus).all() and np.isfinite(self.queries).all(), "invalid normalized dense vectors")
        self.query_ids = {c["id"]: i for i, c in enumerate(dataset.cases)}
        self.hit_ids = {h["id"]: i for i, h in enumerate(self.hits)}
        self.lexical = BM25Retriever(dataset) if profile in {"hybrid", "hybrid-rerank"} else None
        self.profile = profile
        self.calls = ModelCalls() if profile == "hybrid-rerank" else None
        self.configuration = {"backend": "offline_component", "profile": profile, "index_fingerprint": digest(manifest),
                              "model_stack": {"embedding": manifest["model"], **({"reranking": self.calls.stack["reranking"]} if self.calls else {})},
                              "query_rewrite": False, "fusion": {"k": 60, "dense_weight": 1, "bm25_weight": .8} if self.lexical else None,
                              "candidate_k": 50, "rerank_k": 20, "input_policy": manifest["input_policy"],
                              "timing_scope": "Local warm search; precomputed query embeddings excluded; reranker API included when enabled",
                              "limits": "Controlled exact vector/BM25 retrieval with production model routes. BM25 is not BGE-M3; not the full Tessmora pipeline."}

    async def search(self, case, top_k):
        np = self.np
        scores = self.corpus @ self.queries[self.query_ids[case["id"]]]
        eligible = np.array([i for i, hit in enumerate(self.hits) if allowed(case, hit)], dtype=int)
        ordered = eligible[np.argsort(-scores[eligible], kind="stable")[:max(50, top_k)]]
        candidates = [{**self.hits[i], "score": float(scores[i])} for i in ordered]
        usage = {"known_tokens": 0, "unknown_usage_calls": 0}
        if self.lexical:
            lexical = await self.lexical.search(case, max(50, top_k))
            fused = {}
            for weight, branch in ((1, candidates), (.8, lexical["hits"])):
                for rank, hit in enumerate(branch, 1):
                    if hit["id"] not in fused:
                        fused[hit["id"]] = {**hit, "score": 0.0}
                    fused[hit["id"]]["score"] += weight / (60 + rank)
            candidates = sorted(fused.values(), key=lambda h: (-h["score"], h["id"]))[:max(50, top_k)]
        diagnostics = {"pre_rerank_ids": [h["id"] for h in candidates]}
        if self.calls:
            selected = candidates[:20]
            result, receipt = await self.calls.invoke("rerank", query=case["query"], documents=[h["content"] for h in selected], model=self.calls.models["reranking"])
            if not result.success:
                raise RetrievalAttemptError("reranker_" + str(receipt["error_category"]),
                    {"hits": candidates[:top_k], "usage": receipt["usage"], "diagnostics": {**diagnostics, "reranker": receipt}})
            ranks = result.data
            require(isinstance(ranks, list) and len(ranks) == len(selected), "reranker returned incomplete candidates")
            require({r['index'] for r in ranks} == set(range(len(selected))), "invalid reranker indices")
            reranked = [{**selected[r["index"]], "score": float(r["relevance_score"])} for r in ranks]
            reranked.sort(key=lambda h: (-h["score"], h["id"]))
            candidates = reranked + candidates[20:]
            usage = receipt["usage"]
            diagnostics["reranker"] = receipt
        return {"hits": candidates[:top_k], "usage": usage, "diagnostics": diagnostics}
