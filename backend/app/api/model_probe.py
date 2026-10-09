"""Non-persisting tests of exact model routing drafts."""
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.core.llm.connection_probe import run_probe

router = APIRouter()


class ModelProbeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    provider: Literal["siliconflow", "deepseek", "openrouter", "aliyun_bailian"]
    model: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$", strict=True)
    capability: Literal["chat", "embedding", "reranker", "vision", "audio", "video"]


def get_registry():
    from app.core.llm.manager import llm_manager
    return llm_manager.registry


@router.post("/models/test")
async def test_model_connection(selection: ModelProbeRequest):
    registry = get_registry()
    # Membership is explicit: get_model_config alone permits unregistered
    # dynamic model strings and is insufficient for a bounded probe endpoint.
    if selection.model not in registry.list_models():
        raise HTTPException(status_code=422, detail="所选模型不在当前目录中，请刷新目录后重试。")
    config = registry.get_model_config(selection.model)
    if config.get("provider", "siliconflow") != selection.provider:
        raise HTTPException(status_code=422, detail="所选模型与服务商不匹配。")
    if selection.model not in registry.list_models(selection.capability):
        raise HTTPException(status_code=422, detail="当前目录未声明该模型支持所选能力。")
    return await run_probe(
        registry.get_provider(selection.provider), provider=selection.provider,
        model=selection.model, raw_model=registry.get_raw_model_name(selection.model), capability=selection.capability,
    )
