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
from contextvars import ContextVar
from typing import Any

from .contracts import Evidence, RunEvent, TERMINAL_STATUSES
from app.core.prompt_language import normalize_language


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
        self._transaction = ContextVar(f"pi_transaction_{id(self)}", default=None)
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
                CREATE TABLE IF NOT EXISTS pi_closed_sessions (
                    owner TEXT NOT NULL, session_id TEXT NOT NULL, closed_at REAL NOT NULL,
                    PRIMARY KEY(owner, session_id)
                );
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
                CREATE TABLE IF NOT EXISTS pi_operations (
                    run_id TEXT NOT NULL REFERENCES pi_runs(id) ON DELETE CASCADE,
                    call_id TEXT NOT NULL, request_hash TEXT NOT NULL, name TEXT NOT NULL,
                    result_json TEXT, PRIMARY KEY(run_id, call_id)
                );
                CREATE TABLE IF NOT EXISTS pi_inputs (
                    run_id TEXT NOT NULL REFERENCES pi_runs(id) ON DELETE CASCADE,
                    request_id TEXT NOT NULL, message TEXT NOT NULL, mode TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued', created_at REAL NOT NULL,
                    PRIMARY KEY(run_id, request_id)
                );
                CREATE TABLE IF NOT EXISTS pi_model_attempts (
                    run_id TEXT NOT NULL REFERENCES pi_runs(id) ON DELETE CASCADE,
                    turn INTEGER NOT NULL, usage_json TEXT, PRIMARY KEY(run_id, turn)
                );
            """)
        self.path.chmod(0o600)

    @contextmanager
    def _connection(self, *, write=False):
        current = self._transaction.get()
        if current is not None:
            yield current
            return
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

    @contextmanager
    def atomic(self):
        """Group synchronous ledger writes; callers must never await inside."""
        with self._connection(write=True) as db:
            token = self._transaction.set(db)
            try:
                yield
            finally:
                self._transaction.reset(token)

    @staticmethod
    def _decode(row):
        result = dict(row)
        for key in ("request", "config", "state"):
            result[key] = json.loads(result.pop(f"{key}_json"))
        result["request"].setdefault("language", "zh-CN")
        result["config"].setdefault("language", result["request"]["language"])
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
        request = {**request, "language": normalize_language(request.get("language"))}
        config = {**config, "language": request["language"]}
        digest = fingerprint(request)
        with self._connection(write=True) as db:
            if db.execute("SELECT 1 FROM pi_closed_sessions WHERE owner=? AND session_id=?",
                          (owner, request["session_id"])).fetchone():
                raise RunConflict("此会话已删除，不能继续创建任务。请在新会话中重试。")
            old = db.execute("SELECT * FROM pi_runs WHERE owner=? AND request_key=?",
                             (owner, request["client_request_id"])).fetchone()
            if old:
                previous = json.loads(old["request_json"])
                previous.setdefault("language", "zh-CN")
                if old["request_hash"] != digest and fingerprint(previous) != digest:
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

    def list_runs(self, owner: str, session_id: str) -> list[dict]:
        with self._connection() as db:
            rows = db.execute("SELECT * FROM pi_runs WHERE owner=? AND session_id=? ORDER BY created_at DESC",
                              (owner, session_id)).fetchall()
            return [self._decode(row) for row in rows]

    def close_session(self, owner: str, session_id: str):
        # Keep billing/evidence records, but reject even delayed create retries.
        with self._connection(write=True) as db:
            db.execute("INSERT OR IGNORE INTO pi_closed_sessions VALUES (?,?,?)",
                       (owner, session_id, time.time()))

    def record_answer_requirements(self, run_id: str, requirements: dict, *, parent_span_id=None):
        """Register once, atomically with the event used by live UI and replay."""
        with self._connection(write=True) as db:
            row = self._row(db, run_id)
            if row["status"] != "running":
                raise RunConflict("任务不再运行，不能登记回答要求")
            state = json.loads(row["state_json"])
            if "answer_requirements" in state:
                if state["answer_requirements"] != requirements:
                    raise RunConflict("回答要求已登记，不能在本轮改写")
                return state["answer_requirements"]
            state["answer_requirements"] = requirements
            db.execute("UPDATE pi_runs SET state_json=? WHERE id=?", (canonical(state), run_id))
            self._append(db, run_id, "answer.requirements", requirements, span_id="requirements",
                         parent_span_id=parent_span_id)
            return json.loads(canonical(requirements))

    def record_answer_plan(self, run_id: str, plan: dict, *, parent_span_id=None):
        """Commit a validated Agent selection and its replay event together."""
        with self._connection(write=True) as db:
            row = self._row(db, run_id)
            if row["status"] != "running":
                raise RunConflict("任务不再运行，不能更新回答要点")
            state = json.loads(row["state_json"])
            state["answer_plan"] = plan
            db.execute("UPDATE pi_runs SET state_json=? WHERE id=?", (canonical(state), run_id))
            self._append(db, run_id, "answer.plan", plan, span_id="answer-plan", parent_span_id=parent_span_id)
            return json.loads(canonical(plan))

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
            "running": {"queued", "cancelling", "completed", "partial", "needs_input", "cancelled", "failed"},
            "cancelling": {"cancelled", "failed"},
            "needs_input": {"cancelled"},
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

    def next_evidence_id(self, run_id: str) -> int:
        with self._connection() as db:
            self._row(db, run_id)
            return db.execute("SELECT COALESCE(MAX(id),0)+1 FROM pi_evidence WHERE run_id=?", (run_id,)).fetchone()[0]

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

    def begin_operation(self, run_id, call_id, name, args):
        """Return a prior receipt, or mark intent before any external I/O."""
        digest = fingerprint({"name": name, "args": args})
        with self._connection(write=True) as db:
            if self._row(db, run_id)["status"] != "running":
                raise RunConflict("任务不再运行")
            old = db.execute("SELECT * FROM pi_operations WHERE run_id=? AND call_id=?", (run_id, call_id)).fetchone()
            if old:
                if old["request_hash"] != digest:
                    raise RunConflict("工具调用标识不能用于不同的参数")
                return {"replayed": True, "result": json.loads(old["result_json"]) if old["result_json"] else None}
            db.execute("INSERT INTO pi_operations VALUES (?,?,?,?,NULL)", (run_id, call_id, digest, name))
            return {"replayed": False, "result": None}

    def complete_operation(self, run_id, call_id, result):
        with self._connection(write=True) as db:
            row = self._row(db, run_id)
            if row["status"] != "running":
                raise RunConflict("任务不再运行")
            serialized = canonical(result)
            old = db.execute("SELECT result_json FROM pi_operations WHERE run_id=? AND call_id=?", (run_id, call_id)).fetchone()
            if old is None or old[0] is not None and old[0] != serialized:
                raise RunConflict("工具执行收据不存在或已完成")
            db.execute("UPDATE pi_operations SET result_json=? WHERE run_id=? AND call_id=?", (serialized, run_id, call_id))
            state = json.loads(row["state_json"])
            state["recovery_failures"] = 0
            if result.get("details", {}).get("terminal") and not result.get("isError"):
                state["accepted_result"] = result["details"]
            db.execute("UPDATE pi_runs SET state_json=? WHERE id=?", (canonical(state), run_id))

    def operation_results(self, run_id):
        with self._connection() as db:
            self._row(db, run_id)
            return [json.loads(row[0]) for row in db.execute(
                "SELECT result_json FROM pi_operations WHERE run_id=? AND result_json IS NOT NULL ORDER BY rowid", (run_id,))]

    def add_input(self, run_id, owner, request_id, message, mode):
        with self._connection(write=True) as db:
            row = self._row(db, run_id, owner)
            if db.execute("SELECT 1 FROM pi_closed_sessions WHERE owner=? AND session_id=?", (owner, row["session_id"])).fetchone():
                raise RunConflict("此会话已删除")
            old = db.execute("SELECT * FROM pi_inputs WHERE run_id=? AND request_id=?", (run_id, request_id)).fetchone()
            if old:
                if old["message"] != message or old["mode"] != mode:
                    raise RunConflict("同一个请求标识不能用于不同的补充")
                return dict(old), False
            if json.loads(row["config_json"]).get("runtime") != "durable":
                raise RunConflict("此任务使用旧运行时，请在新任务中继续")
            if mode != "reply" and json.loads(row["state_json"]).get("accepted_result"):
                raise RunConflict("当前结果已提交，请在下一轮继续")
            if mode == "reply" and row["status"] != "needs_input" or mode != "reply" and row["status"] not in {"queued", "running"}:
                raise RunConflict("任务状态已变化，请刷新后继续")
            now = time.time()
            db.execute("INSERT INTO pi_inputs VALUES (?,?,?,?,?,?)", (run_id, request_id, message, mode, "queued", now))
            if mode == "reply":
                state = json.loads(row["state_json"])
                for key in ("answer", "question", "options", "terminal", "outcome", "citations", "limitations", "answer_requirements", "answer_checks", "code", "message", "accepted_result"):
                    state.pop(key, None)
                state["submission_id"] = request_id
                db.execute("UPDATE pi_runs SET status='queued',state_json=? WHERE id=?", (canonical(state), run_id))
                self._append(db, run_id, "run.queued", {"status": "queued", "reason": "user_reply"})
            self._append(db, run_id, "input.queued", {"request_id": request_id, "message": message, "mode": mode})
            self._publish_inputs(db, run_id)
            return {"run_id": run_id, "request_id": request_id, "message": message, "mode": mode, "status": "queued", "created_at": now}, True

    def inputs(self, run_id, *, pending=False):
        with self._connection() as db:
            self._row(db, run_id)
            return [dict(row) for row in db.execute("SELECT * FROM pi_inputs WHERE run_id=?" +
                (" AND status='queued'" if pending else "") + " ORDER BY created_at,rowid", (run_id,))]

    def acknowledge_input(self, run_id, request_id, status="accepted"):
        with self._connection(write=True) as db:
            if self._row(db, run_id)["status"] != "running":
                raise RunConflict("任务不再运行")
            row = db.execute("SELECT * FROM pi_inputs WHERE run_id=? AND request_id=?", (run_id, request_id)).fetchone()
            if row is None or row["status"] in {"applied", "rejected"} or row["status"] == status:
                return
            db.execute("UPDATE pi_inputs SET status=? WHERE run_id=? AND request_id=?", (status, run_id, request_id))
            self._append(db, run_id, f"input.{status}", {"request_id": request_id, "message": row["message"], "mode": row["mode"]})
            self._publish_inputs(db, run_id)

    def _publish_inputs(self, db, run_id):
        state = json.loads(self._row(db, run_id)["state_json"])
        state["inputs"] = [dict(item) for item in db.execute(
            "SELECT request_id,message,mode,status,created_at FROM pi_inputs WHERE run_id=? ORDER BY created_at,rowid", (run_id,))]
        db.execute("UPDATE pi_runs SET state_json=? WHERE id=?", (canonical(state), run_id))

    def effective_request(self, run_id):
        request = self.get(run_id)["request"]
        inputs = [item for item in self.inputs(run_id) if item["status"] == "applied"]
        if inputs:
            request = {**request, "message": "\n\n".join([request["message"], *(item["message"] for item in inputs)])}
        return request

    def model_attempt(self, run_id, turn, usage=None, *, started=False):
        with self._connection(write=True) as db:
            self._row(db, run_id)
            if started:
                try:
                    db.execute("INSERT INTO pi_model_attempts VALUES (?,?,NULL)", (run_id, turn))
                except sqlite3.IntegrityError:
                    raise RunConflict("重复的模型请求标识") from None
            else:
                db.execute("UPDATE pi_model_attempts SET usage_json=? WHERE run_id=? AND turn=? AND usage_json IS NULL",
                           (canonical(usage or {}), run_id, turn))

    def model_attempts(self, run_id):
        with self._connection() as db:
            return [{"turn": row[0], "usage": json.loads(row[1]) if row[1] is not None else None}
                    for row in db.execute("SELECT turn,usage_json FROM pi_model_attempts WHERE run_id=?", (run_id,))]

    def save_usage(self, run_id, usage):
        with self._connection(write=True) as db:
            row = self._row(db, run_id)
            if row["status"] in TERMINAL_STATUSES:
                return
            state = json.loads(row["state_json"])
            state["usage"] = usage
            db.execute("UPDATE pi_runs SET state_json=? WHERE id=?", (canonical(state), run_id))

    def pending_runs(self):
        """Private recovery records; trusted owners are never returned by the API."""
        with self._connection() as db:
            return [(self._decode(row), row["owner"]) for row in db.execute(
                "SELECT r.* FROM pi_runs r WHERE r.status='queued' AND NOT EXISTS "
                "(SELECT 1 FROM pi_closed_sessions s WHERE s.owner=r.owner AND s.session_id=r.session_id)")
                if json.loads(row["config_json"]).get("runtime") == "durable"]

    def requeue_worker(self, run_id, usage):
        with self.atomic():
            run = self.get(run_id)
            failures = run["state"].get("recovery_failures", 0) + 1
            state = {"usage": usage, "recovery_failures": failures}
            if failures >= 5:
                state.update(code="restart_limit", message="工作进程多次中断且没有取得进展，已停止自动恢复。")
                return self.transition(run_id, "failed", state=state, data=state)
            return self.transition(run_id, "queued", state=state,
                data={"reason": "worker_recovery", "message": "工作进程中断，正在恢复已保存的任务。"})

    def recover_interrupted(self, *, resume_durable=False) -> int:
        """Only call while holding the host's exclusive supervisor lock."""
        with self._connection(write=True) as db:
            rows = db.execute("SELECT * FROM pi_runs WHERE status IN ('queued','running','cancelling')").fetchall()
            for row in rows:
                state = json.loads(row["state_json"])
                durable = json.loads(row["config_json"]).get("runtime") == "durable"
                resumable = resume_durable and durable
                closed = db.execute("SELECT 1 FROM pi_closed_sessions WHERE owner=? AND session_id=?", (row["owner"], row["session_id"])).fetchone()
                if durable and not resume_durable and row["status"] != "cancelling" and not closed:
                    # A temporary core rollback must not destroy recoverable
                    # work, or consume its crash retry allowance.
                    if not state.get("runtime_paused") or row["status"] != "queued":
                        state["runtime_paused"] = True
                        db.execute("UPDATE pi_runs SET status='queued',state_json=? WHERE id=?", (canonical(state), row["id"]))
                        self._append(db, row["id"], "run.queued", {"status": "queued", "reason": "runtime_paused", "runtime_paused": True,
                            "message": "当前运行时已切回 core；此任务已保留，切回 durable 后继续。"})
                    continue
                if resumable and row["status"] != "cancelling" and not closed and state.get("recovery_failures", 0) < 5:
                    state.pop("runtime_paused", None)
                    state["recovery_failures"] = state.get("recovery_failures", 0) + 1
                    db.execute("UPDATE pi_runs SET status='queued',state_json=? WHERE id=?", (canonical(state), row["id"]))
                    self._append(db, row["id"], "run.queued", {"status": "queued", "reason": "host_recovery", "runtime_paused": False,
                        "message": "服务已恢复，正在继续已保存的任务。"})
                    continue
                status = "cancelled" if row["status"] == "cancelling" else "failed"
                if closed:
                    status = "cancelled"
                detail = {"code": "host_restarted", "message": "服务重启，原任务已中断；已完成的行动和证据仍可查看。"}
                if resumable and not closed and status != "cancelled":
                    detail = {"code": "restart_limit", "message": "任务多次恢复后仍未取得进展，已停止重复重启。"}
                state = {**state, **detail}
                db.execute("UPDATE pi_runs SET status=?,state_json=? WHERE id=?", (status, canonical(state), row["id"]))
                self._append(db, row["id"], f"run.{status}", {"status": status, **detail})
            return len(rows)
