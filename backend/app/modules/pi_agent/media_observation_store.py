"""Completed media observations, scoped by trusted owner and access policy.

This is a result cache, never an execution checkpoint or a source of citation
IDs. Callers must authorize and verify the current source before lookup. Only a
fully returned observation is written; failed or in-flight requests have no row.
"""
from __future__ import annotations

import json
from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3
import time

from pydantic import ValidationError

from .contracts import Evidence
from .store import canonical, fingerprint


class MediaObservationStore:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(descriptor)
        self.path.chmod(0o600)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS media_observations (
                namespace TEXT NOT NULL, observation_key TEXT NOT NULL,
                payload TEXT NOT NULL, payload_hash TEXT NOT NULL,
                created_at REAL NOT NULL, PRIMARY KEY(namespace, observation_key)
            )""")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=2)
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _validate(namespace, key, evidence):
        if not isinstance(namespace, str) or not namespace:
            raise ValueError("A trusted media cache namespace is required")
        if not isinstance(key, str) or not key:
            raise ValueError("An exact media observation key is required")
        if evidence.observation != "media_observation" or not evidence.content.strip():
            raise ValueError("Only completed media observations can be cached")
        if evidence.provenance.get("observation_key") != key:
            raise ValueError("Media observation identity does not match its cache key")

    def get(self, namespace: str, key: str) -> Evidence | None:
        if not namespace:
            raise ValueError("A trusted media cache namespace is required")
        with self._connect() as db:
            row = db.execute("SELECT payload,payload_hash FROM media_observations WHERE namespace=? AND observation_key=?",
                             (namespace, key)).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(row[0])
            if payload.get("schema_version") != 1 or fingerprint(payload) != row[1]:
                raise ValueError("Invalid cached observation")
            evidence = Evidence.model_validate(payload["evidence"])
            self._validate(namespace, key, evidence)
            return evidence
        except (ValueError, TypeError, KeyError, AttributeError, ValidationError):
            # An incompatible/corrupt cache entry is a miss, not evidence.
            # Delete only the value inspected, not a concurrent replacement.
            with self._connect() as db:
                db.execute("DELETE FROM media_observations WHERE namespace=? AND observation_key=? AND payload=? AND payload_hash=?",
                           (namespace, key, row[0], row[1]))
            return None

    def put(self, namespace: str, key: str, evidence: Evidence):
        self._validate(namespace, key, evidence)
        value = evidence.model_copy(deep=True)
        value.id = 0
        value.provenance.pop("reused_from_evidence_id", None)
        value.provenance["cache_status"] = "fresh"
        payload = {"schema_version": 1, "evidence": value.model_dump()}
        with self._connect() as db:
            # A transaction publishes the entire successful observation. Keeping
            # the first completion also makes concurrent exact writes stable.
            db.execute("INSERT OR IGNORE INTO media_observations VALUES (?,?,?,?,?)",
                       (namespace, key, canonical(payload), fingerprint(payload), time.time()))
