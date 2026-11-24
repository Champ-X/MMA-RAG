"""Own the native services of one desktop workspace. Stdout is private launcher IPC."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import URLError
from urllib.request import build_opener, ProxyHandler, Request
from uuid import UUID, uuid4

from app.core.file_lock import lock_file

LOOPBACK = "127.0.0.1"
stop_requested = threading.Event()


class StartupError(Exception):
    pass


def emit(phase, message, **fields):
    print(json.dumps({"phase": phase, "message": message, **fields}, ensure_ascii=True), flush=True)


def stop_on_eof():
    try:
        sys.stdin.buffer.readline()
    finally:
        stop_requested.set()


def write_marker(directory, contents):
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, encoding="utf-8", delete=False) as out:
        json.dump(contents, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(out.name, directory / "workspace.json")


def workspace_identity(directory):
    if not directory.is_dir():
        raise StartupError("工作区目录不存在或不可访问。")
    allowed = {".workspace.lock", ".DS_Store", "desktop.ini"}
    marker = directory / "workspace.json"
    if not marker.exists() and any(p.name not in allowed for p in directory.iterdir()):
        raise StartupError("所选目录已有其他文件。请选择空目录或已有的 Tessmora 工作区。")
    if marker.exists():
        try:
            contents = json.loads(marker.read_text("utf-8"))
            if marker.is_symlink() or contents["format"] != 1:
                raise ValueError
            return str(UUID(contents["id"]))
        except (OSError, KeyError, ValueError, TypeError) as exc:
            raise StartupError("工作区标识或格式无效，请选择兼容版本或从备份恢复。") from exc
    identity = str(uuid4())
    write_marker(directory, {"format": 1, "id": identity})
    return identity


def private_directory(path):
    if path.is_symlink():
        raise StartupError("工作区的运行目录不能是符号链接。")
    path.mkdir(mode=0o700, exist_ok=True)
    return path


def listener():
    sock = socket.socket()
    sock.bind((LOOPBACK, 0))
    return sock


def local_get(url, headers):
    with build_opener(ProxyHandler({})).open(Request(url, headers=headers), timeout=2) as response:
        return json.load(response)


def wait_ready(check, process, timeout, label):
    until = time.monotonic() + timeout
    while not stop_requested.is_set():
        if process.poll() is not None:
            raise StartupError(f"{label}提前退出。请查看工作区 logs 目录中的服务日志。")
        try:
            result = check()
            if result:
                return result
        except (URLError, OSError, ValueError):
            pass
        if time.monotonic() >= until:
            raise StartupError(f"{label}未在预期时间内就绪。请检查磁盘空间及工作区日志。")
        stop_requested.wait(.2)
    raise StartupError("工作区启动已取消。")


def terminate(child):
    if child.poll() is None:
        if child.stdin:
            child.stdin.close()
        # API and worker accept orderly EOF on all platforms.
        if child.stdin:
            try:
                child.wait(timeout=8)
                return
            except subprocess.TimeoutExpired:
                pass
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=3)


def api_main(ready_path):
    import uvicorn
    with listener() as sock:
        port = sock.getsockname()[1]
        os.environ["API_PORT"] = str(port)
        server = uvicorn.Server(uvicorn.Config("app.main:app", host=LOOPBACK, port=port, access_log=False))
        def watch_parent():
            sys.stdin.buffer.readline()
            server.should_exit = True
        threading.Thread(target=watch_parent, daemon=True).start()
        ready_path.write_text(str(port), encoding="ascii")
        asyncio.run(server.serve(sockets=[sock]))


def supervise(workspace, runtime, identity, manifest, scratch, cleanup):
    state = private_directory(workspace / "state")
    logs = private_directory(workspace / "logs")
    qdata = private_directory(workspace / "qdrant")
    cache = private_directory(workspace / "cache")
    token = secrets.token_urlsafe(48)
    qkey = secrets.token_urlsafe(48)
    executables = {name: str((runtime / relative).resolve(strict=True))
                   for name, relative in manifest["executables"].items()}
    backend = runtime / "backend"
    for value in executables.values():
        if not Path(value).is_relative_to(runtime):
            raise StartupError("运行包清单包含无效路径，请修复安装。")
    env = {**os.environ, "TESSMORA_RUNTIME_PROFILE": "desktop", "TESSMORA_STATE_DIR": str(state),
           "TESSMORA_WORKSPACE_ID": identity, "TESSMORA_DESKTOP_TOKEN": token,
           "PI_AGENT_API_TOKEN": token, "TESSMORA_SETUP_TOKEN": token,
           "PI_AGENT_NODE_BINARY": executables["node"], "FFMPEG_PATH": executables["ffmpeg"],
           "HF_HOME": str(state / "models" / "huggingface"), "TORCH_HOME": str(cache / "torch"),
           "TMPDIR": str(scratch), "TEMP": str(scratch), "TMP": str(scratch),
           "PYTHONPATH": str(backend), "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1",
           "PATH": str(runtime / "bin") + os.pathsep + os.environ.get("PATH", ""),
           "QDRANT_HOST": LOOPBACK, "QDRANT_API_KEY": qkey, "API_HOST": LOOPBACK,
           "PRELOAD_LOCAL_MODELS_ON_STARTUP": "false"}
    if "office" in executables:
        env["LIBREOFFICE_PATH"] = executables["office"]
    children = {}
    def start(name, command, environment, *, pipe=True):
        log = cleanup.enter_context((logs / (name + ".log")).open("ab"))
        proc = subprocess.Popen(command, env=environment, cwd=scratch, stdout=log, stderr=log,
                                stdin=subprocess.PIPE if pipe else subprocess.DEVNULL)
        children[name] = proc
        cleanup.callback(terminate, proc)
        return proc

    # A raw Qdrant snapshot can be opened only by the storage version that produced it.
    # Refuse incompatible versions before the service has a chance to alter any index files.
    version = subprocess.check_output([executables["qdrant"], "--version"], cwd=scratch,
                                      stderr=subprocess.DEVNULL, timeout=15, text=True).strip().split()[-1]
    marker = json.loads((workspace / "workspace.json").read_text("utf-8"))
    if marker.get("qdrant_version", version) != version:
        raise StartupError("工作区索引版本与运行包不匹配。请使用匹配的运行包，或进行逻辑迁移。")
    if "qdrant_version" not in marker:
        write_marker(workspace, {**marker, "qdrant_version": version})
    emit("index", "正在打开本地向量索引。")
    # Qdrant takes a numeric port. Its authenticated identity is checked before accepting it.
    # Retry with fresh ports if a concurrent application wins the small bind race.
    for attempt in range(3):
        with listener() as candidate:
            qport = candidate.getsockname()[1]
        env["QDRANT_PORT"] = str(qport)
        qenv = {"PATH": env["PATH"], **{key: os.environ[key] for key in ("SystemRoot", "WINDIR", "HOME", "TMP", "TEMP") if key in os.environ},
                "QDRANT__SERVICE__HOST": LOOPBACK, "QDRANT__SERVICE__HTTP_PORT": str(qport),
                "QDRANT__SERVICE__API_KEY": qkey, "QDRANT__STORAGE__STORAGE_PATH": str(qdata / "storage"),
                "QDRANT__STORAGE__SNAPSHOTS_PATH": str(qdata / "snapshots"), "QDRANT__TELEMETRY_DISABLED": "true"}
        # Explicitly disable the unused gRPC listener (its default port would collide with other workspaces).
        conf = scratch / "qdrant.yaml"
        conf.write_text("service:\n  grpc_port: null\ncluster:\n  enabled: false\n", encoding="utf-8")
        qproc = start("qdrant", [executables["qdrant"], "--config-path", str(conf)], qenv, pipe=False)
        try:
            wait_ready(lambda: local_get(f"http://{LOOPBACK}:{qport}/collections", {"api-key": qkey}),
                       qproc, 40, "本地索引")
            break
        except StartupError:
            terminate(qproc)
            if attempt == 2 or stop_requested.is_set():
                raise

    emit("api", "正在启动知识服务并检查工作区存储。")
    api_port_file = scratch / "api-port"
    api = start("api", [executables["python"], str(backend / "desktop_host.py"), "--api", str(api_port_file)], env)
    port = wait_ready(lambda: int(api_port_file.read_text("ascii")), api, 30, "本地 API")
    url = f"http://{LOOPBACK}:{port}"
    headers = {"Authorization": "Bearer " + token}
    wait_ready(lambda: local_get(url + "/api/setup/storage", headers).get("success"), api, 120, "本地存储")
    emit("worker", "正在恢复本地作业。")
    worker_cmd = [executables["python"], "-m", "app.modules.ingestion.desktop_worker"]
    ready = scratch / "worker-ready"
    env["TESSMORA_WORKER_READY_FILE"] = str(ready)
    def start_worker():
        ready.unlink(missing_ok=True)
        worker = start("worker", worker_cmd, env)
        wait_ready(lambda: ready.is_file(), worker, 90, "入库工作进程")
    start_worker()
    emit("ready", "本地工作区已就绪。", url=url, token=token, workspaceId=identity)
    retries = 0
    while not stop_requested.wait(.3):
        for name, proc in list(children.items()):
            if proc.poll() is None:
                continue
            if name == "worker" and retries < 2:
                retries += 1
                emit("worker", "入库进程已退出，正在恢复持久化作业。")
                start_worker()
            else:
                raise StartupError(f"服务 {name} 已退出。请重新打开工作区，已保存的资料会保留。")


def main():
    os.umask(0o077)
    if sys.argv[1:2] == ["--api"]:
        api_main(Path(sys.argv[2]))
        return
    if os.name == "nt":
        from app.core.windows_job import contain_process_tree
        contain_process_tree()
    envelope = json.loads(sys.stdin.buffer.readline(65536))
    threading.Thread(target=stop_on_eof, daemon=True).start()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop_requested.set())
    directory = Path(envelope["workspaceDir"]).resolve(strict=True)
    runtime = Path(__file__).resolve().parents[1]
    manifest = json.loads((runtime / "runtime.json").read_text("utf-8"))
    if manifest.get("format") != 1 or manifest.get("workspaceFormat") != 1 or manifest.get("apiProtocol") != 1:
        raise StartupError("运行包版本不兼容，请修复安装。")
    # Check before creating the lock file in an unrelated directory.
    if not (directory / "workspace.json").is_file() and any(
            p.name not in {".workspace.lock", ".DS_Store", "desktop.ini"} for p in directory.iterdir()):
        raise StartupError("所选目录已有其他资料。请选择空目录或现有 Tessmora 工作区。")
    if shutil.disk_usage(directory).free < 64 * 1024 * 1024:
        raise StartupError("工作区可用空间不足 64 MiB，请先释放磁盘空间。")
    lock_path = directory / ".workspace.lock"
    if lock_path.is_symlink():
        raise StartupError("工作区锁文件无效。")
    with lock_path.open("a+b") as lock:
        try:
            lock_file(lock)
        except OSError as exc:
            raise StartupError("此工作区已由其他进程打开。请先关闭已有实例。") from exc
        identity = workspace_identity(directory)
        tmp = private_directory(directory / "temp")
        with tempfile.TemporaryDirectory(prefix="launch-", dir=tmp) as scratch, contextlib.ExitStack() as cleanup:
            supervise(directory, runtime, identity, manifest, Path(scratch), cleanup)


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        if "--api" in sys.argv:
            raise
        emit("error", str(exc) if isinstance(exc, StartupError) else "本地运行环境无法打开，请检查安装、工作区权限和日志。")
        sys.exit(1)
