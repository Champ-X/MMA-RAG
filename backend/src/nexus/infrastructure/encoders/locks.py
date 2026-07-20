from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def model_load_lock() -> Iterator[None]:
    """Serialize heavyweight model initialization across Compose processes."""

    root = Path(
        os.getenv("HF_HOME")
        or os.getenv("HUGGINGFACE_HUB_CACHE", "")
        or (Path.home() / ".cache" / "huggingface")
    ).expanduser()
    try:
        root.mkdir(parents=True, exist_ok=True)
        handle = (root / ".nexus-model-load.lock").open("a+")
    except OSError:
        # A read-only custom cache still remains protected by each encoder's
        # in-process lock; capability errors remain explicit.
        yield
        return
    try:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
