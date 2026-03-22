"""
模块化LLM管理器
统一管理所有LLM模型调用，支持多种模型提供商
"""

from typing import Dict, List, Any, Optional, Union
import asyncio
from app.core.config import settings
from app.core.logger import get_logger, log_llm_call
import time
import json

from app.core.llm.providers.base import BaseLLMProvider
# 使用 providers.silicon_flow 中的实现，确保 stream_chat 等流式接口可用（参见 SiliconFlow 流式文档）
from app.core.llm.providers.silicon_flow import SiliconFlowProvider

logger = get_logger(__name__)


class LLMRegistry:
    """模型注册表"""
    
    def __init__(self):
        self._providers: Dict[str, BaseLLMProvider] = {}
        self._models: Dict[str, Dict[str, Any]] = {}
        self._task_routing: Dict[str, str] = {}
        self._load_config()
    
    def _load_config(self):
        """加载模型配置"""
        # SiliconFlow 提供商（使用 providers.silicon_flow，含 stream_chat，参见 SiliconFlow 流式文档）
        siliconflow_provider = SiliconFlowProvider(settings.siliconflow_api_key)
        if hasattr(siliconflow_provider, "set_registry"):
            siliconflow_provider.set_registry(self)
        self._providers["siliconflow"] = siliconflow_provider

        # DeepSeek 提供商（可选，需配置 DEEPSEEK_API_KEY）
        deepseek_key = getattr(settings, "deepseek_api_key", None)
        if deepseek_key:
            from app.core.llm.providers.deepseek import DeepSeekProvider
            deepseek_provider = DeepSeekProvider(deepseek_key)
            deepseek_provider.set_registry(self)
            self._providers["deepseek"] = deepseek_provider

        # OpenRouter 提供商（可选，需配置 OPENROUTER_API_KEY）
        openrouter_key = getattr(settings, "openrouter_api_key", None)
        if openrouter_key:
            from app.core.llm.providers.openrouter import OpenRouterProvider
            openrouter_provider = OpenRouterProvider(openrouter_key)
            openrouter_provider.set_registry(self)
            self._providers["openrouter"] = openrouter_provider

        # 阿里云百炼 提供商（可选，需配置 ALIYUN_BAILIAN_API_KEY）
        aliyun_bailian_key = getattr(settings, "aliyun_bailian_api_key", None)
        if aliyun_bailian_key:
            from app.core.llm.providers.aliyun_bailian import AliyunBailianProvider
            aliyun_bailian_provider = AliyunBailianProvider(aliyun_bailian_key)
            aliyun_bailian_provider.set_registry(self)
            self._providers["aliyun_bailian"] = aliyun_bailian_provider

        # 模型注册
        self._models = {
            # 聊天模型
            "Qwen/Qwen3-235B-A22B-Thinking-2507": {
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
            "Qwen/Qwen3.5-397B-A17B": {
                "provider": "siliconflow",
                "type": "chat,vision,video",
                "context_length": 262144,  # 256K tokens，与 OpenRouter 同系模型一致
                "description": "Qwen3.5 397B MoE 指令模型（SiliconFlow）"
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
            # Siliconflow 新增模型
            "Pro/MiniMaxAI/MiniMax-M2.5": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 200000,  # 200K tokens
                "description": "MiniMax M2.5 对话模型"
            },
            "Pro/moonshotai/Kimi-K2.5": {
                "provider": "siliconflow",
                "type": "chat,vision",  # 对话、视觉、推理
                "context_length": 256000,  # 256K tokens
                "description": "Kimi K2.5 对话、视觉、推理"
            },
            "moonshotai/Kimi-K2-Thinking": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 256000,  # 256K tokens
                "description": "Kimi K2 思考模型（对话、推理）"
            },
            "Pro/zai-org/GLM-5": {
                "provider": "siliconflow",
                "type": "chat",
                "context_length": 200000,  # 200K tokens
                "description": "GLM-5 对话、推理"
            },
            "zai-org/GLM-4.6V": {
                "provider": "siliconflow",
                "type": "vision",
                "context_length": 128000,  # 128K tokens
                "description": "GLM-4.6V 视觉模型"
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

        # OpenRouter 模型（仅当已配置 OPENROUTER_API_KEY 时注册）
        # 使用 openrouter:model_name 格式避免冲突
        if "openrouter" in self._providers:
            openrouter_models = {
                "openrouter:qwen/qwen3-embedding-8b": {
                    "provider": "openrouter",
                    "type": "embedding",
                    "context_length": 32000,
                    "description": "Qwen3 嵌入模型（OpenRouter）",
                    "raw_model": "qwen/qwen3-embedding-8b",  # 实际API调用的模型名
                },
                "openrouter:google/gemini-3-flash-preview": {
                    "provider": "openrouter",
                    "type": "chat,vision,audio,video",
                    "context_length": 1048576,
                    "description": "Google Gemini 3 Flash Preview（OpenRouter）",
                    "raw_model": "google/gemini-3-flash-preview",
                },
                "openrouter:google/gemini-2.5-flash": {
                    "provider": "openrouter",
                    "type": "chat,vision,audio,video",
                    "context_length": 1048576,
                    "description": "Google Gemini 2.5 Flash（OpenRouter）",
                    "raw_model": "google/gemini-2.5-flash",
                },
                "openrouter:google/gemini-3-pro-preview": {
                    "provider": "openrouter",
                    "type": "chat,vision,audio,video",
                    "context_length": 1048576,
                    "description": "Google Gemini 3 Pro Preview（OpenRouter）",
                    "raw_model": "google/gemini-3-pro-preview",
                },
                "openrouter:qwen/qwen3.5-plus-02-15": {
                    "provider": "openrouter",
                    "type": "chat,vision,video",
                    "context_length": 1000000,
                    "description": "Qwen3.5 Plus 02-15（OpenRouter）",
                    "raw_model": "qwen/qwen3.5-plus-02-15",
                },
                "openrouter:qwen/qwen3.5-397b-a17b": {
                    "provider": "openrouter",
                    "type": "chat,vision,video",
                    "context_length": 262144,
                    "description": "Qwen3.5 397B A17B（OpenRouter）",
                    "raw_model": "qwen/qwen3.5-397b-a17b",
                },
                "openrouter:qwen/qwen-plus": {
                    "provider": "openrouter",
                    "type": "chat",
                    "context_length": 1000000,
                    "description": "Qwen Plus（OpenRouter）",
                    "raw_model": "qwen/qwen-plus",
                },
                "openrouter:openai/gpt-5.2-chat": {
                    "provider": "openrouter",
                    "type": "chat,vision",
                    "context_length": 128000,
                    "description": "OpenAI GPT-5.2 Chat（OpenRouter）",
                    "raw_model": "openai/gpt-5.2-chat",
                },
            }
            self._models.update(openrouter_models)

        # 阿里云百炼模型（仅当已配置 ALIYUN_BAILIAN_API_KEY 时注册）
        # 使用 aliyun_bailian:model_name 格式避免冲突
        if "aliyun_bailian" in self._providers:
            aliyun_bailian_models = {
                "aliyun_bailian:qwen3.5-plus": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,video",
                    "context_length": 991000,  # 991K
                    "description": "Qwen3.5 Plus（阿里云百炼）",
                    "raw_model": "qwen3.5-plus",
                },
                "aliyun_bailian:qwen3.5-plus-2026-02-15": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,video",
                    "context_length": 991000,  # 991K
                    "description": "Qwen3.5 Plus 2026-02-15（阿里云百炼，推荐视频解析）",
                    "raw_model": "qwen3.5-plus-2026-02-15",
                },
                "aliyun_bailian:qwen3.5-397b-a17b": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,video",
                    "context_length": 254000,  # 254K
                    "description": "Qwen3.5 397B A17B（阿里云百炼）",
                    "raw_model": "qwen3.5-397b-a17b",
                },
                "aliyun_bailian:qwen3.5-flash": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,video",
                    "context_length": 991000,  # 252K
                    "description": "Qwen3 Max（阿里云百炼）",
                    "raw_model": "qwen3.5-flash",
                },
                "aliyun_bailian:qwen3-max": {
                    "provider": "aliyun_bailian",
                    "type": "chat",
                    "context_length": 252000,  # 252K
                    "description": "Qwen3 Max（阿里云百炼）",
                    "raw_model": "qwen3-max",
                },
                "aliyun_bailian:qwen3-vl-rerank": {
                    "provider": "aliyun_bailian",
                    "type": "reranker",
                    "context_length": 800000,  # 800K
                    "description": "Qwen3 VL Rerank（阿里云百炼）",
                    "raw_model": "qwen3-vl-rerank",
                },
                "aliyun_bailian:qwen3-rerank": {
                    "provider": "aliyun_bailian",
                    "type": "reranker",
                    "context_length": 30000,  # 30K
                    "description": "Qwen3 Rerank（阿里云百炼）",
                    "raw_model": "qwen3-rerank",
                },
                "aliyun_bailian:text-embedding-v4": {
                    "provider": "aliyun_bailian",
                    "type": "embedding",
                    "context_length": 32000,  # 32K
                    "description": "Text Embedding V4（阿里云百炼）",
                    "raw_model": "text-embedding-v4",
                },
                "aliyun_bailian:qwen3-vl-embedding": {
                    "provider": "aliyun_bailian",
                    "type": "embedding",
                    "context_length": 32000,  # 32K
                    "description": "Qwen3 VL Embedding（阿里云百炼）",
                    "raw_model": "qwen3-vl-embedding",
                },
                "aliyun_bailian:qwen3-omni-30b-a3b-captioner": {
                    "provider": "aliyun_bailian",
                    "type": "audio",
                    "context_length": 32000,  # 32K
                    "description": "Qwen3 Omni 30B A3B Captioner（阿里云百炼）",
                    "raw_model": "qwen3-omni-30b-a3b-captioner",
                },
                "aliyun_bailian:qwen3-vl-flash": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,video",
                    "context_length": 30000,  # 30K
                    "description": "Qwen3 VL Flash（阿里云百炼）",
                    "raw_model": "qwen3-vl-flash",
                },
                "aliyun_bailian:qwen3-vl-plus": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,video",
                    "context_length": 30000,  # 30K
                    "description": "Qwen3 VL Plus（阿里云百炼）",
                    "raw_model": "qwen3-vl-plus",
                },
                "aliyun_bailian:qwen3-omni-flash": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,audio,video",
                    "context_length": 48000,  # 48K
                    "description": "Qwen3 Omni Flash（阿里云百炼）",
                    "raw_model": "qwen3-omni-flash",
                },
                "aliyun_bailian:qwen-omni-turbo": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,audio,video",
                    "context_length": 30000,  # 30K
                    "description": "Qwen Omni Turbo（阿里云百炼）",
                    "raw_model": "qwen-omni-turbo",
                },
                "aliyun_bailian:kimi/kimi-k2.5": {
                    "provider": "aliyun_bailian",
                    "type": "chat,vision,video",
                    "context_length": 30000,  # 30K
                    "description": "Kimi K2.5（阿里云百炼）",
                    "raw_model": "kimi/kimi-k2.5",
                },
            }
            self._models.update(aliyun_bailian_models)

        # 任务路由与备用模型（单一数据源）
        # 增/删模型：只改上方 _models；改某任务用谁、失败后换谁：只改此 _task_config。
        # 结构: task_type -> {"model": 主模型, "fallbacks": [备用模型列表]}
        self._task_config: Dict[str, Dict[str, Any]] = {
            "intent_recognition": {
                "model": "aliyun_bailian:qwen3-max",
                "fallbacks": [
                    "deepseek-ai/DeepSeek-V3.2",
                    "Pro/deepseek-ai/DeepSeek-R1",
                    "Qwen/Qwen3-235B-A22B-Instruct-2507",
                    "Pro/moonshotai/Kimi-K2.5",
                    "Pro/deepseek-ai/DeepSeek-V3.2",
                    "Pro/zai-org/GLM-5",
                    "moonshotai/Kimi-K2-Thinking",
                    "Pro/MiniMaxAI/MiniMax-M2.5",
                    "deepseek-chat",
                    "deepseek-reasoner"
                ],
            },
            "query_rewriting": {
                "model": "aliyun_bailian:qwen3.5-flash",
                "fallbacks": [
                    "Qwen/Qwen3-235B-A22B-Instruct-2507",
                    "deepseek-ai/DeepSeek-V3.2",
                    "Pro/deepseek-ai/DeepSeek-R1",
                    "Pro/deepseek-ai/DeepSeek-V3.2",
                    "Pro/moonshotai/Kimi-K2.5",
                    "Pro/zai-org/GLM-5",
                    "moonshotai/Kimi-K2-Thinking",
                    "Pro/MiniMaxAI/MiniMax-M2.5",
                    "deepseek-chat",
                    "deepseek-reasoner"
                ],
            },
            "image_captioning": {
                "model": "Qwen/Qwen3-VL-30B-A3B-Instruct",
                "fallbacks": [
                    "Qwen/Qwen3-Omni-30B-A3B-Captioner",
                    "Pro/moonshotai/Kimi-K2.5",
                    "Qwen/Qwen3-Omni-30B-A3B-Instruct",
                    "Qwen/Qwen3-VL-235B-A22B-Instruct",
                    "zai-org/GLM-4.6V",
                ],
            },
            "final_generation": {
                "model": "aliyun_bailian:qwen3.5-plus",
                "fallbacks": [
                    "Pro/moonshotai/Kimi-K2.5",
                    "deepseek-ai/DeepSeek-V3.2", 
                    "deepseek-ai/DeepSeek-R1",
                    "Pro/deepseek-ai/DeepSeek-R1",
                    "Qwen/Qwen3-235B-A22B-Thinking-2507",
                    "Pro/moonshotai/Kimi-K2.5",
                    "Pro/zai-org/GLM-5",
                    "moonshotai/Kimi-K2-Thinking",
                    "Pro/MiniMaxAI/MiniMax-M2.5",
                    "deepseek-chat",
                    "deepseek-reasoner"
                ],
            },
            "kb_portrait_generation": {
                "model": "Qwen/Qwen3-235B-A22B-Instruct-2507",
                "fallbacks": [
                    "Pro/deepseek-ai/DeepSeek-R1",
                    "deepseek-ai/DeepSeek-V3.2",
                    "Pro/moonshotai/Kimi-K2.5",
                    "Pro/zai-org/GLM-5",
                    "moonshotai/Kimi-K2-Thinking",
                    "Pro/MiniMaxAI/MiniMax-M2.5",
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
            # 音频转写：优先 OpenRouter Gemini（与当前 content 格式兼容），阿里云 Omni 需 WebSocket/专用格式
            "audio_transcription": {
                "model": "aliyun_bailian:qwen3-omni-flash",
                "fallbacks": [
                    "aliyun_bailian:qwen-omni-turbo",
                    "openrouter:google/gemini-3-flash-preview",
                    "openrouter:google/gemini-2.5-flash",
                    "openrouter:google/gemini-3-pro-preview",
                ],
            },
            # 视频解析：长视频场景划分+关键帧、短视频整体描述，需支持多图/视觉
            "video_parsing": {
                "model": "aliyun_bailian:qwen3.5-plus-2026-02-15",
                "fallbacks": [
                    "aliyun_bailian:qwen3.5-plus",
                    "aliyun_bailian:kimi/kimi-k2.5",
                    "openrouter:google/gemini-3-pro-preview",
                    "openrouter:google/gemini-3-flash-preview",
                    "openrouter:google/gemini-2.5-flash",
                    "aliyun_bailian:qwen3-omni-flash",
                    "aliyun_bailian:qwen3-omni-turbo",
                    "openrouter:qwen/qwen3.5-plus-02-15",
                    "openrouter:qwen/qwen3.5-397b-a17b",
                ],
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
        _apply(getattr(settings, "default_video_parsing_model", None), "video_parsing")
        self._task_routing = {k: v["model"] for k, v in self._task_config.items()}
    
    def get_provider(self, provider_name: str) -> Optional[BaseLLMProvider]:
        """获取提供商"""
        return self._providers.get(provider_name)

    def list_providers(self) -> List[str]:
        """列出当前已配置的提供商名称（如 siliconflow、deepseek）"""
        return list(self._providers.keys())
    
    def get_model_config(self, model_name: str) -> Dict[str, Any]:
        """获取模型配置
        支持两种格式：
        1. 直接模型名（如 "Qwen/Qwen3-235B-A22B-Instruct-2507"）
        2. provider:model 格式（如 "openrouter:qwen/qwen3.5-plus-02-15"）
        """
        # 如果包含冒号，尝试解析为 provider:model 格式
        if ":" in model_name:
            parts = model_name.split(":", 1)
            if len(parts) == 2:
                provider, model = parts
                # 查找完整名称
                full_name = f"{provider}:{model}"
                config = self._models.get(full_name)
                if config:
                    return config
                # OpenRouter：允许前端选择任意 openrouter:vendor/model，未在 _models 登记也可调用
                if provider == "openrouter" and "openrouter" in self._providers:
                    rest = (model or "").strip()
                    if rest:
                        return {
                            "provider": "openrouter",
                            "type": "chat,vision,audio,video",
                            "description": "OpenRouter（动态模型）",
                            "raw_model": rest,
                        }
                # 如果没找到，尝试直接查找（向后兼容）
                return self._models.get(model_name, {})
        return self._models.get(model_name, {})
    
    def get_raw_model_name(self, model_name: str) -> str:
        """获取实际API调用的模型名称
        如果模型配置中有 raw_model 字段，返回它；否则返回原始模型名
        """
        config = self.get_model_config(model_name)
        return config.get("raw_model", model_name)
    
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
        """列出可用模型。config.type 可为逗号分隔的多类型（如 chat,vision）。"""
        if model_type:
            def _match(cfg: Dict[str, Any]) -> bool:
                t = cfg.get("type")
                if not t:
                    return False
                types = [s.strip() for s in str(t).split(",") if s.strip()]
                return model_type in types
            return [name for name, config in self._models.items() if _match(config)]
        return list(self._models.keys())

    def list_models_by_provider(self) -> Dict[str, Dict[str, List[str]]]:
        """按 provider 分组的模型列表，供前端按所选 provider 只显示该 provider 的模型。
        config.type 可为逗号分隔的多类型（如 chat,vision），模型会出现在对应类型的列表中。
        """
        result: Dict[str, Dict[str, List[str]]] = {}
        for name, config in self._models.items():
            provider = config.get("provider") or "siliconflow"
            raw_type = config.get("type")
            if not raw_type:
                continue
            types = [s.strip() for s in str(raw_type).split(",") if s.strip()]
            if provider not in result:
                result[provider] = {"chat": [], "vision": [], "reranker": []}
            for t in types:
                if t in ("chat", "vision", "reranker"):
                    result[provider][t].append(name)
        return result

    def add_model(self, name: str, config: Dict[str, Any]):
        """添加模型"""
        self._models[name] = config