"""Decision settings and a bounded, non-persisting connection probe.

Mounted at /api/decision and the backwards-compatible /api/jev prefix.
"""
import re
import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, model_validator

from app.core.config import settings
from app.core.jev_settings import JevConfig, JevConfigUnavailable, jev_config_store
from app.core.llm.decision_catalog import get_decision_model, list_decision_models
from app.core.llm.jev import JevError, get_decision_client

router = APIRouter()


def _key_configured(provider: str) -> bool:
    key = settings.typesafe_api_key if provider == "typesafe" else settings.openrouter_api_key
    return bool((key or "").strip())


def _response(config: JevConfig):
    return {
        "config": config.model_dump(),
        "api_key_configured": _key_configured(config.provider),
        "model": config.model,
        "providers": [
            {"id": "typesafe", "name": "TypeSafe", "api_key_configured": _key_configured("typesafe")},
            {"id": "openrouter", "name": "OpenRouter", "api_key_configured": _key_configured("openrouter")},
        ],
        "models": list_decision_models(),
    }


def _require_key(provider: str):
    if not _key_configured(provider):
        variable = "TYPESAFE_API_KEY" if provider == "typesafe" else "OPENROUTER_API_KEY"
        raise HTTPException(
            status_code=409,
            detail=f"尚未配置所选服务商的 API 密钥。请在服务端设置 {variable} 并重启后端。",
        )


@router.get("/settings")
async def read_settings():
    try:
        return _response(jev_config_store.read())
    except JevConfigUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@router.put("/settings")
async def update_settings(config: JevConfig):
    if config.enabled:
        _require_key(config.provider)
    try:
        jev_config_store.write(config)
    except JevConfigUnavailable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except OSError:
        raise HTTPException(status_code=503, detail="Decision 配置保存失败，请检查服务端文件权限；原配置未更改。") from None
    return _response(config)


class DecisionProbe(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    provider: Literal["typesafe", "openrouter"]
    model: str

    @model_validator(mode="after")
    def validate_model(self):
        if get_decision_model(self.provider, self.model) is None:
            raise ValueError("请选择该服务商支持的 Decision 模型。")
        return self


_PROBE_QUESTIONS = {
    "available": {
        "type": "noul",
        "instructions": "Does the state say the service is available?",
        "criteria": {"true": "The service is available.", "false": "The service is unavailable."},
    },
    "route": {
        "type": "choice",
        "instructions": "Select the service status explicitly stated in the state.",
        "criteria": {"available": "The service is available.", "unavailable": "The service is unavailable."},
    },
    "support": {
        "type": "score",
        "instructions": "How clearly does the state support service availability?",
        "criteria": ["No support.", "Explicit support."],
    },
}

# Only sanitized transport categories may cross the API boundary.
_PROBE_ERRORS = {
    "missing_key", "timeout", "circuit_open", "budget_exhausted", "model_mismatch",
    "incomplete_answers", "invalid_usage", "invalid_answer_type", "invalid_score",
    "invalid_probabilities", "invalid_choice", "invalid_response_or_transport",
    "request_too_large", "invalid_model", "invalid_provider",
}


@router.post("/test")
async def test_connection(selection: DecisionProbe):
    """Check all three typed output contracts without changing the saved route.

    Uses only synthetic data and the same cached allowance/cooldown as runtime.
    Successful transport/schema validation is not a task-quality evaluation.
    """
    _require_key(selection.provider)
    started = time.perf_counter()
    try:
        client = get_decision_client(selection.provider, selection.model)
        result = await client.evaluate(
            "The service is available.", _PROBE_QUESTIONS,
            prompt_version="decision-connection-v1",
        )
    except JevError as exc:
        reason = str(exc)
        if reason not in _PROBE_ERRORS and not re.fullmatch(r"http_\d{3}", reason):
            reason = "invalid_response_or_transport"
        return {
            "success": False, "provider": selection.provider, "model": selection.model,
            "requested_model": selection.model, "duration_s": time.perf_counter() - started,
            "error": reason,
        }
    return {
        "success": True, "provider": selection.provider, "model": result.model,
        "requested_model": selection.model, "duration_s": result.duration_s,
    }
