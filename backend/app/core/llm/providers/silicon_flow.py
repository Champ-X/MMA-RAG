"""
SiliconFlow API提供商实现
支持聊天、嵌入、重排序等功能
"""

from typing import Dict, List, Any, Optional
import httpx
import json
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

    def _get_timeout_for_model(self, model: str) -> float:
        """根据模型类型返回合适的超时时间（秒）"""
        # Thinking 模型（推理模型）需要更长的超时时间
        if "Thinking" in model or "thinking" in model.lower():
            return 90.0  # 235B Thinking 模型建议90秒
        # 大型模型（235B, 72B等）也需要更长超时
        if "235B" in model or "72B" in model:
            return 60.0
        # 默认60秒
        return 60.0
    
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
        timeout = self._get_timeout_for_model(model)
        
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
            logger.error(f"SiliconFlow embedding错误: {str(e)}")
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
        """流式聊天对话。参见 SiliconFlow 流式文档：payload 中 stream=True，请求使用 stream 模式。"""
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 2000)
        }
        
        try:
            async with self.client.stream(
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
                            yield chunk_data
                        except json.JSONDecodeError:
                            continue
                            
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP错误: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"SiliconFlow streaming错误: {str(e)}")
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