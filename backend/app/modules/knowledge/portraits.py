"""
知识库动态画像生成器
基于K-Means聚类算法生成知识库画像
"""

from typing import Dict, List, Any, Optional, Tuple
import asyncio
import random
import math
import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.config import settings
from app.core.logger import get_logger, audit_log
from app.modules.ingestion.storage.vector_store import VectorStore
from app.core.llm.manager import llm_manager
from app.core.llm.prompt_engine import prompt_engine

logger = get_logger(__name__)

# 画像采样与聚类常量
SAMPLE_FULL_THRESHOLD = 5000
SAMPLE_MAX = 1000
SAMPLE_MIN = 50
NEAREST_PER_CLUSTER_MIN = 5
NEAREST_PER_CLUSTER_MAX = 10
EMBEDDING_DIM = 4096

@dataclass
class VectorSample:
    """向量样本数据类（懒加载：采样时仅 id/vector/source_type，主题抽取前按 id 回查文本）"""
    id: str
    vector: List[float]
    source_type: str  # "doc" 或 "image"
    content: Optional[str] = None  # 主题抽取时按需回填，采样阶段不加载

class PortraitGenerator:
    """知识库画像生成器"""
    
    def __init__(self):
        self.vector_store = VectorStore()
        self.llm_manager = llm_manager
        self.prompt_engine = prompt_engine
    
    async def update_kb_portrait(
        self,
        kb_id: str,
        force_update: bool = False
    ) -> Dict[str, Any]:
        """
        更新知识库画像
        
        Args:
            kb_id: 知识库ID
            force_update: 是否强制更新
            
        Returns:
            画像更新结果
        """
        try:
            # 1. 检查是否需要更新
            if not force_update:
                update_needed = await self._check_update_needed(kb_id)
                if not update_needed:
                    logger.info(f"知识库画像无需更新: {kb_id}")
                    return {"status": "no_update_needed", "message": "知识库内容未发生变化"}
            
            logger.info(f"开始更新知识库画像: {kb_id}")
            
            # 2. 采样向量数据
            samples = await self._sample_vectors(kb_id)
            
            if len(samples) < 10:
                return {
                    "status": "insufficient_data",
                    "message": "知识库数据量不足，无法生成画像",
                    "sample_count": len(samples)
                }
            
            # 3. K-Means聚类
            clustering_result = await self._perform_clustering(samples)
            
            # 4. 生成主题摘要
            portraits = await self._generate_topic_summaries(samples, clustering_result)
            
            # 5. 向量化并存储画像
            storage_result = await self._store_portraits(kb_id, portraits)
            
            audit_log(
                f"知识库画像更新完成: {kb_id}",
                kb_id=kb_id,
                cluster_count=len(portraits),
                sample_count=len(samples)
            )
            
            logger.info(f"知识库画像更新完成: {kb_id}, 聚类数: {len(portraits)}")
            
            return {
                "status": "success",
                "kb_id": kb_id,
                "clusters": len(portraits),
                "samples_processed": len(samples),
                "portraits": portraits,
                "storage_result": storage_result
            }
            
        except Exception as e:
            logger.error(f"更新知识库画像失败: {str(e)}")
            raise
    
    async def _check_update_needed(self, kb_id: str) -> bool:
        """
        检查是否需要更新画像
        
        增量更新检查逻辑：
        1. 获取当前知识库的数据量（文本块和图片向量）
        2. 获取上次画像更新的时间
        3. 比较数据量变化和更新时间，判断是否需要更新
        
        更新条件：
        - 如果画像不存在，需要更新
        - 如果数据量变化超过阈值（默认20%），需要更新
        - 如果距离上次更新时间超过一定时间（默认7天），需要更新
        - 如果数据量达到绝对阈值，需要更新
        """
        try:
            from datetime import timedelta
            
            # 1. 获取当前知识库的数据量（按 kb 统计）
            n_text, n_img = await self.vector_store.count_kb_chunks(kb_id)
            current_total = n_text + n_img
            
            # 2. 获取上次画像更新的时间
            existing_portraits = await self.vector_store.search_kb_portraits(kb_id, limit=1)
            
            # 如果没有画像，需要更新
            if not existing_portraits:
                logger.info(f"知识库画像不存在，需要创建: {kb_id}")
                return True
            
            # 获取最新的画像更新时间
            last_update_time = None
            last_total_count = 0
            
            # 从画像的payload中获取更新时间
            for portrait in existing_portraits:
                payload = portrait.get("payload", {})
                if isinstance(payload, dict):
                    created_at = payload.get("created_at")
                    if created_at:
                        try:
                            last_update_time = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                            # 如果有存储上次数据量，也获取
                            last_total_count = payload.get("last_total_count", 0)
                            break
                        except Exception:
                            pass
            
            # 如果没有找到更新时间，默认需要更新
            if not last_update_time:
                logger.info(f"无法获取画像更新时间，需要更新: {kb_id}")
                return True
            
            # 3. 检查数据量变化
            if last_total_count > 0:
                # 计算数据量变化百分比
                change_ratio = abs(current_total - last_total_count) / max(last_total_count, 1)
                change_threshold = 0.2  # 20%的变化阈值
                
                if change_ratio >= change_threshold:
                    logger.info(
                        f"数据量变化超过阈值 ({change_ratio:.2%} >= {change_threshold:.2%})，需要更新: {kb_id}"
                    )
                    return True
            
            # 4. 检查时间间隔
            time_since_update = datetime.utcnow() - last_update_time.replace(tzinfo=None)
            update_interval_days = 7  # 默认7天更新一次
            
            if time_since_update >= timedelta(days=update_interval_days):
                logger.info(
                    f"距离上次更新已超过{update_interval_days}天，需要更新: {kb_id}"
                )
                return True
            
            # 5. 检查绝对数据量阈值
            absolute_threshold = settings.portrait_update_threshold
            if current_total >= absolute_threshold and last_total_count < absolute_threshold:
                logger.info(
                    f"数据量达到绝对阈值 ({current_total} >= {absolute_threshold})，需要更新: {kb_id}"
                )
                return True
            
            # 所有条件都不满足，不需要更新
            logger.info(
                f"知识库画像无需更新: {kb_id}, "
                f"当前数据量={current_total}, "
                f"上次数据量={last_total_count}, "
                f"距离上次更新={time_since_update.days}天"
            )
            return False
            
        except Exception as e:
            logger.error(f"检查更新需求失败: {str(e)}")
            return True  # 出错时默认更新
    
    def _reservoir_sample(self, stream: List[Tuple[str, List[float]]], k: int) -> List[Tuple[str, List[float]]]:
        """蓄水池采样：从 stream 中均匀采样 k 个（不足则全选）。"""
        if k <= 0 or not stream:
            return []
        if len(stream) <= k:
            return list(stream)
        out = list(stream[:k])
        for i in range(k, len(stream)):
            j = random.randint(0, i)
            if j < k:
                out[j] = stream[i]
        return out

    async def _sample_vectors(self, kb_id: str) -> List[VectorSample]:
        """
        采样向量数据（懒加载：仅 id / vector / source_type）。
        - N_text + N_img < 5000：全量提取。
        - 否则按比例 S 分配 S_text、S_img，分别在两集合蓄水池采样。
        """
        try:
            n_text, n_img = await self.vector_store.count_kb_chunks(kb_id)
            total = n_text + n_img
            if total < 10:
                logger.info(f"知识库数据量不足: {kb_id}, total={total}")
                return []

            use_full = total < SAMPLE_FULL_THRESHOLD
            if use_full:
                s = total
                s_text, s_img = n_text, n_img
            else:
                s = max(SAMPLE_MIN, min(SAMPLE_MAX, int(total * 0.2)))
                if total > 0:
                    s_text = max(0, int(s * n_text / total))
                    s_img = s - s_text
                else:
                    s_text = s_img = 0

            samples: List[VectorSample] = []
            batch = 500

            async def drain_text(lim: int) -> List[Tuple[str, List[float]]]:
                out: List[Tuple[str, List[float]]] = []
                off: Optional[Any] = None
                while True:
                    chunk, off = await self._run_scroll_text(kb_id, lim, off, batch)
                    out.extend(chunk)
                    if off is None:
                        break
                return out

            async def drain_img(lim: int) -> List[Tuple[str, List[float]]]:
                out: List[Tuple[str, List[float]]] = []
                off: Optional[Any] = None
                while True:
                    chunk, off = await self._run_scroll_img(kb_id, lim, off, batch)
                    out.extend(chunk)
                    if off is None:
                        break
                return out

            if use_full:
                all_text = await drain_text(n_text + 1)
                all_img = await drain_img(n_img + 1)
                for pid, vec in all_text:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="doc"))
                for pid, vec in all_img:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="image"))
            else:
                stream_text = await drain_text(s_text + 1)
                stream_img = await drain_img(s_img + 1)
                chosen_text = self._reservoir_sample(stream_text, s_text)
                chosen_img = self._reservoir_sample(stream_img, s_img)
                for pid, vec in chosen_text:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="doc"))
                for pid, vec in chosen_img:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="image"))

            logger.info(f"向量采样完成: {kb_id}, 样本数: {len(samples)} (text={n_text}, img={n_img})")
            return samples

        except Exception as e:
            logger.error(f"向量采样失败: {str(e)}")
            raise

    async def _run_scroll_text(
        self,
        kb_id: str,
        limit: int,
        offset: Optional[Any],
        batch_size: int,
    ) -> Tuple[List[Tuple[str, List[float]]], Optional[Any]]:
        return await self.vector_store.scroll_text_chunks_for_sampling(
            kb_id, limit=limit, offset=offset, batch_size=batch_size
        )

    async def _run_scroll_img(
        self,
        kb_id: str,
        limit: int,
        offset: Optional[Any],
        batch_size: int,
    ) -> Tuple[List[Tuple[str, List[float]]], Optional[Any]]:
        return await self.vector_store.scroll_image_vectors_for_sampling(
            kb_id, limit=limit, offset=offset, batch_size=batch_size
        )
    
    async def _perform_clustering(
        self, 
        samples: List[VectorSample]
    ) -> Dict[str, Any]:
        """执行K-Means聚类"""
        try:
            # 准备数据
            vectors = np.array([sample.vector for sample in samples])
            
            # 确定最优聚类数
            optimal_k = await self._find_optimal_k(vectors)
            
            # 执行聚类
            kmeans = KMeans(
                n_clusters=optimal_k,
                random_state=42,
                n_init=10  # type: ignore
            )
            cluster_labels = kmeans.fit_predict(vectors)
            
            # 计算聚类质量指标
            silhouette_avg = silhouette_score(vectors, cluster_labels)
            
            # 准备聚类结果
            clustering_result = {
                "k": optimal_k,
                "labels": cluster_labels.tolist(),
                "centers": kmeans.cluster_centers_.tolist(),
                "inertia": kmeans.inertia_,
                "silhouette_score": silhouette_avg,
                "sample_count": len(samples)
            }
            
            logger.info(f"K-Means聚类完成: K={optimal_k}, 轮廓系数={silhouette_avg:.3f}")
            
            return clustering_result
            
        except Exception as e:
            logger.error(f"聚类执行失败: {str(e)}")
            raise
    
    async def _find_optimal_k(self, vectors: np.ndarray) -> int:
        """确定最优聚类数：K = sqrt(N/2)（经验公式），并限制在 [2, max_kb_portrait_size]。"""
        try:
            n = len(vectors)
            if n < 2:
                return 2
            k = max(2, int(math.sqrt(n / 2.0)))
            k = min(k, settings.max_kb_portrait_size)
            logger.info(f"聚类数 K = sqrt(N/2): N={n} -> K={k}")
            return k
        except Exception as e:
            logger.error(f"确定最优K值失败: {str(e)}")
            return 3
    
    async def _generate_topic_summaries(
        self,
        samples: List[VectorSample],
        clustering_result: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        生成主题摘要。
        对每个簇取距离中心最近的 5–10 个样本，按 id + source_type 回查文本（懒加载），
        再以 [文档片段] / [图片描述] 前缀构造 content_pieces，调用 LLM 生成摘要并向量化入库。
        """
        try:
            labels = clustering_result["labels"]
            centers = clustering_result["centers"]
            k = clustering_result["k"]
            portraits: List[Dict[str, Any]] = []

            for cluster_id in range(k):
                cluster_samples = [
                    samples[i] for i, label in enumerate(labels) if label == cluster_id
                ]
                if not cluster_samples:
                    continue

                cluster_size = len(cluster_samples)
                center = np.array(centers[cluster_id])
                distances = [
                    (s, float(np.linalg.norm(np.array(s.vector) - center)))
                    for s in cluster_samples
                ]
                nearest_count = min(
                    NEAREST_PER_CLUSTER_MAX,
                    max(NEAREST_PER_CLUSTER_MIN, cluster_size),
                )
                nearest = sorted(distances, key=lambda x: x[1])[:nearest_count]

                ids_doc = [s.id for s, _ in nearest if s.source_type == "doc"]
                ids_img = [s.id for s, _ in nearest if s.source_type == "image"]
                texts_doc, texts_img = await self.vector_store.fetch_texts_by_ids(
                    ids_doc, ids_img
                )

                content_pieces: List[str] = []
                for s, _ in nearest:
                    t = texts_doc.get(s.id) if s.source_type == "doc" else texts_img.get(s.id)
                    if not (t and t.strip()):
                        continue
                    prefix = "[文档片段]" if s.source_type == "doc" else "[图片描述]"
                    content_pieces.append(f"{prefix} {t.strip()}")
                if not content_pieces:
                    content_pieces = ["该聚类包含向量数据，但缺少文本内容用于主题生成。"]

                topic_summary = await self._generate_single_topic_summary(content_pieces)
                vectorization_result = await self.llm_manager.embed(texts=[topic_summary])
                if vectorization_result.success and vectorization_result.data:
                    topic_vector = vectorization_result.data[0]
                else:
                    topic_vector = center.tolist()

                portraits.append({
                    "topic_summary": topic_summary,
                    "cluster_size": cluster_size,
                    "vector": topic_vector,
                    "cluster_id": cluster_id,
                    "sample_count": cluster_size,
                })

            logger.info(f"主题摘要生成完成: {len(portraits)} 个主题")
            return portraits
        except Exception as e:
            logger.error(f"生成主题摘要失败: {str(e)}")
            raise
    
    async def _generate_single_topic_summary(self, content_pieces: List[str]) -> str:
        """生成单个主题摘要"""
        try:
            # 构建提示词
            content_text = "\n\n".join(content_pieces)
            
            prompt = self.prompt_engine.render_template(
                "kb_portrait_generation",
                content_pieces=content_text
            )
            
            # 调用LLM生成摘要
            messages = [
                {
                    "role": "system", 
                    "content": "你是一个专业的知识管理专家，擅长分析文档和图片内容，生成简洁准确的主题摘要。"
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
            
            result = await self.llm_manager.chat(
                messages=messages,
                task_type="kb_portrait_generation",
                temperature=0.3
            )
            
            if result.success:
                summary = (result.data or {}).get("choices", [{}])[0].get("message", {}).get("content", "")
                return summary.strip()
            else:
                # 如果LLM调用失败，生成简单的摘要
                return f"基于{len(content_pieces)}个内容片段的主题聚类"
                
        except Exception as e:
            logger.error(f"生成单个主题摘要失败: {str(e)}")
            return f"主题聚类 (基于{len(content_pieces)}个内容片段)"
    
    async def _store_portraits(
        self, 
        kb_id: str, 
        portraits: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """存储画像到向量数据库（Replace 策略：先删旧再插入）"""
        try:
            n_text, n_img = await self.vector_store.count_kb_chunks(kb_id)
            total_count = n_text + n_img
            text_count, image_count = n_text, n_img
            
            # 在portraits的metadata中添加数据量信息
            for portrait in portraits:
                # 确保portrait有metadata字段
                if "metadata" not in portrait:
                    portrait["metadata"] = {}
                portrait["metadata"]["last_total_count"] = total_count
                portrait["metadata"]["last_text_count"] = text_count
                portrait["metadata"]["last_image_count"] = image_count
                portrait["metadata"]["updated_at"] = datetime.now(timezone.utc).isoformat()
            
            # 存储到kb_portraits集合
            result = await self.vector_store.upsert_kb_portraits(kb_id, portraits)
            
            logger.info(
                f"知识库画像存储完成: {kb_id}, 画像数: {len(portraits)}, "
                f"数据量: {total_count} (文本: {text_count}, 图片: {image_count})"
            )
            
            return result
            
        except Exception as e:
            logger.error(f"存储知识库画像失败: {str(e)}")
            raise
    
    async def get_kb_portraits(self, kb_id: str) -> List[Dict[str, Any]]:
        """获取知识库画像"""
        try:
            # 从向量数据库获取画像
            portraits = await self.vector_store.search_kb_portraits(kb_id)
            
            return portraits
            
        except Exception as e:
            logger.error(f"获取知识库画像失败: {str(e)}")
            return []


# ---------------------------------------------------------------------------
# Celery 异步任务：供 Redis 增量触发与手动调用
# ---------------------------------------------------------------------------
def _get_celery_app():
    try:
        from celery_app import celery_app
        return celery_app
    except ImportError:
        return None


_celery_app = _get_celery_app()

if _celery_app is not None:

    @_celery_app.task(
        name="app.modules.knowledge.portraits.build_kb_portrait_task",
        bind=True,
        autoretry_for=(Exception,),
        retry_backoff=True,
        retry_kwargs={"max_retries": 2},
    )
    def build_kb_portrait_task(self, kb_id: str, force_update: bool = False):  # type: ignore[misc]
        """Celery 任务：在 Worker 中执行知识库画像构建（异步流水线）。"""
        import asyncio
        gen = PortraitGenerator()
        return asyncio.run(gen.update_kb_portrait(kb_id, force_update=force_update))