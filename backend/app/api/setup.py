"""Token-protected setup API shared by the npm CLI and first-run web screen."""
from __future__ import annotations

import hmac
import os
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.setup_service import get_setup_service
from app.core.storage_health import check_storage

router = APIRouter()
Provider = Literal["deepseek", "siliconflow", "aliyun_bailian", "openrouter"]
Capability = Literal["text", "image", "audio", "video"]


class SetupDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capabilities: list[Capability] | None = Field(default=None, min_length=1, max_length=4)
    credentials: dict[Provider, Annotated[str, Field(strict=True, max_length=4096)]] = Field(default_factory=dict, repr=False)
    task_models: dict[str, Annotated[str, Field(strict=True, min_length=1, max_length=200, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$")]] = Field(default_factory=dict)
    test_receipt: str | None = Field(default=None, max_length=200)

    @field_validator("capabilities")
    @classmethod
    def normalize_capabilities(cls, value):
        if value is None:
            return value
        return [capability for capability in ("text", "image", "audio", "video") if capability == "text" or capability in value]

    @field_validator("credentials")
    @classmethod
    def normalize_credentials(cls, value):
        if any("\n" in secret or "\r" in secret for secret in value.values()):
            raise ValueError("凭证不能包含换行符")
        return {key: secret.strip() for key, secret in value.items()}


class PrepareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capabilities: list[Capability] | None = Field(default=None, min_length=1, max_length=4)

    @field_validator("capabilities")
    @classmethod
    def normalize_capabilities(cls, value):
        return SetupDraft.normalize_capabilities(value)


def require_setup_token(x_tessmora_setup_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("TESSMORA_SETUP_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="此实例未启用受保护的安装配置，请通过 Tessmora CLI 启动。")
    if not x_tessmora_setup_token or not hmac.compare_digest(expected.encode("utf-8"), x_tessmora_setup_token.encode("utf-8")):
        raise HTTPException(status_code=401, detail="安装会话已失效，请使用 Tessmora CLI 重新打开配置页面。")


@router.get("/status")
async def setup_status():
    return get_setup_service().status()


@router.get("/storage")
def setup_storage():
    # Public, read-only and credential-free, like /status. Sync handler keeps
    # the bounded storage requests off the API event loop.
    return check_storage()


@router.get("/config", dependencies=[Depends(require_setup_token)])
async def setup_config():
    return get_setup_service().status()


@router.post("/test", dependencies=[Depends(require_setup_token)])
async def test_setup(draft: SetupDraft):
    try:
        return await get_setup_service().test(draft.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/config", dependencies=[Depends(require_setup_token)])
async def save_setup(draft: SetupDraft):
    try:
        return await get_setup_service().save(draft.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/prepare", dependencies=[Depends(require_setup_token)])
async def prepare_setup(request: PrepareRequest):
    try:
        return await get_setup_service().prepare(request.capabilities)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.get("/progress")
async def setup_progress():
    return get_setup_service().progress()
