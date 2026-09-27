"""Global Jev settings, following the existing local model-settings API scope."""
from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.core.jev_settings import JevConfig, JevConfigUnavailable, jev_config_store

router = APIRouter()


def _response(config: JevConfig):
    return {
        "config": config.model_dump(),
        "api_key_configured": bool((settings.typesafe_api_key or "").strip()),
        "model": "jev-1.13.0",
    }


@router.get("/settings")
async def read_settings():
    try:
        return _response(jev_config_store.read())
    except JevConfigUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@router.put("/settings")
async def update_settings(config: JevConfig):
    if config.enabled and not (settings.typesafe_api_key or "").strip():
        raise HTTPException(status_code=409, detail="尚未配置 Jev API 密钥。请在服务端设置 TYPESAFE_API_KEY 并重启后端，再开启 Jev。")
    try:
        jev_config_store.write(config)
    except JevConfigUnavailable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except OSError:
        raise HTTPException(status_code=503, detail="Jev 配置保存失败，请检查服务端文件权限；原配置未更改。") from None
    return _response(config)
