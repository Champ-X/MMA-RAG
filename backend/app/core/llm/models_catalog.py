"""
从各厂商 OpenAI 兼容接口拉取 /v1/models，合并进 LLMRegistry（短 TTL 缓存）。
逻辑对齐 tests/modelsFetcher 下的离线脚本；此处为运行时异步版本。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Dict, List, Optional, Set, Tuple
from urllib.parse import urlencode

import httpx

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

CATALOG_TTL_SEC = 600.0
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=all&limit=500"

_refresh_lock = asyncio.Lock()
_last_refresh_monotonic: float = 0.0
_last_refresh_started_at: Optional[float] = None
_last_refresh_finished_at: Optional[float] = None
_last_refresh_forced: bool = False
_catalog_provider_status: Dict[str, Dict[str, Any]] = {}

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
        return []
    if sub == "speech-to-text":
        return ["audio"]
    if sub == "text-to-video":
        return []
    return []


def _normalize_type_names(types: Set[str]) -> str:
    order = ("chat", "embedding", "vision", "reranker", "audio", "video")
    return ",".join(t for t in order if t in types)


def infer_siliconflow_model_types(model_id: str, sub_types: Optional[List[str]] = None) -> str:
    """基于 SiliconFlow 官方 /models + sub_type 结果和模型族名推断项目可用能力。"""
    m = model_id.lower()
    type_set: Set[str] = set()
    for sub_type in sub_types or []:
        type_set.update(_sub_type_to_registry_types(sub_type))

    if "rerank" in m:
        return "reranker"
    if "embedding" in m or "-embed" in m or "/embed" in m or m.startswith("bge-"):
        return "embedding"

    if "captioner" in m:
        type_set.add("vision")
    elif "omni" in m:
        type_set.update({"chat", "vision", "audio", "video"})
    elif "vl" in m or "vision" in m or "qvq" in m:
        type_set.add("vision")

    if "asr" in m or "speech" in m or "audio" in m:
        type_set.add("audio")

    # 部分新一代通义/聚合模型以 chat 子类型发布，但官方能力页标注支持图像/视频理解。
    if any(token in m for token in ("qwen3.5-", "qwen3.6-", "qwen3.7-")):
        type_set.update({"chat", "vision", "video"})
    if "kimi-k2.5" in m or "kimi-k2.6" in m:
        type_set.update({"chat", "vision"})

    if not type_set:
        type_set.add("chat")
    return _normalize_type_names(type_set)


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

    type_set: Set[str] = {"chat"}
    if "omni" in m:
        type_set.update({"vision", "audio", "video"})
    if "vl" in m or "vision" in m or "captioner" in m or "qvq" in m or "ocr" in m:
        type_set.add("vision")
    if "asr" in m or "speech" in m or "audio" in m or "transcription" in m:
        type_set.add("audio")
    if any(token in m for token in ("qwen3.5-", "qwen3.6-", "qwen3.7-")):
        type_set.update({"vision", "video"})
    if "kimi/kimi" in m or "kimi-k" in m:
        type_set.update({"vision", "video"})
    return _normalize_type_names(type_set)


def _openrouter_arch_to_types(arch: Dict[str, Any]) -> str:
    outs = arch.get("output_modalities") if isinstance(arch, dict) else None
    ins = arch.get("input_modalities") if isinstance(arch, dict) else None
    types: Set[str] = set()
    output_modalities = set(outs or []) if isinstance(outs, list) else set()
    input_modalities = set(ins or []) if isinstance(ins, list) else set()

    if "text" in output_modalities:
        types.add("chat")
    if "embeddings" in output_modalities or "embedding" in output_modalities:
        types.add("embedding")
    if "rerank" in output_modalities:
        types.add("reranker")

    # 本项目的 vision/audio/video 任务都是“输入该模态、输出文本理解结果”，不是生成类模型。
    if "text" in output_modalities:
        if "image" in input_modalities:
            types.add("vision")
        if "audio" in input_modalities:
            types.add("audio")
        if "video" in input_modalities:
            types.add("video")
    if not types:
        types.add("chat")
    return _normalize_type_names(types)


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
        typ = infer_siliconflow_model_types(mid, sub_type_map.get(mid, []))
        try:
            ctx = int(raw.get("context_length") or raw.get("max_model_len") or 0) or 32768
        except (TypeError, ValueError):
            ctx = 32768
        cfg: Dict[str, Any] = {
            "provider": "siliconflow",
            "type": typ,
            "context_length": ctx,
            "description": raw.get("name") or raw.get("display_name") or "SiliconFlow（目录同步）",
            "catalog_synced": True,
            "catalog_source": "https://api.siliconflow.cn/v1/models",
            "catalog_sub_types": sorted(set(sub_type_map.get(mid, []))),
            "owned_by": raw.get("owned_by"),
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
            "catalog_source": "https://api.deepseek.com/v1/models",
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
            "catalog_source": "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
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
            "catalog_source": OPENROUTER_MODELS_URL,
            "input_modalities": arch.get("input_modalities") if isinstance(arch, dict) else None,
            "output_modalities": arch.get("output_modalities") if isinstance(arch, dict) else None,
            "supported_parameters": raw.get("supported_parameters"),
            "max_output_tokens": (raw.get("top_provider") or {}).get("max_completion_tokens")
            if isinstance(raw.get("top_provider"), dict)
            else None,
        }
        out.append((reg_id, cfg))
    return out


async def _collect_provider(
    provider_name: str,
    source: str,
    fetcher: Awaitable[List[Tuple[str, Dict[str, Any]]]],
) -> List[Tuple[str, Dict[str, Any]]]:
    started = time.time()
    try:
        rows = await fetcher
        _catalog_provider_status[provider_name] = {
            "ok": True,
            "count": len(rows),
            "error": None,
            "source": source,
            "started_at": started,
            "finished_at": time.time(),
        }
        return rows
    except Exception as e:
        _catalog_provider_status[provider_name] = {
            "ok": False,
            "count": 0,
            "error": str(e),
            "source": source,
            "started_at": started,
            "finished_at": time.time(),
        }
        logger.warning("拉取 {} 模型目录失败: {}", provider_name, e)
        return []


async def _refresh_all_providers(registry: Any) -> None:
    to_merge: List[Tuple[str, Dict[str, Any]]] = []
    providers = set(registry.list_providers())
    _catalog_provider_status.clear()

    async with httpx.AsyncClient() as client:
        tasks: List[Awaitable[List[Tuple[str, Dict[str, Any]]]]] = []
        if "siliconflow" in providers and settings.siliconflow_api_key:
            tasks.append(
                _collect_provider(
                    "siliconflow",
                    "https://api.siliconflow.cn/v1/models",
                    _fetch_siliconflow_models(client, settings.siliconflow_api_key),
                )
            )

        dk = getattr(settings, "deepseek_api_key", None)
        if "deepseek" in providers and dk:
            tasks.append(
                _collect_provider(
                    "deepseek",
                    "https://api.deepseek.com/v1/models",
                    _fetch_deepseek_models(client, dk),
                )
            )

        bk = getattr(settings, "aliyun_bailian_api_key", None)
        if "aliyun_bailian" in providers and bk:
            tasks.append(
                _collect_provider(
                    "aliyun_bailian",
                    "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
                    _fetch_aliyun_bailian_models(client, bk),
                )
            )

        if "openrouter" in providers and getattr(settings, "openrouter_api_key", None):
            tasks.append(
                _collect_provider(
                    "openrouter",
                    OPENROUTER_MODELS_URL,
                    _fetch_openrouter_models(client),
                )
            )

        if tasks:
            results = await asyncio.gather(*tasks)
            for rows in results:
                to_merge.extend(rows)

    for name, cfg in to_merge:
        registry.add_model(name, cfg)

    try:
        registry.revalidate_task_routing_after_catalog()
    except Exception as e:
        logger.warning("目录合并后校正任务路由失败: {}", e)

    logger.info("LLM 模型目录已合并 {} 条（来自已配置提供商的 API）", len(to_merge))


async def ensure_llm_catalog_fresh(registry: Any, *, force: bool = False) -> None:
    """在 TTL 内最多刷新一次；force 时立即刷新。"""
    global _last_refresh_monotonic, _last_refresh_started_at, _last_refresh_finished_at, _last_refresh_forced
    async with _refresh_lock:
        now = time.monotonic()
        if not force and (now - _last_refresh_monotonic) < CATALOG_TTL_SEC:
            return
        _last_refresh_started_at = time.time()
        _last_refresh_finished_at = None
        _last_refresh_forced = force
        try:
            await _refresh_all_providers(registry)
            _last_refresh_monotonic = now
        finally:
            _last_refresh_finished_at = time.time()


def get_llm_catalog_status() -> Dict[str, Any]:
    """返回最近一次官网模型目录同步状态，供设置页展示和排障。"""
    return {
        "ttl_seconds": CATALOG_TTL_SEC,
        "last_refresh_started_at": _last_refresh_started_at,
        "last_refresh_finished_at": _last_refresh_finished_at,
        "last_refresh_forced": _last_refresh_forced,
        "providers": dict(_catalog_provider_status),
    }
