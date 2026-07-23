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
NEAREST_PER_CLUSTER_MIN = 10
NEAREST_PER_CLUSTER_MAX = 15
EMBEDDING_DIM = 4096
# 画像以 Scene 语义为视频采样单位：防止一部长视频的几十个 Shot 压制同库的文档、图片或其他视频。
VIDEO_SCENES_PER_FILE_MAX = 24
VIDEO_CAPTION_WEIGHT = 0.55
VIDEO_ASR_WEIGHT = 0.45
SMALL_CORPUS_SINGLE_PORTRAIT_MAX = 6

@dataclass
class VectorSample:
    """向量样本数据类（懒加载：采样时仅 id/vector/source_type，主题抽取前按 id 回查文本）"""
    id: str
    vector: List[float]
    source_type: str  # "doc" | "image" | "audio" | "video"（视频以 Scene 为计量单位）
    content: Optional[str] = None  # 主题抽取时按需回填，采样阶段不加载
    source_file_id: Optional[str] = None
    scene_id: Optional[str] = None
    scene_start_time: float = 0.0

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
            
            if not samples:
                # 没有任何可用向量时才删除画像。少量 Shot / 短视频仍应形成一个路由主题，
                # 否则纯视频知识库很容易长期没有画像。
                try:
                    await self.vector_store.delete_kb_portraits(kb_id)
                    logger.info(f"知识库无可用向量，已删除该知识库画像: {kb_id}")
                except Exception as del_err:
                    logger.warning(f"删除空知识库画像失败 kb_id={kb_id}: {del_err}")
                return {
                    "status": "insufficient_data",
                    "message": "知识库没有可用于画像的文本、图片、音频或视频 Shot 向量",
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
        1. 获取当前知识库的数据量（文本块、图片、音频与视频 Shot）
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
            
            # 1. 获取当前知识库的数据量（按 kb 统计：文本、图片、音频、视频 Shot）。
            # 关键帧是 Shot 的从属视觉证据，不能再作为画像样本，否则会把同一视频放大数倍。
            n_text, n_img = await self.vector_store.count_kb_chunks(kb_id)
            n_audio = await self.vector_store.count_kb_audio(kb_id)
            n_video = await self.vector_store.count_kb_video(kb_id)
            current_total = n_text + n_img + n_audio + n_video
            current_counts = {
                "text": n_text,
                "image": n_img,
                "audio": n_audio,
                "video_shot": n_video,
            }
            
            # 2. 获取上次画像更新的时间
            existing_portraits = await self.vector_store.search_kb_portraits(kb_id, limit=1)
            
            # 如果没有画像，需要更新
            if not existing_portraits:
                logger.info(f"知识库画像不存在，需要创建: {kb_id}")
                return True
            
            # 获取最新的画像更新时间
            last_update_time = None
            last_total_count = 0
            last_counts: Dict[str, Optional[int]] = {
                "text": None,
                "image": None,
                "audio": None,
                "video_shot": None,
            }
            
            # 从画像的payload中获取更新时间
            for portrait in existing_portraits:
                payload = portrait.get("payload", {})
                if isinstance(payload, dict):
                    updated_at = payload.get("updated_at") or payload.get("created_at")
                    if updated_at:
                        try:
                            last_update_time = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
                            # 如果有存储上次数据量，也获取
                            last_total_count = int(payload.get("last_total_count", 0) or 0)
                            for key, payload_key in (
                                ("text", "last_text_count"),
                                ("image", "last_image_count"),
                                ("audio", "last_audio_count"),
                            ):
                                if payload_key in payload:
                                    last_counts[key] = int(payload.get(payload_key, 0) or 0)
                            # 兼容先前把 Shot 错标为 keyframe 的画像 payload。
                            if "last_video_shot_count" in payload:
                                last_counts["video_shot"] = int(payload.get("last_video_shot_count", 0) or 0)
                            elif "last_video_keyframe_count" in payload:
                                last_counts["video_shot"] = int(payload.get("last_video_keyframe_count", 0) or 0)
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

            # 视频增删即使总数量刚好不变，也会改变知识库主题路由；特别是纯视频库不应等到
            # 20% 阈值或 7 天定时任务才刷新。其它模态仍沿用原有的比例阈值，避免小块频繁重建。
            if (
                last_counts["video_shot"] is not None
                and current_counts["video_shot"] != last_counts["video_shot"]
            ):
                logger.info(
                    "视频 Shot 数量发生变化 ({} -> {})，需要更新画像: {}",
                    last_counts["video_shot"],
                    current_counts["video_shot"],
                    kb_id,
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

    @staticmethod
    def _normalized_vector(vector: Any) -> Optional[np.ndarray]:
        """返回有限、非零的 L2 归一化向量；画像聚类与 Qdrant 的余弦语义保持一致。"""
        try:
            array = np.asarray(vector, dtype=np.float32).reshape(-1)
            if array.size == 0 or not np.isfinite(array).all():
                return None
            norm = float(np.linalg.norm(array))
            if norm <= 1e-8:
                return None
            return array / norm
        except (TypeError, ValueError):
            return None

    @classmethod
    def _video_semantic_vector(cls, record: Dict[str, Any]) -> Optional[np.ndarray]:
        """融合同一 Shot 的视觉 caption 与语音 ASR dense 语义，不增加第五个持久化向量。"""
        caption = cls._normalized_vector(record.get("caption_vector"))
        asr = cls._normalized_vector(record.get("asr_vector"))
        if caption is not None and asr is not None and caption.shape == asr.shape:
            return cls._normalized_vector(VIDEO_CAPTION_WEIGHT * caption + VIDEO_ASR_WEIGHT * asr)
        return caption if caption is not None else asr

    @classmethod
    def _collapse_video_shots_to_scenes(cls, records: List[Dict[str, Any]]) -> List[VectorSample]:
        """把同一 Scene 的多个 Shot 收敛为一个语义样本，并以中心最近 Shot 回读文本。"""
        grouped: Dict[Tuple[str, str], List[Tuple[Dict[str, Any], np.ndarray]]] = {}
        for record in records:
            if not isinstance(record, dict):
                continue
            vector = cls._video_semantic_vector(record)
            point_id = str(record.get("id") or "")
            if vector is None or not point_id:
                continue
            file_id = str(record.get("file_id") or "")
            scene_id = str(record.get("scene_id") or record.get("shot_id") or point_id)
            grouped.setdefault((file_id, scene_id), []).append((record, vector))

        scenes: List[VectorSample] = []
        for (file_id, scene_id), members in grouped.items():
            vectors = [vector for _, vector in members]
            if not vectors or len({vector.shape[0] for vector in vectors}) != 1:
                continue
            centroid = cls._normalized_vector(np.mean(np.stack(vectors), axis=0))
            if centroid is None:
                continue
            medoid_index = min(
                range(len(members)),
                key=lambda index: float(np.linalg.norm(members[index][1] - centroid)),
            )
            representative = members[medoid_index][0]
            try:
                start_time = float(representative.get("shot_start_time") or 0.0)
            except (TypeError, ValueError):
                start_time = 0.0
            scenes.append(VectorSample(
                id=str(representative.get("id")),
                vector=centroid.tolist(),
                source_type="video",
                source_file_id=file_id or None,
                scene_id=scene_id,
                scene_start_time=start_time,
            ))
        return sorted(scenes, key=lambda item: (item.source_file_id or "", item.scene_start_time, item.scene_id or ""))

    @staticmethod
    def _evenly_spaced(samples: List[VectorSample], limit: int) -> List[VectorSample]:
        """稳定地抽取时间有覆盖的样本，避免随机抽样遗漏视频开头、转折或结尾。"""
        if limit <= 0:
            return []
        if len(samples) <= limit:
            return list(samples)
        if limit == 1:
            return [samples[len(samples) // 2]]
        indices = [round(index * (len(samples) - 1) / (limit - 1)) for index in range(limit)]
        return [samples[index] for index in dict.fromkeys(indices)]

    @classmethod
    def _select_video_scene_samples(cls, scenes: List[VectorSample], budget: int) -> List[VectorSample]:
        """先给每个视频做 Scene 上限，再按文件均衡分配预算，避免长视频淹没其他内容。"""
        if budget <= 0 or not scenes:
            return []
        by_file: Dict[str, List[VectorSample]] = {}
        for scene in scenes:
            by_file.setdefault(scene.source_file_id or scene.id, []).append(scene)
        capped = {
            file_id: cls._evenly_spaced(
                sorted(items, key=lambda item: (item.scene_start_time, item.scene_id or "")),
                VIDEO_SCENES_PER_FILE_MAX,
            )
            for file_id, items in by_file.items()
        }
        total = sum(len(items) for items in capped.values())
        if total <= budget:
            return [scene for file_id in sorted(capped) for scene in capped[file_id]]

        file_ids = sorted(capped)
        if budget < len(file_ids):
            anchors = [items[len(items) // 2] for items in (capped[file_id] for file_id in file_ids)]
            return cls._evenly_spaced(anchors, budget)

        allocations = {
            file_id: max(1, min(len(items), int(budget * len(items) / total)))
            for file_id, items in capped.items()
        }
        assigned = sum(allocations.values())
        while assigned < budget:
            candidate = max(
                (file_id for file_id in file_ids if allocations[file_id] < len(capped[file_id])),
                key=lambda file_id: (len(capped[file_id]) - allocations[file_id], file_id),
                default=None,
            )
            if candidate is None:
                break
            allocations[candidate] += 1
            assigned += 1
        while assigned > budget:
            candidate = max(
                (file_id for file_id in file_ids if allocations[file_id] > 1),
                key=lambda file_id: (allocations[file_id], file_id),
                default=None,
            )
            if candidate is None:
                break
            allocations[candidate] -= 1
            assigned -= 1
        return [
            scene
            for file_id in file_ids
            for scene in cls._evenly_spaced(capped[file_id], allocations[file_id])
        ]

    async def _sample_vectors(self, kb_id: str) -> List[VectorSample]:
        """
        采样向量数据（懒加载：仅 id / vector / source_type）。
        - N_text + N_img + N_audio + N_video < 5000：全量提取。
        - 否则按比例 S 分配 S_text、S_img、S_audio、S_video，分别在四类集合蓄水池采样。
        - 视频先融合 Shot 的 caption/ASR 向量，再按 Scene 聚合，并限制单视频的场景样本数。
        """
        try:
            n_text, n_img = await self.vector_store.count_kb_chunks(kb_id)
            n_audio = await self.vector_store.count_kb_audio(kb_id)
            n_video = await self.vector_store.count_kb_video(kb_id)
            total = n_text + n_img + n_audio + n_video
            if total <= 0:
                logger.info(
                    f"知识库没有可采样向量: {kb_id}, total={total} "
                    f"(text={n_text}, img={n_img}, audio={n_audio}, video_units={n_video})"
                )
                return []

            use_full = total < SAMPLE_FULL_THRESHOLD
            if use_full:
                s = total
                s_text, s_img, s_audio, s_video = n_text, n_img, n_audio, n_video
            else:
                s = max(SAMPLE_MIN, min(SAMPLE_MAX, int(total * 0.2)))
                if total > 0:
                    s_text = max(0, int(s * n_text / total))
                    s_img = max(0, int(s * n_img / total))
                    s_audio = max(0, int(s * n_audio / total))
                    s_video = s - s_text - s_img - s_audio
                    # 有视频时至少给一个 Scene 样本预算；从样本数最多的其他模态让出一个名额。
                    if n_video > 0 and s_video <= 0:
                        donors = {
                            "text": s_text,
                            "image": s_img,
                            "audio": s_audio,
                        }
                        donor = max(donors, key=donors.get)
                        if donors[donor] > 0:
                            if donor == "text":
                                s_text -= 1
                            elif donor == "image":
                                s_img -= 1
                            else:
                                s_audio -= 1
                        s_video = 1
                else:
                    s_text = s_img = s_audio = s_video = 0

            samples: List[VectorSample] = []
            batch = 500

            async def drain_text(lim: int) -> List[Tuple[str, List[float]]]:
                out: List[Tuple[str, List[float]]] = []
                off: Optional[Any] = None
                remaining = max(0, lim)
                while remaining > 0:
                    chunk, off = await self._run_scroll_text(kb_id, remaining, off, batch)
                    out.extend(chunk)
                    remaining -= len(chunk)
                    if off is None or not chunk:
                        break
                return out

            async def drain_img(lim: int) -> List[Tuple[str, List[float]]]:
                out: List[Tuple[str, List[float]]] = []
                off: Optional[Any] = None
                remaining = max(0, lim)
                while remaining > 0:
                    chunk, off = await self._run_scroll_img(kb_id, remaining, off, batch)
                    out.extend(chunk)
                    remaining -= len(chunk)
                    if off is None or not chunk:
                        break
                return out

            async def drain_audio(lim: int) -> List[Tuple[str, List[float]]]:
                out: List[Tuple[str, List[float]]] = []
                off: Optional[Any] = None
                remaining = max(0, lim)
                while remaining > 0:
                    chunk, off = await self._run_scroll_audio(kb_id, remaining, off, batch)
                    out.extend(chunk)
                    remaining -= len(chunk)
                    if off is None or not chunk:
                        break
                return out

            async def drain_video(lim: int) -> List[Dict[str, Any]]:
                out: List[Dict[str, Any]] = []
                off: Optional[Any] = None
                remaining = max(0, lim)
                while remaining > 0:
                    chunk, off = await self._run_scroll_video(kb_id, remaining, off, batch)
                    out.extend(chunk)
                    remaining -= len(chunk)
                    if off is None or not chunk:
                        break
                return out

            if use_full:
                all_text = await drain_text(n_text + 1)
                all_img = await drain_img(n_img + 1)
                all_audio = await drain_audio(n_audio + 1)
                all_video_records = await drain_video(n_video + 1)
                all_video = self._select_video_scene_samples(
                    self._collapse_video_shots_to_scenes(all_video_records),
                    budget=n_video,
                )
                for pid, vec in all_text:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="doc"))
                for pid, vec in all_img:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="image"))
                for pid, vec in all_audio:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="audio"))
                samples.extend(all_video)
            else:
                stream_text = await drain_text(s_text + 1)
                stream_img = await drain_img(s_img + 1)
                stream_audio = await drain_audio(s_audio + 1)
                stream_video = await drain_video(s_video + 1)
                chosen_text = self._reservoir_sample(stream_text, s_text)
                chosen_img = self._reservoir_sample(stream_img, s_img)
                chosen_audio = self._reservoir_sample(stream_audio, s_audio)
                chosen_video = self._select_video_scene_samples(
                    self._collapse_video_shots_to_scenes(stream_video),
                    budget=s_video,
                )
                for pid, vec in chosen_text:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="doc"))
                for pid, vec in chosen_img:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="image"))
                for pid, vec in chosen_audio:
                    samples.append(VectorSample(id=pid, vector=vec, source_type="audio"))
                samples.extend(chosen_video)

            logger.info(
                f"向量采样完成: {kb_id}, 样本数: {len(samples)} "
                f"(text={n_text}, img={n_img}, audio={n_audio}, video_units={n_video})"
            )
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

    async def _run_scroll_audio(
        self,
        kb_id: str,
        limit: int,
        offset: Optional[Any],
        batch_size: int,
    ) -> Tuple[List[Tuple[str, List[float]]], Optional[Any]]:
        return await self.vector_store.scroll_audio_vectors_for_sampling(
            kb_id, limit=limit, offset=offset, batch_size=batch_size
        )

    async def _run_scroll_video(
        self,
        kb_id: str,
        limit: int,
        offset: Optional[Any],
        batch_size: int,
    ) -> Tuple[List[Dict[str, Any]], Optional[Any]]:
        return await self.vector_store.scroll_video_shot_samples_for_portrait(
            kb_id, limit=limit, offset=offset, batch_size=batch_size
        )

    async def _perform_clustering(
        self,
        samples: List[VectorSample]
    ) -> Dict[str, Any]:
        """执行 K-Means 聚类，并安全处理小型/纯视频知识库。

        视频按 Scene 聚合后，一个短视频往往只剩 1–6 个样本。旧实现强制 K>=2 且无条件
        计算 silhouette，会让这类本应可路由的知识库构建失败；这里让小语料稳定退化为一个主题。
        """
        try:
            normalized: List[VectorSample] = []
            expected_dim: Optional[int] = None
            dropped = 0
            for sample in samples:
                vector = self._normalized_vector(sample.vector)
                if vector is None:
                    dropped += 1
                    continue
                if expected_dim is None:
                    expected_dim = int(vector.size)
                if vector.size != expected_dim:
                    dropped += 1
                    continue
                sample.vector = vector.tolist()
                normalized.append(sample)

            # 保持调用方的 samples 与 labels 一一对应，供后续按最近样本回读内容。
            samples[:] = normalized
            if not samples:
                raise ValueError("没有可用于画像聚类的有效同维向量")
            if dropped:
                logger.warning("画像聚类丢弃 {} 个空、异常或维度不一致的向量", dropped)

            vectors = np.asarray([sample.vector for sample in samples], dtype=np.float32)
            n = len(samples)
            # 对近似重复向量，KMeans 可能产生空簇，silhouette 也没有意义。
            unique_count = int(np.unique(np.round(vectors, decimals=6), axis=0).shape[0])
            optimal_k = await self._find_optimal_k(vectors)
            optimal_k = min(optimal_k, unique_count, max(1, n - 1)) if n > 1 else 1

            if optimal_k <= 1:
                center = self._normalized_vector(np.mean(vectors, axis=0))
                if center is None:
                    center = vectors[0]
                result = {
                    "k": 1,
                    "labels": [0] * n,
                    "centers": [center.tolist()],
                    "inertia": float(np.sum((vectors - center) ** 2)),
                    "silhouette_score": None,
                    "sample_count": n,
                }
                logger.info("小型或同质知识库使用单主题画像: N={}", n)
                return result

            kmeans = KMeans(
                n_clusters=optimal_k,
                random_state=42,
                n_init=10,  # type: ignore[arg-type]
            )
            cluster_labels = kmeans.fit_predict(vectors)
            distinct_labels = len(set(cluster_labels.tolist()))
            silhouette_avg: Optional[float] = None
            if 1 < distinct_labels < n:
                silhouette_avg = float(silhouette_score(vectors, cluster_labels))

            clustering_result = {
                "k": optimal_k,
                "labels": cluster_labels.tolist(),
                "centers": kmeans.cluster_centers_.tolist(),
                "inertia": float(kmeans.inertia_),
                "silhouette_score": silhouette_avg,
                "sample_count": n,
            }
            silhouette_text = f"{silhouette_avg:.3f}" if silhouette_avg is not None else "N/A"
            logger.info("K-Means 聚类完成: K={}, 轮廓系数={}", optimal_k, silhouette_text)
            return clustering_result
        except Exception as e:
            logger.error(f"聚类执行失败: {str(e)}")
            raise

    async def _find_optimal_k(self, vectors: np.ndarray) -> int:
        """确定画像簇数；小语料稳定使用单主题，大语料使用 sqrt(N/2) 并保证可计算 silhouette。"""
        try:
            n = len(vectors)
            if n <= SMALL_CORPUS_SINGLE_PORTRAIT_MAX:
                return 1
            # silhouette 需要 2 <= K < N；max portrait size 也不能突破这一边界。
            max_k = max(2, min(int(settings.max_kb_portrait_size), n - 1))
            k = max(2, int(math.sqrt(n / 2.0)))
            k = min(k, max_k)
            logger.info("聚类数 K = sqrt(N/2): N={} -> K={}", n, k)
            return k
        except Exception as e:
            logger.error(f"确定最优K值失败: {str(e)}")
            return 1
    
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
                ids_audio = [s.id for s, _ in nearest if s.source_type == "audio"]
                ids_video = [s.id for s, _ in nearest if s.source_type == "video"]
                texts_doc, texts_img = await self.vector_store.fetch_texts_by_ids(
                    ids_doc, ids_img
                )
                texts_audio: Dict[str, str] = {}
                if ids_audio:
                    texts_audio = await self.vector_store.fetch_audio_texts_by_ids(ids_audio)
                texts_video: Dict[str, str] = {}
                if ids_video:
                    texts_video = await self.vector_store.fetch_video_texts_by_ids(ids_video)

                content_pieces: List[str] = []
                for s, _ in nearest:
                    if s.source_type == "doc":
                        t = texts_doc.get(s.id)
                        prefix = "[文档片段]"
                    elif s.source_type == "image":
                        t = texts_img.get(s.id)
                        prefix = "[图片描述]"
                    elif s.source_type == "audio":
                        t = texts_audio.get(s.id)
                        prefix = "[音频转写/描述]"
                    else:
                        t = texts_video.get(s.id)
                        prefix = "[视频片段]"
                    if not (t and t.strip()):
                        continue
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
                    "content": "你是一个专业的知识管理专家，擅长综合文档、图片、音频转写和视频场景/语音内容，生成简洁准确的主题摘要。"
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
            n_audio = await self.vector_store.count_kb_audio(kb_id)
            n_video = await self.vector_store.count_kb_video(kb_id)
            total_count = n_text + n_img + n_audio + n_video
            text_count, image_count, audio_count, video_count = n_text, n_img, n_audio, n_video
            
            # 在portraits的metadata中添加数据量信息
            for portrait in portraits:
                # 确保portrait有metadata字段
                if "metadata" not in portrait:
                    portrait["metadata"] = {}
                portrait["metadata"]["last_total_count"] = total_count
                portrait["metadata"]["last_text_count"] = text_count
                portrait["metadata"]["last_image_count"] = image_count
                portrait["metadata"]["last_audio_count"] = audio_count
                # 视频主检索单元是 Shot；关键帧仅是视觉增强索引，不能用于驱动画像更新。
                portrait["metadata"]["last_video_shot_count"] = video_count
                portrait["metadata"]["updated_at"] = datetime.now(timezone.utc).isoformat()
            
            # 存储到kb_portraits集合
            result = await self.vector_store.upsert_kb_portraits(kb_id, portraits)
            
            logger.info(
                f"知识库画像存储完成: {kb_id}, 画像数: {len(portraits)}, "
                f"数据量: {total_count} (文本: {text_count}, 图片: {image_count}, 音频: {audio_count}, 视频 Shot: {video_count})"
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
        
        # 安全地运行异步代码，处理事件循环问题
        # 在 Celery worker 中，确保使用新的事件循环
        try:
            # 尝试获取当前事件循环
            try:
                loop = asyncio.get_event_loop()
                if loop.is_closed():
                    # 如果循环已关闭，创建新的
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
            except RuntimeError:
                # 没有事件循环，创建新的
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            # 使用 run_until_complete 执行异步代码
            return loop.run_until_complete(gen.update_kb_portrait(kb_id, force_update=force_update))
        except Exception as e:
            logger.error(f"Celery 任务执行失败 (kb_id={kb_id}): {str(e)}", exc_info=True)
            raise
