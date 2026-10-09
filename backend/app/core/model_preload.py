"""
应用启动时可选预加载本地 Hugging Face 模型（BGE-M3、CLIP、CLAP），
避免首条文档/图片/音频处理或首次混合检索时长时间阻塞与下载抖动。

Dense 向量化走 API（如 Qwen3-Embedding），不在此预载；MinerU 等可选组件默认不预载。
"""

from __future__ import annotations

import time

from app.core.logger import get_logger

logger = get_logger(__name__)


def preload_local_inference_models_sync() -> dict:
    """同步预载：须在线程池中调用，以免阻塞 asyncio 事件循环。"""
    from app.core.sparse_encoder import get_sparse_encoder
    from app.core.local_models import get_local_model_runtime

    logger.info("开始预加载本地推理模型（BGE-M3、CLIP、CLAP）…")

    report = {}
    started = time.perf_counter()
    try:
        # Exercise the same inference path as a real query, not only weight loading.
        get_sparse_encoder().encode_query("知识库检索预热")
        report["bge_m3"] = {"state": "ready", "duration_seconds": time.perf_counter() - started}
        logger.info("预加载: BGE-M3 就绪")
    except Exception as e:
        report["bge_m3"] = {"state": "error", "error_type": type(e).__name__,
                            "duration_seconds": time.perf_counter() - started}
        logger.warning("预加载 BGE-M3 失败: {}", type(e).__name__)

    runtime = get_local_model_runtime()
    # Serial startup bounds CPU/memory pressure; both are ready before lifespan yields.
    for name, warmup in (("clip", runtime.warmup_clip), ("clap", runtime.warmup_clap)):
        try:
            report[name] = warmup()
            logger.info("预加载: {} 文本编码就绪", name.upper())
        except Exception as e:
            report[name] = {"state": "error", "error_type": type(e).__name__}
            logger.warning("预加载 {} 失败: {}", name.upper(), type(e).__name__)

    logger.info("本地推理模型预加载阶段结束（部分失败时服务仍会启动）")
    return report
