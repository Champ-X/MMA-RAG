"""Keep developer credentials/settings out of deterministic Jev test modes."""
import pytest


@pytest.fixture(autouse=True)
def isolate_jev_runtime_settings(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.core.jev_settings import jev_config_store
    monkeypatch.setattr(jev_config_store, "path", tmp_path / "jev_settings.json")
    for field in ("jev_intent_mode", "jev_rerank_mode", "jev_citation_mode"):
        monkeypatch.setattr(settings, field, "off")
    monkeypatch.setattr(settings, "jev_citation_strategy", "per_unit")
