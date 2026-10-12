"""Complete, bounded BGE-M3 snapshots for managed installations.

FlagEmbedding downloads an entire repository for remote IDs and silently
initializes random sparse/ColBERT heads when either head is missing. Pass it
only a complete local snapshot; successful inference remains the final check.
"""
from __future__ import annotations

import json
from pathlib import Path

from huggingface_hub import list_repo_files, snapshot_download
from huggingface_hub.errors import LocalEntryNotFoundError


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

    # Choose one supported format; never fetch ONNX or duplicate full weights.
    files = set(list_repo_files(repo_id=model_id))
    weights = next((name for name in _WEIGHTS if name in files), None)
    if not weights or not all(name in files for name in _REQUIRED) or not any(name in files for name in _TOKENIZERS):
        raise ValueError("BGE-M3 repository is missing required inference files or sparse heads")
    selected = {name for name in _METADATA if name in files}
    selected.add(weights)
    if weights.endswith(".index.json"):
        # Root weight shards only; the final index validation rejects omissions.
        prefix, suffix = ("model-", ".safetensors") if weights.startswith("model.") else ("pytorch_model-", ".bin")
        selected.update(name for name in files if "/" not in name and name.startswith(prefix) and name.endswith(suffix))
    snapshot = Path(snapshot_download(repo_id=model_id, allow_patterns=sorted(selected)))
    validate_bge_snapshot(snapshot)
    return str(snapshot)
