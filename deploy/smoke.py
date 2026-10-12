#!/usr/bin/env python3
"""Boot local images in an isolated, credential-free installation and check persistence.

No existing containers, ports, data directories or credentials are reused. Requires
images built by deploy/build.sh. Failed evidence directories remain for diagnosis.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

# A TCP server that accepts Redis connections but never responds, like a stalled
# container route. Exercise Kombu's real socket settings rather than asserting config.
BROKER_TIMEOUT_PROBE = """
import socket, threading, time
from celery_app import celery_app
server = socket.socket()
server.bind(('127.0.0.1', 0))
server.listen()
def stall():
    connection, _ = server.accept()
    with connection:
        time.sleep(15)
threading.Thread(target=stall, daemon=True).start()
started = time.monotonic()
try:
    with celery_app.connection_for_read(f'redis://127.0.0.1:{server.getsockname()[1]}/0') as connection:
        connection.ensure_connection(max_retries=0)
except Exception as error:
    elapsed = time.monotonic() - started
    assert 'timeout' in str(error).lower() or 'timed out' in str(error).lower(), type(error).__name__
    assert elapsed < 12, f'Redis socket attempt took {elapsed:.1f}s'
    print(f'Stalled Redis connection failed after {elapsed:.1f}s')
else:
    raise AssertionError('Unresponsive Redis was accepted')
finally:
    server.close()
"""

# Exercise actual application clients after API credentials have been saved.
# A local rejecting proxy reproduces WSL's lowercase bypass-list mismatch.
STORAGE_PROXY_PROBE = """
import asyncio, json, os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import httpx
class Proxy(BaseHTTPRequestHandler):
    calls = 0
    def do_GET(self):
        type(self).calls += 1
        self.send_response(502)
        self.end_headers()
    def log_message(self, *args): pass
proxy = ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
thread = threading.Thread(target=proxy.serve_forever, daemon=True)
thread.start()
for key in ('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy'):
    os.environ[key] = f'http://127.0.0.1:{proxy.server_port}'
os.environ['NO_PROXY'] = 'localhost,127.0.0.1,minio,qdrant,redis'
os.environ['no_proxy'] = 'localhost,127.0.0.1'
try:
    assert httpx.get('http://qdrant:6333/collections', timeout=5).status_code == 502
    assert httpx.get('http://qdrant:6333/collections', trust_env=False, timeout=5).status_code == 200
    Proxy.calls = 0
    from app.core.config import settings
    from app.core.setup_service import _prepare_storage, _assert_embedding_change_safe
    from app.core.storage_health import check_storage
    from qdrant_client import AsyncQdrantClient
    assert settings.siliconflow_api_key == 'synthetic-smoke-key'
    assert check_storage()['success']
    _assert_embedding_change_safe()
    _prepare_storage()
    async def check_async():
        client = AsyncQdrantClient(**settings.get_qdrant_config())
        try:
            return sorted(row.name for row in (await client.get_collections()).collections)
        finally:
            await client.close()
    collections = asyncio.run(check_async())
    assert len(collections) == 6 and 'text_chunks_agentic' in collections
    assert Proxy.calls == 0, 'Internal storage traffic reached the external proxy'
    assert httpx.get('http://model-probe.invalid/', timeout=5).status_code == 502
    assert Proxy.calls == 1, 'External provider transport lost its proxy'
    print(json.dumps({'collections': collections, 'internal_proxy_requests': 0, 'external_proxy_requests': 1}))
finally:
    proxy.shutdown()
    proxy.server_close()
    thread.join(timeout=2)
"""


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep", action="store_true", help="Keep the isolated installation running for browser QA")
    parser.add_argument("--backend-image", default="tessmora-backend:local")
    parser.add_argument("--frontend-image", default="tessmora-frontend:local")
    parser.add_argument("--minio-image", default="tessmora-minio:RELEASE.2025-09-07T16-13-09Z")
    args = parser.parse_args()
    compose = ["docker", "compose"]
    if subprocess.run(compose + ["version"], capture_output=True).returncode:
        if not shutil.which("docker-compose"):
            raise SystemExit("Docker Compose is required")
        compose = ["docker-compose"]
    # Keep bind mounts below the checkout: macOS Docker/Colima may not share /var/folders.
    evidence_root = ROOT / "data" / "distribution-smoke"
    evidence_root.mkdir(parents=True, exist_ok=True)
    evidence = Path(tempfile.mkdtemp(prefix="tessmora-smoke-", dir=evidence_root))
    data = evidence / "data"
    data.mkdir()
    port, storage_port = free_port(), free_port()
    while storage_port == port:
        storage_port = free_port()
    project = "tessmora-smoke-" + secrets.token_hex(4)
    token = secrets.token_urlsafe(32)
    values = {
        "TESSMORA_DATA_DIR": str(data),
        "TESSMORA_PORT": str(port),
        "TESSMORA_STORAGE_PORT": str(storage_port),
        "TESSMORA_SETUP_TOKEN": token,
        "TESSMORA_MINIO_PASSWORD": secrets.token_urlsafe(32),
        "TESSMORA_BACKEND_IMAGE": args.backend_image,
        "TESSMORA_FRONTEND_IMAGE": args.frontend_image,
        "TESSMORA_MINIO_IMAGE": args.minio_image,
    }
    envfile = evidence / "runtime.env"
    envfile.write_text("".join(key + "='" + value.replace("'", "\\'") + "'\n" for key, value in values.items()))
    envfile.chmod(0o600)
    process_env = {key: value for key, value in os.environ.items() if not key.startswith("TESSMORA_")}
    # Reproduce Docker Desktop/WSL injecting an external proxy into frontend.
    # The local Nginx -> API readiness check must bypass this unreachable proxy.
    proxy_overlay = evidence / "proxy-smoke.yaml"
    proxy_overlay.write_text('services:\n  frontend:\n    environment:\n      http_proxy: http://127.0.0.1:1\n      HTTP_PROXY: http://127.0.0.1:1\n')
    cmd = compose + ["--env-file", str(envfile), "-p", project, "-f", str(ROOT / "deploy" / "compose.yaml"), "-f", str(proxy_overlay)]
    base = f"http://127.0.0.1:{port}"

    def compose_run(*command: str) -> subprocess.CompletedProcess:
        return subprocess.run(cmd + list(command), check=True, text=True, capture_output=True, env=process_env)

    def request(path: str, headers: dict | None = None, body: dict | None = None):
        req = urllib.request.Request(base + path, headers={**(headers or {}), **({"Content-Type": "application/json"} if body is not None else {})},
                                     data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=20) as response:
            content = response.read()
            return json.loads(content) if "json" in response.headers.get("content-type", "") else content.decode()

    report = {"project": project, "url": base, "data": str(data), "checks": {}}
    print(f"Isolated project: {project}\nEvidence: {evidence}\nURL: {base}", flush=True)
    try:
        compose_run("up", "-d", "--wait", "--wait-timeout", "300")
        report["checks"]["health"] = request("/health")
        assert report["checks"]["health"]["status"] == "healthy"
        compose_run("exec", "-T", "frontend", "sh", "-c",
                    "if wget --quiet --spider http://127.0.0.1/health; then exit 1; fi; "
                    "wget -Y off -q -O /dev/null -T 3 http://127.0.0.1/health")
        report["checks"]["proxy_safe_healthcheck"] = True
        task = compose_run("exec", "-T", "backend", "python", "-c",
                           "from celery_app import celery_app; "
                           "result=celery_app.send_task('celery_app.debug_task', queue='celery').get(timeout=20); "
                           "assert result=={'hello':'world'}; print('Worker processed task through Redis')")
        report["checks"]["worker_task"] = task.stdout.strip()
        timeout_probe = compose_run("exec", "-T", "backend", "python", "-c", BROKER_TIMEOUT_PROBE)
        report["checks"]["broker_socket_timeout"] = timeout_probe.stdout.strip()
        page = request("/setup")
        assert "<html" in page and "/assets/" in page, "Compiled SPA was not served"
        report["checks"]["setup_status"] = request("/api/setup/status")
        assert report["checks"]["setup_status"]["managed"] is True
        assert report["checks"]["setup_status"]["setup_required"] is True
        assert report["checks"]["setup_status"]["configured"] is False
        knowledge = request("/api/knowledge/")
        assert knowledge["knowledge_bases"] == [], "Installation is not empty"
        report["checks"]["empty_knowledge_bases"] = True
        try:
            request("/api/setup/config")
        except urllib.error.HTTPError as error:
            assert error.code == 401
        else:
            raise AssertionError("Private configuration endpoint accepted a missing token")
        private_config = request("/api/setup/config", {"X-Tessmora-Setup-Token": token})
        assert private_config["managed"] is True
        report["checks"]["setup_auth"] = True
        assert token not in json.dumps(report), "Public status leaked setup token"
        report["checks"]["storage_preflight"] = request("/api/setup/storage")
        assert report["checks"]["storage_preflight"]["success"]
        saved = request("/api/setup/config", {"X-Tessmora-Setup-Token": token},
                        {"credentials": {"deepseek": "synthetic-smoke-key", "siliconflow": "synthetic-smoke-key"}})
        assert saved["configured"] and not saved["tested"]
        storage_probe = compose_run("exec", "-T", "backend", "python", "-c", STORAGE_PROXY_PROBE)
        report["checks"]["proxy_safe_storage_initialization"] = json.loads(storage_probe.stdout.strip().splitlines()[-1])
        # Process liveness must not conceal a real storage outage.
        compose_run("stop", "qdrant")
        failed_storage = request("/api/setup/storage")
        assert not failed_storage["success"]
        failed_qdrant = next(row for row in failed_storage["checks"] if row["name"] == "qdrant")
        assert not failed_qdrant["success"] and "Qdrant" in failed_qdrant["message"]
        assert request("/health")["status"] == "healthy"
        report["checks"]["storage_outage_diagnosis"] = failed_storage
        compose_run("start", "qdrant")
        for _ in range(20):
            if request("/api/setup/storage")["success"]:
                break
            time.sleep(1)
        else:
            raise AssertionError("Storage preflight did not recover after Qdrant restart")
        report["checks"]["storage_recovery"] = True
        tools = compose_run("exec", "-T", "backend", "sh", "-c",
                            "node --version && ffmpeg -version | head -1 && libreoffice --version && test ! -e /app/backend/.env && test -f /app/agent-runtime/src/worker.mjs")
        report["checks"]["runtime_tools"] = tools.stdout.strip().splitlines()
        fonts = compose_run("exec", "-T", "backend", "fc-list", ":lang=zh", "family")
        assert "Noto" in fonts.stdout, "CJK fonts are missing"
        report["checks"]["cjk_fonts"] = True
        pi = compose_run("exec", "-T", "--workdir", "/app/agent-runtime", "backend", "node", "--input-type=module", "-e",
            "await import('@earendil-works/pi-agent-core'); await import('@earendil-works/pi-ai'); console.log('Pi SDK imports: ready')")
        report["checks"]["pi_sdk"] = pi.stdout.strip()
        inference_imports = compose_run("exec", "-T", "backend", "python", "-c",
            "import torch, FlagEmbedding, magic; from transformers import CLIPModel, ClapModel; "
            "assert magic.from_buffer(b'Tessmora sample'); "
            "print('CPU PyTorch:', torch.__version__); print('BGE-M3 / CLIP / CLAP imports: ready')")
        report["checks"]["inference_dependencies"] = inference_imports.stdout.strip().splitlines()
        # Exercise the rebuilt storage image through S3, including persistence.
        s3_client = (
            "import io, os; from minio import Minio; "
            "c=Minio('minio:9000', access_key=os.environ['MINIO_ACCESS_KEY'], "
            "secret_key=os.environ['MINIO_SECRET_KEY'], secure=False); "
        )
        compose_run("exec", "-T", "backend", "python", "-c", s3_client +
                    "c.make_bucket('onboarding-smoke'); "
                    "payload=b'Every fragment finds its place.'; "
                    "c.put_object('onboarding-smoke', 'fragment.txt', io.BytesIO(payload), len(payload))")
        report["checks"]["storage_version"] = compose_run("exec", "-T", "minio", "minio", "--version").stdout.strip()
        marker = "/state/distribution-smoke-marker.txt"
        compose_run("exec", "-T", "backend", "python", "-c",
                    "from pathlib import Path; import sys; Path(sys.argv[1]).write_text(sys.argv[2])", marker, project)
        compose_run("restart", "minio", "backend", "worker", "frontend")
        compose_run("up", "-d", "--wait", "--wait-timeout", "300")
        persisted = compose_run("exec", "-T", "backend", "python", "-c",
                    "from pathlib import Path; import sys; print(Path(sys.argv[1]).read_text())", marker)
        assert persisted.stdout.strip() == project
        assert request("/health")["status"] == "healthy"
        compose_run("exec", "-T", "backend", "python", "-c", s3_client +
                    "r=c.get_object('onboarding-smoke', 'fragment.txt'); "
                    "assert r.read()==b'Every fragment finds its place.'; r.close(); r.release_conn()")
        report["checks"]["s3_restart_persistence"] = True
        report["checks"]["restart_persistence"] = True
        report["passed"] = True
    except Exception as error:
        report["passed"] = False
        report["error"] = str(error)
        try:
            log = compose_run("logs", "--no-color", "--tail", "100").stdout
            for secret in (token, values["TESSMORA_MINIO_PASSWORD"]):
                log = log.replace(secret, "[redacted]")
            (evidence / "containers.log").write_text(log)
        except subprocess.CalledProcessError:
            pass
        raise
    finally:
        (evidence / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        if not args.keep:
            compose_run("down")
        print(f"Report: {evidence / 'report.json'}", flush=True)


if __name__ == "__main__":
    main()
