"""Build a relocatable native runtime on its target OS. All upstream archives are pinned."""
from __future__ import annotations

import argparse
import concurrent.futures
import gzip
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SOURCES = json.loads((HERE / "native-sources.json").read_text())


def native_target():
    machine = platform.machine().lower()
    if sys.platform == "darwin" and machine in {"arm64", "aarch64"}:
        return "darwin-arm64"
    if sys.platform == "win32" and machine in {"amd64", "x86_64"}:
        return "win32-x64"
    raise SystemExit(f"No tested build recipe for {sys.platform}/{machine}")


def sha256(path):
    with path.open("rb") as src:
        return hashlib.file_digest(src, "sha256").hexdigest()


def fetch(cache, record):
    target = cache / record["sha256"]
    if target.is_file() and sha256(target) == record["sha256"]:
        return target
    last_error = None
    for attempt in range(4):
        try:
            with tempfile.NamedTemporaryFile(dir=cache, delete=False) as out:
                temporary = Path(out.name)
                try:
                    request = Request(record["url"], headers={"User-Agent": "Tessmora-runtime-builder/1"})
                    with urlopen(request, timeout=90) as src:
                        shutil.copyfileobj(src, out, 1024 * 1024)
                except BaseException:
                    out.close()
                    temporary.unlink(missing_ok=True)
                    raise
            if sha256(temporary) != record["sha256"]:
                temporary.unlink()
                raise ValueError(f"Archive digest mismatch for {record['url']}")
            temporary.replace(target)
            return target
        except OSError as exc:
            last_error = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not download {record['url']}") from last_error


def extract(archive, directory, url):
    directory.mkdir()
    if urlsplit(url).path.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            for member in z.infolist():
                if not (directory / member.filename).resolve().is_relative_to(directory.resolve()):
                    raise ValueError("Invalid archive path")
            z.extractall(directory)
    else:
        with tarfile.open(archive, "r:*") as tar:
            tar.extractall(directory, filter="data")


def run(args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def copy_application(root):
    backend = root / "backend"
    backend.mkdir()
    shutil.copytree(REPO / "backend/app", backend / "app", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in ("celery_app.py", "desktop_host.py"):
        shutil.copy2(REPO / "backend" / name, backend / name)
    agent = root / "agent-runtime"
    agent.mkdir()
    for name in ("package.json", "package-lock.json"):
        shutil.copy2(REPO / "agent-runtime" / name, agent / name)
    shutil.copytree(REPO / "agent-runtime/src", agent / "src")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("Build machine requires npm")
    run([npm, "ci", "--omit=dev", "--ignore-scripts", "--no-fund", "--no-audit"], cwd=agent)


def decompress(source, destination):
    with gzip.open(source, "rb") as src, destination.open("wb") as out:
        shutil.copyfileobj(src, out)


def assemble(root, downloads, sources, target, office):
    windows = target == "win32-x64"
    ext = ".exe" if windows else ""
    executables = root / "bin"
    licenses = root / "licenses"
    executables.mkdir()
    licenses.mkdir()
    python_rel = "python/python.exe" if windows else "python/bin/python3.11"
    with tempfile.TemporaryDirectory(dir=root.parent) as unpack:
        unpack = Path(unpack)
        for name in ("python", "node", "qdrant"):
            expanded = unpack / name
            extract(downloads[name], expanded, sources[name]["url"])
            if name == "python":
                (expanded / "python").rename(root / "python")
                continue
            matches = [p for p in expanded.rglob(name + ext) if p.is_file()]
            if len(matches) != 1:
                raise ValueError(f"{name} archive contains {len(matches)} executable candidates")
            shutil.copy2(matches[0], executables / (name + ext))
            for notice in expanded.rglob("LICENSE*"):
                if notice.is_file() and "node_modules" not in notice.parts:
                    shutil.copy2(notice, licenses / (name + "-" + notice.name))
    for name in ("ffmpeg", "ffprobe"):
        decompress(downloads[name], executables / (name + ext))
    for name in ("media-license", "media-source"):
        decompress(downloads[name], licenses / (name + ".txt"))
    shutil.copy2(downloads["qdrant-license"], licenses / "qdrant-LICENSE.txt")
    for binary in executables.iterdir():
        binary.chmod(0o755)
    python = root / python_rel
    lock = HERE.parent / "locks" / (target + ".txt")
    if not lock.is_file():
        raise RuntimeError(f"Missing platform-specific dependency lock: {lock}")
    run(["uv", "pip", "sync", "--python", python, "--break-system-packages", "--link-mode", "copy",
         "--require-hashes", lock])
    copy_application(root)
    entries = {name: f"bin/{name}{ext}" for name in ("node", "qdrant", "ffmpeg", "ffprobe")}
    if office:
        office = office.resolve(strict=True)
        shutil.copytree(office, root / "office", symlinks=True)
        location = root / "office" / ("program/soffice.exe" if windows else "Contents/MacOS/soffice")
        if not location.is_file():
            raise ValueError("Pass the installed LibreOffice directory or macOS app bundle")
        entries["office"] = location.relative_to(root).as_posix()
    manifest = {
        "format": 1, "version": "0.1.0", "platform": target, "apiProtocol": 1, "workspaceFormat": 1,
        "executables": {"python": python_rel, **entries}, "sources": sources, "pythonLockSHA256": sha256(lock),
        "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
    }
    (root / "runtime.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    shutil.copy2(lock, licenses / "python-dependencies.txt")
    run([python, "-I", HERE / "inventory.py", root])
    # Clean-machine sanity checks use only the assembled executables and package resources.
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1"}
    run([python, "-I", "-c", "import fastapi, pymupdf, openpyxl, torch, FlagEmbedding, keyring"], env=env)
    run([root / entries["node"], "--input-type=module", "-e", "await import('./src/durable.mjs')"],
        cwd=root / "agent-runtime", env=env)
    for name, flag in (("qdrant", "--version"), ("ffprobe", "-version"), ("ffmpeg", "-version")):
        run([root / entries[name], flag], stdout=subprocess.DEVNULL, env=env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--prefetch", action="store_true")
    parser.add_argument("--office", type=Path)
    args = parser.parse_args()
    target = native_target()
    sources = SOURCES[target]
    cache = args.cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        pending = {name: pool.submit(fetch, cache, rec) for name, rec in sources.items()}
        downloads = {name: future.result() for name, future in pending.items()}
    if args.prefetch:
        return
    out = args.output.resolve()
    if out.exists():
        parser.error(f"Output already exists: {out}")
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out.parent) as staging:
        root = Path(staging) / "runtime"
        root.mkdir()
        assemble(root, downloads, sources, target, args.office)
        root.rename(out)
    print(out)


if __name__ == "__main__":
    main()
