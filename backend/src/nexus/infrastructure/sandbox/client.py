from __future__ import annotations

import json
import socket
import stat
import struct
from pathlib import Path

from nexus.infrastructure.sandbox.sql import execute_sql_payload, validate_sql_payload
from nexus.shared.domain.errors import CapabilityUnavailableError, ValidationError

_HEADER = struct.Struct("!I")
_MAX_MESSAGE_BYTES = 16 * 1024 * 1024


class UnixSocketSandboxRunner:
    def __init__(self, socket_path: Path, *, timeout_seconds: float = 12.0) -> None:
        self.socket_path = socket_path
        self.timeout_seconds = timeout_seconds

    def sql_read(self, payload: dict[str, object]) -> dict[str, object]:
        # Reject malformed and filesystem/network-capable SQL before crossing
        # the trust boundary; the isolated worker validates it again.
        validate_sql_payload(payload)
        request = json.dumps(
            {"operation": "sql_read", "payload": payload},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
        if len(request) > _MAX_MESSAGE_BYTES:
            raise ValidationError("Sandbox request exceeds the 16 MiB boundary")
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(self.timeout_seconds)
                client.connect(str(self.socket_path))
                client.sendall(_HEADER.pack(len(request)) + request)
                size = _HEADER.unpack(_read_exact(client, _HEADER.size))[0]
                if size > _MAX_MESSAGE_BYTES:
                    raise CapabilityUnavailableError("Sandbox returned an oversized response")
                response = json.loads(_read_exact(client, size))
        except OSError as exc:
            raise CapabilityUnavailableError(
                "Isolated computation sandbox is unavailable",
                details={"socket": str(self.socket_path), "error_type": type(exc).__name__},
            ) from exc
        if not isinstance(response, dict):
            raise CapabilityUnavailableError("Sandbox returned a malformed response")
        if not response.get("ok"):
            raw_error = response.get("error")
            error: dict[str, object] = raw_error if isinstance(raw_error, dict) else {}
            message = str(error.get("message") or "Sandbox rejected the computation")
            if error.get("code") == "VALIDATION_ERROR":
                raise ValidationError(message)
            raise CapabilityUnavailableError(message)
        result = response.get("result")
        if not isinstance(result, dict):
            raise CapabilityUnavailableError("Sandbox returned no result")
        return result

    def health(self) -> dict[str, object]:
        try:
            socket_ready = stat.S_ISSOCK(self.socket_path.stat().st_mode)
        except OSError:
            socket_ready = False
        if not socket_ready:
            return {"status": "unavailable", "transport": "unix_socket"}
        return {"status": "ready", "transport": "unix_socket"}


class LocalTestSandboxRunner:
    """Explicit test-only adapter; production never selects this backend."""

    def sql_read(self, payload: dict[str, object]) -> dict[str, object]:
        return execute_sql_payload(payload)

    def health(self) -> dict[str, object]:
        return {"status": "ready", "transport": "local_test"}


class DisabledSandboxRunner:
    def sql_read(self, payload: dict[str, object]) -> dict[str, object]:
        validate_sql_payload(payload)
        raise CapabilityUnavailableError("Isolated computation sandbox is disabled")

    def health(self) -> dict[str, object]:
        return {"status": "disabled", "transport": "none"}


def _read_exact(client: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = client.recv(remaining)
        if not chunk:
            raise ConnectionError("Sandbox connection closed before the response completed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)
