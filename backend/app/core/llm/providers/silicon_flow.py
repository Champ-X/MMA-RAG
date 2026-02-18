"""
SiliconFlow API提供商实现
支持聊天、嵌入、重排序等功能
"""

from typing import Dict, List, Any, Optional
import httpx
import json
import asyncio
from .base import BaseLLMProvider
from app.core.logger import get_logger

logger = get_logger(__name__)

class SiliconFlowProvider(BaseLLMProvider):
    """SiliconFlow API提供商"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.siliconflow.cn/v1"
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        # 默认超时30秒，但会在调用时根据模型类型动态调整
        self.client = httpx.AsyncClient(timeout=60.0)

    def set_registry(self, registry: Any) -> None:
        """设置 registry 引用（可选，与 DeepSeek 等提供商接口一致）"""
        pass

    def _get_timeout_for_model(self, model: str, is_stream: bool = False) -> float:
        """根据模型类型返回合适的超时时间（秒）
        
        Args:
            model: 模型名称
            is_stream: 是否为流式调用，流式调用需要更长的超时时间
        """
        base_timeout = 100.0
        
        # VLM/视觉模型（图生描述等）处理大图较慢，需要更长超时
        if "VL" in model or "Vision" in model or "vision" in model.lower() or "Caption" in model or "caption" in model.lower():
            base_timeout = 180.0  # 图生描述建议 180 秒，避免大图未完成即超时
        # Thinking 模型（推理模型）需要更长的超时时间
        elif "Thinking" in model or "thinking" in model.lower():
            base_timeout = 120.0  # 235B Thinking 模型建议90秒
        # 大型模型（235B, 72B等）也需要更长超时
        elif "235B" in model or "72B" in model:
            base_timeout = 60.0
        
        # 流式调用需要更长的超时时间，因为数据是逐步返回的
        # 对于流式调用，增加2-3倍的超时时间以应对长响应
        if is_stream:
            return base_timeout * 2.5  # 流式调用使用2.5倍超时时间
        
        return base_timeout
    
    def _get_stream_timeout(self, model: str) -> httpx.Timeout:
        """为流式调用创建专门的超时配置
        
        流式调用需要区分连接超时和读取超时：
        - connect: 连接建立超时（较短）
        - read: 读取数据超时（较长，因为数据逐步返回）
        """
        total_timeout = self._get_timeout_for_model(model, is_stream=True)
        
        # 连接超时：10秒（快速失败）
        # 读取超时：总超时时间（允许长时间等待数据）
        # write超时：30秒（发送请求数据）
        # pool超时：10秒（从连接池获取连接）
        return httpx.Timeout(
            connect=10.0,
            read=total_timeout,
            write=30.0,
            pool=10.0
        )
    
    async def chat_completion(
        self, 
        messages: List[Dict[str, str]], 
        model: str,
        **kwargs
    ) -> Dict[str, Any]:
        """聊天对话"""
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": kwargs.get("stream", False),
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 2000),
            "top_p": kwargs.get("top_p", 0.9),
            "frequency_penalty": kwargs.get("frequency_penalty", 0.0),
            "presence_penalty": kwargs.get("presence_penalty", 0.0)
        }
        
        # 根据模型类型动态设置超时时间（使用原始模型名称）
        timeout = self._get_timeout_for_model(model, is_stream=False)
        
        try:
            # 使用临时客户端以应用动态超时
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self.headers,
                    json=payload
                )
                response.raise_for_status()
                return response.json()
            
        except httpx.TimeoutException as e:
            error_msg = f"请求超时（超时设置: {timeout}秒）: {str(e)}"
            logger.error(f"SiliconFlow chat超时 [{model}]: {error_msg}")
            raise TimeoutError(error_msg) from e
        except httpx.HTTPStatusError as e:
            error_detail = ""
            try:
                error_detail = e.response.text[:500]  # 限制长度避免日志过长
            except:
                pass
            error_msg = f"HTTP错误 {e.response.status_code}: {error_detail}"
            logger.error(f"SiliconFlow chat HTTP错误 [{model}]: {error_msg}")
            raise
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            logger.error(f"SiliconFlow chat错误 [{model}]: {error_msg}")
            raise
    
    async def embed_texts(
        self, 
        texts: List[str], 
        model: str
    ) -> List[List[float]]:
        """文本向量化"""
        
        payload = {
            "model": model,
            "input": texts
        }
        
        try:
            # 尝试使用现有的 client
            response = await self.client.post(
                f"{self.base_url}/embeddings",
                headers=self.headers,
                json=payload
            )
            response.raise_for_status()
            result = response.json()
            
            # 提取嵌入向量
            embeddings = []
            for item in result.get("data", []):
                embeddings.append(item.get("embedding", []))
            
            return embeddings
            
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP错误: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            err_msg = str(e)
            # 如果是事件循环相关的错误，使用新的 client 重试
            # 不记录为ERROR，因为 manager 会处理重试
            if "Event loop is closed" in err_msg or "event loop" in err_msg.lower():
                # 只记录DEBUG级别，让 manager 处理重试逻辑
                logger.debug(f"SiliconFlow embedding遇到事件循环问题，尝试使用新 client: {err_msg}")
                try:
                    # 创建新的 client 并重试
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        response = await client.post(
                            f"{self.base_url}/embeddings",
                            headers=self.headers,
                            json=payload
                        )
                        response.raise_for_status()
                        result = response.json()
                        
                        embeddings = []
                        for item in result.get("data", []):
                            embeddings.append(item.get("embedding", []))
                        
                        logger.debug("SiliconFlow embedding使用新 client 重试成功")
                        return embeddings
                except Exception as e2:
                    # 重试失败，抛出异常让 manager 处理
                    # manager 会记录WARNING并尝试在新事件循环中重试
                    raise e2
            else:
                # 非事件循环错误，记录ERROR并抛出
                logger.error(f"SiliconFlow embedding错误: {err_msg}")
                raise
    
    async def rerank(
        self, 
        query: str, 
        documents: List[str],
        model: str
    ) -> List[Dict[str, Any]]:
        """文档重排序"""
        
        # 验证输入参数
        if not query or not query.strip():
            raise ValueError("查询不能为空")
        
        if not documents:
            raise ValueError("文档列表不能为空")
        
        # 过滤空文档并限制文档数量
        valid_documents = [doc.strip() for doc in documents if doc and doc.strip()]
        if not valid_documents:
            raise ValueError("没有有效的文档")
        
        # 限制文档数量（API可能有限制）
        max_documents = 100
        if len(valid_documents) > max_documents:
            logger.warning(f"文档数量超过限制({max_documents})，只处理前{max_documents}个")
            valid_documents = valid_documents[:max_documents]
        
        # 限制每个文档的长度（避免API错误）
        max_doc_length = 10000
        truncated_documents = []
        for doc in valid_documents:
            if len(doc) > max_doc_length:
                logger.warning(f"文档长度超过限制({max_doc_length})，已截断")
                truncated_documents.append(doc[:max_doc_length])
            else:
                truncated_documents.append(doc)
        
        payload = {
            "model": model,
            "query": query.strip(),
            "documents": truncated_documents
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/rerank",
                headers=self.headers,
                json=payload
            )
            response.raise_for_status()
            result = response.json()
            
            return result.get("results", [])
            
        except httpx.HTTPStatusError as e:
            error_detail = ""
            try:
                error_detail = e.response.text
            except:
                pass
            logger.error(f"HTTP错误: {e.response.status_code} - {error_detail}")
            logger.error(f"请求参数: query长度={len(query)}, documents数量={len(truncated_documents)}")
            raise
        except Exception as e:
            logger.error(f"SiliconFlow rerank错误: {str(e)}")
            raise
    
    async def stream_chat(
        self, 
        messages: List[Dict[str, str]], 
        model: str,
        **kwargs
    ):
        """流式聊天对话。参见 SiliconFlow 流式文档：payload 中 stream=True，请求使用 stream 模式。
        
        使用专门的流式超时配置，区分连接超时和读取超时，以应对长响应场景。
        """
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 2000)
        }
        
        # 使用专门的流式超时配置
        timeout = self._get_stream_timeout(model)
        total_timeout_seconds = timeout.read  # 用于日志记录
        
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=self.headers,
                    json=payload
                ) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_lines():
                        if isinstance(chunk, bytes):
                            chunk = chunk.decode("utf-8")
                        if chunk.startswith("data: "):
                            data_str = chunk[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk_data = json.loads(data_str)
                            except json.JSONDecodeError:
                                continue
                            err = (chunk_data or {}).get("error")
                            if err is not None:
                                msg = err.get("message", err) if isinstance(err, dict) else str(err)
                                logger.error(f"SiliconFlow 流式返回错误 [{model}]: {msg}")
                                raise RuntimeError(f"流式 API 错误: {msg}")
                            yield chunk_data
        except httpx.HTTPStatusError as e:
            body = getattr(e.response, "text", "") or ""
            logger.error(f"SiliconFlow 流式 HTTP 错误 [{model}]: {e.response.status_code} - {body[:500]}")
            raise
        except httpx.TimeoutException as e:
            logger.error(f"SiliconFlow 流式超时 [{model}] (读取超时={total_timeout_seconds}s): {type(e).__name__} {repr(e)}")
            raise TimeoutError(f"流式请求超时（读取超时={total_timeout_seconds}s）: {e}") from e
        except httpx.RemoteProtocolError as e:
            # 处理连接提前关闭的情况
            err_msg = str(e).strip() or repr(e)
            logger.warning(f"SiliconFlow 流式连接中断 [{model}]: {type(e).__name__} - {err_msg}")
            logger.info(f"这可能是网络波动或服务端提前关闭连接导致的，建议检查网络连接或联系服务提供商")
            raise ConnectionError(f"流式连接中断: {err_msg}") from e
        except Exception as e:
            err_msg = str(e).strip() or repr(e)
            logger.error(f"SiliconFlow 流式错误 [{model}]: {type(e).__name__} - {err_msg}", exc_info=True)
            raise
    
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            # 使用嵌入API进行简单测试
            test_result = await self.embed_texts(
                texts=["hello"],
                model="Qwen/Qwen3-Embedding-8B"
            )
            return {
                "status": "healthy",
                "test_passed": True,
                "embedding_dimension": len(test_result[0]) if test_result else 0
            }
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e),
                "test_passed": False
            }
    
    def get_provider_info(self) -> Dict[str, Any]:
        """获取提供商信息（模型列表从 LLMRegistry 动态读取，与单一数据源一致）"""
        try:
            from app.core.llm.manager import llm_manager
            r = llm_manager.registry
            return {
                "name": "SiliconFlow",
                "description": "SiliconFlow AI API 提供商",
                "capabilities": ["chat", "embedding", "reranking", "vision"],
                "models": {
                    "chat": r.list_models("chat"),
                    "embedding": r.list_models("embedding"),
                    "vision": r.list_models("vision"),
                    "reranker": r.list_models("reranker"),
                },
            }
        except Exception:
            # 若在 registry 尚未初始化时调用，退回空列表，避免硬编码
            return {
                "name": "SiliconFlow",
                "description": "SiliconFlow AI API 提供商",
                "capabilities": ["chat", "embedding", "reranking", "vision"],
                "models": {"chat": [], "embedding": [], "vision": [], "reranker": []},
            }
    
    async def close(self):
        """关闭客户端"""
        await self.client.aclose()

# 便捷函数
def create_siliconflow_provider(api_key: str) -> SiliconFlowProvider:
    """创建SiliconFlow提供商实例"""
    return SiliconFlowProvider(api_key)