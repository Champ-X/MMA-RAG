#!/usr/bin/env python3
"""POSIX local-service supervisor. Uses stdlib only, including for stop/status."""

import argparse
import contextlib
import errno
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent.parent
RUN_DIR = ROOT / "logs" / "dev"
STATE = RUN_DIR / "state.json"
BACKEND_LOG = ROOT / "logs" / "restored-backend.log"
FRONTEND_LOG = ROOT / "logs" / "restored-frontend.log"
SUPERVISOR_LOG = RUN_DIR / "supervisor.log"
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
STORAGE = ("mmrag_minio", "mmrag_qdrant", "mmrag_redis")


class StartupError(RuntimeError):
    pass


def say(message):
    print(message, flush=True)


def log_tail(path, lines=30):
    # Logs can be large after repeated restarts; only read a bounded tail.
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        handle.seek(max(0, handle.tell() - 65536))
        return "\n".join(handle.read().decode("utf-8", errors="replace").splitlines()[-lines:])


def run(command, *, timeout=30, capture=True, cwd=None, env=None, check=True):
    try:
        result = subprocess.run(command, cwd=cwd or ROOT, env=env, text=True,
                                stdout=subprocess.PIPE if capture else None,
                                stderr=subprocess.PIPE if capture else None, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StartupError(f"Command failed: {command[0]} ({exc})") from exc
    if check and result.returncode:
        # Never print command arguments: they may include user-supplied credentials.
        detail = (result.stderr or result.stdout or "").strip()[-2000:]
        raise StartupError(f"{command[0]} exited {result.returncode}: {detail}")
    return result


def process_identity(pid):
    result = run(["ps", "-p", str(pid), "-o", "stat=", "-o", "uid=", "-o", "lstart=", "-o", "args="], check=False)
    fields = result.stdout.strip().split(None, 8)
    if result.returncode or len(fields) < 8 or fields[0].startswith("Z"):
        return ""
    # macOS Python switches from its venv launcher to Python.app after exec.
    # Compare UID, birth time and arguments; the executable spelling is transient.
    arguments = fields[8] if len(fields) == 9 else Path(fields[7]).name
    return " ".join(fields[1:7]) + " " + arguments


def process_record(pid, arguments=None):
    # ps can temporarily expose only '(python3.12)' during macOS exec. Wait for
    # the real argv, then require two stable observations before saving identity.
    previous = None
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        identity = process_identity(pid)
        argv = identity.split(None, 6)[-1] if identity else ""
        valid = identity and not (argv.startswith("(") and argv.endswith(")"))
        if valid and (arguments is None or argv == arguments) and identity == previous:
            return {"pid": pid, "identity": identity}
        previous = identity
        time.sleep(.03)
    raise StartupError(f"Process {pid} exited or did not expose a stable command; see service logs")


def alive(record):
    if not isinstance(record, dict) or not isinstance(record.get("pid"), int) or record["pid"] <= 1:
        return False
    return bool(record.get("identity")) and process_identity(record["pid"]) == record["identity"]


def read_state():
    try:
        state = json.loads(STATE.read_text())
    except FileNotFoundError:
        return {}
    except (ValueError, OSError) as exc:
        raise StartupError(f"Cannot read {STATE}; inspect it before retrying: {exc}") from exc
    if not isinstance(state, dict) or state.get("root") != str(ROOT):
        raise StartupError(f"Invalid or foreign service state: {STATE}")
    children = state.get("children", {})
    records = list(children.values()) if isinstance(children, dict) else []
    if "supervisor" in state:
        records.append(state["supervisor"])
    if not isinstance(children, dict) or any(
        not isinstance(record, dict)
        or not isinstance(record.get("pid"), int)
        or record["pid"] <= 1
        or not isinstance(record.get("identity"), str)
        or not record["identity"]
        for record in records
    ):
        raise StartupError(f"Invalid process records in {STATE}; inspect the state before retrying.")
    return state


def write_state(state):
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(state, indent=2) + "\n")
    temp.chmod(0o600)
    temp.replace(STATE)


@contextlib.contextmanager
def lock(name):
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    with (RUN_DIR / name).open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise StartupError("Another startup/stop operation is running; try status or logs.") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def signal_owned(record, sig):
    # PID plus creation time and exact command protects against stale/reused PIDs.
    if not alive(record):
        return
    try:
        pid = record["pid"]
        if os.getpgid(pid) == pid:
            os.killpg(pid, sig)
        else:
            os.kill(pid, sig)
    except ProcessLookupError:
        pass


def stop_children(state, processes=()):
    children = list(state.get("children", {}).values())
    owned_pids = {process.pid for process in processes}

    def send(sig):
        for pid in owned_pids:
            # These children have not been reaped, so their group IDs cannot
            # be reused even if the leader crashed and descendants survived.
            try:
                os.killpg(pid, sig)
            except ProcessLookupError:
                pass
            except PermissionError:
                # On macOS a group containing only an unreaped zombie can report EPERM.
                if process_identity(pid):
                    raise
        for child in children:
            if child["pid"] not in owned_pids:
                signal_owned(child, sig)

    send(signal.SIGTERM)
    deadline = time.monotonic() + 15
    while any(alive(child) for child in children) and time.monotonic() < deadline:
        time.sleep(0.2)
    send(signal.SIGKILL)


def stop():
    state = read_state()
    supervisor = state.get("supervisor")
    if alive(supervisor):
        signal_owned(supervisor, signal.SIGTERM)
        deadline = time.monotonic() + 25
        while alive(supervisor) and time.monotonic() < deadline:
            time.sleep(0.2)
        if alive(supervisor):
            # Children must be stopped before forcibly terminating their supervisor.
            stop_children(read_state())
            signal_owned(supervisor, signal.SIGKILL)
    stop_children(read_state())
    STATE.unlink(missing_ok=True)
    say("Frontend/backend stopped. MinIO, Qdrant and Redis remain running.")


def assert_port_free(port):
    # BSD permits wildcard/loopback coexistence with SO_REUSEADDR. Probe both,
    # including IPv6, while allowing a released socket in TIME_WAIT to restart.
    for family, address in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET, "0.0.0.0"),
                            (socket.AF_INET6, "::1"), (socket.AF_INET6, "::")):
        try:
            with socket.socket(family) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                if family == socket.AF_INET6:
                    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                sock.bind((address, port))
                # macOS permits a reused wildcard bind while another address
                # listens. listen() is required to detect that conflict.
                sock.listen(1)
        except OSError as exc:
            if family == socket.AF_INET6 and exc.errno in (errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL):
                continue  # IPv6 is disabled on this host.
            raise StartupError(
                f"Port {port} is occupied. Inspect: lsof -nP -iTCP:{port} -sTCP:LISTEN. "
                "Only processes registered by this launcher are stopped automatically.") from exc


def assert_ports_free(frontend_port):
    for port in (8000, frontend_port):
        assert_port_free(port)


def get_json(url, timeout=3):
    with HTTP.open(url, timeout=timeout) as response:
        return json.load(response)


def health_ok():
    try:
        data = get_json("http://127.0.0.1:8000/health")
        return isinstance(data, dict) and data.get("status") == "healthy" and data.get("service") == "Tessmora"
    except (OSError, ValueError, urllib.error.URLError):
        return False


def frontend_ok(port):
    try:
        with HTTP.open(f"http://127.0.0.1:{port}/", timeout=3) as response:
            if b'<div id="root"' not in response.read():
                return False
        # Exercise the same /api proxy used by the browser, including stored data.
        data = get_json(f"http://127.0.0.1:{port}/api/knowledge/", timeout=15)
        return isinstance(data, dict) and isinstance(data.get("knowledge_bases"), list)
    except (OSError, ValueError, urllib.error.URLError):
        return False


def wait_ready(label, probe, processes, timeout, cancelled):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cancelled():
            raise StartupError("Startup interrupted")
        for process in processes:
            # Leave an exited child unreaped until its entire group is cleaned up.
            if not process_identity(process.pid):
                raise StartupError(f"{label}: process exited; see service logs")
        if probe():
            return
        time.sleep(0.5)
    raise StartupError(f"{label} timed out after {timeout}s; see service logs")


def preflight(install=True):
    if sys.version_info[:2] not in ((3, 11), (3, 12)):
        raise StartupError("Backend needs Python 3.11/3.12. Set MMA_PYTHON to a compatible virtualenv.")
    if not (ROOT / "backend" / ".env").is_file():
        raise StartupError("Missing backend/.env. Copy backend/.env.example and configure your providers.")
    result = run([sys.executable, "-c", "import uvicorn, fastapi, dotenv, minio, qdrant_client, pydantic_settings"], check=False)
    if result.returncode:
        raise StartupError(f"Backend dependencies missing. Run: {sys.executable} -m pip install -r backend/requirements.txt")
    if not shutil.which("node"):
        raise StartupError("Install Node.js >=22.19 first (Vite and Pi Agent runtime).")
    version = tuple(int(n) for n in run(["node", "--version"]).stdout.strip().lstrip("v").split("."))
    if version < (22, 19, 0):
        raise StartupError("Node.js >=22.19 is required for Vite and Pi Agent runtime.")
    for directory, entry in (("frontend", "node_modules/vite/bin/vite.js"),
                             ("agent-runtime", "node_modules/@earendil-works/pi-agent-core/package.json")):
        if not (ROOT / directory / entry).is_file():
            if not install:
                raise StartupError(f"Missing {directory} dependencies. Run: npm --prefix {directory} ci")
            if not shutil.which("npm"):
                raise StartupError(f"npm is required to install {directory} dependencies.")
            say(f"Installing {directory} dependencies with npm ci...")
            run(["npm", "ci"], cwd=ROOT / directory, timeout=600, capture=False)
    run(["node", "--input-type=module", "-e",
         "await import('@earendil-works/pi-agent-core'); await import('@earendil-works/pi-ai')"],
        cwd=ROOT / "agent-runtime")
    missing = [name for name in ("ffmpeg", "ffprobe") if not shutil.which(name)]
    if not (shutil.which("libreoffice") or shutil.which("soffice") or
            Path("/Applications/LibreOffice.app/Contents/MacOS/soffice").is_file()):
        missing.append("LibreOffice")
    if missing:
        say(f"Media tools missing: {', '.join(missing)}. Install them before processing office/audio/video files.")
    say(f"Python {sys.version_info.major}.{sys.version_info.minor}, Node {'.'.join(map(str, version))}, frontend/Pi dependencies OK")


def docker_command():
    if not shutil.which("docker"):
        raise StartupError("Docker is not installed.")
    context = os.environ.get("MMA_DOCKER_CONTEXT")
    if not context:
        exists = run(["docker", "context", "inspect", "colima-mma-rag"], check=False)
        context = "colima-mma-rag" if exists.returncode == 0 else run(["docker", "context", "show"]).stdout.strip()
    env = dict(os.environ, DOCKER_CONTEXT=context)
    for key in ("DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "COMPOSE_FILE", "COMPOSE_PROJECT_NAME"):
        env.pop(key, None)
    docker = ["docker", "--context", context]
    endpoint = run(docker + ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"], env=env).stdout.strip()
    if not endpoint.startswith("unix://"):
        raise StartupError("Local data and localhost probes require a local Unix-socket Docker context.")
    return docker, env, context


def start_storage(restored, cancelled):
    docker, env, context = docker_command()
    say(f"Docker context: {context}")
    if run(docker + ["info"], env=env, timeout=10, check=False).returncode:
        if context != "colima-mma-rag" or not shutil.which("colima"):
            raise StartupError(f"Start Docker context {context} first or set MMA_DOCKER_CONTEXT.")
        say("Starting Colima profile mma-rag...")
        run(["colima", "start", "--profile", "mma-rag", "--activate=false"], timeout=240, capture=False, env=env)
        run(docker + ["info"], timeout=10, env=env)

    existing = []
    for name in STORAGE:
        result = run(docker + ["container", "inspect", name], env=env, check=False)
        if result.returncode == 0:
            existing.append(json.loads(result.stdout)[0])
        elif run(docker + ["info"], env=env, timeout=10, check=False).returncode:
            raise StartupError("Docker became unavailable while inspecting storage; no directories were created.")
    if existing:
        if len(existing) != len(STORAGE):
            raise StartupError("Storage containers are incomplete. Restore the missing containers before starting; existing data was retained.")
        for container, destination in zip(existing[:2], ("/data", "/qdrant/storage")):
            mounts = [m for m in container["Mounts"] if m["Destination"] == destination]
            if not mounts or mounts[0]["Type"] != "bind" or not Path(mounts[0]["Source"]).is_dir():
                raise StartupError(f"Missing local persistent storage mount for {container['Name']}; refusing empty storage.")
            say(f"Reuse {container['Name']}: {mounts[0]['Source']}")
        # Compose up against another checkout would change mounts and hide its data.
        run(docker + ["start", *STORAGE], env=env)
    else:
        minio = ROOT / "minio_data"
        qdrant = ROOT / "qdrant_storage"
        if restored and not (minio.is_dir() and (qdrant / "collections").is_dir()):
            raise StartupError("Restored startup requires existing MinIO/Qdrant data or all three existing storage containers.")
        if run(docker + ["compose", "version"], env=env, check=False).returncode == 0:
            compose = docker + ["compose"]
        elif shutil.which("docker-compose"):
            compose = ["docker-compose"]
        else:
            raise StartupError("Install Docker Compose first.")
        minio.mkdir(exist_ok=True)
        qdrant.mkdir(exist_ok=True)
        run(compose + ["-p", "mma-rag", "-f", str(ROOT / "docker-compose.yml"),
                       "--env-file", str(ROOT / "backend" / ".env"),
                       "up", "-d", "minio", "qdrant", "redis"], env=env, timeout=180, capture=False)

    def storage_ready():
        try:
            for url in ("http://127.0.0.1:9000/minio/health/live", "http://127.0.0.1:6333/healthz"):
                with HTTP.open(url, timeout=2) as response:
                    if response.status != 200:
                        return False
            return run(docker + ["exec", "mmrag_redis", "redis-cli", "ping"], env=env,
                       timeout=3, check=False).stdout.strip() == "PONG"
        except (OSError, urllib.error.URLError, StartupError):
            return False

    wait_ready("MinIO/Qdrant/Redis", storage_ready, [], 90, cancelled)
    say("MinIO, Qdrant and Redis are ready")


def spawn(command, cwd, log_path):
    # Process groups allow reload workers and Pi subprocesses to be stopped too.
    with log_path.open("a") as output:
        output.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} start ---\n")
        output.flush()
        return subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL,
                                stdout=output, stderr=subprocess.STDOUT, start_new_session=True)


def supervise(args):
    cancelled = False

    def request_stop(_sig, _frame):
        nonlocal cancelled
        cancelled = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    state = {"root": str(ROOT), "token": args.token, "status": "starting", "port": args.port,
             "supervisor": process_record(os.getpid()), "children": {}}
    processes = []
    with lock("supervisor.lock"):
        write_state(state)
        try:
            assert_ports_free(args.port)
            state["phase"] = "dependency checks"
            write_state(state)
            preflight()
            state["phase"] = "storage readiness"
            write_state(state)
            start_storage(args.restored, lambda: cancelled)
            if cancelled:
                raise StartupError("Startup interrupted")
            backend = [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]
            if args.reload:
                backend.append("--reload")
            for name, command, cwd, output, probe in (
                ("backend", backend, ROOT / "backend", BACKEND_LOG, health_ok),
                ("frontend", ["node", str(ROOT / "frontend/node_modules/vite/bin/vite.js"),
                              "--host", "127.0.0.1", "--port", str(args.port), "--strictPort"],
                 ROOT / "frontend", FRONTEND_LOG, lambda: frontend_ok(args.port)),
            ):
                process = spawn(command, cwd, output)
                processes.append(process)
                state["children"][name] = process_record(process.pid, " ".join(command[1:]))
                state["phase"] = f"{name} readiness"
                write_state(state)
                say(f"Waiting for {name} readiness...")
                wait_ready(name, probe, processes, args.timeout, lambda: cancelled)
            state["status"] = "ready"
            write_state(state)
            say(f"Tessmora ready: http://localhost:{args.port} (API: http://localhost:8000/docs)")
            while not cancelled:
                for process in processes:
                    if not process_identity(process.pid):
                        raise StartupError("Service exited; stopping the other service")
                time.sleep(0.5)
        finally:
            state["status"] = "stopping"
            write_state(state)
            stop_children(state, processes)
            for process in processes:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            STATE.unlink(missing_ok=True)


def start(args):
    state = read_state()
    if alive(state.get("supervisor")):
        children = state.get("children", {})
        if state.get("status") == "ready" and len(children) == 2 and all(alive(child) for child in children.values()) and health_ok() and frontend_ok(state["port"]):
            say(f"Already running: http://localhost:{state['port']} . Use ./start-dev.sh restart to restart.")
            return
        raise StartupError("An existing supervisor is starting or unhealthy. Use restart or inspect logs.")
    stop_children(state)  # Recover verified orphan processes after an abnormal exit.
    STATE.unlink(missing_ok=True)
    assert_ports_free(args.port)
    token = uuid.uuid4().hex
    command = [sys.executable, str(Path(__file__).resolve()), "supervise", "--token", token,
               "--port", str(args.port), "--timeout", str(args.timeout)]
    if args.restored:
        command.append("--restored")
    if args.reload:
        command.append("--reload")
    with SUPERVISOR_LOG.open("a") as output:
        output.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} launch ---\n")
        output.flush()
        process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL,
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    ready = False
    try:
        last_message = 0
        while process.poll() is None:
            state = read_state()
            if state.get("token") == token and state.get("status") == "ready":
                ready = True
                break
            if time.monotonic() - last_message >= 10:
                say(f"Starting ({state.get('phase', 'initializing')})... see {SUPERVISOR_LOG.relative_to(ROOT)}")
                last_message = time.monotonic()
            time.sleep(0.3)
        if not ready:
            say(log_tail(SUPERVISOR_LOG, 60))
            raise StartupError("Startup failed. Run ./start-dev.sh logs for service details.")
        say(f"Frontend: http://localhost:{args.port}\nAPI: http://localhost:8000/docs")
        say("Health and /api proxy verified. Logs: ./start-dev.sh logs")
        if args.background:
            say("Running in background. Stop: ./start-dev.sh stop")
            return
        say("Ctrl+C stops the frontend/backend; storage stays running.")
        if process.wait() != 0:
            raise StartupError("Service supervisor exited; see ./start-dev.sh logs")
    finally:
        if not ready or not args.background:
            stop()


def status():
    state = read_state()
    managed = alive(state.get("supervisor"))
    children = state.get("children", {})
    for name in ("backend", "frontend"):
        record = children.get(name)
        say(f"{name}: {'running (PID ' + str(record['pid']) + ')' if alive(record) else 'stopped'}")
    port = state.get("port", 3001)
    backend = health_ok()
    frontend = frontend_ok(port)
    say(f"API health: {'OK' if backend else 'unavailable'}; frontend/API proxy :{port}: {'OK' if frontend else 'unavailable'}")
    return 0 if managed and state.get("status") == "ready" and len(children) == 2 and all(alive(c) for c in children.values()) and backend and frontend else 1


def main():
    parser = argparse.ArgumentParser(description="Tessmora one-command local startup, restart and diagnostics.")
    parser.add_argument("action", nargs="?", default="start", choices=("start", "restart", "stop", "status", "logs", "doctor", "supervise"))
    parser.add_argument("--background", "-d", action="store_true", help="keep running after this terminal exits")
    parser.add_argument("--reload", action="store_true", help="enable backend reload (Vite always supports HMR)")
    parser.add_argument("--restored", action="store_true", help="require existing storage, never initialize an empty dataset")
    parser.add_argument("--port", type=int, default=os.environ.get("FRONTEND_PORT", "3001"), help="frontend port (default: FRONTEND_PORT or 3001; API fixed at 8000)")
    parser.add_argument("--timeout", type=int, default=os.environ.get("MMA_START_TIMEOUT", "300"), help="seconds to wait for each app service (default: 300)")
    parser.add_argument("--token", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or args.port == 8000 or args.timeout <= 0:
        parser.error("Choose a valid frontend port other than 8000 and a positive timeout.")
    try:
        if args.action == "supervise":
            if not args.token:
                parser.error("supervise is internal; use start")
            supervise(args)
        elif args.action == "status":
            return status()
        elif args.action == "logs":
            for path in (SUPERVISOR_LOG, BACKEND_LOG, FRONTEND_LOG):
                say(f"\n{path.relative_to(ROOT)}")
                if path.exists():
                    say(log_tail(path))
                else:
                    say("No log yet")
        elif args.action == "doctor":
            preflight(install=False)
            docker, env, context = docker_command()
            run(docker + ["info"], env=env, timeout=10)
            say(f"Docker {context} OK. This check does not install dependencies or start services.")
        else:
            with lock("operation.lock"):
                if args.action in ("stop", "restart"):
                    stop()
                if args.action != "stop":
                    start(args)
        return 0
    except (StartupError, OSError) as exc:
        say(f"ERROR: {exc}")
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
