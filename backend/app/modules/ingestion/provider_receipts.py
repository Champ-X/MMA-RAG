"""Fence uncertain paid calls and replay completed provider results within one ingestion job."""
import asyncio
import hashlib
from pathlib import Path

from .desktop_jobs import ProviderOutcomeUnknown, active_job, encoded, jobs


def _fingerprint(value):
    if isinstance(value, dict):
        # FFmpeg segment paths can change between restarts. The bytes identify the input.
        if value.get("type") == "video_local" and "path" in value:
            with Path(value["path"]).open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            value = {**value, "path": digest}
        return {key: _fingerprint(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_fingerprint(item) for item in value]
    if isinstance(value, bytes):
        return {"sha256": hashlib.sha256(value).hexdigest()}
    return value


async def recorded_provider_call(provider, request, invoke, *, require_result=False):
    """invoke is a zero-argument async function. Browser/server requests bypass the ledger."""
    owner = active_job.get()
    if owner is None:
        return await invoke()

    def begin():
        ident = hashlib.sha256(
            encoded([provider, _fingerprint(request)]).encode()
        ).hexdigest()
        return ident, jobs().begin_call(owner, ident)

    key, (known, value) = await asyncio.to_thread(begin)
    if known:
        return value
    try:
        value = await invoke()
        if require_result and value is None:
            raise ProviderOutcomeUnknown()
    except Exception as exc:
        status = getattr(exc, "status_code", None) or getattr(
            getattr(exc, "response", None), "status_code", None
        )
        # An explicit rejection did not complete the requested inference; normal routing handles it.
        rejected = (
            isinstance(status, int) and 400 <= status < 500 and status not in {408, 499}
        )
        await asyncio.to_thread(jobs().fail_call, owner, key, rejected)
        if not rejected:
            raise ProviderOutcomeUnknown() from exc
        raise
    await asyncio.to_thread(jobs().complete_call, owner, key, value)
    return value
