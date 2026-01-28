"""
LLM管理器主类
统一的LLM调用接口，支持模型路由和故障转移
"""

from typing import Dict, List, Any, Optional, Union
from . import LLMRegistry, BaseLLMProvider
from app.core.logger import get_logger
import asyncio
import time
from dataclasses import dataclass

logger = get_logger(__name__)

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
        messages: List[Dict[str, str]], 
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
        
        # 尝试主模型
        result = await self._call_with_model(
            "chat_completion", 
            model, 
            {"messages": messages, **kwargs}
        )
        
        # 如果失败且启用了故障转移，尝试备用模型
        if not result.success and fallback:
            result = await self._try_fallback_models(
                "chat_completion", 
                task_type, 
                {"messages": messages, **kwargs}
            )
        
        return result
    
    async def embed(
        self, 
        texts: List[str], 
        task_type: str = "embedding",
        model: Optional[str] = None,
        fallback: bool = False,
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
        
        # 嵌入模型通常不需要故障转移
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
            result = await self._try_fallback_models(
                "rerank", 
                task_type, 
                {"query": query, "documents": documents, **kwargs}
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
            model_config = self.registry.get_model_config(model)
            provider_name = model_config.get("provider")
            
            if not provider_name:
                return LLMCallResult(
                    success=False,
                    error=f"模型 {model} 没有配置提供商"
                )
            
            provider = self.registry.get_provider(provider_name)
            if not provider:
                return LLMCallResult(
                    success=False,
                    error=f"提供商 {provider_name} 不存在"
                )
            
            # 获取对应方法
            method_func = getattr(provider, method)
            
            # 添加模型参数
            if method == "chat_completion":
                params["model"] = model
                # 如果没有指定max_tokens，根据模型的context_length设置
                if "max_tokens" not in params or params.get("max_tokens") is None:
                    context_length = model_config.get("context_length", 2000)
                    # max_tokens应该是输出token的最大值，设置为context_length的80%或context_length本身
                    # 但考虑到实际使用，设置为context_length的值（用户要求设置为最大值）
                    params["max_tokens"] = context_length
                    logger.debug(f"根据模型 {model} 的 context_length ({context_length}) 设置 max_tokens={params['max_tokens']}")
            elif method == "embed_texts":
                params["model"] = model
            elif method == "rerank":
                params["model"] = model
            
            start_time = time.time()
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
        params: Dict[str, Any]
    ) -> LLMCallResult:
        """尝试故障转移模型（备用列表来自 registry.get_task_fallbacks）"""
        
        fallback_models = self.registry.get_task_fallbacks(task_type)
        
        for fallback_model in fallback_models:
            if fallback_model in params.get("model", ""):
                continue  # 跳过已尝试的主模型
            
            logger.info(f"尝试故障转移模型: {fallback_model}")
            result = await self._call_with_model(method, fallback_model, params)
            
            if result.success:
                result.fallback_used = True
                logger.info(f"故障转移成功: {fallback_model}")
                return result
        
        return LLMCallResult(
            success=False,
            error=f"所有模型调用失败，包括故障转移模型"
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