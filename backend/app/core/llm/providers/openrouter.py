"""
OpenRouter API 提供商
API文档：https://openrouter.ai/docs/api/
"""

import json
from typing import Dict, List, Any, Optional, AsyncGenerator
import time

from app.core.llm.providers.base import BaseLLMProvider
from app.core.logger import get_logger, log_llm_call

logger = get_logger(__name__)


class OpenRouterProvider(BaseLLMProvider):
    """OpenRouter API 提供商（OpenAI 兼容格式）"""

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        self.base_url = (base_url or "https://openrouter.ai/api/v1").rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/MMA-RAG",  # OpenRouter要求
            "X-Title": "MMA RAG",  # 应用名称
        }
        self._registry = None

    def set_registry(self, registry: Any) -> None:
        """设置 registry 引用，用于从模型配置读取 context_length 等"""
        self._registry = registry

    def _get_max_tokens_for_model(self, model: str, default_max_tokens: int = 2000) -> int:
        """从注册表获取模型的最大token数
        model 参数是 raw_model_name（实际API调用的模型名），需要通过 raw_model 字段反向查找配置
        """
        if self._registry:
            # 先尝试直接查找（可能是完整模型名）
            cfg = self._registry.get_model_config(model)
            if cfg:
                cl = cfg.get("context_length")
                if cl:
                    return cl
            
            # 如果直接查找失败，遍历所有模型配置，通过 raw_model 字段查找
            all_models = self._registry._models if hasattr(self._registry, '_models') else {}
            for model_name, config in all_models.items():
                raw_model = config.get("raw_model")
                if raw_model == model:
                    cl = config.get("context_length")
                    if cl:
                        return cl
                    break
        
        return default_max_tokens

    async def chat_completion(
        self, messages: List[Dict[str, str]], model: str, **kwargs
    ) -> Dict[str, Any]:
        """聊天对话（OpenAI 兼容的 /chat/completions）"""
        import httpx

        # 获取 max_tokens，使用固定默认值（与 SiliconFlow 保持一致）
        # max_tokens 表示输出的最大token数，不应该直接使用 context_length（总上下文长度）
        max_tokens = kwargs.get("max_tokens", 2000)
        
        # 确保是整数类型
        try:
            max_tokens = int(max_tokens)
        except (ValueError, TypeError):
            logger.warning(f"OpenRouter chat_completion [{model}]: max_tokens 值无效 ({max_tokens})，使用默认值2000")
            max_tokens = 2000

        payload = {
            "model": model,
            "messages": messages,
            "stream": kwargs.get("stream", False),
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": max_tokens,
        }
        
        # 添加可选参数
        if "top_p" in kwargs:
            payload["top_p"] = kwargs["top_p"]
        if "top_k" in kwargs:
            payload["top_k"] = kwargs["top_k"]
        if "frequency_penalty" in kwargs:
            payload["frequency_penalty"] = kwargs["frequency_penalty"]
        if "presence_penalty" in kwargs:
            payload["presence_penalty"] = kwargs["presence_penalty"]

        timeout = 90.0  # OpenRouter默认超时
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
            logger.error(f"OpenRouter chat 超时 [{model}]: {e}")
            raise TimeoutError(f"OpenRouter 请求超时（{timeout}s）") from e
        except httpx.HTTPStatusError as e:
            duration = time.time() - start
            log_llm_call(model=model, task_type="chat", tokens_used=0, duration=duration, success=False)
            error_detail = ""
            if e.response is not None:
                try:
                    error_detail = e.response.text[:500]
                except:
                    pass
            logger.error(f"OpenRouter chat HTTP错误 [{model}]: {e.response.status_code if e.response else 'Unknown'} - {error_detail}")
            raise
        except Exception as e:
            duration = time.time() - start
            log_llm_call(model=model, task_type="chat", tokens_used=0, duration=duration, success=False)
            logger.error(f"OpenRouter chat 错误 [{model}]: {e}")
            raise

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        model: str,
        **kwargs
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式聊天对话（OpenAI 兼容 SSE）。"""
        import httpx

        # 获取 max_tokens，使用固定默认值（与 SiliconFlow 保持一致）
        # max_tokens 表示输出的最大token数，不应该直接使用 context_length（总上下文长度）
        max_tokens = kwargs.get("max_tokens", 6000)
        
        # 确保是整数类型
        try:
            max_tokens = int(max_tokens)
        except (ValueError, TypeError):
            logger.warning(f"OpenRouter stream_chat [{model}]: max_tokens 值无效 ({max_tokens})，使用默认值6000")
            max_tokens = 6000
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": max_tokens,
        }
        
        if "top_p" in kwargs:
            payload["top_p"] = kwargs["top_p"]
        if "top_k" in kwargs:
            payload["top_k"] = kwargs["top_k"]

        timeout = 120.0  # 流式调用需要更长超时
        try:
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=self.headers,
                    json=payload,
                    timeout=timeout,
                ) as response:
                    if response.status_code != 200:
                        # 读取错误响应
                        error_text = ""
                        try:
                            async for line in response.aiter_lines():
                                error_text += line + "\n"
                        except:
                            pass
                        error_detail = error_text[:500] if error_text else response.text[:500]
                        logger.error(f"OpenRouter stream_chat HTTP错误 [{model}]: {response.status_code} - {error_detail}")
                        response.raise_for_status()
                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                yield json.loads(data_str)
                            except json.JSONDecodeError:
                                continue
        except httpx.HTTPStatusError as e:
            error_detail = ""
            if e.response is not None:
                try:
                    error_detail = e.response.text[:500]
                except:
                    pass
            logger.error(f"OpenRouter stream_chat HTTP错误 [{model}]: {e.response.status_code if e.response else 'Unknown'} - {error_detail}")
            raise
        except Exception as e:
            logger.error(f"OpenRouter stream_chat 错误 [{model}]: {e}")
            raise

    async def embed_texts(self, texts: List[str], model: str) -> List[List[float]]:
        """文本向量化（OpenRouter支持embeddings）"""
        import httpx

        payload = {
            "model": model,
            "input": texts,
        }

        timeout = 60.0
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self.base_url}/embeddings",
                    headers=self.headers,
                    json=payload,
                    timeout=timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                # OpenAI格式：data是一个列表，每个元素包含embedding字段
                embeddings = [item["embedding"] for item in data.get("data", [])]
                return embeddings
        except Exception as e:
            logger.error(f"OpenRouter embed_texts 错误 [{model}]: {e}")
            raise

    async def rerank(self, query: str, documents: List[str], model: str) -> List[Dict[str, Any]]:
        """文档重排序（OpenRouter可能不支持，需要检查）"""
        # OpenRouter可能不直接支持rerank，需要查看文档
        # 暂时抛出NotImplementedError，如果支持再实现
        raise NotImplementedError("OpenRouter API 暂不支持 rerank，请使用其他提供商的重排序模型")

    def get_provider_info(self) -> Dict[str, Any]:
        """提供商信息"""
        return {
            "name": "OpenRouter",
            "description": "OpenRouter API（OpenAI 兼容），支持多种模型",
            "capabilities": ["chat", "embedding"],
            "models": {
                "chat": [],
                "embedding": [],
                "vision": [],
                "reranker": [],
            },
        }
