"""Persist non-secret Decision options and keep one immutable snapshot per request.

The original file, Python names and JEV_* mode variables remain compatible.
Legacy saved settings without a provider/model continue to select TypeSafe Jev.
"""
from contextvars import ContextVar
import json
import os
from pathlib import Path
import tempfile
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

from app.core.config import settings
from app.core.llm.decision_catalog import DECISION_DEFAULT_MODELS, DecisionProvider, get_decision_model


class JevConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: DecisionProvider = "typesafe"
    model: str = "jev-1.13.0"
    intent_mode: Literal["off", "adaptive", "force"]
    rerank_mode: Literal["off", "shadow", "assist", "replace", "force"]
    citation_mode: Literal["off", "shadow"]
    citation_strategy: Literal["per_unit", "batch_choice"]

    @model_validator(mode="after")
    def validate_model(self):
        if get_decision_model(self.provider, self.model) is None:
            raise ValueError("请选择该服务商支持的 Decision 模型。")
        return self

    @property
    def enabled(self) -> bool:
        return any(mode != "off" for mode in (
            self.intent_mode, self.rerank_mode, self.citation_mode,
        ))


OFF_CONFIG = JevConfig(intent_mode="off", rerank_mode="off", citation_mode="off", citation_strategy="per_unit")


class JevConfigUnavailable(RuntimeError):
    pass


class JevConfigStore:
    def __init__(self, path: Path | None):
        # None pins standalone evaluations to environment defaults. Their HTTP
        # settings endpoint is read-only and cannot overwrite the user's file.
        self.path = path

    @staticmethod
    def environment_config() -> JevConfig:
        try:
            return JevConfig(
                provider=settings.decision_provider,
                model=settings.decision_model or DECISION_DEFAULT_MODELS[settings.decision_provider],
                intent_mode=settings.jev_intent_mode,
                rerank_mode=settings.jev_rerank_mode,
                citation_mode=settings.jev_citation_mode,
                citation_strategy=settings.jev_citation_strategy,
            )
        except ValidationError:
            raise JevConfigUnavailable("Decision 环境配置无效，已暂停 Decision；请检查服务商与模型或重新保存配置。") from None

    def read(self) -> JevConfig:
        if self.path is None:
            return self.environment_config()
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return self.environment_config()
        except (OSError, UnicodeError):
            raise JevConfigUnavailable("无法读取 Decision 配置，请检查服务端文件权限。") from None
        try:
            return JevConfig.model_validate_json(raw)
        except ValidationError:
            raise JevConfigUnavailable("保存的 Decision 配置无效，已暂停 Decision；请重新保存配置。") from None

    def write(self, config: JevConfig) -> None:
        if self.path is None:
            raise JevConfigUnavailable("评测进程的 Decision 配置只读，请通过启动参数配置。")
        # Never persist credentials here or modify .env. Replace only after the
        # complete payload is durable, so readers/workers cannot see a partial file.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        name = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                             prefix=".jev-", suffix=".tmp", delete=False) as handle:
                name = handle.name
                json.dump(config.model_dump(), handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, self.path)
        finally:
            if name and os.path.exists(name):
                os.unlink(name)


jev_config_store = JevConfigStore(Path(__file__).resolve().parents[2] / "data" / "jev_settings.json")
_request_config: ContextVar[JevConfig | None] = ContextVar("jev_request_config", default=None)


def get_jev_config() -> JevConfig:
    snapshot = _request_config.get()
    if snapshot is not None:
        return snapshot
    try:
        return jev_config_store.read()
    except JevConfigUnavailable:
        # Invalid persisted settings must not silently enable environment defaults.
        return OFF_CONFIG


class JevConfigMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        token = _request_config.set(get_jev_config())
        try:
            # Pure ASGI middleware keeps the snapshot through streaming completion.
            await self.app(scope, receive, send)
        finally:
            _request_config.reset(token)
