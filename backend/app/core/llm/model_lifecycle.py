"""Verified retirements and migrations, scoped to this project's provider IDs.

Catalog absence alone is never a retirement signal. Bailian entries below
returned model_not_found at the configured Beijing endpoint on 2026-10-13;
the dated VL model is still documented in Hong Kong, so it is not globally
retired. Maintained policy and official sources: docs/MODEL_CALL_RELIABILITY.md.
Local probe receipts: docs/verification/model-lifecycle-2026-10-13/ (Git-ignored).
"""

from datetime import date, datetime, timezone

# OpenRouter's official /models metadata, captured on 2026-10-13.
KNOWN_EXPIRATION_DATES = {"openrouter:google/gemini-2.5-flash": "2026-10-20"}
RETIREMENT_NOTICE_DAYS = 30

UNAVAILABLE_MODELS = frozenset({
    # SiliconFlow release notes: retired on 2026-04-22 / 05-15 / 06-11 / 09-11.
    "Qwen/Qwen3-235B-A22B-Thinking-2507",
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "Qwen/Qwen3-VL-235B-A22B-Instruct",
    "Qwen/Qwen3.5-397B-A17B",
    "Pro/MiniMaxAI/MiniMax-M2.5",
    "Pro/moonshotai/Kimi-K2.5",
    "moonshotai/Kimi-K2-Thinking",
    "Pro/zai-org/GLM-5",
    "zai-org/GLM-4.6V",
    # Google shutdown on 2026-03-09; also absent from OpenRouter's live catalog.
    "openrouter:google/gemini-3-pro-preview",
    # Unavailable at the current Bailian endpoint, verified by actual requests.
    "aliyun_bailian:qwen3-vl-plus-2025-12-19",
    "aliyun_bailian:qwen-omni-turbo",
    "aliyun_bailian:qwen3-max",
    "aliyun_bailian:kimi/kimi-k2.5",
    "aliyun_bailian:qwen3-omni-30b-a3b-captioner",
    "aliyun_bailian:qwen3-vl-flash",
    "aliyun_bailian:qwen3-vl-embedding",
})

MODEL_UPGRADES = {
    "Qwen/Qwen3-235B-A22B-Thinking-2507": "Qwen/Qwen3.8-27B",
    "Qwen/Qwen3-235B-A22B-Instruct-2507": "Qwen/Qwen3.8-27B",
    "Qwen/Qwen3.5-397B-A17B": "Qwen/Qwen3.8-27B",
    "Qwen/Qwen3-VL-235B-A22B-Instruct": "Qwen/Qwen3-VL-30B-A3B-Instruct",
    "Pro/MiniMaxAI/MiniMax-M2.5": "Pro/zai-org/GLM-5.1",
    "Pro/moonshotai/Kimi-K2.5": "Pro/moonshotai/Kimi-K2.6",
    "moonshotai/Kimi-K2-Thinking": "Pro/moonshotai/Kimi-K2.6",
    "Pro/zai-org/GLM-5": "Pro/zai-org/GLM-5.1",
    "zai-org/GLM-4.6V": "Qwen/Qwen3-VL-30B-A3B-Instruct",
    "aliyun_bailian:qwen3-vl-plus-2025-12-19": "aliyun_bailian:qwen3.8-flash",
    "aliyun_bailian:qwen-omni-turbo": "aliyun_bailian:qwen3.8-omni-flash",
    "aliyun_bailian:qwen3-max": "aliyun_bailian:qwen3.8-flash",
    "aliyun_bailian:kimi/kimi-k2.5": "aliyun_bailian:qwen3.8-flash",
    "aliyun_bailian:qwen3-omni-30b-a3b-captioner": "aliyun_bailian:qwen3.8-omni-flash",
    "aliyun_bailian:qwen3-vl-flash": "aliyun_bailian:qwen3.8-flash",
    # Proactive upgrades of working legacy defaults; these are not retirements.
    "aliyun_bailian:qwen3-omni-flash": "aliyun_bailian:qwen3.8-omni-flash",
    "aliyun_bailian:qwen3.5-omni-plus-2026-03-15": "aliyun_bailian:qwen3.8-omni-flash",
}


def upgrade_model_id(model: str) -> str:
    return MODEL_UPGRADES.get(model, model)


def model_expiration_date(model: str, config: dict) -> str | None:
    # A refreshed explicit null can withdraw an earlier shutdown announcement.
    return config.get("expiration_date") if "expiration_date" in config else KNOWN_EXPIRATION_DATES.get(model)


def model_lifecycle_status(model: str, config: dict, *, today: date | None = None) -> str:
    if model in UNAVAILABLE_MODELS:
        return "unavailable"
    try:
        expiry = date.fromisoformat(model_expiration_date(model, config) or "")
    except (TypeError, ValueError):
        return "active"
    remaining = (expiry - (today or datetime.now(timezone.utc).date())).days
    if remaining <= 0:
        return "retired"
    return "retiring" if remaining <= RETIREMENT_NOTICE_DAYS else "active"


def model_is_unavailable(model: str, config: dict) -> bool:
    return model_lifecycle_status(model, config) != "active"
