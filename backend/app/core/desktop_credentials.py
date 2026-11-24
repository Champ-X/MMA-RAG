"""Versioned credential references keep cleartext keys out of workspace backups."""
from __future__ import annotations

import json
import os
import sys
from uuid import UUID, uuid4


def _keychain():
    if sys.platform == "darwin":
        from keyring.backends.macOS import Keyring
        return Keyring()
    if sys.platform == "win32":
        from keyring.backends.Windows import WinVaultKeyring
        return WinVaultKeyring()
    raise ValueError("This platform has no supported desktop credential store")


def _service() -> str:
    return "Tessmora/" + str(UUID(os.environ["TESSMORA_WORKSPACE_ID"]))


def hydrate(config: dict) -> dict:
    credentials = {}
    reference = config.get("credential_ref")
    if reference:
        ref = str(UUID(reference))
        try:
            raw = _keychain().get_password(_service(), ref)
        except Exception:
            # A locked keychain should still allow opening a workspace and its documents.
            return {**config, "credentials": {}, "credential_store_locked": True}
        if raw:
            credentials = json.loads(raw)
    return {**config, "credentials": credentials}


def save(path, draft: dict, write_json) -> None:
    old = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    public = {k: v for k, v in draft.items() if k not in {"credentials", "credential_ref", "credential_store_locked"}}
    keys = {name: value for name, value in draft.get("credentials", {}).items() if value}
    previous = old.get("credential_ref")
    if not keys and not previous:
        write_json(path, public)
        return
    try:
        vault = _keychain()
        service = _service()
        before = vault.get_password(service, str(UUID(previous))) if previous else None
        if previous and before is not None and json.loads(before) == keys:
            write_json(path, {**public, "credential_ref": previous})
            return
        reference = str(uuid4()) if keys else None
        if reference:
            vault.set_password(service, reference, json.dumps(keys, ensure_ascii=False))
            public["credential_ref"] = reference
    except Exception:
        raise ValueError("请解锁本机系统凭证库后重新保存模型设置。") from None
    try:
        write_json(path, public)
    except BaseException:
        if reference:
            vault.delete_password(service, reference)
        raise
    if previous and before is not None:
        try:
            vault.delete_password(service, previous)
        except Exception:
            # The configuration already refers exclusively to the new entry.
            pass
