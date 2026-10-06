"""The verifier must detect divergence, preserve stream failures and forbid I/O."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import socket
import threading

import httpx
import pytest
import urllib3

MODULE = Path(__file__).resolve().parents[2] / "scripts/pi_io_replay.py"
spec = importlib.util.spec_from_file_location("pi_io_replay", MODULE)
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"source": "original text", "path": self.path}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.mark.asyncio
async def test_real_transports_replay_after_server_stops_and_reject_different_request(tmp_path):
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    path = tmp_path / "tape"

    async def exercise():
        token = replay.lane.set("source")
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                a = (await client.get(url + "/async", headers={"Authorization": "Bearer test-secret"})).json()
            def blocking():
                with httpx.Client(trust_env=False) as client:
                    return client.get(url + "/sync").json()
            with ThreadPoolExecutor(max_workers=1) as pool:
                b = await asyncio.get_running_loop().run_in_executor(pool, blocking)
            response = urllib3.PoolManager().urlopen("GET", url + "/object", preload_content=False)
            c = json.loads(response.read())
            response.close()
            return [a, b, c]
        finally:
            replay.lane.reset(token)

    recorder = replay.Tape(path, "record").install()
    try:
        original = await exercise()
    finally:
        recorder.close()
        server.shutdown()
        server.server_close()
        thread.join()
    assert all(item["lane"] == "source" for item in recorder.records)
    assert "test-secret" not in "".join(p.read_text() for p in path.glob("*.json"))
    player = replay.Tape(path, "replay").install()
    try:
        assert await exercise() == original
        assert player.report()["unconsumed_ids"] == []
        token = replay.lane.set("source")
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                with pytest.raises(replay.ReplayMismatch, match="Unrecorded"):
                    await client.get(url + "/different")
            with socket.socket() as connection, pytest.raises(replay.ReplayMismatch, match="socket"):
                connection.connect(("127.0.0.1", server.server_port))
        finally:
            replay.lane.reset(token)
        assert len(player.report()["errors"]) == 2
    finally:
        player.close()
    with pytest.raises(FileExistsError):
        replay.Tape(path, "record")


@pytest.mark.asyncio
async def test_partial_stream_timeout_is_preserved_and_not_turned_into_success(tmp_path, monkeypatch):
    class BrokenStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"data: first\n\n"
            raise httpx.ReadTimeout("private provider failure")

    async def upstream(self, request):
        return httpx.Response(200, stream=BrokenStream())
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", upstream)
    for mode in ("record", "replay"):
        tape = replay.Tape(tmp_path / "tape", mode).install()
        seen = []
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                with pytest.raises(httpx.ReadTimeout):
                    async with client.stream("GET", "http://provider.invalid/stream") as response:
                        async for line in response.aiter_lines():
                            if line:
                                seen.append(line)
            assert seen == ["data: first"]
            assert not tape.report()["unconsumed_ids"]
        finally:
            tape.close()
    assert "private provider failure" not in (tmp_path / "tape/000000.json").read_text()


@pytest.mark.asyncio
async def test_embedding_deadline_keeps_application_timeout_semantics(tmp_path, monkeypatch):
    async def upstream(self, request):
        await asyncio.sleep(1)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", upstream)
    for mode in ("record", "replay"):
        tape = replay.Tape(tmp_path / "tape", mode).install()
        try:
            async with httpx.AsyncClient(trust_env=False) as client:
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(client.get("http://provider.invalid/embed"), .02)
        finally:
            tape.close()


def test_storage_is_read_only_and_only_signing_values_are_normalized(tmp_path):
    tape = replay.Tape(tmp_path / "tape", "record", minio_hosts={"storage:9000"}, qdrant_hosts={"vectors:6333"})
    for method, url in (("DELETE", "http://storage:9000/kb/file"),
                        ("PUT", "http://vectors:6333/collections/docs/points")):
        with pytest.raises(replay.ReplayMismatch, match="mutation"):
            tape.begin(replay.request_contract("httpx", method, url, {}, b""))
    body = {"query": [0.1, 0.2], "filter": {"file_id": "selected"}, "limit": 8}
    a = replay.request_contract("httpx", "POST", "http://vectors:6333/collections/docs/points/query", {}, json.dumps(body))
    b = replay.request_contract("httpx", "POST", a["url"], {}, json.dumps({**body, "filter": {"file_id": "other"}}))
    assert replay.digest(a) != replay.digest(b)
    tape.begin(a)
    url = "http://storage:9000/kb/file?X-Amz-Signature=secret&X-Amz-Date=now&versionId=old"
    assert "secret" not in replay.safe_url(url)
    assert "versionId=old" in replay.safe_url(url)


def test_cache_clock_replays_every_read_and_does_not_change_global_time(tmp_path):
    import time
    recorder = replay.Tape(tmp_path / "tape", "record")
    readings = iter([10.0, 11.0, 72.0])
    observed = [recorder.clock("inventory/monotonic", lambda: next(readings)) for _ in range(3)]
    player = replay.Tape(tmp_path / "tape", "replay")
    def forbidden():
        raise AssertionError("Replay must not consult the live inventory clock")
    assert [player.clock("inventory/monotonic", forbidden) for _ in range(3)] == observed
    assert observed[1] - observed[0] < 60 <= observed[2] - observed[1]
    assert not player.report()["unconsumed_ids"]
    assert time.monotonic() > 0
    with pytest.raises(replay.ReplayMismatch, match="Unrecorded"):
        player.clock("inventory/monotonic", forbidden)
