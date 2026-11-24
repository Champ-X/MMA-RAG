# Desktop data transfer

The native runtime exposes `python -m app.modules.desktop_transfer`. Run it with
the runtime's Python and `PYTHONPATH` pointing to its `backend` directory. The
desktop launcher can invoke the same commands without requiring system Python.
Success is a single JSON object on stdout. Failures return a nonzero exit code
and a JSON error on stderr; provider exception bodies and credentials are not
printed.

## Back up and restore

Stop the selected workspace's local runtime, including its Qdrant child, before
transferring it. Backup acquires the same `.workspace.lock` OS lock as the native
host and refuses a running workspace.

```sh
python -m app.modules.desktop_transfer backup \
  --workspace /absolute/workspace \
  --output /absolute/backups/workspace.zip

python -m app.modules.desktop_transfer verify \
  --archive /absolute/backups/workspace.zip

python -m app.modules.desktop_transfer restore \
  --archive /absolute/backups/workspace.zip \
  --destination /absolute/new-workspace
```

The output archive and restore destination must not already exist. Existing
source files are never edited. Restoration verifies and extracts into a private
staging directory, checks SQLite integrity and original object hashes, relocates
owned Pi attachment/collection-payload paths, then publishes with an atomic
no-replace directory rename. An interruption can be retried into the same unused
destination. Restoring a completed backup retains the workspace UUID and all
knowledge/file/point/run identities.

The ZIP manifest records every file's size and SHA-256, the workspace UUID, the
format version and required Qdrant version. ZIP paths, links, duplicates,
unmanifested files and checksum mismatches are rejected. SQLite databases use the
SQLite backup API so committed WAL pages are included. Physical Qdrant storage is
copied only while the workspace is offline; the native host checks its recorded
Qdrant version before opening it. Physical-index restore has been exercised on
macOS Apple Silicon with Qdrant 1.16.2; Windows restoration needs its own native
acceptance run.

Application credentials, OS-keychain references, runtime tokens, model caches,
logs and temporary files are excluded. Restore requires model credentials to be
entered again. User documents and conversation contents are preserved verbatim;
this is a data backup, not a redacted diagnostic report. Keep it private.

The backend cannot read browser `localStorage` or IndexedDB. Export client history
from the existing browser/Desktop settings page first, then supply the resulting
`.tessmora-chat` file:

```sh
python -m app.modules.desktop_transfer backup \
  --workspace /absolute/workspace \
  --output /absolute/backups/workspace.zip \
  --client-history /absolute/history.tessmora-chat
```

The export is stored unchanged at `client/history-export` with its own archive
checksum. Restore returns `client_history_path` for the client importer. Without
that input, the receipt explicitly reports `client_history_included: false`;
server-side Pi history is still included. The client bundle contains session
snapshots and chunk-verified raw attachment bytes; it does not replace the
server-side original files, vector indexes or Pi run ledger.

## Import a frozen CLI/Compose installation

Use the CLI instance's **data directory**, containing `state/`, `pi-agent/`,
`backend-data/`, `minio/` and `qdrant/`. Stop its API and worker before importing;
keep the storage services reachable by the migration tool and prevent other
clients from writing. `--source-frozen` explicitly acknowledges that condition.
The tool does not stop or reconfigure an existing installation itself.

Credentials are read only from these environment variables:

- `TESSMORA_MIGRATION_MINIO_ACCESS_KEY`
- `TESSMORA_MIGRATION_MINIO_SECRET_KEY`
- `TESSMORA_MIGRATION_MINIO_REGION` (optional; defaults to `us-east-1`)
- `TESSMORA_MIGRATION_QDRANT_API_KEY` (optional)

```sh
python -m app.modules.desktop_transfer migrate \
  --source-data-dir /absolute/legacy-data \
  --destination /absolute/new-desktop-workspace \
  --minio-endpoint http://127.0.0.1:9000 \
  --qdrant-url http://127.0.0.1:6333 \
  --qdrant-executable /absolute/verified-runtime/bin/qdrant \
  --source-frozen \
  --client-history /absolute/history.tessmora-chat
```

The example addresses are illustrative. The production Compose configuration
does not publish Qdrant's port; arrange a temporary loopback-only forwarding path
or run the transfer in a controlled environment with storage-network access.
Do not expose the stores publicly. Non-loopback source addresses require HTTPS.

Migration reads MinIO through its API; its physical disk layout is never treated
as plain original files. The new local object catalog retains each bucket/key
and original ETag while storing bytes by SHA-256. This keeps existing Pi source
versions valid. The source inventory is checked again after import. Source
Qdrant collections are read through configuration/scroll APIs and recreated in a
temporary, authenticated native Qdrant process owned by the tool. It preserves
named dense/sparse vectors, point IDs, payloads, payload-index definitions and
aliases. Point counts and content digests are verified before publication. The
source and destination Qdrant versions must match. Custom-sharded collections
and ambiguous custom Pi owners require an explicit migration design and are
refused rather than silently changed.

The tool checks that vector references still resolve to original objects. Missing
originals fail the migration with the collection/point identity. Application
configuration and ledgers are copied with credentials removed. Pi attachment
paths and collection payload paths are relocated; the built-in single-user
`local-workspace` owner can be converted to `configured-workspace` together with
its attachment directory. Existing trusted-user identities are not merged.
Redis is not copied: new local ingestion uses the desktop durable job ledger;
finish or cancel legacy background jobs before freezing the source. Existing
Pi/collection ledgers remain available to their recovery logic.

A successful new workspace includes `state/migration-receipt.json`. Failure or
interruption removes staging data and leaves the source unchanged. Retrying
starts a fresh verified import; no incomplete result is presented as a workspace.

## Verification

Deterministic disk/SDK tests cover archive integrity, credentials exclusion,
SQLite WAL, lock conflicts, safe extraction, Pi and collection path relocation,
legacy ETags, named dense/sparse vectors, aliases, old citation positions, missing
objects, source changes and interrupted migration followed by two retries.

An optional native test launches isolated Qdrant 1.16.2 source and destination
processes, migrates synthetic video references, backs up/restores, reopens the
restored index and queries both dense and sparse channels through real HTTP APIs:

```sh
TESSMORA_TEST_QDRANT=/absolute/runtime/bin/qdrant PYTHONPATH=backend \
  python -m pytest -q backend/tests/test_desktop_transfer.py backend/tests/test_desktop_objects.py
```

The source object API contract also has a real MinIO acceptance script:

```sh
python packages/desktop/qa/native-transfer.py \
  --runtime /absolute/verified-runtime \
  --fixtures /absolute/synthetic-fixtures \
  --output /absolute/new-evidence-directory \
  --docker-context existing-test-context \
  --minio-image existing-minio-image
```

It creates and removes its own loopback-only MinIO container in the explicitly
selected context, with synthetic credentials and an isolated data directory.
It never changes Docker's current context or uses an existing container's data.
On 2026-11-24 this passed on macOS Apple Silicon with real MinIO, native Qdrant
1.16.2, and the restored FastAPI service. The checks include multipart ETags,
source collection/configuration invariance, old presigned media refresh,
signed Range/HEAD, original PDF page markers and saved Pi-source previews.
See [native acceptance evidence](native-acceptance-2026-11-24.md).

This synthetic acceptance does not claim that an existing user's complete
Compose installation has been migrated. Native Windows restore and cross-OS
physical Qdrant-index compatibility still need separate acceptance runs.
