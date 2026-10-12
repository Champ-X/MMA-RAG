"""Exercise Hugging Face's actual on-disk resume after a terminated process.

A local HTTP fixture supplies deterministic bytes with Hub metadata. This is a
transport/cache integration check, not a claim of inference with fixture bytes;
setup only marks real models ready after the separate encoder warmup succeeds.
"""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import sys
from threading import Thread
import time


def test_huggingface_download_reuses_incomplete_bytes_after_process_exit(tmp_path):
    data = b"tessmora-hub-download-fixture\n" * (32 * 1024 * 1024 // 28)
    digest = hashlib.sha256(data).hexdigest()
    ranges = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_HEAD(self):
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("ETag", digest)
            self.send_header("X-Repo-Commit", "a" * 40)
            self.end_headers()

        def do_GET(self):
            request_range = self.headers.get("Range")
            ranges.append(request_range)
            start = int(request_range.removeprefix("bytes=").split("-")[0]) if request_range else 0
            self.send_response(206 if start else 200)
            self.send_header("Content-Length", str(len(data) - start))
            if start:
                self.send_header("Content-Range", f"bytes {start}-{len(data)-1}/{len(data)}")
            self.end_headers()
            try:
                for offset in range(start, len(data), 64 * 1024):
                    self.wfile.write(data[offset:offset + 64 * 1024])
                    self.wfile.flush()
                    time.sleep(0.005)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    cache = tmp_path / "hf-cache"
    script = "from huggingface_hub import hf_hub_download;import sys;print(hf_hub_download(repo_id='tessmora/resume-fixture',filename='model.bin',cache_dir=sys.argv[1],endpoint=sys.argv[2]))"
    arguments = [sys.executable, "-c", script, str(cache), f"http://127.0.0.1:{server.server_port}"]
    env = {**os.environ, "HF_HUB_DISABLE_XET": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "NO_PROXY": "127.0.0.1,localhost"}
    process = subprocess.Popen(arguments, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 20
        incomplete = None
        while time.monotonic() < deadline and process.poll() is None:
            incomplete = next(iter(cache.rglob("*.incomplete")), None)
            if incomplete and incomplete.stat().st_size >= 10 * 1024 * 1024:
                break
            time.sleep(0.02)
        assert incomplete and incomplete.stat().st_size > 0, "Hub did not persist any partial bytes"
        assert process.poll() is None, "Download unexpectedly finished before interruption"
        process.terminate()
        process.wait(timeout=5)
        partial_size = incomplete.stat().st_size
        assert 0 < partial_size < len(data)
        resumed = subprocess.run(arguments, env=env, capture_output=True, text=True, timeout=30)
        assert resumed.returncode == 0, resumed.stderr
        artifact = Path(resumed.stdout.strip())
        assert hashlib.sha256(artifact.read_bytes()).hexdigest() == digest
        assert f"bytes={partial_size}-" in ranges
        assert not incomplete.exists()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
