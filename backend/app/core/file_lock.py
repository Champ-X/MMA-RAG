"""Exclusive OS locks for workspaces and cross-process read/modify/write cycles."""
from __future__ import annotations

import errno
import os
import time
from typing import IO

if os.name == "nt":
    import msvcrt
else:
    import fcntl


def lock_file(stream: IO, *, wait: bool = False) -> None:
    if os.name != "nt":
        flags = fcntl.LOCK_EX if wait else fcntl.LOCK_EX | fcntl.LOCK_NB
        fcntl.flock(stream.fileno(), flags)
        return

    # Windows byte-range locks can extend past EOF. All callers lock byte zero.
    stream.seek(0)
    while True:
        try:
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            return
        except OSError as exc:
            if not wait or exc.errno not in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                raise
            time.sleep(0.05)


def unlock_file(stream: IO) -> None:
    if os.name == "nt":
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
