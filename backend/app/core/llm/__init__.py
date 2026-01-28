"""
模块化LLM管理器
统一管理所有LLM模型调用，支持多种模型提供商
"""

from typing import Dict, List, Any, Optional, Union
from abc import ABC, abstractmethod
import asyncio
from app.core.config import settings
from app.core.logger import get_logger, log_llm_call
import time
import json

logger = get_logger(__name__)


class BaseLLMProvider(ABC):
    """LLM提供商基类"""
    
    @abstractmethod
    async def chat_completion(self, messages: List[Dict[str, str]], **kwargs) -> Dict[str, Any]:
        """聊天对话"""
        pass
    
    @abstractmethod
    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """文本向量化"""
        pass
    
    @abstractmethod
    async def rerank(self, query: str, documents: List[str]) -> List[Dict[str, Any]]:
        """重排序"""
        pass

class SiliconFlowProvider(BaseLLMProvider):
    """SiliconFlow API提供商"""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.siliconflow.cn/v1"
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        # 存储registry引用以便获取模型配置
        self._registry = None
    
    def set_registry(self, registry):
        """设置registry引用"""
        self._registry = registry
    
    def _get_max_tokens_for_model(self, model: str, default_max_tokens: int = 2000) -> int:
        """根据模型配置获取max_tokens"""
        if self._registry:
            model_config = self._registry.get_model_config(model)
            if model_config:
                context_length = model_config.get("context_length")
                if context_length:
                    # 根据用户要求，设置为context_length的最大值
                    return context_length
        return default_max_tokens
    
    async def chat_completion(self, messages: List[Dict[str, str]], model: str, **kwargs) -> Dict[str, Any]:
        """聊天对话实现"""
        import httpx
        
        # 如果没有指定max_tokens，根据模型配置设置
        max_tokens = kwargs.get("max_tokens")
        if max_tokens is None:
            max_tokens = self._get_max_tokens_for_model(model, 2000)
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": kwargs.get("stream", False),
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": max_tokens
        }
        
        # 根据模型类型动态设置超时时间
        def _get_timeout_for_model(model: str) -> float:
            """根据模型类型返回合适的超时时间（秒）"""
            if "Thinking" in model or "thinking" in model.lower():
                return 90.0  # Thinking 模型建议90秒
            if "235B" in model or "72B" in model:
                return 90.0  # 大型模型90秒
            return 30.0  # 默认30秒
        
        timeout = _get_timeout_for_model(model)
        start_time = time.time()
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self.headers,
                    json=payload,
                    timeout=timeout
                )
                response.raise_for_status()
                result = response.json()
                
                duration = time.time() - start_time
                tokens_used = result.get("usage", {}).get("total_tokens", 0)
                
                log_llm_call(
                    model=model,
                    task_type="chat",
                    tokens_used=tokens_used,
                    duration=duration,
                    success=True
                )
                
                return result
                
        except httpx.TimeoutException as e:
            duration = time.time() - start_time
            error_msg = f"请求超时（超时设置: {timeout}秒，实际耗时: {duration:.2f}秒）"
            log_llm_call(
                model=model,
                task_type="chat",
                tokens_used=0,
                duration=duration,
                success=False
            )
            logger.error(f"SiliconFlow chat超时 [{model}]: {error_msg}")
            raise TimeoutError(error_msg) from e
        except Exception as e:
            duration = time.time() - start_time
            error_msg = f"{type(e).__name__}: {str(e)}"
            log_llm_call(
                model=model,
                task_type="chat",
                tokens_used=0,
                duration=duration,
                success=False
            )
            logger.error(f"SiliconFlow chat错误 [{model}]: {error_msg}")
            raise
    
    async def embed_texts(self, texts: List[str], model: str) -> List[List[float]]:
        """文本向量化实现"""
        import httpx
        
        payload = {
            "model": model,
            "input": texts
        }
        
        # 根据文本数量和模型类型动态设置超时时间
        def _get_embedding_timeout(texts: List[str], model: str) -> float:
            """根据文本数量和模型类型返回合适的超时时间（秒）"""
            base_timeout = 60.0  # 基础超时60秒
            # 根据文本数量增加超时时间（每个文本增加5秒）
            text_count_factor = len(texts) * 5.0
            # 大型模型可能需要更长时间
            if "8B" in model or "large" in model.lower():
                model_factor = 1.5
            else:
                model_factor = 1.0
            return min(base_timeout + text_count_factor * model_factor, 180.0)  # 最多180秒
        
        timeout = _get_embedding_timeout(texts, model)
        start_time = time.time()
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers=self.headers,
                    json=payload,
                    timeout=timeout
                )
                response.raise_for_status()
                result = response.json()
                
                duration = time.time() - start_time
                embeddings = [item["embedding"] for item in result["data"]]
                
                # 尝试从API响应中提取token使用量
                tokens_used = 0
                if "usage" in result:
                    tokens_used = result["usage"].get("total_tokens", 0)
                elif "data" in result and result["data"]:
                    # 某些API可能在data中返回usage信息
                    first_item = result["data"][0]
                    if "usage" in first_item:
                        tokens_used = first_item["usage"].get("total_tokens", 0)
                
                log_llm_call(
                    model=model,
                    task_type="embedding",
                    tokens_used=tokens_used,
                    duration=duration,
                    success=True
                )
                
                return embeddings
                
        except httpx.TimeoutException as e:
            duration = time.time() - start_time
            error_msg = f"请求超时（超时设置: {timeout}秒，实际耗时: {duration:.2f}秒）"
            log_llm_call(
                model=model,
                task_type="embedding",
                tokens_used=0,
                duration=duration,
                success=False
            )
            logger.error(f"SiliconFlow embedding超时 [{model}]: {error_msg}")
            raise TimeoutError(error_msg) from e
        except Exception as e:
            duration = time.time() - start_time
            error_msg = f"{type(e).__name__}: {str(e)}"
            log_llm_call(
                model=model,
                task_type="embedding",
                tokens_used=0,
                duration=duration,
                success=False
            )
            logger.error(f"SiliconFlow embedding错误 [{model}]: {error_msg}")
            raise
    
    async def rerank(self, query: str, documents: List[str], model: str) -> List[Dict[str, Any]]:
        """重排序实现"""
        import httpx
        
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
        
        start_time = time.time()
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/rerank",
                    headers=self.headers,
                    json=payload,
                    timeout=30.0
                )
                response.raise_for_status()
                result = response.json()
                
                duration = time.time() - start_time
                
                # 尝试从API响应中提取token使用量
                tokens_used = 0
                
                # 方法1: 检查顶层usage字段
                if "usage" in result:
                    usage = result["usage"]
                    if isinstance(usage, dict):
                        tokens_used = usage.get("total_tokens", 0) or usage.get("tokens", 0) or usage.get("prompt_tokens", 0)
                    elif isinstance(usage, (int, float)):
                        tokens_used = int(usage)
                
                # 方法2: 检查data字段中的usage
                if tokens_used == 0 and "data" in result:
                    data = result["data"]
                    if isinstance(data, dict) and "usage" in data:
                        usage = data["usage"]
                        if isinstance(usage, dict):
                            tokens_used = usage.get("total_tokens", 0) or usage.get("tokens", 0) or usage.get("prompt_tokens", 0)
                
                # 方法3: 检查results中的usage（某些API格式）
                if tokens_used == 0 and "results" in result:
                    results = result["results"]
                    if isinstance(results, list) and results:
                        first_result = results[0]
                        if isinstance(first_result, dict) and "usage" in first_result:
                            usage = first_result["usage"]
                            if isinstance(usage, dict):
                                tokens_used = usage.get("total_tokens", 0) or usage.get("tokens", 0)
                
                # 方法4: 如果API不返回token，尝试估算
                if tokens_used == 0:
                    # 粗略估算：rerank通常处理query + documents
                    query_chars = len(query)
                    docs_chars = sum(len(doc) for doc in truncated_documents)
                    # 使用保守估算：中文1字符≈1token，英文1单词≈1.3tokens，平均按3字符/token估算
                    estimated_tokens = int((query_chars + docs_chars) / 3)
                    tokens_used = estimated_tokens
                    logger.debug(
                        f"Rerank API未返回token使用量，使用估算值: "
                        f"查询长度={query_chars}字符, 文档总长度={docs_chars}字符, "
                        f"估算tokens={estimated_tokens}, API响应keys={list(result.keys())}"
                    )
                else:
                    # 确保tokens_used是int类型
                    tokens_used = int(tokens_used)
                    logger.debug(f"Rerank API返回token使用量: {tokens_used}")
                
                log_llm_call(
                    model=model,
                    task_type="rerank",
                    tokens_used=tokens_used,
                    duration=duration,
                    success=True
                )
                
                return result.get("results", [])
                
        except httpx.HTTPStatusError as e:
            duration = time.time() - start_time
            error_detail = ""
            try:
                error_detail = e.response.text
            except:
                pass
            log_llm_call(
                model=model,
                task_type="rerank",
                tokens_used=0,
                duration=duration,
                success=False
            )
            logger.error(f"HTTP错误: {e.response.status_code} - {error_detail}")
            logger.error(f"请求参数: query长度={len(query)}, documents数量={len(truncated_documents)}")
            raise
        except Exception as e:
            duration = time.time() - start_time
            log_llm_call(
                model=model,
                task_type="rerank",
                tokens_used=0,
                duration=duration,
                success=False
            )
            logger.error(f"SiliconFlow rerank error: {str(e)}")
            raise

class LLMRegistry:
    """模型注册表"""
    
    def __init__(self):
        self._providers: Dict[str, BaseLLMProvider] = {}
        self._models: Dict[str, Dict[str, Any]] = {}
        self._task_routing: Dict[str, str] = {}
        self._load_config()
    
    def _load_config(self):
        """加载模型配置"""
        # SiliconFlow 提供商
        siliconflow_provider = SiliconFlowProvider(settings.siliconflow_api_key)
        siliconflow_provider.set_registry(self)  # 设置registry引用
        self._providers["siliconflow"] = siliconflow_provider

        # DeepSeek 提供商（可选，需配置 DEEPSEEK_API_KEY）
        deepseek_key = getattr(settings, "deepseek_api_key", None)
        if deepseek_key:
            from app.core.llm.providers.deepseek import DeepSeekProvider
            deepseek_provider = DeepSeekProvider(deepseek_key)
            deepseek_provider.set_registry(self)
            self._providers["deepseek"] = deepseek_provider

        # 模型注册
        self._models = {
            # 聊天模型
            "Qwen/Qwen3-VL-235B-A22B-Thinking": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 256000, # 256K tokens
                "description": "Qwen3 235B 思考模型"
            },
            "Qwen/Qwen3-235B-A22B-Instruct-2507": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 256000, # 256K tokens
                "description": "Qwen3 235B 指令遵循大语言模型"
            },
            "Pro/deepseek-ai/DeepSeek-V3.2": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 160000, # 160K tokens
                "description": "DeepSeek V3.2 模型"
            },
            "Pro/deepseek-ai/DeepSeek-R1": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 160000, # 160K tokens
                "description": "DeepSeek R1 模型"
            },
            "deepseek-ai/DeepSeek-R1": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 160000, # 160K tokens
                "description": "DeepSeek R1 模型"
            },
            "deepseek-ai/DeepSeek-V3.2": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 160000, # 160K tokens
                "description": "DeepSeek V3.2 模型"
            },
            
            # 嵌入模型
            "Qwen/Qwen3-Embedding-8B": {
                "provider": "siliconflow",
                "type": "embedding",
                "context_length": 32000, # 32K tokens
                "description": "Qwen3 嵌入模型"
            },
            
            # 视觉模型
            "Qwen/Qwen3-Omni-30B-A3B-Captioner": {
                "provider": "siliconflow",
                "type": "vision",
                "context_length": 128000, # 128K tokens
                "description": "Qwen3 图像描述模型"
            },
            "Qwen/Qwen3-VL-30B-A3B-Instruct": {
                "provider": "siliconflow",
                "type": "vision",
                "context_length": 256000, # 256K tokens
                "description": "Qwen3 视觉理解模型"
            },
            "Qwen/Qwen3-VL-235B-A22B-Instruct": {
                "provider": "siliconflow",
                "type": "vision",
                "context_length": 256000, # 256K tokens
                "description": "Qwen3 大规模视觉模型"
            },
            "Qwen/Qwen3-Omni-30B-A3B-Instruct": {
                "provider": "siliconflow",
                "type": "vision",
                "context_length": 64000, # 64K tokens
                "description": "Qwen3 多模态理解模型"
            },
            
            # 重排序模型
            "Qwen/Qwen3-Reranker-8B": {
                "provider": "siliconflow",
                "type": "reranker",
                "context_length": 32000, # 32K tokens
                "description": "Qwen3 重排序模型"
            },
            "Qwen/Qwen3-Reranker-4B": {
                "provider": "siliconflow",
                "type": "reranker",
                "context_length": 32000, # 32K tokens
                "description": "Qwen3 重排序模型"
            },
            "BAAI/bge-reranker-v2-m3": {
                "provider": "siliconflow",
                "type": "reranker",
                "context_length": 8000, # 8K tokens
                "description": "BGE 重排序模型"
            }
        }
        # 可选：DeepSeek 官方模型（仅当已配置 DEEPSEEK_API_KEY 时注册）
        if "deepseek" in self._providers:
            self._models["deepseek-chat"] = {
                "provider": "deepseek",
                "type": "chat",
                "context_length": 128000,  # 128K tokens，DeepSeek-V3.2
                "description": "DeepSeek-V3.2 非思考模式（官方 API 模型名）",
            }
            self._models["deepseek-reasoner"] = {
                "provider": "deepseek",
                "type": "chat",
                "context_length": 128000, # 128K tokens
                "description": "DeepSeek-V3.2 思考模式（官方 API 模型名）",
            }

        # 任务路由与备用模型（单一数据源）
        # 增/删模型：只改上方 _models；改某任务用谁、失败后换谁：只改此 _task_config。
        # 结构: task_type -> {"model": 主模型, "fallbacks": [备用模型列表]}
        self._task_config: Dict[str, Dict[str, Any]] = {
            "intent_recognition": {
                "model": "Pro/deepseek-ai/DeepSeek-V3.2",
                "fallbacks": [
                    "deepseek-ai/DeepSeek-V3.2", 
                    "Pro/deepseek-ai/DeepSeek-R1", 
                    "Qwen/Qwen3-235B-A22B-Instruct-2507",
                    "deepseek-chat",
                    "deepseek-reasoner"
                ],
            },
            "query_rewriting": {
                "model": "deepseek-ai/DeepSeek-V3.2",
                "fallbacks": [
                    "Pro/deepseek-ai/DeepSeek-R1",
                    "Qwen/Qwen3-235B-A22B-Instruct-2507",
                    "deepseek-chat",
                    "deepseek-reasoner"
                ],
            },
            "image_captioning": {
                "model": "Qwen/Qwen3-VL-30B-A3B-Instruct",
                "fallbacks": [
                    "Qwen/Qwen3-Omni-30B-A3B-Captioner",
                    "Qwen/Qwen3-Omni-30B-A3B-Instruct",
                    "Qwen/Qwen3-VL-235B-A22B-Instruct",
                ],
            },
            "final_generation": {
                "model": "Pro/deepseek-ai/DeepSeek-R1",
                "fallbacks": [
                    "deepseek-ai/DeepSeek-R1", 
                    "Qwen/Qwen3-235B-A22B-Instruct-2507", 
                    "deepseek-ai/DeepSeek-V3.2", 
                    "Qwen/Qwen3-VL-235B-A22B-Thinking",
                    "deepseek-chat",
                    "deepseek-reasoner"
                ],
            },
            "kb_portrait_generation": {
                "model": "Qwen/Qwen3-235B-A22B-Instruct-2507",
                "fallbacks": [
                    "Pro/deepseek-ai/DeepSeek-R1", "deepseek-ai/DeepSeek-V3.2",
                    "deepseek-chat",
                    "deepseek-reasoner"
                ],
            },
            "health_check": {
                "model": "deepseek-ai/DeepSeek-V3.2",
                "fallbacks": [
                    "Qwen/Qwen3-235B-A22B-Instruct-2507",
                    "Pro/deepseek-ai/DeepSeek-R1",
                    "deepseek-ai/DeepSeek-V3.2",
                    "deepseek-chat",
                    "deepseek-reasoner"
                ],
            },
            "reranking": {
                "model": "Qwen/Qwen3-Reranker-8B",
                "fallbacks": [
                    "Qwen/Qwen3-Reranker-4B",
                    "BAAI/bge-reranker-v2-m3",
                ],
            },
            "embedding": {
                "model": "Qwen/Qwen3-Embedding-8B",
                "fallbacks": [],
            },
        }
        # 若设置了环境变量 DEFAULT_CHAT_MODEL 等，则覆盖对应任务的主模型（与 config 单一语义）
        def _apply(s: Any, task: str) -> None:
            v = (s or "").strip() if s is not None else ""
            if v and task in self._task_config:
                self._task_config[task]["model"] = v
        _apply(getattr(settings, "default_chat_model", None), "final_generation")
        _apply(getattr(settings, "default_embedding_model", None), "embedding")
        _apply(getattr(settings, "default_vision_model", None), "image_captioning")
        _apply(getattr(settings, "default_reranker_model", None), "reranking")
        self._task_routing = {k: v["model"] for k, v in self._task_config.items()}
    
    def get_provider(self, provider_name: str) -> Optional[BaseLLMProvider]:
        """获取提供商"""
        return self._providers.get(provider_name)
    
    def get_model_config(self, model_name: str) -> Dict[str, Any]:
        """获取模型配置"""
        return self._models.get(model_name, {})
    
    def get_task_model(self, task_type: str) -> Optional[str]:
        """根据任务类型获取主模型"""
        return self._task_routing.get(task_type)
    
    def get_task_fallbacks(self, task_type: str) -> List[str]:
        """根据任务类型获取备用模型列表（用于主模型失败时的故障转移）"""
        cfg = self._task_config.get(task_type, {})
        return list(cfg.get("fallbacks") or [])
    
    def update_task_fallbacks(self, task_type: str, fallbacks: List[str]) -> None:
        """运行时更新某任务的备用模型列表（供 set_fallback_models 使用）"""
        if task_type in self._task_config:
            self._task_config[task_type] = dict(self._task_config[task_type])
            self._task_config[task_type]["fallbacks"] = list(fallbacks)
    
    def list_models(self, model_type: Optional[str] = None) -> List[str]:
        """列出可用模型"""
        if model_type:
            return [name for name, config in self._models.items() 
                   if config.get("type") == model_type]
        return list(self._models.keys())
    
    def add_model(self, name: str, config: Dict[str, Any]):
        """添加模型"""
        self._models[name] = config