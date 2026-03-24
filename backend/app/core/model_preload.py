"""
应用启动时可选预加载本地 Hugging Face 模型（BGE-M3、CLIP、CLAP），
避免首条文档/图片/音频处理或首次混合检索时长时间阻塞与下载抖动。

Dense 向量化走 API（如 Qwen3-Embedding），不在此预载；MinerU 等可选组件默认不预载。
"""

from __future__ import annotations

from app.core.logger import get_logger

logger = get_logger(__name__)


def preload_local_inference_models_sync() -> None:
    """同步预载：须在线程池中调用，以免阻塞 asyncio 事件循环。"""
    from app.core.sparse_encoder import get_sparse_encoder
    from app.modules.ingestion.service import get_ingestion_service

    logger.info("开始预加载本地推理模型（BGE-M3、CLIP、CLAP）…")

    try:
        get_sparse_encoder()._ensure_initialized()
        logger.info("预加载: BGE-M3 就绪")
    except Exception as e:
        logger.warning(f"预加载 BGE-M3 失败（稀疏检索/写入将受影响）: {e}")

    ingestion = get_ingestion_service()

    try:
        ingestion._load_clip_model()
        logger.info("预加载: CLIP 就绪")
    except Exception as e:
        logger.warning(f"预加载 CLIP 失败（图片向量与视觉检索将受影响）: {e}")

    try:
        ingestion._load_clap_model()
        logger.info("预加载: CLAP 就绪")
    except Exception as e:
        logger.warning(f"预加载 CLAP 失败（音频 CLAP 路将受影响）: {e}")

    logger.info("本地推理模型预加载阶段结束（部分失败时服务仍会启动）")
