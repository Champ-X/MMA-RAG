"""
从各厂商 OpenAI 兼容接口拉取 /v1/models，合并进 LLMRegistry（短 TTL 缓存）。
逻辑对齐 tests/modelsFetcher 下的离线脚本；此处为运行时异步版本。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlencode

import httpx

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

CATALOG_TTL_SEC = 600.0
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

_refresh_lock = asyncio.Lock()
_last_refresh_monotonic: float = 0.0

SILICONFLOW_SUB_TYPES = (
    "chat",
    "embedding",
    "reranker",
    "text-to-image",
    "image-to-image",
    "speech-to-text",
    "text-to-video",
)


def _sub_type_to_registry_types(sub: str) -> List[str]:
    if sub == "chat":
        return ["chat"]
    if sub == "embedding":
        return ["embedding"]
    if sub == "reranker":
        return ["reranker"]
    if sub in ("text-to-image", "image-to-image"):
        return ["vision"]
    if sub == "speech-to-text":
        return ["audio"]
    if sub == "text-to-video":
        return ["video"]
    return []


def infer_deepseek_model_types(model_id: str) -> str:
    m = model_id.lower()
    if "embed" in m:
        return "embedding"
    return "chat"


def infer_bailian_model_types(model_id: str) -> str:
    m = model_id.lower()
    if "rerank" in m:
        return "reranker"
    if "embedding" in m or "-embed" in m or m.startswith("text-embedding"):
        return "embedding"
    parts: List[str] = ["chat"]
    if "omni" in m or "asr" in m or "speech" in m:
        parts.extend(["audio", "video"])
    if "vl" in m or "vision" in m or "captioner" in m or "qvq" in m:
        parts.append("vision")
    if "omni" in m:
        parts.append("audio")
    return ",".join(dict.fromkeys(parts))


def _openrouter_arch_to_types(arch: Dict[str, Any]) -> str:
    outs = arch.get("output_modalities") if isinstance(arch, dict) else None
    ins = arch.get("input_modalities") if isinstance(arch, dict) else None
    types: Set[str] = set()
    if isinstance(outs, list):
        if "text" in outs:
            types.add("chat")
        if "image" in outs:
            types.add("vision")
        if "audio" in outs:
            types.add("audio")
        if "video" in outs:
            types.add("video")
        if "embeddings" in outs or "embedding" in outs:
            types.add("embedding")
    if isinstance(ins, list):
        if "image" in ins or "video" in ins:
            types.add("vision")
        if "audio" in ins:
            types.add("audio")
    if not types:
        return "chat,vision,audio,video"
    if "chat" not in types and "text" in (outs or []):
        types.add("chat")
    return ",".join(sorted(types))


def _openrouter_chat_capable(raw: Dict[str, Any]) -> bool:
    arch = raw.get("architecture") or {}
    outs = arch.get("output_modalities")
    if not isinstance(outs, list) or not outs:
        return True
    return "text" in outs


async def _http_get_json(client: httpx.AsyncClient, url: str, headers: Dict[str, str], timeout: float) -> Dict[str, Any]:
    resp = await client.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise ValueError("JSON 非对象")
    return data


async def _fetch_siliconflow_models(client: httpx.AsyncClient, api_key: str) -> List[Tuple[str, Dict[str, Any]]]:
    base = "https://api.siliconflow.cn/v1"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json", "User-Agent": "MMAA-RAG/catalog"}
    payload = await _http_get_json(client, f"{base}/models", headers, 120.0)
    data_list = payload.get("data")
    if not isinstance(data_list, list):
        return []

    sub_type_map: Dict[str, List[str]] = {}

    async def fetch_sub(st: str) -> None:
        q = urlencode({"sub_type": st})
        try:
            p = await _http_get_json(client, f"{base}/models?{q}", headers, 120.0)
            rows = p.get("data")
            if not isinstance(rows, list):
                return
            for item in rows:
                if isinstance(item, dict):
                    mid = (item.get("id") or "").strip()
                    if mid:
                        sub_type_map.setdefault(mid, []).append(st)
        except Exception as e:
            logger.warning("SiliconFlow sub_type={} 拉取失败: {}", st, e)

    await asyncio.gather(*(fetch_sub(st) for st in SILICONFLOW_SUB_TYPES))

    out: List[Tuple[str, Dict[str, Any]]] = []
    for raw in data_list:
        if not isinstance(raw, dict):
            continue
        mid = (raw.get("id") or "").strip()
        if not mid:
            continue
        type_set: Set[str] = set()
        for st in sub_type_map.get(mid, []):
            type_set.update(_sub_type_to_registry_types(st))
        if not type_set:
            type_set.add("chat")
        try:
            ctx = int(raw.get("context_length") or raw.get("max_model_len") or 0) or 32768
        except (TypeError, ValueError):
            ctx = 32768
        cfg: Dict[str, Any] = {
            "provider": "siliconflow",
            "type": ",".join(sorted(type_set)),
            "context_length": ctx,
            "description": "SiliconFlow（目录同步）",
            "catalog_synced": True,
        }
        out.append((mid, cfg))
    return out


async def _fetch_deepseek_models(client: httpx.AsyncClient, api_key: str) -> List[Tuple[str, Dict[str, Any]]]:
    base = "https://api.deepseek.com/v1"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json", "User-Agent": "MMAA-RAG/catalog"}
    payload = await _http_get_json(client, f"{base}/models", headers, 90.0)
    data_list = payload.get("data")
    if not isinstance(data_list, list):
        return []
    out: List[Tuple[str, Dict[str, Any]]] = []
    for raw in data_list:
        if not isinstance(raw, dict):
            continue
        mid = (raw.get("id") or "").strip()
        if not mid:
            continue
        typ = infer_deepseek_model_types(mid)
        reg_id = f"deepseek:{mid}"
        cfg: Dict[str, Any] = {
            "provider": "deepseek",
            "type": typ,
            "context_length": 131072,
            "description": "DeepSeek 官方 API（目录同步）",
            "raw_model": mid,
            "catalog_synced": True,
        }
        out.append((reg_id, cfg))
    return out


async def _fetch_aliyun_bailian_models(client: httpx.AsyncClient, api_key: str) -> List[Tuple[str, Dict[str, Any]]]:
    base = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json", "User-Agent": "MMAA-RAG/catalog"}
    payload = await _http_get_json(client, f"{base}/models", headers, 120.0)
    data_list = payload.get("data")
    if not isinstance(data_list, list):
        return []
    out: List[Tuple[str, Dict[str, Any]]] = []
    for raw in data_list:
        if not isinstance(raw, dict):
            continue
        mid = (raw.get("id") or raw.get("model") or "").strip()
        if not mid:
            continue
        reg_id = f"aliyun_bailian:{mid}"
        typ = infer_bailian_model_types(mid)
        cfg: Dict[str, Any] = {
            "provider": "aliyun_bailian",
            "type": typ,
            "context_length": 131072,
            "description": "阿里云百炼（目录同步）",
            "raw_model": mid,
            "catalog_synced": True,
        }
        out.append((reg_id, cfg))
    return out


async def _fetch_openrouter_models(client: httpx.AsyncClient) -> List[Tuple[str, Dict[str, Any]]]:
    headers = {"Accept": "application/json", "User-Agent": "MMAA-RAG/catalog"}
    payload = await _http_get_json(client, OPENROUTER_MODELS_URL, headers, 90.0)
    raw_list = payload.get("data")
    if not isinstance(raw_list, list):
        return []
    out: List[Tuple[str, Dict[str, Any]]] = []
    for raw in raw_list:
        if not isinstance(raw, dict):
            continue
        if not _openrouter_chat_capable(raw):
            continue
        mid = (raw.get("id") or "").strip()
        if not mid:
            continue
        arch = raw.get("architecture") if isinstance(raw.get("architecture"), dict) else {}
        typ = _openrouter_arch_to_types(arch)
        reg_id = f"openrouter:{mid}"
        ctx_raw = raw.get("context_length")
        try:
            ctx = int(ctx_raw) if ctx_raw is not None else 128000
        except (TypeError, ValueError):
            ctx = 128000
        cfg: Dict[str, Any] = {
            "provider": "openrouter",
            "type": typ,
            "context_length": ctx,
            "description": (raw.get("name") or "OpenRouter（目录同步）"),
            "raw_model": mid,
            "catalog_synced": True,
        }
        out.append((reg_id, cfg))
    return out


async def _refresh_all_providers(registry: Any) -> None:
    to_merge: List[Tuple[str, Dict[str, Any]]] = []
    providers = set(registry.list_providers())

    async with httpx.AsyncClient() as client:
        if "siliconflow" in providers and settings.siliconflow_api_key:
            try:
                to_merge.extend(await _fetch_siliconflow_models(client, settings.siliconflow_api_key))
            except Exception as e:
                logger.warning("拉取 SiliconFlow 模型目录失败: {}", e)

        dk = getattr(settings, "deepseek_api_key", None)
        if "deepseek" in providers and dk:
            try:
                to_merge.extend(await _fetch_deepseek_models(client, dk))
            except Exception as e:
                logger.warning("拉取 DeepSeek 模型目录失败: {}", e)

        bk = getattr(settings, "aliyun_bailian_api_key", None)
        if "aliyun_bailian" in providers and bk:
            try:
                to_merge.extend(await _fetch_aliyun_bailian_models(client, bk))
            except Exception as e:
                logger.warning("拉取阿里云百炼模型目录失败: {}", e)

        if "openrouter" in providers and getattr(settings, "openrouter_api_key", None):
            try:
                to_merge.extend(await _fetch_openrouter_models(client))
            except Exception as e:
                logger.warning("拉取 OpenRouter 模型目录失败: {}", e)

    for name, cfg in to_merge:
        registry.add_model(name, cfg)

    try:
        registry.revalidate_task_routing_after_catalog()
    except Exception as e:
        logger.warning("目录合并后校正任务路由失败: {}", e)

    logger.info("LLM 模型目录已合并 {} 条（来自已配置提供商的 API）", len(to_merge))


async def ensure_llm_catalog_fresh(registry: Any, *, force: bool = False) -> None:
    """在 TTL 内最多刷新一次；force 时立即刷新。"""
    global _last_refresh_monotonic
    async with _refresh_lock:
        now = time.monotonic()
        if not force and (now - _last_refresh_monotonic) < CATALOG_TTL_SEC:
            return
        await _refresh_all_providers(registry)
        _last_refresh_monotonic = now
