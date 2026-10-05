"""SQLite event ledger, independent of legacy chat storage and knowledge indexes.

Transactions couple state changes with events. Per-run sequences support SSE replay;
idempotency keys prevent reconnects/repeated POSTs from paying for another run.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Any

from .contracts import Evidence, RunEvent, TERMINAL_STATUSES


class RunNotFound(LookupError):
    pass


class RunConflict(ValueError):
    pass


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class RunStore:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS pi_runs (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL,
                    request_hash TEXT NOT NULL, session_id TEXT NOT NULL, status TEXT NOT NULL,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL, seq INTEGER NOT NULL DEFAULT 0,
                    request_json TEXT NOT NULL, config_json TEXT NOT NULL, state_json TEXT NOT NULL,
                    UNIQUE(owner, request_key)
                );
                CREATE INDEX IF NOT EXISTS pi_session_runs ON pi_runs(owner, session_id, created_at);
                CREATE TABLE IF NOT EXISTS pi_events (
                    run_id TEXT NOT NULL REFERENCES pi_runs(id) ON DELETE CASCADE,
                    seq INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(run_id, seq)
                );
                CREATE TABLE IF NOT EXISTS pi_evidence (
                    run_id TEXT NOT NULL REFERENCES pi_runs(id) ON DELETE CASCADE,
                    id INTEGER NOT NULL, fingerprint TEXT NOT NULL, evidence_json TEXT NOT NULL,
                    PRIMARY KEY(run_id, id), UNIQUE(run_id, fingerprint)
                );
                CREATE TABLE IF NOT EXISTS pi_artifacts (
                    run_id TEXT NOT NULL REFERENCES pi_runs(id) ON DELETE CASCADE,
                    id TEXT NOT NULL, artifact_json TEXT NOT NULL, PRIMARY KEY(run_id, id)
                );
            """)
        self.path.chmod(0o600)

    @contextmanager
    def _connection(self, *, write=False):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
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

    @staticmethod
    def _decode(row):
        result = dict(row)
        for key in ("request", "config", "state"):
            result[key] = json.loads(result.pop(f"{key}_json"))
        result.pop("owner", None)
        result.pop("request_hash", None)
        result.pop("request_key", None)
        return result

    @staticmethod
    def _row(db, run_id: str, owner: str | None = None):
        row = db.execute("SELECT * FROM pi_runs WHERE id=?", (run_id,)).fetchone()
        if row is None or (owner is not None and row["owner"] != owner):
            # Do not disclose existence to another owner.
            raise RunNotFound(run_id)
        return row

    def create(self, *, owner: str, request: dict, config: dict) -> tuple[dict, bool]:
        digest = fingerprint(request)
        with self._connection(write=True) as db:
            old = db.execute("SELECT * FROM pi_runs WHERE owner=? AND request_key=?",
                             (owner, request["client_request_id"])).fetchone()
            if old:
                if old["request_hash"] != digest:
                    raise RunConflict("同一个请求标识不能用于不同的问题或范围")
                return self._decode(old), False
            run_id, now = str(uuid.uuid4()), time.time()
            db.execute("""INSERT INTO pi_runs
                (id,owner,request_key,request_hash,session_id,status,created_at,updated_at,
                 request_json,config_json,state_json) VALUES (?,?,?,?,?,'queued',?,?,?,?,?)""",
                       (run_id, owner, request["client_request_id"], digest, request["session_id"],
                        now, now, canonical(request), canonical(config), "{}"))
            self._append(db, run_id, "run.queued", {"status": "queued", "engine": "pi"})
            return self._decode(self._row(db, run_id)), True

    def get(self, run_id: str, *, owner: str | None = None) -> dict:
        with self._connection() as db:
            return self._decode(self._row(db, run_id, owner))

    def find_request(self, owner: str, key: str):
        with self._connection() as db:
            row = db.execute("SELECT * FROM pi_runs WHERE owner=? AND request_key=?", (owner, key)).fetchone()
            return self._decode(row) if row else None

    def finish_preparation(self, run_id: str, *, scope: dict, sources: list[dict], duration_ms: int):
        """Publish validated scope and its immutable private source map together."""
        with self._connection(write=True) as db:
            row = self._row(db, run_id)
            config = json.loads(row["config_json"])
            if row["status"] != "running" or config.get("scope_ready") is not False:
                raise RunConflict("来源准备已结束或任务不再运行")
            config.update(scope=scope, scope_ready=True)
            db.execute("INSERT INTO pi_artifacts VALUES (?,?,?)", (run_id, "_sources", canonical(sources)))
            db.execute("UPDATE pi_runs SET config_json=? WHERE id=?", (canonical(config), run_id))
            return self._append(db, run_id, "sources.completed", {
                "message": f"来源范围已确认，可读取 {len(sources)} 项资料。", "scope": scope,
                "source_count": len(sources), "duration_ms": duration_ms}, span_id="sources")

    def list_runs(self, owner: str, session_id: str, *, limit: int = 100) -> list[dict]:
        with self._connection() as db:
            rows = db.execute("SELECT * FROM pi_runs WHERE owner=? AND session_id=? ORDER BY created_at DESC LIMIT ?",
                              (owner, session_id, min(max(limit, 1), 100))).fetchall()
            return [self._decode(row) for row in rows]

    def _append(self, db, run_id, event_type, data, span_id=None, parent_span_id=None):
        row = self._row(db, run_id)
        seq, now = row["seq"] + 1, time.time()
        event = RunEvent(run_id=run_id, event_id=f"{run_id}:{seq}", seq=seq,
                         type=event_type, timestamp=now, span_id=span_id,
                         parent_span_id=parent_span_id, data=data).model_dump()
        db.execute("INSERT INTO pi_events VALUES (?,?,?)", (run_id, seq, canonical(event)))
        db.execute("UPDATE pi_runs SET seq=?,updated_at=? WHERE id=?", (seq, now, run_id))
        return event

    def append(self, run_id, event_type, data, *, span_id=None, parent_span_id=None):
        with self._connection(write=True) as db:
            if self._row(db, run_id)["status"] in TERMINAL_STATUSES:
                raise RunConflict("任务已经结束")
            return self._append(db, run_id, event_type, data, span_id, parent_span_id)

    def transition(self, run_id: str, status: str, *, state: dict | None = None,
                   data: dict | None = None, owner: str | None = None):
        allowed = {
            "queued": {"running", "cancelling", "cancelled", "failed"},
            "running": {"cancelling", "completed", "partial", "needs_input", "cancelled", "failed"},
            "cancelling": {"cancelled", "failed"},
        }
        with self._connection(write=True) as db:
            row = self._row(db, run_id, owner)
            if status not in allowed.get(row["status"], set()):
                raise RunConflict(f"无效的任务状态转换：{row['status']} → {status}")
            current = json.loads(row["state_json"])
            current.update(state or {})
            db.execute("UPDATE pi_runs SET status=?,state_json=? WHERE id=?", (status, canonical(current), run_id))
            return self._append(db, run_id, f"run.{status}", {**(data or {}), "status": status})

    def events(self, run_id: str, *, after: int = 0, owner: str | None = None, limit: int = 200):
        with self._connection() as db:
            self._row(db, run_id, owner)
            rows = db.execute("SELECT event_json FROM pi_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?",
                              (run_id, max(after, 0), min(max(limit, 1), 1000))).fetchall()
            return [json.loads(row[0]) for row in rows]

    def add_evidence(self, run_id: str, evidence: Evidence) -> Evidence:
        value = evidence.model_dump(exclude={"id"})
        # Acquisition metadata can change; identity binds the actual returned observation.
        digest = fingerprint({key: value[key] for key in ("source", "source_id", "version", "locator", "content", "observation")})
        with self._connection(write=True) as db:
            if self._row(db, run_id)["status"] in TERMINAL_STATUSES:
                raise RunConflict("不能改写已完成任务的证据")
            previous = db.execute("SELECT evidence_json FROM pi_evidence WHERE run_id=? AND fingerprint=?",
                                  (run_id, digest)).fetchone()
            if previous:
                return Evidence.model_validate_json(previous[0])
            number = db.execute("SELECT COALESCE(MAX(id),0)+1 FROM pi_evidence WHERE run_id=?", (run_id,)).fetchone()[0]
            stored = evidence.model_copy(update={"id": number})
            db.execute("INSERT INTO pi_evidence VALUES (?,?,?,?)", (run_id, number, digest, stored.model_dump_json()))
            self._append(db, run_id, "evidence.added", {"id": number, "file_name": stored.file_name,
                         "modality": stored.modality, "observation": stored.observation, "locator": stored.locator})
            return stored

    def evidence(self, run_id: str, *, owner: str | None = None) -> list[Evidence]:
        with self._connection() as db:
            self._row(db, run_id, owner)
            return [Evidence.model_validate_json(row[0]) for row in db.execute(
                "SELECT evidence_json FROM pi_evidence WHERE run_id=? ORDER BY id", (run_id,))]

    def put_artifact(self, run_id, artifact_id, value):
        with self._connection(write=True) as db:
            if self._row(db, run_id)["status"] in TERMINAL_STATUSES:
                raise RunConflict("任务已经结束")
            # Immutable: retrying the same ID with different content is an error.
            serialized = canonical(value)
            old = db.execute("SELECT artifact_json FROM pi_artifacts WHERE run_id=? AND id=?", (run_id, artifact_id)).fetchone()
            if old and old[0] != serialized:
                raise RunConflict("不能覆盖已记录的工具结果")
            db.execute("INSERT OR IGNORE INTO pi_artifacts VALUES (?,?,?)", (run_id, artifact_id, serialized))

    def artifact(self, run_id, artifact_id, *, owner=None):
        with self._connection() as db:
            self._row(db, run_id, owner)
            row = db.execute("SELECT artifact_json FROM pi_artifacts WHERE run_id=? AND id=?", (run_id, artifact_id)).fetchone()
            if not row:
                raise RunNotFound(artifact_id)
            return json.loads(row[0])

    def recover_interrupted(self) -> int:
        """Only call while holding the host's exclusive supervisor lock."""
        with self._connection(write=True) as db:
            rows = db.execute("SELECT id,status FROM pi_runs WHERE status IN ('queued','running','cancelling')").fetchall()
            for row in rows:
                status = "cancelled" if row["status"] == "cancelling" else "failed"
                detail = {"code": "host_restarted", "message": "服务重启，原任务已中断；已完成的行动和证据仍可查看。"}
                db.execute("UPDATE pi_runs SET status=?,state_json=? WHERE id=?", (status, canonical(detail), row["id"]))
                self._append(db, row["id"], f"run.{status}", {"status": status, **detail})
            return len(rows)
