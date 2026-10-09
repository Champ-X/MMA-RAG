"""Explicit local recovery before a development restart; no public write API."""
import json
from pathlib import Path


def restore_session_snapshot(target: dict, path: str) -> tuple[int, int]:
    """Validate an exported history snapshot in full before restoring anything.

    This is opt-in startup recovery, not automatic or durable session storage.
    Never replace a process that already contains conversation state.
    """
    if target:
        raise ValueError('Session recovery requires an empty session store')
    with Path(path).open('rb') as handle:
        content = handle.read(20_000_001)
    if len(content) > 20_000_000:
        raise ValueError('Session recovery snapshot exceeds 20 MB')
    data = json.loads(content)
    rows = data.get('sessions') if isinstance(data, dict) and data.get('version') == 1 else None
    if not isinstance(rows, list) or len(rows) > 1000:
        raise ValueError('Invalid session recovery snapshot')
    restored = {}
    message_count = 0
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Invalid session recovery entry')
        identity, messages = row.get('id'), row.get('messages')
        if (not isinstance(identity, str) or not 1 <= len(identity) <= 128
                or identity in restored or not isinstance(messages, list)
                or len(messages) > 2000 or any(not isinstance(message, dict)
                    or message.get('role') not in ('user', 'assistant')
                    or not isinstance(message.get('content'), str) for message in messages)):
            raise ValueError('Invalid session recovery entry')
        restored[identity] = row
        message_count += len(messages)
    target.update(restored)
    return len(restored), message_count
