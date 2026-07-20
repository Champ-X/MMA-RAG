from __future__ import annotations

import json
import multiprocessing
import os
import resource
import socket
import struct
from pathlib import Path
from typing import Any

from nexus.infrastructure.sandbox.sql import execute_sql_payload
from nexus.shared.domain.errors import DomainError

_HEADER = struct.Struct("!I")
_MAX_MESSAGE_BYTES = 16 * 1024 * 1024
_TASK_TIMEOUT_SECONDS = 8.0


def main() -> None:
    socket_path = Path(os.environ.get("NEXUS_SANDBOX_SOCKET_PATH", "/run/nexus-sandbox/sql.sock"))
    socket_path.parent.mkdir(parents=True, exist_ok=True)
    socket_path.unlink(missing_ok=True)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(str(socket_path))
        socket_path.chmod(0o660)
        server.listen(32)
        while True:
            connection, _ = server.accept()
            with connection:
                try:
                    size = _HEADER.unpack(_read_exact(connection, _HEADER.size))[0]
                    if size > _MAX_MESSAGE_BYTES:
                        raise ValueError("request exceeds sandbox message limit")
                    request = json.loads(_read_exact(connection, size))
                    response = _execute_bounded(request)
                except Exception as exc:
                    response = {
                        "ok": False,
                        "error": {
                            "code": "SANDBOX_PROTOCOL_ERROR",
                            "message": f"{type(exc).__name__}: {exc}",
                        },
                    }
                encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode()
                try:
                    connection.sendall(_HEADER.pack(len(encoded)) + encoded)
                except OSError:
                    # Health probes or timed-out callers may close after connect.
                    pass


def _execute_bounded(request: object) -> dict[str, object]:
    if not isinstance(request, dict) or request.get("operation") != "sql_read":
        return {"ok": False, "error": {"code": "VALIDATION_ERROR", "message": "Unknown operation"}}
    payload = request.get("payload")
    if not isinstance(payload, dict):
        return {
            "ok": False,
            "error": {"code": "VALIDATION_ERROR", "message": "payload must be an object"},
        }
    receive, send = multiprocessing.Pipe(duplex=False)
    process = multiprocessing.Process(target=_child, args=(send, payload), daemon=True)
    process.start()
    send.close()
    if receive.poll(_TASK_TIMEOUT_SECONDS):
        response = receive.recv()
        process.join(timeout=1)
        return response
    process.kill()
    process.join(timeout=1)
    return {
        "ok": False,
        "error": {"code": "SANDBOX_TIMEOUT", "message": "Computation exceeded 8 seconds"},
    }


def _child(send: Any, payload: dict[str, object]) -> None:
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (6, 7))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
        send.send({"ok": True, "result": execute_sql_payload(payload)})
    except DomainError as exc:
        send.send({"ok": False, "error": {"code": exc.code, "message": exc.message}})
    except Exception as exc:
        send.send(
            {
                "ok": False,
                "error": {
                    "code": "SANDBOX_EXECUTION_FAILED",
                    "message": f"{type(exc).__name__}: {exc}",
                },
            }
        )
    finally:
        send.close()


def _read_exact(connection: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = connection.recv(remaining)
        if not chunk:
            raise ConnectionError("client disconnected")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


if __name__ == "__main__":
    main()
