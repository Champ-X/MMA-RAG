"""
BGE-M3 稀疏向量编码器
用于生成 SPLADE 稀疏向量，支持存储和检索
"""

from typing import Dict, List, Any, Optional
from pathlib import Path
import torch
import numpy as np
from FlagEmbedding import BGEM3FlagModel

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


class BGEM3SparseEncoder:
    """BGE-M3 稀疏向量编码器"""
    
    def __init__(self, model_id: str = "BAAI/bge-m3", use_fp16: bool = False):
        """
        初始化 BGE-M3 编码器
        
        Args:
            model_id: 模型 ID 或本地路径
            use_fp16: 是否使用 Float16（减小模型大小，约 1.06GB vs 2.27GB）
        """
        self.model_id = self._resolve_model_id(model_id)
        self.use_fp16 = use_fp16
        self._model: Optional[BGEM3FlagModel] = None
        self._initialized = False

    @staticmethod
    def _resolve_model_id(model_id: str) -> str:
        """Translate a persisted Docker Hugging Face cache path for local runs."""
        configured = str(model_id or "").strip()
        path = Path(configured).expanduser()
        if not path.is_absolute() or path.exists():
            return str(path) if path.exists() else configured

        cache_marker = "/.cache/huggingface/"
        if cache_marker not in configured:
            return configured
        relative_cache_path = configured.split(cache_marker, 1)[1]
        local_candidate = Path.home() / ".cache" / "huggingface" / relative_cache_path
        if local_candidate.exists():
            logger.info(
                "BGE-M3 配置路径不存在，已映射到当前运行环境缓存: {}",
                local_candidate,
            )
            return str(local_candidate)
        return configured
    
    def _ensure_initialized(self):
        """确保模型已初始化（懒加载）"""
        if self._model is None:
            logger.info(f"正在加载 BGE-M3 模型: {self.model_id}...")
            logger.info(f"  使用 Float16: {self.use_fp16} (模型大小: ~{'1.06GB' if self.use_fp16 else '2.27GB'})")
            try:
                self._model = BGEM3FlagModel(
                    self.model_id,
                    use_fp16=self.use_fp16,
                )
                self._initialized = True
                logger.info("✓ BGE-M3 模型加载完成！")
            except Exception as e:
                err = str(e)
                if "huggingface.co" in err or "ConnectTimeout" in err or "timed out" in err.lower():
                    logger.error(
                        "无法访问 Hugging Face：可在 backend/.env 设置 HF_ENDPOINT=https://hf-mirror.com "
                        "（或本机代理），或将模型下载到目录后设置 BGE_M3_MODEL_ID 指向该路径；"
                        "亦可先运行: HF_ENDPOINT=https://hf-mirror.com python tests/preload_bge_m3.py"
                    )
                logger.error(f"BGE-M3 模型加载失败: {err}")
                raise
    
    def encode_query(self, text: str) -> Dict[str, Any]:
        """
        编码查询文本，返回稀疏向量
        
        Args:
            text: 查询文本
            
        Returns:
            {
                "sparse": Dict[int, float],  # 稀疏向量 {token_id: weight}
            }
        """
        self._ensure_initialized()
        
        if self._model is None:
            raise RuntimeError("BGE-M3 模型未初始化")
        
        # 类型断言：确保模型不为 None
        model = self._model
        
        try:
            # FlagEmbedding 的不同版本曾提供 encode_queries / encode_corpus
            # 便捷方法；当前 BGEM3FlagModel 统一使用 encode。优先兼容旧版，
            # 在新版回退到 encode，避免稀疏召回因 API 演进完全失效。
            query_encoder = getattr(model, "encode_queries", None) or model.encode
            output = query_encoder(
                [text],
                return_dense=False,  # 我们不需要密集向量，只使用稀疏向量
                return_sparse=True,
                return_colbert_vecs=False,
            )
            
            # 处理返回结果
            sparse_dict = {}
            
            if 'lexical_weights' in output and output['lexical_weights'] is not None:
                lexical_weights = output['lexical_weights']
                if len(lexical_weights) > 0:
                    # lexical_weights 是 List[Dict[str, float]]，需要转换为 {int: float}
                    weights_dict = lexical_weights[0]
                    if isinstance(weights_dict, dict):
                        sparse_dict = {int(k): float(v) for k, v in weights_dict.items()}
            
            return {
                "sparse": sparse_dict
            }
            
        except Exception as e:
            logger.error(f"BGE-M3 查询编码失败: {str(e)}")
            raise
    
    def encode_corpus(self, texts: List[str], batch_size: int = 32) -> List[Dict[str, Any]]:
        """
        编码文档文本列表，返回稀疏向量列表
        
        Args:
            texts: 文档文本列表
            batch_size: 批处理大小
            
        Returns:
            稀疏向量列表，每个元素包含 {"sparse": Dict[int, float]}
        """
        self._ensure_initialized()
        
        if self._model is None:
            raise RuntimeError("BGE-M3 模型未初始化")
        
        # 类型断言：确保模型不为 None
        model = self._model
        
        try:
            # 见 encode_query：新版模型统一使用 encode。
            corpus_encoder = getattr(model, "encode_corpus", None) or model.encode
            output = corpus_encoder(
                texts,
                return_dense=False,  # 我们不需要密集向量，只使用稀疏向量
                return_sparse=True,
                return_colbert_vecs=False,
                batch_size=batch_size,
            )
            
            results = []
            lexical_weights_list = output.get('lexical_weights', [])
            
            for i in range(len(texts)):
                sparse_dict = {}
                
                if i < len(lexical_weights_list) and lexical_weights_list[i] is not None:
                    weights_dict = lexical_weights_list[i]
                    if isinstance(weights_dict, dict):
                        sparse_dict = {int(k): float(v) for k, v in weights_dict.items()}
                
                results.append({
                    "sparse": sparse_dict
                })
            
            logger.info(f"BGE-M3 编码完成: {len(texts)} 个文档")
            return results
            
        except Exception as e:
            logger.error(f"BGE-M3 文档编码失败: {str(e)}")
            raise
    
    def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        try:
            # 如果未初始化，先尝试初始化（懒加载）
            if not self._initialized:
                try:
                    self._ensure_initialized()
                except Exception as init_e:
                    return {
                        "status": "not_initialized",
                        "model_id": self.model_id,
                        "error": f"初始化失败: {str(init_e)}"
                    }
            
            # 尝试编码一个测试文本
            test_result = self.encode_query("测试")
            
            return {
                "status": "healthy",
                "model_id": self.model_id,
                "use_fp16": self.use_fp16,
                "sparse_vector_size": len(test_result.get("sparse", {}))
            }
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }


# 全局 BGE-M3 编码器实例（懒加载）
_sparse_encoder: Optional[BGEM3SparseEncoder] = None


def get_sparse_encoder() -> BGEM3SparseEncoder:
    """获取全局 BGE-M3 稀疏向量编码器实例"""
    global _sparse_encoder
    if _sparse_encoder is None:
        _sparse_encoder = BGEM3SparseEncoder(
            model_id=settings.bge_m3_model_id,
            use_fp16=settings.bge_m3_use_fp16,
        )
    return _sparse_encoder
