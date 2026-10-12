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
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep", action="store_true", help="Keep the isolated installation running for browser QA")
    parser.add_argument("--backend-image", default="tessmora-backend:local")
    parser.add_argument("--frontend-image", default="tessmora-frontend:local")
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
    }
    envfile = evidence / "runtime.env"
    envfile.write_text("".join(key + "='" + value.replace("'", "\\'") + "'\n" for key, value in values.items()))
    envfile.chmod(0o600)
    process_env = {key: value for key, value in os.environ.items() if not key.startswith("TESSMORA_")}
    cmd = compose + ["--env-file", str(envfile), "-p", project, "-f", str(ROOT / "deploy" / "compose.yaml")]
    base = f"http://127.0.0.1:{port}"

    def compose_run(*command: str) -> subprocess.CompletedProcess:
        return subprocess.run(cmd + list(command), check=True, text=True, capture_output=True, env=process_env)

    def request(path: str, headers: dict | None = None):
        req = urllib.request.Request(base + path, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as response:
            content = response.read()
            return json.loads(content) if "json" in response.headers.get("content-type", "") else content.decode()

    report = {"project": project, "url": base, "data": str(data), "checks": {}}
    print(f"Isolated project: {project}\nEvidence: {evidence}\nURL: {base}", flush=True)
    try:
        compose_run("up", "-d", "--wait", "--wait-timeout", "300")
        report["checks"]["health"] = request("/health")
        assert report["checks"]["health"]["status"] == "healthy"
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
        marker = "/state/distribution-smoke-marker.txt"
        compose_run("exec", "-T", "backend", "python", "-c",
                    "from pathlib import Path; import sys; Path(sys.argv[1]).write_text(sys.argv[2])", marker, project)
        compose_run("restart", "backend", "worker", "frontend")
        compose_run("up", "-d", "--wait", "--wait-timeout", "300")
        persisted = compose_run("exec", "-T", "backend", "python", "-c",
                    "from pathlib import Path; import sys; print(Path(sys.argv[1]).read_text())", marker)
        assert persisted.stdout.strip() == project
        assert request("/health")["status"] == "healthy"
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
