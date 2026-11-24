"""Real isolated MinIO -> native Qdrant migration, backup and old-reference HTTP acceptance."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import asdict
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import secrets
import subprocess
import sys
import time
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from app.modules.desktop_transfer import archive, migration
from app.modules.pi_agent.catalog import SourceCatalog
from app.modules.pi_agent.store import RunStore
from minio import Minio
from qdrant_client import models
import httpx
import urllib3


def command(args, **kwargs):
    return subprocess.run([str(item) for item in args], check=True, capture_output=True, text=True, **kwargs).stdout.strip()


def vector_snapshot(client):
    result = {"collections": {}, "aliases": sorted((row.alias_name, row.collection_name) for row in client.get_aliases().aliases)}
    for collection in client.get_collections().collections:
        info = client.get_collection(collection.name)
        points = [point for batch in migration._points(client, collection.name) for point in batch]
        result["collections"][collection.name] = {
            "params": migration._dump(info.config.params), "schema": migration._dump(info.payload_schema),
            "points": sorted((str(point.id), migration._point_digest(point)) for point in points),
        }
    return result


@contextmanager
def isolated_minio(context, image, output):
    name = "tessmora-qa-minio-" + uuid4().hex[:12]
    user, password = "tessmora-qa", secrets.token_hex(24)
    data = (output / "minio-source").resolve()
    data.mkdir()
    docker = ["docker", "--context", context]
    created = False
    pool = urllib3.PoolManager(timeout=urllib3.Timeout(connect=3, read=20), retries=False)
    try:
        image_id = command([*docker, "image", "inspect", image, "--format", "{{.Id}}"])
        command([*docker, "run", "--rm", "--detach", "--name", name,
                 "--publish", "127.0.0.1::9000", "--env", f"MINIO_ROOT_USER={user}",
                 "--env", f"MINIO_ROOT_PASSWORD={password}",
                 "--mount", f"type=bind,source={data},target=/data", image, "server", "/data", "--console-address", ":9001"])
        created = True
        address = command([*docker, "port", name, "9000/tcp"]).splitlines()[0]
        assert address.startswith("127.0.0.1:")
        client = Minio(address, access_key=user, secret_key=password, secure=False, region="us-east-1", http_client=pool)
        deadline = time.monotonic() + 40
        while True:
            try:
                client.list_buckets()
                break
            except Exception:
                if time.monotonic() > deadline:
                    raise RuntimeError("Isolated MinIO did not become ready") from None
                time.sleep(0.2)
        yield client, "http://" + address, user, password, image_id
    finally:
        if created:
            command([*docker, "rm", "--force", name])
        pool.clear()


@contextmanager
def restored_api(workspace, qdrant, runtime, output):
    # These are QA-owned clients and credentials created above; no developer env
    # or source configuration is loaded into the isolated application process.
    token = secrets.token_hex(32)
    port_file = output / "api-port"
    manifest = json.loads((runtime / "runtime.json").read_text())
    environment = {key: value for key, value in os.environ.items() if key in {"PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR"}}
    environment.update({"PYTHONPATH": str(ROOT / "backend"), "TESSMORA_RUNTIME_PROFILE": "desktop",
        "TESSMORA_STATE_DIR": str(workspace / "state"), "TESSMORA_WORKSPACE_ID": archive.workspace_identity(workspace)["id"],
        "TESSMORA_DESKTOP_TOKEN": token, "TESSMORA_SETUP_TOKEN": token, "PI_AGENT_API_TOKEN": token,
        "PI_AGENT_NODE_BINARY": str(runtime / manifest["executables"]["node"]),
        "QDRANT_HOST": "127.0.0.1", "QDRANT_PORT": str(qdrant._client._port), "QDRANT_API_KEY": qdrant._client._api_key,
        "PRELOAD_LOCAL_MODELS_ON_STARTUP": "false", "HF_HOME": str(output / "empty-model-cache"),
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "EVALUATION_MODE": "true"})
    process = None
    with (output / "restored-api.log").open("wb") as log:
        try:
            process = subprocess.Popen([str(runtime / manifest["executables"]["python"]),
                str(ROOT / "backend" / "desktop_host.py"), "--api", str(port_file)],
                stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, env=environment, cwd=output)
            deadline = time.monotonic() + 60
            with httpx.Client(trust_env=False, timeout=30) as http:
                while True:
                    if process.poll() is not None:
                        raise RuntimeError("Restored application exited; inspect the private QA log")
                    if port_file.exists():
                        base = "http://127.0.0.1:" + port_file.read_text().strip()
                        try:
                            response = http.get(base + "/health", headers={"Authorization": "Bearer " + token})
                            if response.status_code == 200:
                                break
                        except httpx.HTTPError:
                            pass
                    if time.monotonic() > deadline:
                        raise RuntimeError("Restored application readiness timed out")
                    time.sleep(0.2)
                yield http, base, {"Authorization": "Bearer " + token}
        finally:
            if process and process.poll() is None:
                process.stdin.close()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=10)


def seed(objects, vectors, fixtures, source_data):
    kb = "11111111-2222-3333-4444-555555555555"
    bucket = "kb-" + kb
    objects.make_bucket(bucket)
    meta = json.dumps({"id": kb, "name": "Synthetic migration acceptance", "description": "No user data",
                       "created_at": "2026-11-24T00:00:00", "updated_at": "2026-11-24T00:00:00"}).encode()
    objects.put_object(bucket, ".kb_meta.json", io.BytesIO(meta), len(meta), content_type="application/json")
    entries = {}
    for index, (name, prefix, content_type) in enumerate((("manual.pdf", "documents", "application/pdf"),
        ("blue-marker.png", "images", "image/png"), ("tone.wav", "audios", "audio/wav"), ("recording.mp4", "videos", "video/mp4")), 1):
        file_id = f"00000000-0000-0000-0000-{index:012d}"
        data = (fixtures / name).read_bytes()
        key = f"{prefix}/{file_id}_{name}"
        result = objects.put_object(bucket, key, io.BytesIO(data), len(data), content_type=content_type)
        entries[prefix] = {"name": name, "file_id": file_id, "key": key, "etag": result.etag,
                           "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                           "old_url": objects.presigned_get_object(bucket, key)}
    multipart = b"multipart-acceptance\n" * (1024 * 1024)
    multi_key = "documents/00000000-0000-0000-0000-000000000005_large.bin"
    multi = objects.put_object(bucket, multi_key, io.BytesIO(multipart), len(multipart), part_size=5 * 1024 * 1024)
    assert "-" in multi.etag
    entries["multipart"] = {"key": multi_key, "etag": multi.etag, "sha256": hashlib.sha256(multipart).hexdigest(), "bytes": len(multipart)}
    dense = lambda size: [1.0] + [0.0] * (size - 1)
    vectors.create_collection("text_chunks_agentic", vectors_config=models.VectorParams(size=4096, distance=models.Distance.COSINE),
                              sparse_vectors_config={"sparse": models.SparseVectorParams()})
    vectors.upsert("text_chunks_agentic", wait=True, points=[models.PointStruct(id=11, vector={"": dense(4096),
        "sparse": models.SparseVector(indices=[17], values=[1.0])}, payload={"kb_id": kb, "file_id": entries["documents"]["file_id"],
        "file_path": entries["documents"]["key"], "file_type": "pdf", "text_content": "Recovery code: CEDAR-17", "chunk_index": 0,
        "metadata": {"page": 2, "page_number": 2}})])
    vectors.create_collection("video_shot_vectors", vectors_config={name: models.VectorParams(size=4096, distance=models.Distance.COSINE)
        for name in ("caption_dense", "asr_dense")}, sparse_vectors_config={name: models.SparseVectorParams() for name in ("caption_sparse", "asr_sparse")})
    vectors.upsert("video_shot_vectors", wait=True, points=[models.PointStruct(id=42, vector={"caption_dense": dense(4096),
        "asr_dense": dense(4096), "caption_sparse": models.SparseVector(indices=[6], values=[1.0]),
        "asr_sparse": models.SparseVector(indices=[8], values=[1.0])}, payload={"kb_id": kb, "file_id": entries["videos"]["file_id"],
        "file_path": entries["videos"]["key"], "shot_start_time": 6.0, "shot_end_time": 8.0, "caption": "Blue marker and a tone"})])
    vectors.create_payload_index("video_shot_vectors", "kb_id", models.PayloadSchemaType.KEYWORD, wait=True)
    vectors.update_collection_aliases(change_aliases_operations=[models.CreateAliasOperation(create_alias=models.CreateAlias(
        collection_name="text_chunks_agentic", alias_name="legacy-texts"))])
    (source_data / "state").mkdir(parents=True)
    (source_data / "state" / "setup.json").write_text(json.dumps({"version": 1, "capabilities": ["text", "image", "audio", "video"],
        "credentials": {"deepseek": "SYNTHETIC-SECRET-MUST-NOT-MIGRATE"}}))
    store = RunStore(source_data / "pi-agent" / "runs.sqlite3")
    run, _ = store.create(owner="configured-workspace", request={"client_request_id": "native-migration", "session_id": "old-session"}, config={"runtime": "durable"})
    catalog = SourceCatalog.load(objects)
    store.put_artifact(run["id"], "_sources", [asdict(source) for source in catalog.sources.values()])
    store.transition(run["id"], "running")
    store.transition(run["id"], "completed")
    pdf_source = catalog.by_file[entries["documents"]["file_id"]][0]
    return kb, bucket, entries, run["id"], pdf_source.id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--docker-context", required=True)
    parser.add_argument("--minio-image", required=True)
    args = parser.parse_args()
    args.runtime, args.fixtures, args.output = args.runtime.resolve(), args.fixtures.resolve(), args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    report = {"ok": False, "started_at": time.time(), "cloud_calls": 0, "synthetic_data_only": True, "assertions": [],
              "platform": platform.platform(), "python": sys.version.split()[0],
              "application_source": "Current checkout backend, bundled Python and native executables"}
    manifest = json.loads((args.runtime / "runtime.json").read_text())
    executable = args.runtime / manifest["executables"]["qdrant"]
    source_service, source_data = args.output / "source-index", args.output / "legacy-data"
    source_service.mkdir()
    source_data.mkdir()
    started = time.perf_counter()
    try:
        with isolated_minio(args.docker_context, args.minio_image, args.output) as (objects, endpoint, user, password, image_id):
            report["minio_image_id"] = image_id
            with migration.temporary_qdrant(executable, source_service) as vectors:
                kb, bucket, entries, run_id, source_id = seed(objects, vectors, args.fixtures, source_data)
                report["qdrant_version"] = vectors.info().version
                original_inventory = [(b, row.object_name, row.etag, row.size) for b, row in migration._inventory(objects)]
                original_vectors = vector_snapshot(vectors)
                print("isolated real MinIO and Qdrant seeded", flush=True)
                destination = args.output / "migrated"
                env = {**os.environ, "PYTHONPATH": str(ROOT / "backend"), "TESSMORA_MIGRATION_MINIO_ACCESS_KEY": user,
                       "TESSMORA_MIGRATION_MINIO_SECRET_KEY": password, "TESSMORA_MIGRATION_QDRANT_API_KEY": vectors._client._api_key}
                response = command([sys.executable, "-m", "app.modules.desktop_transfer", "migrate",
                    "--source-data-dir", source_data, "--destination", destination, "--minio-endpoint", endpoint,
                    "--qdrant-url", vectors._client.rest_uri, "--qdrant-executable", executable, "--source-frozen"], env=env)
                migrated = json.loads(response)
                assert migrated["ok"] and migrated["objects"] == 6
                assert original_inventory == [(b, row.object_name, row.etag, row.size) for b, row in migration._inventory(objects)]
                assert original_vectors == vector_snapshot(vectors)
                report["assertions"].append("CLI migrated six real S3 objects including multipart ETag; original source inventory and indexes unchanged")
            print("real API migration passed", flush=True)
            backup_file = args.output / "migration-backup.zip"
            report["backup"] = archive.backup(destination, backup_file)
            archive.verify(backup_file)
            restored = args.output / "restored"
            report["restore"] = archive.restore(backup_file, restored)
            assert b"SYNTHETIC-SECRET" not in (restored / "state" / "setup.json").read_bytes()
            from app.modules.ingestion.storage.local_objects import LocalObjectClient
            local = LocalObjectClient(restored / "state" / "objects")
            for entry in entries.values():
                assert local.stat_object(bucket, entry["key"]).etag == entry["etag"]
                stream = local.get_object(bucket, entry["key"])
                try:
                    digest = hashlib.sha256()
                    for block in stream.stream():
                        digest.update(block)
                    assert digest.hexdigest() == entry["sha256"]
                finally:
                    stream.close()
            report["assertions"].append("Backup/restore preserved original SHA256, multipart ETags and workspace identity while removing application credentials")
            with migration.temporary_qdrant(executable, restored) as target:
                record = target.retrieve("video_shot_vectors", ids=[42], with_vectors=True)[0]
                assert record.payload["shot_start_time"] == 6.0 and record.payload["shot_end_time"] == 8.0
                assert target.get_aliases().aliases[0].alias_name == "legacy-texts"
                query = target.query_points("video_shot_vectors", using="caption_sparse", query=models.SparseVector(indices=[6], values=[1.0]))
                assert query.points[0].id == 42
                with restored_api(restored, target, args.runtime, args.output) as (http, base, headers):
                    assert http.get(base + "/api/knowledge/").status_code == 401
                    for prefix, kind, field in (("images", "image", "img_url"), ("audios", "audio", "audio_url"), ("videos", "video", "video_url")):
                        response = http.post(base + f"/api/chat/reference-{kind}-url", headers=headers,
                                             json={"kb_id": kb, "file_path": entries[prefix]["old_url"]})
                        response.raise_for_status()
                        link = response.json()[field]
                        assert link.startswith("/api/objects/")
                        partial = http.get(base + link, headers={"Range": "bytes=0-31"})
                        assert partial.status_code == 206 and len(partial.content) == 32
                        assert partial.content == (args.fixtures / entries[prefix]["name"]).read_bytes()[:32]
                        assert http.head(base + link).status_code == 200
                    pdf = http.get(base + f"/api/knowledge/{kb}/files/{entries['documents']['file_id']}/stream", headers=headers)
                    pdf.raise_for_status()
                    import pymupdf
                    with pymupdf.open(stream=pdf.content, filetype="pdf") as document:
                        assert "CEDAR-17" in document[1].get_text()
                    old_pi = http.get(base + f"/api/pi/runs/{run_id}/sources/{source_id}/content", headers=headers)
                    old_pi.raise_for_status()
                    assert hashlib.sha256(old_pi.content).hexdigest() == entries["documents"]["sha256"]
                    assert http.get(base + "/api/objects/" + bucket + "/" + entries["documents"]["key"]).status_code == 403
            report["assertions"].append("Restored real FastAPI refreshed old MinIO image/audio/video URLs; signed Range/HEAD succeeded and unsigned objects were rejected")
            report["assertions"].append("Original PDF page 2 marker and saved Pi source HTTP preview survived migration/restoration; video 6–8 second locator, point ID and sparse retrieval preserved")
            report["source_objects"] = {name: {key: value for key, value in row.items() if key != "old_url"} for name, row in entries.items()}
            report["ok"] = True
        report["isolated_minio_removed"] = True
    except BaseException as error:
        report["failure_type"] = type(error).__name__
        raise
    finally:
        report["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        (args.output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"ok": True, "report": str(args.output / "report.json")}), flush=True)


if __name__ == "__main__":
    main()
