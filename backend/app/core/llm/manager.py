"""
LLM管理器主类
统一的LLM调用接口，支持模型路由和故障转移
"""

from typing import Dict, List, Any, Optional, Union, AsyncGenerator, cast
from . import LLMRegistry, BaseLLMProvider
from app.core.logger import get_logger
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

logger = get_logger(__name__)

# 模型调用重试：最大重试次数、退避秒数（第 1、2 次重试前等待）
_CALL_MAX_RETRIES = 2
_CALL_RETRY_BACKOFF = (1.0, 2.0)
_EVENT_LOOP_CLOSED_MSG = "Event loop is closed"

# 用于「在新事件循环中执行」的线程池，避免阻塞主循环
_executor: Optional[ThreadPoolExecutor] = None

def _get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="llm_loop")
    return _executor


def _is_transient_error(e: Exception) -> bool:
    """是否为可重试的瞬时错误（网络、超时、Event loop 关闭等）"""
    err_str = str(e).strip()
    if _EVENT_LOOP_CLOSED_MSG in err_str or "event loop" in err_str.lower():
        return True
    if isinstance(e, (ConnectionError, TimeoutError, asyncio.TimeoutError)):
        return True
    try:
        import httpx
        if isinstance(e, (httpx.ConnectError, httpx.TimeoutException, httpx.RemoteProtocolError)):
            return True
        resp = getattr(e, "response", None)
        code = getattr(resp, "status_code", None) if resp is not None else None
        if code is not None and 500 <= code < 600:
            return True
    except ImportError:
        pass
    return False


def _run_async_in_new_loop(func, kwargs: Dict[str, Any]) -> Any:
    """在独立线程中创建新事件循环并执行 func(**kwargs)，用于恢复「Event loop is closed」等场景。"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(func(**kwargs))
    finally:
        try:
            loop.close()
        except Exception:
            pass

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
            result = await self._try_fallback_models(
                "chat_completion", 
                task_type, 
                {"messages": messages, **kwargs},
                primary_model=model  # 传递主模型名称
            )
        
        return result

    async def stream_chat(
        self,
        messages: List[Dict[str, Any]],
        task_type: str = "final_generation",
        model: Optional[str] = None,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """流式聊天对话，逐块 yield 内容 delta。"""
        if model is None:
            model = self.registry.get_task_model(task_type)
        if model is None:
            raise ValueError(f"没有找到任务类型 {task_type} 对应的模型")
        model_config = self.registry.get_model_config(model)
        if not model_config:
            raise ValueError(f"模型 {model} 没有在注册表中找到配置")
        provider = self.registry.get_provider(model_config.get("provider") or "siliconflow")
        if not provider:
            raise ValueError(f"提供商不存在: {model_config.get('provider')}")
        
        # 记录使用的模型
        logger.info(f"使用主模型: {model} (任务类型: {task_type})")
        
        # 获取实际API调用的模型名（如果有raw_model字段则使用它，否则使用原始模型名）
        raw_model_name = self.registry.get_raw_model_name(model)
        
        # 获取模型配置
        model_config = self.registry.get_model_config(model)
        
        # max_tokens 应该表示输出的最大token数，而不是总上下文长度
        # 如果没有指定，使用合理的默认值（6000，与 SiliconFlow 保持一致），而不是 context_length
        # context_length 是总上下文长度（输入+输出），不应该直接用作 max_tokens
        default_max_tokens = kwargs.get("max_tokens") or 6000
        
        params = {
            "messages": messages,
            "model": raw_model_name,  # 使用raw_model_name
            "temperature": kwargs.get("temperature", 0.3),
            "max_tokens": default_max_tokens,
        }
        try:
            stream = cast(
                AsyncGenerator[Dict[str, Any], None],
                provider.stream_chat(**params),
            )
            async for chunk_data in stream:
                delta = (chunk_data or {}).get("choices", [{}])[0].get("delta") or {}
                content = delta.get("content") or ""
                # 仅将最终回答 content 推送给前端；不推送 reasoning_content（思考链），
                # 避免前端消息气泡只显示“思考过程”而没有正式回答。检索阶段的思考由前端 ThinkingCapsule 展示。
                if content:
                    yield content
        except Exception as e:
            err_msg = str(e).strip() or repr(e)
            logger.error(f"流式聊天失败 [{model}]: {type(e).__name__} - {err_msg}", exc_info=True)
            raise
    
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
        
        result = await self._call_with_model(
            "embed_texts",
            model,
            {"texts": texts, **kwargs}
        )
        # 失败时尝试故障转移（含重试后仍失败的情况，如 Event loop is closed）
        if not result.success and fallback:
            fallback_models = self.registry.get_task_fallbacks(task_type)
            if fallback_models:
                for fb in fallback_models:
                    if fb == model:
                        continue
                    logger.warning(f"embed_texts 主模型 {model} 失败，尝试备用: {fb}")
                    r = await self._call_with_model("embed_texts", fb, {"texts": texts, **kwargs})
                    if r.success:
                        r.fallback_used = True
                        return r
                logger.error("embed_texts 所有模型（含备用）均失败")
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
        
        result = await self._call_with_model(
            "rerank", 
            model, 
            {"query": query, "documents": documents, **kwargs}
        )
        
        if not result.success and fallback:
            logger.warning(f"主模型 {model} 调用失败: {result.error}，开始故障转移")
            result = await self._try_fallback_models(
                "rerank", 
                task_type, 
                {"query": query, "documents": documents, **kwargs},
                primary_model=model  # 传递主模型名称
            )
        
        return result
    
    async def _call_with_model(
        self, 
        method: str, 
        model: str, 
        params: Dict[str, Any]
    ) -> LLMCallResult:
        """使用指定模型调用方法"""
        
        try:
            logger.debug(f"准备调用模型: {model}, 方法: {method}")
            model_config = self.registry.get_model_config(model)
            
            if not model_config:
                error_msg = f"模型 {model} 没有在注册表中找到配置"
                logger.error(error_msg)
                return LLMCallResult(
                    success=False,
                    error=error_msg
                )
            
            provider_name = model_config.get("provider")
            
            if not provider_name:
                error_msg = f"模型 {model} 没有配置提供商"
                logger.error(error_msg)
                return LLMCallResult(
                    success=False,
                    error=error_msg
                )
            
            logger.debug(f"模型 {model} 使用提供商: {provider_name}")
            provider = self.registry.get_provider(provider_name)
            if not provider:
                error_msg = f"提供商 {provider_name} 不存在"
                logger.error(error_msg)
                return LLMCallResult(
                    success=False,
                    error=error_msg
                )
            
            # 获取对应方法
            method_func = getattr(provider, method)
            
            # 获取实际API调用的模型名（如果有raw_model字段则使用它，否则使用原始模型名）
            raw_model_name = self.registry.get_raw_model_name(model)
            
            # 添加模型参数
            if method == "chat_completion":
                params["model"] = raw_model_name  # 使用raw_model_name
                # 如果没有指定max_tokens，使用合理的默认值（2000，与 SiliconFlow 保持一致）
                # max_tokens 表示输出的最大token数，不应该直接使用 context_length（总上下文长度）
                if "max_tokens" not in params or params.get("max_tokens") is None:
                    params["max_tokens"] = 2000
                    logger.debug(f"模型 {model} 未指定 max_tokens，使用默认值 2000")
            elif method == "embed_texts":
                params["model"] = raw_model_name  # 使用raw_model_name
            elif method == "rerank":
                params["model"] = raw_model_name  # 使用raw_model_name
            
            start_time = time.time()
            last_error: Optional[Exception] = None
            for attempt in range(_CALL_MAX_RETRIES + 1):
                try:
                    data = await method_func(**params)
                    duration = time.time() - start_time
                    return LLMCallResult(
                        success=True,
                        data=data,
                        duration=duration,
                        model_used=model,
                        fallback_used=False
                    )
                except Exception as e:
                    last_error = e
                    if not _is_transient_error(e):
                        logger.error(f"模型调用失败（不可重试） {model}.{method}: {str(e)}")
                        break
                    is_loop_closed = _EVENT_LOOP_CLOSED_MSG in str(e) or "event loop" in str(e).lower()
                    if is_loop_closed:
                        logger.warning(f"模型调用遇到 Event loop 关闭，在新事件循环中重试: {model}.{method}")
                        try:
                            data = await asyncio.get_event_loop().run_in_executor(
                                _get_executor(),
                                _run_async_in_new_loop,
                                method_func,
                                params,
                            )
                            duration = time.time() - start_time
                            return LLMCallResult(
                                success=True,
                                data=data,
                                duration=duration,
                                model_used=model,
                                fallback_used=False
                            )
                        except Exception as e2:
                            last_error = e2
                            logger.warning(f"新事件循环中重试仍失败: {e2}")
                        break
                    if attempt < _CALL_MAX_RETRIES:
                        backoff = _CALL_RETRY_BACKOFF[attempt] if attempt < len(_CALL_RETRY_BACKOFF) else 2.0
                        await asyncio.sleep(backoff)
                        logger.info(f"模型调用重试 ({attempt + 1}/{_CALL_MAX_RETRIES}) {model}.{method}: {str(e)}")
                    else:
                        logger.error(f"模型调用失败（已重试 {_CALL_MAX_RETRIES} 次） {model}.{method}: {str(e)}")
                        break
            duration = time.time() - start_time
            return LLMCallResult(
                success=False,
                error=str(last_error) if last_error else "unknown",
                model_used=model,
                fallback_used=False
            )
            
        except Exception as e:
            logger.error(f"模型调用失败 {model}.{method}: {str(e)}")
            return LLMCallResult(
                success=False,
                error=str(e),
                model_used=model,
                fallback_used=False
            )
    
    async def _try_fallback_models(
        self, 
        method: str, 
        task_type: str, 
        params: Dict[str, Any],
        primary_model: Optional[str] = None
    ) -> LLMCallResult:
        """尝试故障转移模型（备用列表来自 registry.get_task_fallbacks）"""
        
        fallback_models = self.registry.get_task_fallbacks(task_type)
        
        if not fallback_models:
            logger.warning(f"任务类型 {task_type} 没有配置备用模型")
            return LLMCallResult(
                success=False,
                error=f"没有可用的故障转移模型"
            )
        
        logger.info(f"开始故障转移，共 {len(fallback_models)} 个备用模型: {fallback_models}")
        
        for fallback_model in fallback_models:
            # 跳过已尝试的主模型（精确匹配）
            if primary_model and fallback_model == primary_model:
                logger.debug(f"跳过备用模型 {fallback_model}（与主模型相同）")
                continue
            
            # 也检查params中是否已有model参数（向后兼容）
            if params.get("model") == fallback_model:
                logger.debug(f"跳过备用模型 {fallback_model}（已在params中）")
                continue
            
            logger.info(f"尝试故障转移模型: {fallback_model}")
            result = await self._call_with_model(method, fallback_model, params)
            
            if result.success:
                result.fallback_used = True
                logger.info(f"故障转移成功: {fallback_model}")
                return result
            else:
                logger.warning(f"故障转移模型 {fallback_model} 调用失败: {result.error}")
        
        logger.error(f"所有故障转移模型都失败，共尝试 {len(fallback_models)} 个模型")
        return LLMCallResult(
            success=False,
            error=f"所有模型调用失败，包括故障转移模型（共 {len(fallback_models)} 个）"
        )
    
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