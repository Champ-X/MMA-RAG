"""Read-only API import from a frozen CLI/Compose instance into a new workspace."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import time
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from minio import Minio
from qdrant_client import QdrantClient, models

from app.modules.ingestion.storage.local_objects import LocalObjectClient
from .archive import TransferError, copy_data_tree, json_bytes, new_workspace, validate_objects, rewrite_owned_paths


def _source_url(value: str):
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise TransferError("Source storage address must be an HTTP(S) origin without credentials")
    if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise TransferError("Non-loopback source storage requires HTTPS")
    return parsed


def _inventory(client):
    for bucket in sorted(client.list_buckets(), key=lambda row: row.name):
        for obj in client.list_objects(bucket.name, recursive=True):
            yield bucket.name, obj


def _inventory_record(bucket, obj) -> bytes:
    return json_bytes([bucket, obj.object_name, obj.size, obj.etag])


def import_objects(source, destination: LocalObjectClient) -> dict:
    inventory = hashlib.sha256()
    count, total = 0, 0
    for bucket in sorted(source.list_buckets(), key=lambda row: row.name):
        destination.make_bucket(bucket.name)
        try:
            tags = source.get_bucket_tags(bucket.name)
        except Exception as error:
            if getattr(error, "code", None) == "NoSuchTagSet":
                tags = {}
            else:
                raise
        if tags:
            destination.set_bucket_tags(bucket.name, tags)
        for obj in source.list_objects(bucket.name, recursive=True):
            inventory.update(_inventory_record(bucket.name, obj))
            original = source.stat_object(bucket.name, obj.object_name)
            if original.size != obj.size or original.etag != obj.etag:
                raise TransferError("Source objects changed; freeze the source and retry")
            response = source.get_object(bucket.name, obj.object_name, request_headers={"If-Match": obj.etag})
            try:
                destination.put_object(bucket.name, obj.object_name, response, obj.size,
                                       content_type=original.content_type or "application/octet-stream", source_etag=obj.etag)
            finally:
                response.close()
                response.release_conn()
            count += 1
            total += obj.size
    after = hashlib.sha256()
    for bucket, obj in _inventory(source):
        after.update(_inventory_record(bucket, obj))
    if after.digest() != inventory.digest():
        raise TransferError("Source object inventory changed during migration")
    return {"objects": count, "bytes": total, "source_inventory_sha256": inventory.hexdigest()}


def _dump(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", exclude_none=True)
    if isinstance(value, dict):
        return {key: _dump(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_dump(item) for item in value]
    return value


def _points(client, collection):
    offset, previous = None, set()
    while True:
        points, offset = client.scroll(collection_name=collection, offset=offset, limit=256,
                                       with_vectors=True, with_payload=True)
        yield points
        if offset is None:
            break
        marker = str(offset)
        if marker in previous:
            raise TransferError("Vector export returned a non-advancing cursor")
        previous.add(marker)


def _point_digest(point):
    # Qdrant's float32 values round-trip through the same JSON/SDK representation.
    value = {"id": point.id, "vector": _dump(point.vector), "payload": point.payload or {}}
    return int.from_bytes(hashlib.sha256(json_bytes(value)).digest(), "big")


def _reference_exists(objects, payload):
    kb, raw = payload.get("kb_id"), payload.get("file_path")
    if not kb or not raw or not isinstance(raw, str):
        return True  # Portrait and routing points need not refer to an original file.
    raw = unquote(urlsplit(raw).path) if raw.startswith(("http://", "https://")) else raw
    raw = raw.lstrip("/")
    if raw.startswith("api/objects/"):
        raw = raw[len("api/objects/"):]
    clean = str(kb).lower().replace("_", "-")
    canonical = "".join(char for char in clean if char in "abcdefghijklmnopqrstuvwxyz0123456789-")[:60].strip("-") or "kb-default"
    legacy = "".join(char for char in clean if char in "abcdefghijklmnopqrstuvwxyz0-9-")[:63].strip("-") or "kb-default"
    buckets = [str(kb), f"kb-{canonical}", f"kb-{legacy}"]
    candidates = [raw]
    if "/" in raw:
        candidates.append(raw.split("/", 1)[1])
    for bucket in buckets:
        for key in candidates:
            try:
                objects.stat_object(bucket, key)
                return True
            except Exception as error:
                if getattr(error, "code", None) not in {"NoSuchKey", "NoSuchBucket", "InvalidBucketName", "InvalidObjectName"}:
                    raise
    return False


def import_vectors(source, destination, objects: LocalObjectClient) -> dict:
    source_version, target_version = source.info().version, destination.info().version
    if source_version != target_version:
        raise TransferError(f"Qdrant versions must match for migration: source={source_version}, destination={target_version}")
    names = sorted(row.name for row in source.get_collections().collections)
    results = []
    for name in names:
        info = source.get_collection(name)
        params = info.config.params
        if getattr(params, "sharding_method", None) == models.ShardingMethod.CUSTOM:
            raise TransferError("Custom-sharded Qdrant collections need an explicit migration plan")
        config = info.config
        options = {"vectors_config": params.vectors, "sparse_vectors_config": params.sparse_vectors,
                   "shard_number": 1, "replication_factor": 1, "write_consistency_factor": 1,
                   "on_disk_payload": params.on_disk_payload}
        for key, model in (("hnsw_config", models.HnswConfigDiff), ("optimizer_config", models.OptimizersConfigDiff),
                           ("wal_config", models.WalConfigDiff)):
            value = getattr(config, key, None)
            if value is not None:
                options["optimizers_config" if key == "optimizer_config" else key] = model(**_dump(value))
        if getattr(config, "quantization_config", None) is not None:
            options["quantization_config"] = config.quantization_config
        destination.create_collection(collection_name=name, **options)
        count, checksum = 0, 0
        for batch in _points(source, name):
            for point in batch:
                if not _reference_exists(objects, point.payload or {}):
                    raise TransferError(f"Original object is missing for vector reference: {name}/{point.id}")
                checksum = (checksum + _point_digest(point)) % (1 << 256)
            if batch:
                destination.upsert(collection_name=name, wait=True,
                                   points=[models.PointStruct(id=point.id, vector=point.vector, payload=point.payload) for point in batch])
            count += len(batch)
        for field, schema in info.payload_schema.items():
            destination.create_payload_index(collection_name=name, field_name=field,
                                             field_schema=schema.params or schema.data_type, wait=True)
        copied_count, copied_checksum = 0, 0
        for batch in _points(destination, name):
            copied_count += len(batch)
            for point in batch:
                copied_checksum = (copied_checksum + _point_digest(point)) % (1 << 256)
        if count != copied_count or checksum != copied_checksum or count != source.count(name, exact=True).count:
            raise TransferError(f"Vector verification failed: {name}")
        if _dump(source.get_collection(name).config.params) != _dump(params):
            raise TransferError("Source vector configuration changed during migration")
        results.append({"name": name, "points": count, "content_digest": f"{checksum:064x}"})
    if names != sorted(row.name for row in source.get_collections().collections):
        raise TransferError("Source vector collections changed during migration")
    aliases = source.get_aliases().aliases
    if aliases:
        destination.update_collection_aliases(change_aliases_operations=[models.CreateAliasOperation(
            create_alias=models.CreateAlias(collection_name=row.collection_name, alias_name=row.alias_name)) for row in aliases])
    return {"qdrant_version": source_version, "collections": results, "aliases": len(aliases)}


@contextmanager
def temporary_qdrant(executable: Path, workspace: Path):
    executable = executable.absolute()
    if not executable.is_file():
        raise TransferError("A verified Qdrant runtime executable is required")
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    config_path, log_path = workspace / ".transfer-qdrant.yaml", workspace / ".transfer-qdrant.log"
    config_path.write_text("service:\n  grpc_port: null\n  enable_cors: false\ncluster:\n  enabled: false\nlog_level: WARN\n")
    key = secrets.token_hex(32)
    environment = {name: value for name, value in os.environ.items() if name in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"}}
    environment.update({"QDRANT__SERVICE__API_KEY": key, "QDRANT__SERVICE__HOST": "127.0.0.1",
        "QDRANT__SERVICE__HTTP_PORT": str(port), "QDRANT__STORAGE__STORAGE_PATH": str(workspace / "qdrant" / "storage"),
        "QDRANT__STORAGE__SNAPSHOTS_PATH": str(workspace / "qdrant" / "snapshots"), "QDRANT__TELEMETRY_DISABLED": "true"})
    client = QdrantClient(host="127.0.0.1", port=port, https=False, api_key=key, timeout=30, trust_env=False, check_compatibility=False)
    process = None
    try:
        with log_path.open("wb") as output:
            process = subprocess.Popen([str(executable), "--config-path", str(config_path)], cwd=workspace,
                                       env=environment, stdout=output, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 30
            while True:
                if process.poll() is not None:
                    raise TransferError("Destination Qdrant stopped before migration")
                try:
                    client.get_collections()
                    break
                except Exception:
                    if time.monotonic() > deadline:
                        raise TransferError("Destination Qdrant did not become ready") from None
                    time.sleep(0.1)
            yield client
    finally:
        client.close()
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        config_path.unlink(missing_ok=True)
        log_path.unlink(missing_ok=True)


def _relocate_pi_attachments(staging: Path, destination: Path, source_data: Path):
    database = staging / "state" / "pi-agent" / "runs.sqlite3"
    prefixes = [("/app/data/pi-agent/", "state/pi-agent/"), ("/app/backend/data/", "state/data/"),
                ("/state/", "state/"), (str(source_data / "pi-agent") + os.sep, "state/pi-agent/"),
                (str(source_data / "state") + os.sep, "state/"),
                (str(source_data / "backend-data") + os.sep, "state/data/")]
    if database.is_file():
        with sqlite3.connect(database) as db:
            # CLI uses configured-workspace; the single-user source fallback uses
            # local-workspace. No arbitrary trusted-user identities are silently merged.
            owners = {row[0] for row in db.execute("SELECT DISTINCT owner FROM pi_runs")}
            if owners - {"local-workspace", "configured-workspace"} or len(owners) > 1:
                raise TransferError("Source has custom Pi identities; configure an explicit identity migration")
            if owners == {"local-workspace"}:
                old = hashlib.sha256(b"local-workspace").hexdigest()[:32]
                new = hashlib.sha256(b"configured-workspace").hexdigest()[:32]
                uploads = staging / "state" / "pi-agent" / "uploads"
                if (uploads / old).exists():
                    if (uploads / new).exists():
                        raise TransferError("Conflicting Pi attachment owners")
                    (uploads / old).rename(uploads / new)
                for prefix, relative in list(prefixes):
                    if relative == "state/pi-agent/":
                        prefixes.insert(0, (prefix + f"uploads/{old}/", f"state/pi-agent/uploads/{new}/"))
                    elif relative == "state/":
                        prefixes.insert(0, (prefix + f"pi-agent/uploads/{old}/", f"state/pi-agent/uploads/{new}/"))
                db.execute("UPDATE pi_runs SET owner='configured-workspace'")
                db.execute("UPDATE pi_closed_sessions SET owner='configured-workspace'")
    rewrite_owned_paths(staging, prefixes, destination)


def migrate_from_clients(source_data: Path, destination: Path, source_objects, source_vectors, target_factory,
                         *, source_frozen=False, client_history: Path | None = None) -> dict:
    if not source_frozen:
        raise TransferError("Stop source application/worker writes and explicitly confirm --source-frozen")
    source_data, destination = source_data.absolute(), destination.absolute()
    if not source_data.is_dir() or source_data.is_symlink() or destination.is_relative_to(source_data):
        raise TransferError("Source and destination must be separate data directories")
    workspace_id = str(uuid4())
    with new_workspace(destination) as staging:
        copy_data_tree(source_data / "state", staging / "state")
        if (source_data / "backend-data").exists():
            copy_data_tree(source_data / "backend-data", staging / "state" / "data")
        if (source_data / "pi-agent").exists():
            copy_data_tree(source_data / "pi-agent", staging / "state" / "pi-agent")
        (staging / "state").mkdir(exist_ok=True)
        # Preparation receipts refer to another host's cache and credentials.
        (staging / "state" / "prepare.json").unlink(missing_ok=True)
        objects = LocalObjectClient(staging / "state" / "objects")
        object_result = import_objects(source_objects, objects)
        with target_factory(staging) as target:
            vector_result = import_vectors(source_vectors, target, objects)
        _relocate_pi_attachments(staging, destination, source_data)
        if client_history:
            if client_history.is_symlink() or not client_history.is_file():
                raise TransferError("Client history export must be an ordinary file")
            (staging / "client").mkdir()
            shutil.copyfile(client_history, staging / "client" / "history-export")
        (staging / "workspace.json").write_bytes(json_bytes({"format": 1, "id": workspace_id,
                                                            "qdrant_version": vector_result["qdrant_version"]}))
        counts = validate_objects(staging)
        receipt = {"format": 1, "workspace_id": workspace_id, **object_result, **vector_result,
                   "old_reference_keys_preserved": True, "credentials_included": False,
                   "client_history_included": client_history is not None}
        (staging / "state" / "migration-receipt.json").write_bytes(json_bytes(receipt))
    return {"workspace": str(destination), "workspace_id": workspace_id, **counts,
            "collections": vector_result["collections"], "credentials_required": True,
            "client_history_included": client_history is not None}


def migrate_legacy(source_data: Path, destination: Path, *, minio_endpoint: str, qdrant_url: str,
                   qdrant_executable: Path, source_frozen=False, client_history=None):
    minio_url, vector_url = _source_url(minio_endpoint), _source_url(qdrant_url)
    key = os.environ.get("TESSMORA_MIGRATION_MINIO_ACCESS_KEY")
    secret = os.environ.get("TESSMORA_MIGRATION_MINIO_SECRET_KEY")
    if not key or not secret:
        raise TransferError("Set TESSMORA_MIGRATION_MINIO_ACCESS_KEY and TESSMORA_MIGRATION_MINIO_SECRET_KEY")
    import urllib3
    pool = urllib3.PoolManager(timeout=urllib3.Timeout(connect=5, read=60), retries=False)
    objects = Minio(minio_url.netloc, access_key=key, secret_key=secret, secure=minio_url.scheme == "https",
                    region=os.environ.get("TESSMORA_MIGRATION_MINIO_REGION", "us-east-1"), http_client=pool)
    vectors = QdrantClient(url=qdrant_url, https=vector_url.scheme == "https", timeout=60, trust_env=False,
                           api_key=os.environ.get("TESSMORA_MIGRATION_QDRANT_API_KEY") or None)
    try:
        return migrate_from_clients(source_data, destination, objects, vectors,
                                    lambda staging: temporary_qdrant(qdrant_executable, staging),
                                    source_frozen=source_frozen, client_history=client_history)
    finally:
        vectors.close()
        pool.clear()
