"""Machine-readable CLI; credentials are supplied through environment only."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .archive import TransferError, backup, restore, verify


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.modules.desktop_transfer")
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("backup", help="Back up a stopped desktop workspace")
    export.add_argument("--workspace", type=Path, required=True)
    export.add_argument("--output", type=Path, required=True)
    export.add_argument("--client-history", type=Path)
    check = commands.add_parser("verify", help="Verify every file in a backup")
    check.add_argument("--archive", type=Path, required=True)
    recover = commands.add_parser("restore", help="Restore into a new, nonexistent directory")
    recover.add_argument("--archive", type=Path, required=True)
    recover.add_argument("--destination", type=Path, required=True)
    migrate = commands.add_parser("migrate", help="Copy a frozen legacy instance through read-only storage APIs")
    migrate.add_argument("--source-data-dir", type=Path, required=True)
    migrate.add_argument("--destination", type=Path, required=True)
    migrate.add_argument("--minio-endpoint", required=True)
    migrate.add_argument("--qdrant-url", required=True)
    migrate.add_argument("--qdrant-executable", type=Path, required=True)
    migrate.add_argument("--source-frozen", action="store_true", required=True,
                         help="Confirm source API/worker are stopped and no other clients can write")
    migrate.add_argument("--client-history", type=Path)
    options = parser.parse_args(argv)
    try:
        if options.command == "backup":
            result = backup(options.workspace, options.output, client_history=options.client_history)
        elif options.command == "verify":
            manifest = verify(options.archive)
            result = {"workspace_id": manifest["workspace_id"], "files": len(manifest["files"]),
                      "credentials_included": False, "client_history_included": manifest["client_history_included"],
                      "required_qdrant_version": manifest.get("required_qdrant_version")}
        elif options.command == "restore":
            result = restore(options.archive, options.destination)
        else:
            from .migration import migrate_legacy
            result = migrate_legacy(options.source_data_dir, options.destination, minio_endpoint=options.minio_endpoint,
                                    qdrant_url=options.qdrant_url, qdrant_executable=options.qdrant_executable,
                                    source_frozen=options.source_frozen, client_history=options.client_history)
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        return 0
    except TransferError as error:
        print(json.dumps({"ok": False, "error": "transfer_failed", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception as error:
        # Provider errors can include signed URLs or credentials; never echo them.
        print(json.dumps({"ok": False, "error": "transfer_failed", "error_type": type(error).__name__,
                          "message": "Transfer failed; the source and existing destination were not replaced."}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
