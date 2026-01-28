"""
BGE-M3 稀疏向量编码器
用于生成 SPLADE 稀疏向量，支持存储和检索
"""

from typing import Dict, List, Any, Optional
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
        self.model_id = model_id
        self.use_fp16 = use_fp16
        self._model: Optional[BGEM3FlagModel] = None
        self._initialized = False
    
    def _ensure_initialized(self):
        """确保模型已初始化（懒加载）"""
        if self._model is None:
            logger.info(f"正在加载 BGE-M3 模型: {self.model_id}...")
            logger.info(f"  使用 Float16: {self.use_fp16} (模型大小: ~{'1.06GB' if self.use_fp16 else '2.27GB'})")
            try:
                self._model = BGEM3FlagModel(
                    self.model_id,
                    use_fp16=self.use_fp16,
                    trust_remote_code=True
                )
                self._initialized = True
                logger.info("✓ BGE-M3 模型加载完成！")
            except Exception as e:
                logger.error(f"BGE-M3 模型加载失败: {str(e)}")
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
            # BGE-M3 编码查询
            output = model.encode_queries(
                [text],
                return_dense=False,  # 我们不需要密集向量，只使用稀疏向量
                return_sparse=True,
                return_colbert_vecs=False
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
            # BGE-M3 编码文档
            output = model.encode_corpus(
                texts,
                return_dense=False,  # 我们不需要密集向量，只使用稀疏向量
                return_sparse=True,
                return_colbert_vecs=False,
                batch_size=batch_size
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
        _sparse_encoder = BGEM3SparseEncoder()
    return _sparse_encoder
