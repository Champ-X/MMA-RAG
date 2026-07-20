from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
from pathlib import Path

import uvicorn
from sqlalchemy import select

from nexus.api import create_app
from nexus.bootstrap import build_container
from nexus.config import get_settings
from nexus.infrastructure.operations.service import restore_backup_to_empty
from nexus.infrastructure.postgres.models import Run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nexus")
    subparsers = parser.add_subparsers(dest="command", required=True)
    serve = subparsers.add_parser("serve")
    serve.add_argument("--host")
    serve.add_argument("--port", type=int)
    subparsers.add_parser("doctor")
    worker = subparsers.add_parser("worker")
    worker.add_argument("--once", action="store_true")
    worker.add_argument(
        "--role", choices=("all", "control", "index"), default="all"
    )
    subparsers.add_parser("feishu-worker")
    backup = subparsers.add_parser("backup")
    backup.add_argument("destination", type=Path)
    verify = subparsers.add_parser("verify-backup")
    verify.add_argument("path", type=Path)
    restore = subparsers.add_parser("restore")
    restore.add_argument("path", type=Path)
    restore.add_argument("--target-database-url", required=True)
    restore.add_argument("--target-blob-root", required=True, type=Path)
    subparsers.add_parser("reconcile")
    openapi = subparsers.add_parser("openapi")
    openapi.add_argument("output", type=Path)
    args = parser.parse_args(argv)
    settings = get_settings()
    if args.command == "serve":
        uvicorn.run(
            "nexus.api.app:app",
            host=args.host or settings.bind_host,
            port=args.port or settings.bind_port,
        )
        return 0
    if args.command == "openapi":
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(create_app(settings=settings).openapi(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(json.dumps({"status": "written", "path": str(args.output)}, ensure_ascii=False))
        return 0
    if args.command == "restore":
        result = restore_backup_to_empty(
            args.path,
            target_database_url=args.target_database_url,
            target_blob_root=args.target_blob_root,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0
    container = build_container(settings)
    try:
        if args.command == "doctor":
            result = container.operations.doctor()
        elif args.command == "backup":
            result = container.operations.backup(args.destination)
        elif args.command == "verify-backup":
            result = container.operations.verify_backup(args.path)
        elif args.command == "reconcile":
            result = container.operations.reconcile()
        elif args.command == "worker":
            if args.once:
                result = _worker_once(container, role=args.role)
            else:
                while True:
                    result = _worker_once(container, role=args.role)
                    time.sleep(settings.worker_poll_seconds)
        elif args.command == "feishu-worker":
            from nexus.infrastructure.feishu.worker import run_feishu_worker

            result = run_feishu_worker(container)
        else:
            parser.error("Unknown command")
            return 2
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0 if result.get("status") not in {"unavailable", "invalid"} else 1
    finally:
        container.database.engine.dispose()


def _worker_once(container: object, *, role: str = "all") -> dict[str, object]:
    jobs: list[object]
    runs: list[str]
    jobs = []
    runs = []
    if role in {"all", "control"}:
        worker_id = f"worker:{socket.gethostname()}:{os.getpid()}"
        jobs = container.control_plane.claim_ingestion_jobs(  # type: ignore[attr-defined]
            worker_id=worker_id,
            limit=20,
            lease_seconds=container.settings.worker_lease_seconds,  # type: ignore[attr-defined]
        )
        with container.database.transaction() as session:  # type: ignore[attr-defined]
            runs = list(
                session.scalars(
                    select(Run.id)
                    .where(Run.status.in_(["created", "recovering"]))
                    .order_by(Run.id)
                    .limit(20)
                )
            )
    for lease in jobs:
        container.ingestion.process_job(  # type: ignore[attr-defined]
            lease.job_id, lease=lease
        )
    projected = (
        container.index.project_pending()  # type: ignore[attr-defined]
        if role in {"all", "index"} and container.index  # type: ignore[attr-defined]
        else {"projected": 0}
    )
    for run_id in runs:
        container.agent_runtime.recover(run_id)  # type: ignore[attr-defined]
    return {
        "status": "completed",
        "role": role,
        "jobs": len(jobs),
        "runs": len(runs),
        "index": projected,
    }


if __name__ == "__main__":
    sys.exit(main())
