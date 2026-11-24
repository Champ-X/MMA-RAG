"""Backup integrity, exclusive ownership and legacy identity-preserving imports."""
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
from types import SimpleNamespace
from uuid import uuid4
import zipfile

import pytest
from qdrant_client import QdrantClient, models

from app.modules.desktop_transfer import archive, migration
from app.modules.desktop_transfer.__main__ import main
from app.modules.ingestion.storage.local_objects import LocalObjectClient


@pytest.fixture
def workspace(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "workspace.json").write_text(json.dumps({"format": 1, "id": str(uuid4()), "qdrant_version": "1.16.2"}))
    client = LocalObjectClient(root / "state" / "objects")
    client.make_bucket("kb-test")
    client.put_object("kb-test", "documents/id_source.txt", io.BytesIO(b"source bytes"), 12)
    (root / "state" / "setup.json").write_text(json.dumps({"version": 1, "capabilities": ["text"],
        "credentials": {"provider": "SYNTHETIC-PRIVATE-KEY"}, "credential_ref": "SYNTHETIC-PRIVATE-REF"}))
    for name in ("logs", "cache", "state/models"):
        (root / name).mkdir(parents=True)
        (root / name / "ignored").write_text("EXCLUDED-RUNTIME-CONTENT")
    (root / "qdrant" / "collection" / "logs").mkdir(parents=True)
    (root / "qdrant" / "collection" / "logs" / "data").write_bytes(b"legitimate index bytes")
    return root, client


def _pi_attachment(root, path, *, owner="configured-workspace"):
    payload = b"attachment data"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    database = root / "state" / "pi-agent" / "runs.sqlite3"
    database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as db:
        db.executescript("CREATE TABLE pi_artifacts(run_id TEXT,id TEXT,artifact_json TEXT);"
                         "CREATE TABLE pi_runs(id TEXT,owner TEXT);CREATE TABLE pi_closed_sessions(owner TEXT);")
        db.execute("INSERT INTO pi_runs VALUES ('run-1',?)", (owner,))
        db.execute("INSERT INTO pi_artifacts VALUES ('run-1','_sources',?)", (json.dumps([{
            "id": "stable-source", "attachment_id": "same-name-attachment", "name": "same.png", "local_path": str(path),
            "size": len(payload), "version": hashlib.sha256(payload).hexdigest()}]),))
    return database


def test_backup_restore_keeps_ids_bytes_and_wal_but_excludes_credentials(workspace, tmp_path):
    root, client = workspace
    attachment = root / "state" / "pi-agent" / "uploads" / "owner" / "content"
    _pi_attachment(root, attachment)
    collection = root / "state" / "data" / "collection"
    (collection / "payloads").mkdir(parents=True)
    payload = collection / "payloads" / "item.bin"
    payload.write_bytes(b"download awaiting ingestion")
    with sqlite3.connect(collection / "runs.sqlite3") as db:
        db.execute("CREATE TABLE collection_runs(state_json TEXT)")
        db.execute("INSERT INTO collection_runs VALUES (?)", (json.dumps({"id": "collection-1", "items": [{"_payload": str(payload)}]}),))
    ledger = root / "state" / "jobs.sqlite3"
    writer = sqlite3.connect(ledger)
    writer.execute("PRAGMA journal_mode=WAL")
    writer.execute("CREATE TABLE jobs(id TEXT)")
    writer.execute("INSERT INTO jobs VALUES ('durable-job')")
    writer.commit()
    history = tmp_path / "history.tessmora-chat"
    history.write_bytes(b"TESSMORA-CHAT\nopaque-attachment-bytes")
    try:
        receipt = archive.backup(root, tmp_path / "backup.zip", client_history=history)
    finally:
        writer.close()
    assert receipt["credentials_included"] is False and receipt["client_history_included"] is True
    with zipfile.ZipFile(tmp_path / "backup.zip") as bundle:
        contents = b"".join(bundle.read(name) for name in bundle.namelist())
        assert b"SYNTHETIC-PRIVATE" not in contents and b"EXCLUDED-RUNTIME-CONTENT" not in contents
        assert "qdrant/collection/logs/data" in bundle.namelist()
        assert not any(name.endswith(("-wal", "-shm", ".lock")) for name in bundle.namelist())
    restored = tmp_path / "restored"
    result = archive.restore(tmp_path / "backup.zip", restored)
    assert result["workspace_id"] == json.loads((root / "workspace.json").read_text())["id"]
    assert result["objects"] == 1 and result["credentials_required"] is True
    assert Path(result["client_history_path"]).suffix == ".tessmora-chat"
    assert Path(result["client_history_path"]).read_bytes() == history.read_bytes()
    with sqlite3.connect(restored / "state" / "jobs.sqlite3") as db:
        assert db.execute("SELECT id FROM jobs").fetchone()[0] == "durable-job"
    with sqlite3.connect(restored / "state" / "pi-agent" / "runs.sqlite3") as db:
        saved = json.loads(db.execute("SELECT artifact_json FROM pi_artifacts").fetchone()[0])[0]
    assert saved["id"] == "stable-source"
    assert saved["local_path"] == str(restored / "state" / "pi-agent" / "uploads" / "owner" / "content")
    assert Path(saved["local_path"]).read_bytes() == attachment.read_bytes()
    with sqlite3.connect(restored / "state" / "data" / "collection" / "runs.sqlite3") as db:
        pending = json.loads(db.execute("SELECT state_json FROM collection_runs").fetchone()[0])
    assert Path(pending["items"][0]["_payload"]).read_bytes() == b"download awaiting ingestion"


def test_backup_requires_exclusive_workspace_ownership(workspace, tmp_path):
    root, _ = workspace
    with archive.workspace_lock(root):
        with pytest.raises(archive.TransferError, match="running"):
            archive.backup(root, tmp_path / "busy.zip")
    assert not (tmp_path / "busy.zip").exists()


def test_corruption_missing_objects_and_existing_targets_are_not_accepted(workspace, tmp_path):
    root, client = workspace
    backup_path = tmp_path / "backup.zip"
    archive.backup(root, backup_path)
    with pytest.raises(archive.TransferError, match="already exists"):
        archive.restore(backup_path, root)
    damaged = tmp_path / "damaged.zip"
    with zipfile.ZipFile(backup_path) as original, zipfile.ZipFile(damaged, "w") as modified:
        for info in original.infolist():
            data = original.read(info)
            if info.filename.startswith("state/objects/"):
                data = b"X" * len(data)
            modified.writestr(info, data)
    with pytest.raises(archive.TransferError, match="checksum"):
        archive.restore(damaged, tmp_path / "not-published")
    assert not (tmp_path / "not-published").exists()
    info = client.stat_object("kb-test", "documents/id_source.txt")
    (client.root / "kb-test" / info.etag).unlink()
    with pytest.raises(archive.TransferError, match="Missing or damaged object"):
        archive.backup(root, tmp_path / "incomplete.zip")
    assert not (tmp_path / "incomplete.zip").exists()


def test_links_traversal_and_unmanifested_entries_are_rejected(workspace, tmp_path):
    root, _ = workspace
    (root / "state" / "linked").symlink_to(tmp_path)
    with pytest.raises(archive.TransferError, match="Symbolic links"):
        archive.backup(root, tmp_path / "linked.zip")
    (root / "state" / "linked").unlink()
    archive.backup(root, tmp_path / "good.zip")
    with zipfile.ZipFile(tmp_path / "good.zip", "a") as bundle:
        bundle.writestr("../outside", b"not allowed")
    with pytest.raises(archive.TransferError, match="manifest"):
        archive.restore(tmp_path / "good.zip", tmp_path / "new")
    assert not (tmp_path / "outside").exists()


def test_cli_backup_verify_restore_and_failed_reuse_are_machine_readable(workspace, tmp_path, capsys):
    root, _ = workspace
    path = tmp_path / "cli.zip"
    assert main(["backup", "--workspace", str(root), "--output", str(path)]) == 0
    assert json.loads(capsys.readouterr().out)["ok"] is True
    assert main(["verify", "--archive", str(path)]) == 0
    assert json.loads(capsys.readouterr().out)["client_history_included"] is False
    assert main(["restore", "--archive", str(path), "--destination", str(tmp_path / "cli-restored")]) == 0
    assert json.loads(capsys.readouterr().out)["credentials_required"] is True
    assert main(["backup", "--workspace", str(root), "--output", str(path)]) == 1
    assert json.loads(capsys.readouterr().err)["error"] == "transfer_failed"


class VectorFixture:
    """Real Qdrant SDK local engine for deterministic API/point-contract tests."""
    def __init__(self):
        self.client = QdrantClient(location=":memory:")
    def info(self):
        return SimpleNamespace(version="1.16.2")
    def __getattr__(self, name):
        return getattr(self.client, name)


@pytest.fixture
def legacy(tmp_path):
    source_data = tmp_path / "legacy"
    (source_data / "state").mkdir(parents=True)
    (source_data / "state" / "setup.json").write_text(json.dumps({"version": 1, "credentials": {"provider": "OLD-SECRET"}}))
    source_objects = LocalObjectClient(tmp_path / "legacy-s3")
    source_objects.make_bucket("kb-12345678")
    key = "documents/11111111-1111-1111-1111-111111111111_original.pdf"
    source_objects.put_object("kb-12345678", key, io.BytesIO(b"pdf source"), 10, source_etag="legacy-multipart-2")
    source_vectors, target = VectorFixture(), VectorFixture()
    source_vectors.create_collection("text_chunks_agentic", vectors_config={"dense": models.VectorParams(size=2, distance=models.Distance.COSINE)},
                                     sparse_vectors_config={"sparse": models.SparseVectorParams()})
    source_vectors.upsert("text_chunks_agentic", points=[models.PointStruct(id=7, vector={"dense": [1.0, 0.0],
        "sparse": models.SparseVector(indices=[3, 9], values=[0.25, 0.5])},
        payload={"kb_id": "12345678", "file_id": "11111111-1111-1111-1111-111111111111", "file_path": key, "page": 4})])
    source_vectors.update_collection_aliases(change_aliases_operations=[models.CreateAliasOperation(
        create_alias=models.CreateAlias(collection_name="text_chunks_agentic", alias_name="texts"))])
    @contextmanager
    def target_factory(stage):
        (stage / "qdrant").mkdir()
        yield target
    try:
        yield source_data, source_objects, source_vectors, target, target_factory, key
    finally:
        source_vectors.close()
        target.close()


def test_legacy_import_preserves_original_etag_vector_ids_sparse_and_citation_positions(legacy, tmp_path):
    source_data, objects, vectors, target, factory, key = legacy
    destination = tmp_path / "migrated"
    result = migration.migrate_from_clients(source_data, destination, objects, vectors, factory, source_frozen=True)
    assert result["objects"] == 1 and result["client_history_included"] is False
    local = LocalObjectClient(destination / "state" / "objects")
    assert local.stat_object("kb-12345678", key).etag == "legacy-multipart-2"
    response = local.get_object("kb-12345678", key, request_headers={"If-Match": "legacy-multipart-2"})
    assert response.read() == b"pdf source"
    response.close()
    copied = target.retrieve("text_chunks_agentic", ids=[7], with_vectors=True)[0]
    assert copied.id == 7 and copied.payload["page"] == 4 and copied.payload["file_path"] == key
    assert copied.vector["sparse"].indices == [3, 9]
    assert target.get_aliases().aliases[0].alias_name == "texts"
    assert "OLD-SECRET" not in (destination / "state" / "setup.json").read_text()
    assert "OLD-SECRET" in (source_data / "state" / "setup.json").read_text()
    assert objects.stat_object("kb-12345678", key).etag == "legacy-multipart-2"


def test_legacy_pi_owner_and_attachment_paths_move_together(legacy, tmp_path):
    source, objects, vectors, target, factory, key = legacy
    owner_directory = hashlib.sha256(b"local-workspace").hexdigest()[:32]
    source_attachment = source / "pi-agent" / "uploads" / owner_directory / "content"
    _pi_attachment(source, source_attachment, owner="local-workspace")
    destination = tmp_path / "owner-migration"
    migration.migrate_from_clients(source, destination, objects, vectors, factory, source_frozen=True)
    with sqlite3.connect(destination / "state" / "pi-agent" / "runs.sqlite3") as db:
        assert db.execute("SELECT owner FROM pi_runs").fetchone()[0] == "configured-workspace"
        migrated = json.loads(db.execute("SELECT artifact_json FROM pi_artifacts").fetchone()[0])[0]
    assert Path(migrated["local_path"]).read_bytes() == source_attachment.read_bytes()
    assert hashlib.sha256(b"configured-workspace").hexdigest()[:32] in migrated["local_path"]


def test_interrupted_migration_can_be_repeated_without_mutating_source(legacy, tmp_path):
    source, objects, vectors, _, _, key = legacy
    @contextmanager
    def interrupted(_stage):
        raise KeyboardInterrupt("synthetic interruption")
        yield
    with pytest.raises(KeyboardInterrupt):
        migration.migrate_from_clients(source, tmp_path / "interrupted", objects, vectors, interrupted, source_frozen=True)
    assert not (tmp_path / "interrupted").exists()
    @contextmanager
    def fresh(_stage):
        target = VectorFixture()
        try:
            yield target
        finally:
            target.close()
    receipts = [migration.migrate_from_clients(source, tmp_path / f"retry-{attempt}", objects, vectors, fresh,
                                               source_frozen=True) for attempt in (1, 2)]
    assert receipts[0]["collections"] == receipts[1]["collections"]
    assert objects.stat_object("kb-12345678", key).etag == "legacy-multipart-2"
    assert vectors.count("text_chunks_agentic", exact=True).count == 1


def test_migration_rejects_unfrozen_missing_original_and_wrong_engine_without_publishing(legacy, tmp_path):
    source, objects, vectors, target, factory, key = legacy
    destination = tmp_path / "migrated"
    with pytest.raises(archive.TransferError, match="freeze|frozen"):
        migration.migrate_from_clients(source, destination, objects, vectors, factory)
    objects.remove_object("kb-12345678", key)
    with pytest.raises(archive.TransferError, match="Original object is missing"):
        migration.migrate_from_clients(source, destination, objects, vectors, factory, source_frozen=True)
    assert not destination.exists() and not list(tmp_path.glob(".migrated.transfer-*"))


def test_legacy_inventory_change_is_detected_before_any_publication(tmp_path):
    source, destination = LocalObjectClient(tmp_path / "s3"), LocalObjectClient(tmp_path / "objects")
    source.make_bucket("kb-source")
    source.put_object("kb-source", "original", io.BytesIO(b"a"), 1)
    original = source.list_objects
    calls = 0
    def changed(*args, **kwargs):
        nonlocal calls
        calls += 1
        rows = list(original(*args, **kwargs))
        if calls == 2:
            rows[0].etag = "changed"
        return iter(rows)
    source.list_objects = changed
    with pytest.raises(archive.TransferError, match="inventory changed"):
        migration.import_objects(source, destination)


@pytest.mark.skipif(not os.environ.get("TESSMORA_TEST_QDRANT"), reason="Set TESSMORA_TEST_QDRANT to a verified native binary")
def test_native_qdrant_migration_backup_restore_and_real_queries(tmp_path):
    executable = Path(os.environ["TESSMORA_TEST_QDRANT"])
    source_data = tmp_path / "legacy-data"
    source_data.mkdir()
    source_service = tmp_path / "source-service"
    source_service.mkdir()
    objects = LocalObjectClient(tmp_path / "s3-originals")
    objects.make_bucket("kb-native")
    object_path = "videos/11111111-1111-1111-1111-111111111111_original.mp4"
    objects.put_object("kb-native", object_path, io.BytesIO(b"synthetic-video-source"), 22, source_etag="original-etag-1")
    with migration.temporary_qdrant(executable, source_service) as source:
        source.create_collection("video_shot_vectors", vectors_config={"caption_dense": models.VectorParams(size=2, distance=models.Distance.COSINE)},
                                 sparse_vectors_config={"caption_sparse": models.SparseVectorParams()})
        source.create_payload_index("video_shot_vectors", "kb_id", models.PayloadSchemaType.KEYWORD, wait=True)
        source.upsert("video_shot_vectors", wait=True, points=[models.PointStruct(id=42,
            vector={"caption_dense": [1.0, 0.0], "caption_sparse": models.SparseVector(indices=[2], values=[1.0])},
            payload={"kb_id": "native", "file_path": object_path, "file_id": "11111111-1111-1111-1111-111111111111",
                     "shot_start_time": 12.5, "shot_end_time": 16.0})])
        destination = tmp_path / "native-desktop"
        result = migration.migrate_from_clients(source_data, destination, objects, source,
            lambda staging: migration.temporary_qdrant(executable, staging), source_frozen=True)
        assert result["objects"] == 1 and source.count("video_shot_vectors", exact=True).count == 1
    archive.backup(destination, tmp_path / "native.zip")
    restored = tmp_path / "restored-native"
    archive.restore(tmp_path / "native.zip", restored)
    with migration.temporary_qdrant(executable, restored) as target:
        response = target.query_points("video_shot_vectors", query=[1.0, 0.0], using="caption_dense",
            query_filter=models.Filter(must=[models.FieldCondition(key="kb_id", match=models.MatchValue(value="native"))]), with_payload=True)
        assert response.points[0].id == 42 and response.points[0].payload["shot_start_time"] == 12.5
        sparse = target.query_points("video_shot_vectors", query=models.SparseVector(indices=[2], values=[1.0]), using="caption_sparse")
        assert sparse.points[0].id == 42
        assert target.get_collection("video_shot_vectors").payload_schema["kb_id"].data_type == "keyword"
    restored_objects = LocalObjectClient(restored / "state" / "objects")
    assert restored_objects.stat_object("kb-native", object_path).etag == "original-etag-1"


def test_preallocated_index_compresses_and_restores_sparse_for_both_v1_encodings(workspace, tmp_path):
    import shutil
    root, client = workspace
    index = root / "qdrant" / "collection" / "vector-page"
    amount = 32 * 1024 * 1024 + 111
    with index.open("wb") as stream:
        stream.write(b"head")
        stream.seek(9 * 1024 * 1024 + 3)
        stream.write(b"middle")
        stream.truncate(amount)
    catalog = root / "state" / "objects-metadata" / "catalog.sqlite3"
    media = b"\x89PNG\r\n\x1a\n" + os.urandom(2048)
    client.put_object("kb-test", "images/logo.png", io.BytesIO(media), len(media))
    member = index.relative_to(root).as_posix()
    fresh = tmp_path / "fresh.zip"
    old = tmp_path / "legacy-stored.zip"
    archive.backup(root, fresh)
    assert fresh.stat().st_size < amount // 100
    with zipfile.ZipFile(fresh) as current, zipfile.ZipFile(old, "w") as legacy:
        assert current.getinfo(member).compress_type == zipfile.ZIP_DEFLATED
        assert current.getinfo(catalog.relative_to(root).as_posix()).compress_type == zipfile.ZIP_DEFLATED
        media_member = "state/objects/kb-test/" + hashlib.sha256(media).hexdigest()
        assert current.getinfo(media_member).compress_type == zipfile.ZIP_STORED
        for entry in current.infolist():
            with current.open(entry) as src, legacy.open(entry.filename, "w") as dst:
                shutil.copyfileobj(src, dst)
    assert old.stat().st_size > amount
    expected = archive.sha256(index)
    for source in (fresh, old):
        restored = tmp_path / (source.stem + "-workspace")
        archive.restore(source, restored)
        actual = restored / member
        assert actual.stat().st_size == amount
        assert archive.sha256(actual) == expected
        if hasattr(actual.stat(), "st_blocks") and archive._sparse_volume(tmp_path):
            assert actual.stat().st_blocks * 512 < amount // 4
