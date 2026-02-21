"""
阿里云百炼 API 提供商
API文档：https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=2712576
"""

import json
from typing import Dict, List, Any, Optional, AsyncGenerator
import time

from app.core.llm.providers.base import BaseLLMProvider
from app.core.logger import get_logger, log_llm_call

logger = get_logger(__name__)

# 官方文档：qwen3-omni-flash 等 Omni 模型「stream 必须设置为 True，否则会报错」
_OMNI_MODELS_REQUIRE_STREAM = ("qwen3-omni-flash", "qwen-omni-turbo")


def _is_omni_model_require_stream(model: str) -> bool:
    """是否为必须使用 stream=True 的 Omni 模型"""
    model_lower = (model or "").strip().lower()
    return any(omni in model_lower for omni in _OMNI_MODELS_REQUIRE_STREAM)


def _normalize_messages_for_aliyun_audio(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """将 messages 中 input_audio 的 base64 转为 DashScope 要求的 data URI（data:audio/xxx;base64,xxx）。"""
    out: List[Dict[str, Any]] = []
    for msg in messages:
        new_msg = dict(msg)
        content = new_msg.get("content")
        if isinstance(content, list):
            new_content = []
            for block in content:
                if not isinstance(block, dict):
                    new_content.append(block)
                    continue
                if block.get("type") == "input_audio":
                    ia = block.get("input_audio") or {}
                    data = ia.get("data")
                    if isinstance(data, str) and data and not data.startswith("http") and not data.startswith("data:"):
                        fmt = (ia.get("format") or "mp3").strip().lower() or "mp3"
                        if fmt == "mpeg":
                            fmt = "mp3"
                        data_uri = f"data:audio/{fmt};base64,{data}"
                        new_content.append({
                            **block,
                            "input_audio": {**ia, "data": data_uri},
                        })
                    else:
                        new_content.append(block)
                else:
                    new_content.append(block)
            new_msg["content"] = new_content
        out.append(new_msg)
    return out


class AliyunBailianProvider(BaseLLMProvider):
    """阿里云百炼 API 提供商（OpenAI 兼容格式）"""

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.api_key = api_key
        # 使用OpenAI兼容模式的base_url
        self.base_url = (base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
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
        """聊天对话（OpenAI 兼容的 /chat/completions）。
        qwen3-omni-flash 等 Omni 模型要求 stream=True，本方法会在内部用流式请求并聚合成非流式返回。
        音频块 input_audio.data 若为 base64，会规范化为 DashScope 要求的 data URI。
        """
        import httpx

        messages = _normalize_messages_for_aliyun_audio(messages)

        # 获取 max_tokens，确保类型正确
        max_tokens = kwargs.get("max_tokens")
        if max_tokens is None:
            max_tokens = self._get_max_tokens_for_model(model, 8192)
        else:
            try:
                max_tokens = int(max_tokens)
            except (ValueError, TypeError):
                logger.warning(f"阿里云百炼 chat_completion [{model}]: max_tokens 值无效 ({max_tokens})，使用默认值8192")
                max_tokens = 8192
        
        original_max_tokens = max_tokens
        if max_tokens > 65536:
            logger.warning(f"阿里云百炼 chat_completion [{model}]: max_tokens {original_max_tokens} 超过限制65536，已限制为65536")
            max_tokens = 65536
        elif max_tokens < 1:
            logger.warning(f"阿里云百炼 chat_completion [{model}]: max_tokens {original_max_tokens} 小于1，已设置为1")
            max_tokens = 1

        use_stream = kwargs.get("stream", False)
        # Omni 模型必须 stream=True，否则 API 返回 400。若调用方未开流式，则内部用流式聚合后返回
        if _is_omni_model_require_stream(model) and not use_stream:
            return await self._chat_completion_omni_via_stream(
                messages=messages,
                model=model,
                max_tokens=max_tokens,
                kwargs=kwargs,
            )

        payload = {
            "model": model,
            "messages": messages,
            "stream": use_stream,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": max_tokens,
        }
        if "top_p" in kwargs:
            payload["top_p"] = kwargs["top_p"]
        if "top_k" in kwargs:
            payload["top_k"] = kwargs["top_k"]
        if "frequency_penalty" in kwargs:
            payload["frequency_penalty"] = kwargs["frequency_penalty"]
        if "presence_penalty" in kwargs:
            payload["presence_penalty"] = kwargs["presence_penalty"]

        timeout = 90.0
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
            logger.error(f"阿里云百炼 chat 超时 [{model}]: {e}")
            raise TimeoutError(f"阿里云百炼 请求超时（{timeout}s）") from e
        except Exception as e:
            duration = time.time() - start
            log_llm_call(model=model, task_type="chat", tokens_used=0, duration=duration, success=False)
            logger.error(f"阿里云百炼 chat 错误 [{model}]: {e}")
            raise

    async def _chat_completion_omni_via_stream(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        max_tokens: int,
        kwargs: Dict[str, Any],
    ) -> Dict[str, Any]:
        """对 Omni 模型用 stream=True 请求并聚合成非流式返回（仅文本输出）。"""
        import httpx

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
        # 仅要文本输出（如转写）时传 modalities=["text"]，避免服务端按多模态输出校验
        payload["modalities"] = ["text"]
        payload["stream_options"] = {"include_usage": True}

        timeout = 120.0
        start = time.time()
        content_parts: List[str] = []
        usage: Optional[Dict[str, Any]] = None

        try:
            stream_headers = {**self.headers, "Accept": "text/event-stream"}
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=stream_headers,
                    json=payload,
                    timeout=timeout,
                ) as response:
                    if response.status_code != 200:
                        error_text = ""
                        try:
                            async for line in response.aiter_lines():
                                error_text += line + "\n"
                                if len(error_text) > 1000:
                                    break
                        except Exception:
                            pass
                        logger.error(f"阿里云百炼 Omni stream [{model}]: HTTP {response.status_code} - {error_text[:500]}")
                        response.raise_for_status()

                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line or line.startswith(":"):
                            continue
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        if "error" in chunk:
                            err = chunk["error"]
                            raise ValueError(err.get("message", str(err)))
                        if "usage" in chunk:
                            usage = chunk["usage"]
                        if chunk.get("choices"):
                            delta = chunk["choices"][0].get("delta") or {}
                            part = delta.get("content") or ""
                            if part:
                                content_parts.append(part)
                    duration = time.time() - start
                    aggregated = "".join(content_parts)
                    total_tokens = (usage or {}).get("total_tokens", 0)
                    log_llm_call(model=model, task_type="chat", tokens_used=total_tokens, duration=duration, success=True)
                    return {
                        "choices": [
                            {
                                "index": 0,
                                "message": {"role": "assistant", "content": aggregated},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": usage or {"total_tokens": 0, "prompt_tokens": 0, "completion_tokens": 0},
                    }
        except Exception as e:
            duration = time.time() - start
            log_llm_call(model=model, task_type="chat", tokens_used=0, duration=duration, success=False)
            logger.error(f"阿里云百炼 Omni stream 聚合失败 [{model}]: {e}")
            raise

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        model: str,
        **kwargs
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """流式聊天对话（OpenAI 兼容 SSE）。
        参考官方文档：https://bailian.console.aliyun.com/cn-beijing?tab=api#/api/?type=model&url=3016807
        """
        import httpx

        # 获取 max_tokens，确保类型正确
        max_tokens = kwargs.get("max_tokens")
        if max_tokens is None:
            max_tokens = self._get_max_tokens_for_model(model, 8192)
        else:
            # 确保是整数类型
            try:
                max_tokens = int(max_tokens)
            except (ValueError, TypeError):
                logger.warning(f"阿里云百炼 stream_chat [{model}]: max_tokens 值无效 ({max_tokens})，使用默认值8192")
                max_tokens = 8192
        
        # 阿里云百炼限制：max_tokens范围是[1, 65536]
        original_max_tokens = max_tokens
        if max_tokens > 65536:
            logger.warning(f"阿里云百炼 stream_chat [{model}]: max_tokens {original_max_tokens} 超过限制65536，已限制为65536")
            max_tokens = 65536
        elif max_tokens < 1:
            logger.warning(f"阿里云百炼 stream_chat [{model}]: max_tokens {original_max_tokens} 小于1，已设置为1")
            max_tokens = 1
        
        # 记录最终使用的 max_tokens（用于调试）
        if original_max_tokens != max_tokens:
            logger.info(f"阿里云百炼 stream_chat [{model}]: max_tokens 从 {original_max_tokens} 调整为 {max_tokens}")
        
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
        
        # 添加 stream_options 以包含使用统计（可选）
        if "stream_options" in kwargs:
            payload["stream_options"] = kwargs["stream_options"]

        timeout = 120.0  # 流式调用需要更长超时
        chunk_count = 0
        try:
            # 流式请求需要特殊的 Accept 头
            stream_headers = {**self.headers, "Accept": "text/event-stream"}
            
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers=stream_headers,
                    json=payload,
                    timeout=timeout,
                ) as response:
                    logger.info(f"阿里云百炼 stream_chat [{model}]: HTTP状态码: {response.status_code}")
                    logger.info(f"阿里云百炼 stream_chat [{model}]: Content-Type: {response.headers.get('content-type', 'unknown')}")
                    
                    if response.status_code != 200:
                        # 读取错误响应
                        error_text = ""
                        try:
                            async for line in response.aiter_lines():
                                error_text += line + "\n"
                                if len(error_text) > 1000:  # 限制错误文本长度
                                    break
                        except:
                            pass
                        error_detail = error_text[:500] if error_text else ""
                        logger.error(f"阿里云百炼 stream_chat HTTP错误 [{model}]: {response.status_code} - {error_detail}")
                        response.raise_for_status()
                    
                    # 解析 SSE 格式的流式响应
                    line_count = 0
                    first_lines = []  # 记录前几行用于调试
                    raw_content_parts = []  # 记录原始内容片段
                    
                    try:
                        async for line in response.aiter_lines():
                            line_count += 1
                            original_line = line
                            line = line.strip()
                            
                            # 记录前10行用于调试
                            if line_count <= 10:
                                first_lines.append(f"行#{line_count}: {repr(original_line)}")
                            
                            # 跳过空行
                            if not line:
                                continue
                            
                            # 跳过注释行（SSE 规范中以 : 开头的行）
                            if line.startswith(":"):
                                logger.debug(f"阿里云百炼 stream_chat [{model}]: 跳过注释行: {line[:50]}")
                                continue
                            
                            # SSE 格式：data: {...}
                            if line.startswith("data: "):
                                data_str = line[6:].strip()
                                if data_str == "[DONE]":
                                    logger.info(f"阿里云百炼 stream_chat [{model}]: 收到结束信号，共 {chunk_count} 个chunk，{line_count} 行")
                                    break
                                
                                # 解析 JSON 数据
                                try:
                                    chunk_data = json.loads(data_str)
                                    
                                    # 检查是否是错误响应
                                    if "error" in chunk_data:
                                        error_info = chunk_data.get("error", {})
                                        error_msg = error_info.get("message", "未知错误")
                                        error_code = error_info.get("code", "unknown")
                                        logger.error(f"阿里云百炼 stream_chat [{model}]: API返回错误 - {error_code}: {error_msg}")
                                        raise ValueError(f"阿里云百炼API错误: {error_msg}")
                                    
                                    chunk_count += 1
                                    if chunk_count <= 3:  # 前3个chunk记录详细信息
                                        logger.info(f"阿里云百炼 stream_chat [{model}]: chunk #{chunk_count}: {str(chunk_data)[:200]}")
                                    yield chunk_data
                                except json.JSONDecodeError as e:
                                    logger.warning(f"阿里云百炼 stream_chat [{model}]: JSON解析失败，行 #{line_count}, 内容: {data_str[:200]}, 错误: {e}")
                                    continue
                            else:
                                # 如果不是 data: 开头的行，记录日志以便调试（前10行）
                                if line_count <= 10:
                                    logger.debug(f"阿里云百炼 stream_chat [{model}]: 行 #{line_count}, 非标准格式: {repr(line)}")
                                    raw_content_parts.append(line)
                    except Exception as e:
                        logger.error(f"阿里云百炼 stream_chat [{model}]: 读取响应流时出错: {type(e).__name__}: {str(e)}")
                        raise
                    
                    # 如果未收到chunk，输出详细信息用于调试
                    if chunk_count == 0:
                        logger.error(f"阿里云百炼 stream_chat [{model}]: 未收到任何有效chunk，共处理 {line_count} 行")
                        if first_lines:
                            logger.error(f"阿里云百炼 stream_chat [{model}]: 前10行内容:\n" + "\n".join(first_lines))
                        if raw_content_parts:
                            logger.error(f"阿里云百炼 stream_chat [{model}]: 非标准格式行内容: {raw_content_parts[:5]}")
        
        except httpx.HTTPStatusError as e:
            error_detail = ""
            if e.response is not None:
                try:
                    error_detail = e.response.text[:500]
                except:
                    pass
            logger.error(f"阿里云百炼 stream_chat HTTP错误 [{model}]: {e.response.status_code if e.response else 'Unknown'} - {error_detail}")
            raise
        except Exception as e:
            logger.error(f"阿里云百炼 stream_chat 错误 [{model}]: {type(e).__name__}: {str(e)}")
            logger.error(f"阿里云百炼 stream_chat [{model}]: 已收到 {chunk_count} 个chunk")
            raise

    async def embed_texts(self, texts: List[str], model: str) -> List[List[float]]:
        """文本向量化"""
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
            logger.error(f"阿里云百炼 embed_texts 错误 [{model}]: {e}")
            raise

    async def rerank(self, query: str, documents: List[str], model: str) -> List[Dict[str, Any]]:
        """文档重排序
        - qwen3-rerank: 使用兼容OpenAI的接口
        - qwen3-vl-rerank: 使用DashScope原生API（不支持兼容模式）
        """
        import httpx

        # qwen3-vl-rerank 需要使用原生API，其他模型使用兼容模式API
        use_native_api = "vl-rerank" in model.lower()
        
        if use_native_api:
            # DashScope原生API
            rerank_url = "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank"
            
            # 原生API格式：documents是对象数组
            document_objects = [{"text": doc} for doc in documents]
            
            payload = {
                "model": model,
                "input": {
                    "query": query,
                    "documents": document_objects,
                },
                "parameters": {
                    "return_documents": True,
                    "top_n": len(documents),  # 返回所有文档
                }
            }
        else:
            # OpenAI兼容模式API
            rerank_url = "https://dashscope.aliyuncs.com/compatible-api/v1/reranks"
            
            payload = {
                "model": model,
                "query": query,
                "documents": documents,
            }

        timeout = 60.0
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    rerank_url,
                    headers=self.headers,
                    json=payload,
                    timeout=timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                
                if use_native_api:
                    # 原生API返回格式：output.results 列表
                    results = data.get("output", {}).get("results", [])
                    formatted_results = []
                    for item in results:
                        formatted_results.append({
                            "document": item.get("document", {}).get("text", ""),
                            "score": item.get("relevance_score", 0.0),
                            "index": item.get("index", 0),
                        })
                else:
                    # OpenAI兼容格式：返回results列表
                    results = data.get("results", [])
                    formatted_results = []
                    for item in results:
                        formatted_results.append({
                            "document": item.get("document", ""),
                            "score": item.get("relevance_score", item.get("score", 0.0)),
                            "index": item.get("index", 0),
                        })
                
                return formatted_results
        except httpx.HTTPStatusError as e:
            error_detail = ""
            if e.response is not None:
                try:
                    error_detail = e.response.text[:500]
                except:
                    pass
            logger.error(f"阿里云百炼 rerank HTTP错误 [{model}]: {e.response.status_code if e.response else 'Unknown'} - {error_detail}")
            raise
        except Exception as e:
            logger.error(f"阿里云百炼 rerank 错误 [{model}]: {e}")
            raise

    def get_provider_info(self) -> Dict[str, Any]:
        """提供商信息"""
        return {
            "name": "AliyunBailian",
            "description": "阿里云百炼 API（OpenAI 兼容），支持千问系列模型",
            "capabilities": ["chat", "embedding", "reranker"],
            "models": {
                "chat": [],
                "embedding": [],
                "vision": [],
                "reranker": [],
            },
        }
