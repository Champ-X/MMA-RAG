"""Transactional run state, item identity and payload checkpoints."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .models import ACTIVE_STATUSES


class CollectionNotFound(LookupError):
    pass


class CollectionConflict(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical_url(url: str) -> str:
    parts = urlsplit(url.strip())
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
        raise ValueError("只支持有效的 HTTP/HTTPS 链接")
    host = parts.hostname.lower().encode("idna").decode("ascii")
    if ":" in host:
        host = f"[{host}]"
    port = parts.port
    if port and not (parts.scheme.lower() == "https" and port == 443 or parts.scheme.lower() == "http" and port == 80):
        host += f":{port}"
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}]
    return urlunsplit((parts.scheme.lower(), host, parts.path or "/", urlencode(sorted(query)), ""))


class CollectionStore:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.payload_dir = self.path.parent / "payloads"
        self.payload_dir.mkdir(exist_ok=True)
        with self.connection(write=False) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS collection_runs (
                    id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
                    request_hash TEXT NOT NULL, kb_id TEXT NOT NULL,
                    state_json TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS collection_kb_runs ON collection_runs(kb_id, updated_at);
                CREATE TABLE IF NOT EXISTS collection_claims (
                    kb_id TEXT NOT NULL, kind TEXT NOT NULL, identity TEXT NOT NULL,
                    run_id TEXT NOT NULL, item_id TEXT NOT NULL,
                    PRIMARY KEY(kb_id,kind,identity));
            """)
        self.path.chmod(0o600)

    @contextmanager
    def connection(self, *, write=True):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def _get(self, db, run_id):
        row = db.execute("SELECT state_json FROM collection_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise CollectionNotFound("采集任务不存在")
        return json.loads(row[0])

    def _save(self, db, run):
        run["updated_at"] = now()
        db.execute("UPDATE collection_runs SET state_json=?,updated_at=? WHERE id=?",
                   (json.dumps(run, ensure_ascii=False), run["updated_at"], run["id"]))
        return run

    def create(self, request: dict):
        digest = hashlib.sha256(json.dumps(request, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with self.connection() as db:
            existing = db.execute("SELECT id,request_hash FROM collection_runs WHERE request_key=?", (request["client_request_id"],)).fetchone()
            if existing:
                if existing["request_hash"] != digest:
                    raise CollectionConflict("同一请求标识不能用于不同需求或素材空间")
                return self._get(db, existing["id"]), False
            run = {**request, "id": str(uuid.uuid4()), "status": "planning", "plan": {}, "candidates": [],
                   "message": "正在理解素材需求", "warnings": [], "created_at": now(), "updated_at": now(),
                   "_search_calls": 0, "_bytes": 0, "_phase": "discovery"}
            db.execute("INSERT INTO collection_runs VALUES (?,?,?,?,?,?)", (
                run["id"], request["client_request_id"], digest, request["kb_id"], json.dumps(run, ensure_ascii=False), run["updated_at"]))
            return run, True

    def get(self, run_id):
        with self.connection() as db:
            return self._get(db, run_id)

    def list(self, kb_id, limit=30):
        with self.connection() as db:
            return [json.loads(row[0]) for row in db.execute(
                "SELECT state_json FROM collection_runs WHERE kb_id=? ORDER BY updated_at DESC LIMIT ?", (kb_id, min(limit, 100)))]

    def update(self, run_id, **values):
        with self.connection() as db:
            run = self._get(db, run_id)
            run.update(values)
            return self._save(db, run)

    def item(self, run_id, item_id, **values):
        with self.connection() as db:
            run = self._get(db, run_id)
            item = next((i for i in run["candidates"] if i["id"] == item_id), None)
            if not item:
                raise CollectionNotFound("候选素材不属于此任务")
            item.update(values)
            self._save(db, run)
            return item

    def account_download(self, run_id, item_id, byte_count):
        """Commit consumed transport bytes, including interrupted attempts."""
        if not isinstance(byte_count, int) or isinstance(byte_count, bool) or byte_count < 0:
            raise ValueError("下载字节数无效")
        with self.connection() as db:
            run = self._get(db, run_id)
            run["_bytes"] = run.get("_bytes", 0) + byte_count
            if item_id is None:
                run["_discovery_bytes"] = run.get("_discovery_bytes", 0) + byte_count
            else:
                item = next((i for i in run["candidates"] if i["id"] == item_id), None)
                if not item:
                    raise CollectionNotFound("候选素材不属于此任务")
                item["_download_bytes"] = item.get("_download_bytes", 0) + byte_count
            self._save(db, run)
            return run["_bytes"]

    def claim(self, kb_id, kind, identity, run_id, item_id):
        """Return the previous owning item; never move an in-flight write's claim."""
        with self.connection() as db:
            row = db.execute("SELECT run_id,item_id FROM collection_claims WHERE kb_id=? AND kind=? AND identity=?",
                             (kb_id, kind, identity)).fetchone()
            if row and (row["run_id"], row["item_id"]) != (run_id, item_id):
                other_run = self._get(db, row["run_id"])
                other = next(i for i in other_run["candidates"] if i["id"] == row["item_id"])
                if other["status"] not in {"failed", "skipped"} or other.get("_ingest_started"):
                    return other
            db.execute("INSERT OR REPLACE INTO collection_claims VALUES (?,?,?,?,?)", (kb_id, kind, identity, run_id, item_id))
            return None

    def save_payload(self, item_id, content):
        path = self.payload_dir / f"{item_id}.bin"
        temporary = path.with_suffix(".tmp")
        with temporary.open("wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o600)
        temporary.replace(path)
        return str(path)

    def release_claim(self, kb_id, kind, identity, item_id):
        with self.connection() as db:
            db.execute("DELETE FROM collection_claims WHERE kb_id=? AND kind=? AND identity=? AND item_id=?",
                       (kb_id, kind, identity, item_id))

    def recover(self):
        with self.connection() as db:
            rows = db.execute("SELECT state_json FROM collection_runs").fetchall()
            count = 0
            for row in rows:
                run = json.loads(row[0])
                if run["status"] in ACTIVE_STATUSES:
                    run.update(status="interrupted", message="服务已重启；可继续采集，已入库素材会先核验并复用。")
                    self._save(db, run)
                    count += 1
            return count
