"""
DeepSeek API 提供商
使用与 OpenAI 兼容的 API：https://api.deepseek.com
文档：deepseek-chat 对应 DeepSeek-V3.2 非思考模式，deepseek-reasoner 对应思考模式
"""

from typing import Dict, List, Any, Optional
import time

from app.core.llm import BaseLLMProvider  # 与 LLMRegistry._providers 类型一致
from app.core.logger import get_logger, log_llm_call

logger = get_logger(__name__)


class DeepSeekProvider(BaseLLMProvider):
    """DeepSeek API 提供商（OpenAI 兼容格式）
 
    注意：DeepSeek 官方文档当前推荐的 base_url 为
    https://api.deepseek.com ，聊天接口路径为 /chat/completions ，
    而不是早期版本中的 /v1/chat/completions。
    """
 
    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        # 默认使用官方文档中的 base_url（不带 /v1）
        # 这样下面拼接的就是 https://api.deepseek.com/chat/completions
        self.base_url = (base_url or "https://api.deepseek.com").rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._registry = None

    def set_registry(self, registry: Any) -> None:
        """设置 registry 引用，用于从模型配置读取 context_length 等"""
        self._registry = registry

    def _get_max_tokens_for_model(self, model: str, default_max_tokens: int = 2000) -> int:
        if self._registry:
            cfg = self._registry.get_model_config(model)
            if cfg:
                cl = cfg.get("context_length")
                if cl:
                    return cl
        return default_max_tokens

    async def chat_completion(
        self, messages: List[Dict[str, str]], model: str, **kwargs
    ) -> Dict[str, Any]:
        """聊天对话（OpenAI 兼容的 /v1/chat/completions）"""
        import httpx

        max_tokens = kwargs.get("max_tokens")
        if max_tokens is None:
            max_tokens = self._get_max_tokens_for_model(model, 8192)

        payload = {
            "model": model,
            "messages": messages,
            "stream": kwargs.get("stream", False),
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": max_tokens,
        }

        # reasoner 为思考模式，需更长超时
        timeout = 90.0 if "reasoner" in model.lower() else 30.0
        start = time.time()
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self.headers,
                    json=payload,
                    timeout=timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                duration = time.time() - start
                tokens = data.get("usage", {}).get("total_tokens", 0)
                log_llm_call(model=model, task_type="chat", tokens_used=tokens, duration=duration, success=True)
                return data
        except httpx.TimeoutException as e:
            duration = time.time() - start
            log_llm_call(model=model, task_type="chat", tokens_used=0, duration=duration, success=False)
            logger.error(f"DeepSeek chat 超时 [{model}]: {e}")
            raise TimeoutError(f"DeepSeek 请求超时（{timeout}s）") from e
        except Exception as e:
            duration = time.time() - start
            log_llm_call(model=model, task_type="chat", tokens_used=0, duration=duration, success=False)
            logger.error(f"DeepSeek chat 错误 [{model}]: {e}")
            raise

    async def embed_texts(self, texts: List[str], model: str) -> List[List[float]]:
        """DeepSeek 官方 API 暂无 embedding，需使用其他提供商（如 SiliconFlow）的嵌入模型"""
        raise NotImplementedError("DeepSeek API 不支持 embedding，请在任务路由中使用 SiliconFlow 等提供商的嵌入模型")

    async def rerank(self, query: str, documents: List[str], model: str) -> List[Dict[str, Any]]:
        """DeepSeek 官方 API 暂无 rerank，需使用其他提供商的重排序模型"""
        raise NotImplementedError("DeepSeek API 不支持 rerank，请在任务路由中使用 SiliconFlow 等提供商的重排序模型")

    def get_provider_info(self) -> Dict[str, Any]:
        """提供商信息。DeepSeek 官方模型：deepseek-chat（非思考）、deepseek-reasoner（思考模式）"""
        return {
            "name": "DeepSeek",
            "description": "DeepSeek API（OpenAI 兼容），base_url=https://api.deepseek.com",
            "capabilities": ["chat"],
            "models": {
                "chat": ["deepseek-chat", "deepseek-reasoner"],
                "embedding": [],
                "vision": [],
                "reranker": [],
            },
        }
