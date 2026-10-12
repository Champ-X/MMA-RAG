"""Optional managed installation paths; source checkouts keep their old layout."""
from __future__ import annotations

import json
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROVIDER_FIELDS = {
    "deepseek": "deepseek_api_key",
    "siliconflow": "siliconflow_api_key",
    "aliyun_bailian": "aliyun_bailian_api_key",
    "openrouter": "openrouter_api_key",
}


def state_dir() -> Path | None:
    value = os.environ.get("TESSMORA_STATE_DIR", "").strip()
    return Path(value).expanduser().resolve() if value else None


def backend_data_dir() -> Path:
    root = state_dir()
    return root / "data" if root else BACKEND_DIR / "data"


def read_managed_config() -> dict:
    root = state_dir()
    path = root / "setup.json" if root else None
    if not path or not path.exists():
        return {}
    # A broken file must never silently replace an existing installation.
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise ValueError("Unsupported Tessmora setup configuration; restore setup.json from backup")
    return payload


def managed_settings_values() -> dict:
    root = state_dir()
    if not root:
        return {}
    config = read_managed_config()
    credentials = config.get("credentials", {})
    result = {PROVIDER_FIELDS[name].upper(): value for name, value in credentials.items() if name in PROVIDER_FIELDS}
    # Do not load/download models before the user can open the setup screen.
    result["PRELOAD_LOCAL_MODELS_ON_STARTUP"] = False
    result["LOG_FILE"] = str(root / "logs" / "app.log")
    result["DATABASE_URL"] = f"sqlite:///{root / 'data' / 'app.db'}"
    os.environ.setdefault("HF_HOME", str(root / "models" / "huggingface"))
    return result
