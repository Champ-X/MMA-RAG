"""
LLM提供商基础模块
定义统一的提供商接口
"""

from typing import Dict, List, Any, Optional, Union, AsyncGenerator
from abc import ABC, abstractmethod
import asyncio

class BaseLLMProvider(ABC):
    """LLM提供商基类"""
    
    @abstractmethod
    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        聊天对话
        
        Args:
            messages: 对话消息列表
            model: 模型名称
            **kwargs: 其他参数
        
        Returns:
            API响应数据
        """
        pass
    
    @abstractmethod
    async def stream_chat(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        **kwargs
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式聊天对话，逐块 yield API 原始 chunk。"""
        ...

    @abstractmethod
    async def embed_texts(
        self, 
        texts: List[str], 
        model: str
    ) -> List[List[float]]:
        """
        文本向量化
        
        Args:
            texts: 待向量化文本列表
            model: 嵌入模型名称
        
        Returns:
            向量列表
        """
        pass
    
    @abstractmethod
    async def rerank(
        self, 
        query: str, 
        documents: List[str],
        model: str
    ) -> List[Dict[str, Any]]:
        """
        文档重排序
        
        Args:
            query: 查询文本
            documents: 文档列表
            model: 重排序模型名称
        
        Returns:
            重排序结果列表
        """
        pass
    
    def get_provider_info(self) -> Dict[str, Any]:
        """获取提供商信息"""
        return {
            "name": self.__class__.__name__,
            "capabilities": ["chat", "embedding", "reranking"]
        }
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        registry = getattr(self, "_registry", None)
        if registry is None:
            return {"status": "unknown", "error": "No registry for provider health probe"}
        models = [name for name in registry.list_models("chat")
                  if registry.get_provider(registry.get_model_config(name).get("provider")) is self]
        if not models:
            return {"status": "unknown", "error": "No chat model configured"}
        preferred = [registry.get_task_model(task) for task in ("health_check", "final_generation", "intent_recognition")]
        model = next((name for name in preferred if name in models), None)
        if model is None:
            model = next((name for name in models if registry.get_model_config(name).get("catalog_presence") == "present"), models[0])
        try:
            result = await asyncio.wait_for(self.chat_completion(
                messages=[{"role": "user", "content": "Reply with OK."}],
                model=registry.get_raw_model_name(model), max_tokens=256, timeout=15,
            ), timeout=20)
            return {"status": "healthy" if result.get("choices") else "unhealthy",
                    "model": model, "scope": "single_model_chat"}
        except Exception as exc:
            return {"status": "unhealthy", "model": model, "error": type(exc).__name__}

class ChatProvider(ABC):
    """聊天功能提供商基类"""
    
    @abstractmethod
    async def chat(
        self, 
        messages: List[Dict[str, str]], 
        **kwargs
    ) -> Dict[str, Any]:
        """聊天对话"""
        pass
    
    @abstractmethod
    async def stream_chat(
        self, 
        messages: List[Dict[str, str]], 
        **kwargs
    ):
        """流式聊天对话"""
        pass

class EmbeddingProvider(ABC):
    """嵌入功能提供商基类"""
    
    @abstractmethod
    async def embed(
        self, 
        texts: List[str], 
        **kwargs
    ) -> List[List[float]]:
        """文本向量化"""
        pass

class VisionProvider(ABC):
    """视觉功能提供商基类"""
    
    @abstractmethod
    async def describe_image(
        self, 
        image_content: str, 
        **kwargs
    ) -> str:
        """图片描述"""
        pass
    
    @abstractmethod
    async def analyze_chart(
        self, 
        chart_content: str, 
        **kwargs
    ) -> Dict[str, Any]:
        """图表分析"""
        pass

class RerankerProvider(ABC):
    """重排序功能提供商基类"""
    
    @abstractmethod
    async def rerank(
        self, 
        query: str, 
        documents: List[str], 
        **kwargs
    ) -> List[Dict[str, Any]]:
        """重排序"""
        pass

class ProviderFactory:
    """提供商工厂"""
    
    _providers: Dict[str, BaseLLMProvider] = {}
    
    @classmethod
    def register_provider(cls, name: str, provider: BaseLLMProvider):
        """注册提供商"""
        cls._providers[name] = provider
    
    @classmethod
    def get_provider(cls, name: str) -> Optional[BaseLLMProvider]:
        """获取提供商"""
        return cls._providers.get(name)
    
    @classmethod
    def list_providers(cls) -> List[str]:
        """列出所有提供商"""
        return list(cls._providers.keys())