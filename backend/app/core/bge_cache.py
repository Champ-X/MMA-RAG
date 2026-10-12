"""Complete, bounded BGE-M3 snapshots for managed installations.

FlagEmbedding downloads an entire repository for remote IDs and silently
initializes random sparse/ColBERT heads when either head is missing. Pass it
only a complete local snapshot; successful inference remains the final check.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from pathlib import Path
import re
from threading import Event, Thread

from huggingface_hub import HfApi, hf_hub_download, snapshot_download
from huggingface_hub.errors import LocalEntryNotFoundError

from app.core.model_preparation import report_preparation


_REQUIRED = ("config.json", "tokenizer_config.json", "sparse_linear.pt", "colbert_linear.pt")
_TOKENIZERS = ("tokenizer.json", "sentencepiece.bpe.model")
_METADATA = (*_REQUIRED, *_TOKENIZERS, "special_tokens_map.json", "added_tokens.json",
             "config_sentence_transformers.json", "modules.json", "sentence_bert_config.json")
_WEIGHTS = ("model.safetensors", "model.safetensors.index.json", "pytorch_model.bin", "pytorch_model.bin.index.json")


def _nonempty(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def validate_bge_snapshot(snapshot: Path) -> None:
    """Reject missing heads, tokenizer, and incomplete/sharded weight sets."""
    missing = [name for name in _REQUIRED if not _nonempty(snapshot / name)]
    if not any(_nonempty(snapshot / name) for name in _TOKENIZERS):
        missing.append("tokenizer.json or sentencepiece.bpe.model")
    weights = next((name for name in _WEIGHTS if (snapshot / name).is_file()), None)
    if not weights or not _nonempty(snapshot / weights):
        missing.append("model weights")
    elif weights.endswith(".index.json"):
        try:
            shards = set(json.loads((snapshot / weights).read_text())["weight_map"].values())
            if not shards or any(not isinstance(name, str) or Path(name).name != name or not _nonempty(snapshot / name) for name in shards):
                missing.append("complete weight shards")
        except (OSError, ValueError, KeyError, TypeError):
            missing.append("valid weight index")
    if missing:
        raise ValueError("BGE-M3 cache is incomplete: " + ", ".join(missing))


def managed_bge_snapshot(model_id: str) -> str:
    """Reuse complete cache offline, otherwise fetch only inference artifacts."""
    report_preparation("cache")
    local = Path(model_id).expanduser()
    if local.is_dir():
        validate_bge_snapshot(local)
        return str(local)
    if local.is_absolute():
        raise ValueError("BGE-M3 local model directory does not exist")
    try:
        cached = Path(snapshot_download(repo_id=model_id, local_files_only=True))
        validate_bge_snapshot(cached)
        return str(cached)
    except (LocalEntryNotFoundError, ValueError):
        pass

    report_preparation("metadata")
    # list_repo_files has no request timeout. On an unreachable WSL network it
    # could sit in the OS connect timeout for two minutes without any progress.
    # Fail early on the metadata request before entering the SDK's retry loop.
    api = HfApi()
    info = api.model_info(repo_id=model_id, files_metadata=True, timeout=10)
    # Fetch one tiny file: the SDK records refs/main and resolves an exact
    # revision. Every remaining file then comes from that same revision.
    config = Path(hf_hub_download(repo_id=model_id, filename="config.json", etag_timeout=10))
    snapshot = config.parent
    revision = snapshot.name
    if info.sha != revision:
        # The branch may have moved between the two requests.
        info = api.model_info(repo_id=model_id, revision=revision, files_metadata=True, timeout=10)
    files = {row.rfilename for row in info.siblings or []}
    # Choose one supported format; never fetch ONNX or duplicate full weights.
    weights = next((name for name in _WEIGHTS if name in files), None)
    if not weights or not all(name in files for name in _REQUIRED) or not any(name in files for name in _TOKENIZERS):
        raise ValueError("BGE-M3 repository is missing required inference files or sparse heads")
    selected = {name for name in _METADATA if name in files}
    selected.add(weights)
    if weights.endswith(".index.json"):
        # Root weight shards only; the final index validation rejects omissions.
        prefix, suffix = ("model-", ".safetensors") if weights.startswith("model.") else ("pytorch_model-", ".bin")
        selected.update(name for name in files if "/" not in name and name.startswith(prefix) and name.endswith(suffix))
    rows = [row for row in info.siblings if row.rfilename in selected]
    _download_files(model_id, revision, snapshot, rows)
    report_preparation("verify")
    validate_bge_snapshot(snapshot)
    return str(snapshot)


def _download_status(snapshot: Path, rows: list) -> dict:
    """Observe only selected, immutable Hub blobs, including resumable bytes.

    This reads the pinned Hub 0.36 cache layout; it never writes/deletes cache
    internals. Missing size/hash metadata leaves the byte total unknown.
    """
    completed, downloaded, total, known = 0, 0, 0, True
    for row in rows:
        size = getattr(row, "size", None)
        lfs = getattr(row, "lfs", None)
        digest = getattr(lfs, "sha256", None) or getattr(row, "blob_id", None)
        ready = snapshot / row.rfilename
        complete = ready.is_file()
        completed += int(complete)
        if not isinstance(size, int) or size < 0 or not isinstance(digest, str) or not re.fullmatch(r"[a-fA-F0-9]{40,64}", digest):
            known = False
            continue
        total += size
        blob = snapshot.parent.parent / "blobs" / digest
        candidates = [ready, blob, blob.with_suffix(".incomplete")]
        sizes = []
        for path in candidates:
            try:
                sizes.append(path.stat().st_size)
            except OSError:
                pass
        downloaded += min(size, max(sizes, default=0))
    from huggingface_hub import constants
    # Xet can preallocate files: stat size would not measure transferred bytes.
    # Managed Compose uses resumable HTTP; keep other environments honest.
    known = known and constants.HF_HUB_DISABLE_XET
    return {"files_completed": completed, "files_total": len(rows),
            **({"downloaded_bytes": downloaded, "total_bytes": total} if known else {})}


def _download_files(model_id: str, revision: str, snapshot: Path, rows: list) -> None:
    stopped = Event()

    def publish():
        report_preparation("download", **_download_status(snapshot, rows))

    def monitor():
        while not stopped.wait(1):
            publish()

    publish()
    context = copy_context()
    thread = Thread(target=lambda: context.run(monitor), name="tessmora-download-progress", daemon=True)
    thread.start()
    try:
        def download(row):
            return hf_hub_download(repo_id=model_id, filename=row.rfilename, revision=revision, etag_timeout=10)

        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="tessmora-hub") as pool:
            # Hugging Face owns retries, partial blobs and Range resumption.
            list(pool.map(download, rows))
        publish()
    finally:
        stopped.set()
        thread.join()
