"""Read-only source identities, derived from original objects rather than model paths.

Some restored indexes use a different KB UUID from the bucket. Bind a point to a
globally unique original file ID in the bucket catalog and reject ambiguities;
never guess a KB from a filename or take the most common index UUID.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import string
import time

from .policy import AccessScope, ToolError

ORIGINAL = re.compile(r"^(documents|images|audios|videos)/([0-9a-fA-F-]{36})_([^/]+)$")
KINDS = {"documents": "doc", "images": "image", "audios": "audio", "videos": "video"}


@dataclass(frozen=True)
class Source:
    id: str
    kb_id: str
    file_id: str
    name: str
    modality: str
    version: str
    size: int
    bucket: str = ""
    object_path: str = ""
    attachment_id: str = ""
    local_path: str = ""

    @property
    def attachment(self):
        return bool(self.attachment_id)

    def public(self, scope: AccessScope):
        return {"source_id": self.id, "kb_id": self.kb_id, "file_id": self.file_id,
                "file_name": self.name, "modality": self.modality, "version": self.version,
                "size_bytes": self.size, "source": "attachment" if self.attachment else "knowledge",
                "input_material": self.attachment or (self.kb_id, self.file_id) in scope.references,
                "searchable": not self.attachment and scope.can_search(self.kb_id, self.file_id)}


def source_id(kb_id: str, file_id: str) -> str:
    return "src_" + hashlib.sha256(f"{kb_id}\0{file_id}".encode()).hexdigest()[:24]


def index_kb_matches(index_id: str, source: Source) -> bool:
    if index_id in {source.kb_id, source.bucket, source.bucket.replace("-", "_")}:
        return True
    # Historical bucket sanitization used the literal characters "0-9" instead
    # of all ten digits. Reproduce that exact, deterministic transformation only;
    # a guessed/majority alias would allow a different KB to leak into this one.
    legacy = "".join(c for c in index_id.lower().replace("_", "-") if c in string.ascii_lowercase + "0-9-").strip("-")
    return bool(legacy) and legacy == source.kb_id


class SourceCatalog:
    def __init__(self, sources: list[Source], knowledge_bases: dict[str, str]):
        self.sources = {s.id: s for s in sources}
        self.knowledge_bases = knowledge_bases
        self.by_pair = {(s.kb_id, s.file_id): s for s in sources if not s.attachment}
        self.by_file: dict[str, list[Source]] = {}
        for source in sources:
            if not source.attachment:
                self.by_file.setdefault(source.file_id, []).append(source)

    @classmethod
    def load(cls, client, *, checkpoint=lambda: None):
        sources, bases = [], {}
        def checked(items):
            iterator = iter(items)
            while True:
                # MinIO pagination performs I/O inside next(), so check before
                # advancing, including the first page and every later page.
                checkpoint()
                try:
                    item = next(iterator)
                except StopIteration:
                    return
                yield item
        # Catalog the file identities in every bucket, including inaccessible KBs,
        # so a duplicate file ID can never be mistaken for an accessible source.
        # Only identities in the host's AccessScope are exposed to the Agent.
        checkpoint()
        for bucket in checked(client.list_buckets()):
            if not bucket.name.startswith("kb-") or bucket.name == "kb-default":
                continue
            kb_id = bucket.name[3:]
            bases[kb_id] = kb_id
            for obj in checked(client.list_objects(bucket.name, recursive=True)):
                if obj.object_name == ".kb_meta.json":
                    checkpoint()
                    response = client.get_object(bucket.name, obj.object_name)
                    try:
                        if obj.size <= 65536:
                            bases[kb_id] = str(json.loads(response.read(65537)).get("name") or kb_id)[:300]
                    except (ValueError, TypeError):
                        pass  # Display metadata cannot grant access.
                    finally:
                        response.close()
                        response.release_conn()
                match = ORIGINAL.fullmatch(obj.object_name)
                if not match:
                    continue
                prefix, fid, name = match.groups()
                sources.append(Source(source_id(kb_id, fid), kb_id, fid, name, KINDS[prefix],
                                      obj.etag or "", obj.size, bucket.name, obj.object_name))
                if len(sources) > 20000:
                    raise ToolError("catalog_limit", "来源目录超过本实例预算，请缩小本实例的数据集合")
        return cls(sources, bases)

    def get(self, identity: str, scope: AccessScope, *, search=False) -> Source:
        source = self.sources.get(identity)
        if not source:
            raise ToolError("source_unavailable", "来源不存在或不在本轮范围内")
        if source.attachment:
            if search:
                raise ToolError("scope_denied", "输入附件不能作为知识库搜索结果")
            return source
        allowed = scope.can_search if search else scope.can_read
        if not allowed(source.kb_id, source.file_id):
            raise ToolError("scope_denied", "来源不在本轮允许范围内")
        return source

    def visible(self, scope: AccessScope, *, search=False):
        for source in self.sources.values():
            try:
                yield self.get(source.id, scope, search=search)
            except ToolError:
                continue

    def bind_point(self, payload: dict, scope: AccessScope, *, search=False) -> Source | None:
        # Parent IDs support images extracted from a selected document. A point's
        # file and parent must resolve to the same KB if both are originals.
        candidates = []
        for fid in (payload.get("file_id"), payload.get("source_file_id")):
            matches = self.by_file.get(fid, [])
            if len(matches) > 1:
                return None
            if matches:
                candidates.append(matches[0])
        if not candidates or len({s.kb_id for s in candidates}) > 1:
            return None
        for source in candidates:
            # Explicit storage bucket metadata must agree with the catalog.
            metadata = payload.get("metadata") or {}
            bucket = payload.get("bucket") or (metadata.get("bucket") if isinstance(metadata, dict) else None)
            if bucket and bucket != source.bucket:
                return None
            if not index_kb_matches(str(payload.get("kb_id") or ""), source):
                continue
            try:
                return self.get(source.id, scope, search=search)
            except ToolError:
                continue
        return None

    def parent_document(self, payload: dict, scope: AccessScope) -> Source | None:
        """Navigate an indexed image's explicit relationship, without granting access.

        A filename is never a relationship. The point must pass the same bucket,
        KB and unambiguous-file checks used to deliver evidence, and the document
        must be independently readable in the original run scope.
        """
        parent_id = payload.get("source_file_id")
        if not isinstance(parent_id, str) or not parent_id or parent_id == payload.get("file_id"):
            return None
        parents = self.by_file.get(parent_id, [])
        if len(parents) != 1 or parents[0].modality != "doc":
            return None
        bound = self.bind_point(payload, scope)
        if bound is None or bound.kb_id != parents[0].kb_id:
            return None
        try:
            return self.get(parents[0].id, scope)
        except ToolError:
            return None

    def download(self, client, source: Source, destination: Path, *, max_bytes: int):
        if source.size > max_bytes:
            raise ToolError("source_too_large", "原文件超过本次读取预算，请读取索引片段或缩小媒体范围")
        if source.attachment:
            raw = Path(source.local_path).read_bytes()
            if len(raw) > max_bytes or hashlib.sha256(raw).hexdigest() != source.version:
                raise ToolError("source_changed", "附件已变化，请重新上传")
            destination.write_bytes(raw)
            return
        current = client.stat_object(source.bucket, source.object_path)
        if current.etag != source.version or current.size != source.size:
            raise ToolError("source_changed", "原文件已更新，请重新开始任务以使用新版本")
        response = client.get_object(source.bucket, source.object_path,
                                     request_headers={"If-Match": source.version})
        size, started = 0, time.monotonic()
        try:
            with destination.open("wb") as target:
                for block in response.stream(256 * 1024):
                    if time.monotonic() - started > 90:
                        raise ToolError("source_read_timeout", "原文件读取超过时间预算")
                    size += len(block)
                    if size > max_bytes:
                        raise ToolError("source_too_large", "原文件超过本次读取预算")
                    target.write(block)
        finally:
            response.close()
            response.release_conn()
        if size != source.size:
            raise ToolError("source_changed", "原文件读取不完整")
