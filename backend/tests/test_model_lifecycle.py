"""Unavailable IDs must not return through catalogs, persisted routes or Pi."""
import json
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.core.llm import LLMRegistry
from app.core.llm.model_lifecycle import UNAVAILABLE_MODELS, model_lifecycle_status
from app.core.llm.models_catalog import infer_bailian_model_types, infer_siliconflow_model_types
from app.modules.pi_agent.config import PiSettings


@pytest.fixture
def registry(tmp_path, monkeypatch):
    monkeypatch.setenv("TESSMORA_STATE_DIR", str(tmp_path))
    settings = SimpleNamespace(
        siliconflow_api_key="synthetic", siliconflow_embedding_trust_env=False,
        deepseek_api_key="synthetic", aliyun_bailian_api_key="synthetic",
        openrouter_api_key="synthetic",
    )
    return LLMRegistry(settings_override=settings)


def test_catalog_cannot_reintroduce_verified_unavailable_models(registry):
    for model in UNAVAILABLE_MODELS:
        provider = model.split(":", 1)[0] if ":" in model else "siliconflow"
        registry.add_model(model, {"provider": provider, "type": "chat,vision,audio,video"})
        assert registry.get_model_config(model) == {}
    assert not UNAVAILABLE_MODELS.intersection(registry.list_models())
    for row in registry._task_config.values():
        assert row["model"] not in UNAVAILABLE_MODELS
        assert not UNAVAILABLE_MODELS.intersection(row["fallbacks"])
    with pytest.raises(ValueError):
        registry.update_task_model("image_captioning", "aliyun_bailian:qwen3-vl-plus-2025-12-19", persist=False)


def test_saved_media_routes_upgrade_without_changing_embedding_or_custom_text(registry):
    saved = {
        "image_captioning": {"model": "aliyun_bailian:qwen3-vl-plus-2025-12-19"},
        "audio_transcription": "aliyun_bailian:qwen-omni-turbo",
        "video_parsing": "aliyun_bailian:qwen3.5-omni-plus-2026-03-15",
        "embedding": "Qwen/Qwen3-Embedding-8B",
        "final_generation": "openrouter:custom/chosen-model",
    }
    registry._task_overrides_path.parent.mkdir(parents=True)
    registry._task_overrides_path.write_text(json.dumps(saved))
    registry._apply_saved_task_overrides()
    registry.revalidate_task_routing_after_catalog()
    assert registry.get_task_model("image_captioning") == "aliyun_bailian:qwen3.8-flash"
    for task in ("audio_transcription", "video_parsing"):
        assert registry.get_task_model(task) == "aliyun_bailian:qwen3.8-omni-flash"
        for fallback in registry.get_task_fallbacks(task):
            assert registry._is_model_compatible_with_task(task, fallback)
            assert registry.get_model_config(fallback)["provider"] == "aliyun_bailian"
            assert "audio" in registry.get_model_config(fallback)["type"].split(",")
    assert registry.get_task_model("embedding") == saved["embedding"]
    assert registry.get_task_model("final_generation") == saved["final_generation"]
    registry.update_task_model("image_captioning", registry.get_task_model("image_captioning"))
    persisted = json.loads(registry._task_overrides_path.read_text())
    assert persisted["audio_transcription"] == "aliyun_bailian:qwen3.8-omni-flash"
    assert persisted["embedding"] == saved["embedding"]


def test_missing_catalog_is_not_retirement_evidence(registry):
    model = "aliyun_bailian:text-embedding-v4"
    registry._models[model]["catalog_presence"] = "missing"
    assert registry._is_model_compatible_with_task("embedding", model)
    assert model in registry.list_models("embedding")


@pytest.mark.parametrize("model,expected", [
    ("qwen3.8-flash", "chat,vision,video"),
    ("qwen3.8-max", "chat,vision,video"),
    ("qwen3.8-omni-flash", "chat,vision,audio,video"),
    ("qwen3.8-omni-flash-realtime", ""),
    ("qwen3.5-omni-plus-realtime-2026-03-15", ""),
    ("qwen3.7-text-embedding", "embedding"),
])
def test_current_bailian_capabilities_and_transport(model, expected):
    assert infer_bailian_model_types(model) == expected


def test_siliconflow_current_multimodal_model():
    assert infer_siliconflow_model_types("Qwen/Qwen3.8-27B", ["chat"]) == "chat,vision,video"


def test_pi_environment_media_overrides_upgrade(monkeypatch):
    monkeypatch.setenv("PI_AGENT_VISION_MODEL", "aliyun_bailian:qwen3-vl-plus-2025-12-19")
    monkeypatch.setenv("PI_AGENT_AUDIO_MODEL", "aliyun_bailian:qwen3-omni-flash")
    config = PiSettings(_env_file=None)
    assert config.vision_model == "aliyun_bailian:qwen3.8-flash"
    assert config.audio_model == "aliyun_bailian:qwen3.8-omni-flash"


def test_expiring_catalog_routes_are_filtered_and_fail_over_before_shutdown(registry):
    model = "openrouter:synthetic/expiring"
    registry.add_model(model, {
        "provider": "openrouter", "type": "chat",
        "expiration_date": (date.today() + timedelta(days=7)).isoformat(),
    })
    registry._task_config["final_generation"]["model"] = model
    registry.revalidate_task_routing_after_catalog()
    assert registry.get_task_model("final_generation") == "aliyun_bailian:qwen3.5-flash"
    assert model not in registry.list_models("chat")
    assert model not in registry.list_models_by_provider()["openrouter"]["chat"]
    details = registry.list_model_details()[model]
    assert details["lifecycle_status"] == "retiring" and details["expiration_date"]
    with pytest.raises(ValueError):
        registry.update_task_model("final_generation", model, persist=False)
    # A postponement or withdrawn announcement can make the same ID usable again.
    registry.add_model(model, {"provider": "openrouter", "type": "chat", "expiration_date": None})
    assert model in registry.list_models("chat")


@pytest.mark.parametrize("expiry,expected", [
    ("2026-10-12", "retired"), ("2026-10-13", "retired"),
    ("2026-10-20", "retiring"), ("2026-11-12", "retiring"),
    ("2026-11-13", "active"), (None, "active"), ("unknown", "active"),
])
def test_lifecycle_notice_dates_are_bounded(expiry, expected):
    assert model_lifecycle_status("test/model", {"expiration_date": expiry}, today=date(2026, 10, 13)) == expected
