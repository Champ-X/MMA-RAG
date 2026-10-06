"""Private immutable turn attachments; never ingest or vectorize chat uploads."""
from __future__ import annotations

import hashlib
from pathlib import Path

from .catalog import Source, source_id
from .policy import ToolError


def upload_path(owner, digest, settings):
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ToolError("invalid_attachment", "附件版本标识无效")
    return settings.data_dir / "uploads" / hashlib.sha256(owner.encode()).hexdigest()[:32] / digest


def save_attachment(raw, *, owner, identity, name, kind, settings):
    digest = hashlib.sha256(raw).hexdigest()
    path = upload_path(owner, digest, settings)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Exact bytes may be reused across retries; the identity remains turn-specific.
    try:
        with path.open("xb") as target:
            target.write(raw)
        path.chmod(0o600)
    except FileExistsError:
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ToolError("attachment_corrupt", "已保存的附件与其版本标识不一致") from None
    return {"id": identity, "name": Path(name).name[:1000], "modality": kind,
            "sha256": digest, "size": len(raw)}


def attachment_source(item, owner, settings):
    if not isinstance(item, dict) or set(item) != {"id", "name", "modality", "sha256", "size"}:
        raise ToolError("invalid_attachment", "附件描述无效，请重新上传")
    if item["modality"] not in {"image", "audio", "video"} or not isinstance(item["id"], str) or not 1 <= len(item["id"]) <= 128:
        raise ToolError("invalid_attachment", "附件类型或标识无效")
    path = upload_path(owner, item["sha256"], settings)
    if not path.is_file() or path.stat().st_size != item["size"]:
        raise ToolError("attachment_unavailable", "附件不可用，请重新上传")
    return Source(source_id("attachment", item["id"]), "", item["id"], str(item["name"]), item["modality"],
                  item["sha256"], item["size"], attachment_id=item["id"], local_path=str(path))
