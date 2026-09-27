"""
LLM管理器主类
统一的LLM调用接口，支持模型路由和故障转移
"""

from typing import Dict, List, Any, Optional, AsyncGenerator
from . import LLMRegistry
from app.core.logger import get_logger
import asyncio
import time
from dataclasses import dataclass
from .model_health import ModelHealth, raise_for_stream_error

logger = get_logger(__name__)

# One request may call a primary and at most two usable fallbacks.
_MAX_FALLBACK_ATTEMPTS = 2

@dataclass
class LLMCallResult:
    """LLM调用结果"""
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    duration: float = 0.0
    tokens_used: int = 0
    model_used: str = ""
    fallback_used: bool = False
    error_category: Optional[str] = None
    status_code: Optional[int] = None

class LLMManager:
    """LLM管理器单例"""
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.registry = LLMRegistry()
        # 备用模型列表改由 registry.get_task_fallbacks(task_type) 提供，见 app/core/llm/__init__.py 的 _task_config
        
        self._initialized = True
    
    async def chat(
        self,
        messages: List[Dict[str, Any]],
        task_type: str = "final_generation",
        model: Optional[str] = None,
        fallback: bool = True,
        **kwargs
    ) -> LLMCallResult:
        """聊天对话"""
        
        if model is None:
            model = self.registry.get_task_model(task_type)
        
        if model is None:
            return LLMCallResult(
                success=False,
                error=f"没有找到任务类型 {task_type} 对应的模型"
            )
        
        kwargs = dict(kwargs)
        total_timeout = float(kwargs.pop("total_timeout", 360 if task_type == "video_parsing" else 180))
        kwargs["_deadline"] = time.monotonic() + total_timeout
        # 记录主模型调用
        logger.info(f"使用主模型: {model} (任务类型: {task_type})")
        # 视频解析多图+长 prompt，易超时；统一加长超时
        if task_type == "video_parsing" and "timeout" not in kwargs:
            kwargs = {**kwargs, "timeout": 180}

        # 尝试主模型
        result = await self._call_with_model(
            "chat_completion", 
            model, 
            {"messages": messages, **kwargs}
        )
        
        # 如果失败且启用了故障转移，尝试备用模型
        if not result.success and fallback:
            logger.warning(f"主模型 {model} 调用失败: {result.error}，开始故障转移")
            # 将主模型传递给故障转移函数，以便正确跳过
            primary_result = result
            result = await self._try_fallback_models(
                "chat_completion", 
                task_type, 
                {"messages": messages, **kwargs},
                primary_model=model  # 传递主模型名称
            )
            if result.error_category == "no_fallback":
                result = primary_result
        
        return result

    def _health(self) -> ModelHealth:
        if not hasattr(self.registry, "model_health"):
            self.registry.model_health = ModelHealth()
        return self.registry.model_health

    def _blocked(self, model: str, method: str) -> Optional[Dict[str, Any]]:
        cfg = self.registry.get_model_config(model)
        return self._health().blocked(cfg.get("provider", ""),
                                     self.registry.get_raw_model_name(model), method)

    def _supports_messages(self, model: str, messages: List[Dict[str, Any]]) -> bool:
        cfg = self.registry.get_model_config(model)
        types = set(str(cfg.get("type", "")).split(","))
        for message in messages:
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                kind = part.get("type")
                required = {"image_url": "vision", "input_audio": "audio",
                            "video_url": "video", "video_local": "video"}.get(kind)
                if required and required not in types:
                    return False
                if kind == "video_local" and cfg.get("provider") != "aliyun_bailian":
                    return False
        return True

    async def stream_chat(
        self, messages: List[Dict[str, Any]], task_type: str = "final_generation",
        model: Optional[str] = None, fallback: bool = True, **kwargs
    ) -> AsyncGenerator[str, None]:
        """Fail over only before any answer content has been emitted."""
        model = model or self.registry.get_task_model(task_type)
        if not model:
            raise ValueError(f"没有找到任务类型 {task_type} 对应的模型")
        deadline = time.monotonic() + float(kwargs.pop("total_timeout", 360))
        candidates = list(dict.fromkeys([model, *(self.registry.get_task_fallbacks(task_type) if fallback else [])]))
        attempts = 0
        last_error: Exception = RuntimeError("No usable streaming model")
        for candidate in candidates:
            if attempts >= 1 + _MAX_FALLBACK_ATTEMPTS:
                break
            cfg = self.registry.get_model_config(candidate)
            provider = self.registry.get_provider(cfg.get("provider", ""))
            if not provider or self._blocked(candidate, "chat_completion"):
                continue
            if not self._supports_messages(candidate, messages):
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Model request total time budget exhausted")
            attempts += 1
            raw = self.registry.get_raw_model_name(candidate)
            params = {**kwargs, "messages": messages, "model": raw}
            params.setdefault("max_tokens", 6000)
            params.setdefault("temperature", 0.3)
            emitted = False
            started = time.monotonic()
            stream = provider.stream_chat(**params)
            try:
                async with asyncio.timeout(remaining):
                    async for chunk in stream:
                        raise_for_stream_error(chunk or {})
                        choices = (chunk or {}).get("choices") or []
                        if not choices or not isinstance(choices[0], dict):
                            continue
                        content = (choices[0].get("delta") or {}).get("content")
                        if content:
                            emitted = True
                            yield content
                    if not emitted:
                        raise RuntimeError("Provider stream ended without answer content")
                self._health().record(cfg["provider"], raw, "chat_completion",
                                      duration=time.monotonic() - started)
                return
            except Exception as exc:
                last_error = exc
                self._health().record(cfg["provider"], raw, "chat_completion",
                                      duration=time.monotonic() - started, error=exc)
                if emitted:
                    raise
            finally:
                await stream.aclose()
        raise last_error

    async def embed(
        self,
        texts: List[str],
        task_type: str = "embedding",
        model: Optional[str] = None,
        fallback: bool = True,
        **kwargs
    ) -> LLMCallResult:
        """文本向量化"""
        
        if model is None:
            model = self.registry.get_task_model(task_type)
        
        if model is None:
            return LLMCallResult(
                success=False,
                error=f"没有找到任务类型 {task_type} 对应的模型"
            )
        
        kwargs = dict(kwargs)
        kwargs["_deadline"] = time.monotonic() + float(kwargs.pop("total_timeout", 180))
        result = await self._call_with_model(
            "embed_texts",
            model,
            {"texts": texts, **kwargs}
        )
        if not result.success and fallback:
            alternative = await self._try_fallback_models(
                "embed_texts", task_type, {"texts": texts, **kwargs}, primary_model=model,
            )
            if alternative.error_category != "no_fallback":
                result = alternative

        return result
    
    async def rerank(
        self, 
        query: str, 
        documents: List[str],
        task_type: str = "reranking",
        model: Optional[str] = None,
        fallback: bool = True,
        **kwargs
    ) -> LLMCallResult:
        """重排序"""
        
        if model is None:
            model = self.registry.get_task_model(task_type)
        
        if model is None:
            return LLMCallResult(
                success=False,
                error=f"没有找到任务类型 {task_type} 对应的模型"
            )
        
        kwargs = dict(kwargs)
        kwargs["_deadline"] = time.monotonic() + float(kwargs.pop("total_timeout", 180))
        result = await self._call_with_model(
            "rerank", 
            model, 
            {"query": query, "documents": documents, **kwargs}
        )
        
        if not result.success and fallback:
            logger.warning(f"主模型 {model} 调用失败: {result.error}，开始故障转移")
            primary_result = result
            result = await self._try_fallback_models(
                "rerank", 
                task_type, 
                {"query": query, "documents": documents, **kwargs},
                primary_model=model  # 传递主模型名称
            )
            if result.error_category == "no_fallback":
                result = primary_result
        
        return result
    
    async def _call_with_model(
        self, method: str, model: str, params: Dict[str, Any]
    ) -> LLMCallResult:
        """One attempt, with structured failure evidence and no hidden retries."""
        params = dict(params)  # Do not mutate the caller's primary/fallback payload.
        cfg = self.registry.get_model_config(model)
        provider_name = cfg.get("provider", "")
        provider = self.registry.get_provider(provider_name)
        if not cfg or not provider:
            return LLMCallResult(False, error=f"Model/provider not configured: {model}",
                                 model_used=model, error_category="configuration")
        blocked = self._blocked(model, method)
        if blocked:
            return LLMCallResult(False, error=f"Model cooling down: {blocked['category']}",
                                 model_used=model, error_category=blocked["category"],
                                 status_code=blocked.get("status_code"))
        if method == "chat_completion" and not self._supports_messages(model, params.get("messages", [])):
            return LLMCallResult(False, error="Model cannot accept the input modalities",
                                 model_used=model, error_category="capability")
        raw = self.registry.get_raw_model_name(model)
        params["model"] = raw
        if method == "chat_completion":
            params.setdefault("max_tokens", 2000)
        deadline = params.pop("_deadline", None)
        started = time.monotonic()
        try:
            if deadline is not None:
                remaining = deadline - started
                if remaining <= 0:
                    return LLMCallResult(False, error="Model request total time budget exhausted",
                                         model_used=model, error_category="budget")
                data = await asyncio.wait_for(getattr(provider, method)(**params), timeout=remaining)
            else:
                data = await getattr(provider, method)(**params)
            if method == "chat_completion" and (not isinstance(data, dict) or not data.get("choices")):
                raise ValueError("Provider returned no chat choices")
            duration = time.monotonic() - started
            self._health().record(provider_name, raw, method, duration=duration)
            return LLMCallResult(True, data=data, duration=duration, model_used=model)
        except Exception as exc:
            duration = time.monotonic() - started
            evidence = self._health().record(provider_name, raw, method, duration=duration, error=exc)
            # Preserve actionable codes without retaining request/response bodies.
            error = f"{type(exc).__name__}: {evidence['category']} (HTTP {evidence.get('status_code')})"
            logger.warning("Model call failed: {} {} {} {:.3f}s", model, method, error, duration)
            return LLMCallResult(False, error=error, duration=duration, model_used=model,
                                 error_category=evidence["category"], status_code=evidence.get("status_code"))

    async def _try_fallback_models(
        self, method: str, task_type: str, params: Dict[str, Any],
        primary_model: Optional[str] = None
    ) -> LLMCallResult:
        attempts = 0
        failures = []
        last_result = None
        for model in self.registry.get_task_fallbacks(task_type):
            if model == primary_model or self._blocked(model, method):
                continue
            if method == "chat_completion" and not self._supports_messages(model, params.get("messages", [])):
                continue
            if attempts >= _MAX_FALLBACK_ATTEMPTS:
                break
            if params.get("_deadline") is not None and time.monotonic() >= params["_deadline"]:
                break
            attempts += 1
            result = await self._call_with_model(method, model, params)
            if result.success:
                result.fallback_used = True
                return result
            last_result = result
            failures.append(f"{model}: {result.error}")
        if last_result:
            last_result.error = "; ".join(failures)
            return last_result
        return LLMCallResult(False, error="No usable fallback within request budget",
                             error_category="no_fallback")

    def get_available_models(self, task_type: Optional[str] = None) -> List[str]:
        """获取可用模型列表"""
        return self.registry.list_models(task_type)
    
    def get_model_info(self, model: str) -> Dict[str, Any]:
        """获取模型信息"""
        return self.registry.get_model_config(model)
    
    def set_fallback_models(self, task_type: str, models: List[str]):
        """设置故障转移模型（写入 registry，与 _task_config 保持一致）"""
        self.registry.update_task_fallbacks(task_type, models)

# 全局LLM管理器实例
llm_manager = LLMManager()