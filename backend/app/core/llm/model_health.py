"""Recent call evidence, separate from provider catalog membership.

A missing catalog entry is not proof of failure (providers also serve aliases).
Only actual failures open a bounded cooldown; after expiry one can try again.
No prompts, response bodies or credentials are kept in diagnostics.
"""
from __future__ import annotations

import time
from typing import Any

import httpx


class ProviderAPIError(RuntimeError):
    """Preserve SDK/SSE status codes without depending on an HTTP response."""
    def __init__(self, message: str, *, status_code: int | None = None, code: Any = None):
        super().__init__("Provider returned an API error")
        self.provider_message = message
        self.status_code = status_code
        self.code = code


def raise_for_stream_error(chunk: dict[str, Any]) -> None:
    error = chunk.get("error")
    if error is None:
        return
    error = error if isinstance(error, dict) else {"message": str(error)}
    code = error.get("code")
    try:
        status = int(error.get("status") or code)
        if not 400 <= status < 600:
            status = None
    except (ValueError, TypeError):
        status = None
    raise ProviderAPIError(str(error.get("message", "")), status_code=status, code=code)


def classify_error(error: Exception) -> dict[str, Any]:
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None) or getattr(error, "status_code", None)
    code = getattr(error, "code", None)
    message = str(getattr(error, "provider_message", "")).lower()
    if response is not None:
        try:
            payload = response.json()
            detail = payload.get("error") or payload
            if isinstance(detail, dict):
                code = detail.get("code")
                message = str(detail.get("message") or "").lower()
        except Exception:
            pass
    # Prefer structured provider evidence; do not classify arbitrary 400s as a
    # globally broken model (the user's input may simply be unsupported).
    if str(code) == "30003" or "model disabled" in message:
        category, cooldown, scope = "model_disabled", 600, "model"
    elif status == 401:
        category, cooldown, scope = "authentication", 60, "provider"
    elif status == 402:
        category, cooldown, scope = "billing", 60, "provider"
    elif status == 404:
        category, cooldown, scope = "not_found", 600, "model"
    elif status == 403:
        category, cooldown, scope = "access_denied", 600, "model"
    elif status == 429:
        category, cooldown, scope = "rate_limited", 30, "model"
    elif status is not None and status >= 500:
        category, cooldown, scope = "provider_error", 15, "model"
    elif isinstance(error, (TimeoutError, httpx.TimeoutException, ConnectionError, httpx.TransportError)):
        category, cooldown, scope = "transport", 15, "model"
    else:
        category, cooldown, scope = "request_error", 0, "model"
    return {"category": category, "status_code": status, "provider_code": code,
            "cooldown_seconds": cooldown, "scope": scope}


class ModelHealth:
    def __init__(self) -> None:
        self.calls: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.providers: dict[str, dict[str, Any]] = {}

    def blocked(self, provider: str, model: str, method: str) -> dict[str, Any] | None:
        now = time.time()
        for row in (self.providers.get(provider), self.calls.get((provider, model, method))):
            if row and row.get("retry_after", 0) > now:
                return dict(row)
        return None

    def record(self, provider: str, model: str, method: str, *, duration: float,
               error: Exception | None = None) -> dict[str, Any]:
        now = time.time()
        key = (provider, model, method)
        previous = self.calls.get(key, {})
        row = {"provider": provider, "raw_model": model, "method": method,
               "checked_at": now, "duration_seconds": round(duration, 4),
               "success": error is None, "retry_after": 0,
               "success_count": previous.get("success_count", 0) + int(error is None),
               "failure_count": previous.get("failure_count", 0) + int(error is not None)}
        if error is not None:
            row.update(classify_error(error))
            row["retry_after"] = now + row["cooldown_seconds"]
            if row["scope"] == "provider":
                self.providers[provider] = row
        else:
            self.providers.pop(provider, None)
        self.calls[key] = row
        return dict(row)

    def snapshot(self) -> list[dict[str, Any]]:
        now = time.time()
        return [{**row, "cooling_down": row.get("retry_after", 0) > now}
                for row in self.calls.values()]
