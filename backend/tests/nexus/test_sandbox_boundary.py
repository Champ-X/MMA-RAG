from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

from nexus.infrastructure.sandbox.client import UnixSocketSandboxRunner
from nexus.shared.domain.errors import ValidationError


def test_unix_socket_sandbox_executes_bounded_read_only_sql() -> None:
    # macOS limits AF_UNIX paths to 104 bytes; pytest's nested temp path is longer.
    socket_path = Path(f"/tmp/nexus-sandbox-{uuid.uuid4().hex[:10]}.sock")
    environment = {
        **os.environ,
        "NEXUS_SANDBOX_SOCKET_PATH": str(socket_path),
        "PYTHONPATH": str(Path(__file__).parents[2] / "src"),
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "nexus.infrastructure.sandbox.server"],
        env=environment,
    )
    try:
        for _ in range(100):
            if socket_path.exists():
                break
            if process.poll() is not None:
                raise AssertionError("Sandbox server exited before creating its socket")
            time.sleep(0.03)
        runner = UnixSocketSandboxRunner(socket_path)
        assert runner.health()["status"] == "ready"
        result = runner.sql_read(
            {
                "query": "SELECT category, sum(value) total FROM input GROUP BY category",
                "rows": [
                    {"category": "a", "value": 40},
                    {"category": "a", "value": 2},
                ],
            }
        )
        assert result["rows"] == [["a", 42]]
        assert result["sandboxed"] is True
        with pytest.raises(ValidationError):
            runner.sql_read(
                {
                    "query": "SELECT * FROM read_csv_auto('/etc/passwd')",
                    "rows": [{"value": 1}],
                }
            )
    finally:
        process.terminate()
        process.wait(timeout=5)
        socket_path.unlink(missing_ok=True)


def test_sql_executor_has_no_in_process_duckdb_runtime() -> None:
    root = Path(__file__).parents[3]
    executor = (root / "backend/src/nexus/infrastructure/tools/executor.py").read_text()
    compose = (root / "docker-compose.yml").read_text()
    assert "import duckdb" not in executor
    assert "duckdb.connect" not in executor
    assert "network_mode: none" in compose
    assert "cap_drop: [ALL]" in compose
    assert "nexus_sandbox_socket:/run/nexus-sandbox" in compose
