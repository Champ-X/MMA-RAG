from __future__ import annotations

import hashlib
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from nexus.shared.domain.errors import ConflictError, NotFoundError, ValidationError


class FilesystemBlobStore:
    """Content-addressed local adapter used by development, tests and restore drills."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        pure = PurePosixPath(key)
        if pure.is_absolute() or ".." in pure.parts:
            raise ValidationError("Invalid blob key")
        path = (self.root / Path(*pure.parts)).resolve()
        if path != self.root and self.root not in path.parents:
            raise ValidationError("Blob key escapes the configured root")
        return path

    def put(self, key: str, data: bytes, *, content_type: str, content_hash: str) -> None:
        actual_hash = hashlib.sha256(data).hexdigest()
        if actual_hash != content_hash:
            raise ConflictError(
                "Blob hash does not match manifest",
                details={"expected": content_hash, "actual": actual_hash},
            )
        path = self._path(key)
        if path.exists():
            if hashlib.sha256(path.read_bytes()).hexdigest() != content_hash:
                raise ConflictError("Existing content-addressed blob has a different hash")
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".partial")
        temporary.write_bytes(data)
        temporary.replace(path)

    def get(self, key: str) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise NotFoundError("Blob not found", details={"key": key})
        return path.read_bytes()

    def open(self, key: str) -> BinaryIO:
        path = self._path(key)
        if not path.is_file():
            raise NotFoundError("Blob not found", details={"key": key})
        return path.open("rb")

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def list_keys(self) -> list[str]:
        return [
            path.relative_to(self.root).as_posix()
            for path in sorted(self.root.rglob("*"))
            if path.is_file() and not path.name.endswith(".partial")
        ]
