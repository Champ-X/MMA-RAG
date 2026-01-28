# 在线路由控制器：策略合理性分析与实现差距

## 一、策略概述（文档描述）

- **触发时机**：用户查询预处理之后
- **输入**：processed_query 对应的向量
- **检索**：在 kb_portraits 中检索 **TopN 个相似的主题节点**
- **打分**：对每个 kb_id 累加  
  $$Score(KB_x) = \sum_{node \in KB_x} \big( Similarity(node) \times \log(ClusterSize) \big)$$
- **归一化**：将所有 KB 的 Score 归一化到 [0, 1]
- **决策**：
  - 选出第一名；
  - 若第 2+ 名与第一名**差距较小** → 多库查询；
  - 若第 2+ 名与第一名**差距较大** → 只查第一名；
  - 若**所有 KB Score 都偏小** → 路由失败，启用全库检索。

---

## 二、策略合理性分析

### 2.1 整体评价

策略设计**整体合理**，能兼顾“与查询最相关的 KB”和“主题覆盖度”两个信号，并给出明确的多库/单库/全库规则。

### 2.2 各环节合理性

| 环节 | 合理性 | 说明 |
|------|--------|------|
| **用 processed_query 向量** | ✅ 合理 | 与检索流程一致：当前实现中路由入参为 `refined_query`，即预处理后的查询，符合“processed_query”的语义。 |
| **在 kb_portraits 中检索 TopN** | ✅ 合理 | 只对与查询最相关的主题做打分，避免噪声、且利于扩展（KB/画像很多时不必全量扫描）。 |
| **相似度 × log(ClusterSize)** | ✅ 合理 | 相似度反映“与本查询相关度”；ClusterSize 大表示该主题覆盖文档多、更稳，用 log 做温和加权，避免超大聚类垄断。 |
| **按 KB 对节点得分求和** | ✅ 合理 | 多个相关主题落在同一 KB 时，该 KB 总分自然更高，符合“多证据支持同一库”的直觉。 |
| **归一化到 [0,1]** | ✅ 合理 | 便于设定“偏小”的绝对阈值，与“所有 Score 都偏小则全库”的规则一致。 |
| **按与第一名的差距决定单库/多库** | ✅ 合理 | 差距小说明多库竞争激烈，多库更稳；差距大说明有一库明显更相关，单库即可。 |
| **全部分低则全库** | ✅ 合理 | 避免在“都不太相关”时强行选库，宁可全库检索。 |

### 2.3 可补充的细节（非错误）

- **TopN 的 N**：策略未写死，实现时可取 20～50 或按“至少覆盖前 K 个 KB”的规则自适应。
- **“差距较小/较大”的阈值**：需在实现里用常数或配置明确（如 0.1～0.3）。
- **归一化方式**：线性 min-max 到 [0,1] 即可；若希望突出头部，也可用 softmax 等，文档未强制。

---

## 三、当前实现与策略的差距

### 3.1 对照总表

| 策略要求 | 当前实现 | 是否满足 |
|----------|----------|----------|
| 使用 processed_query 向量在 kb_portraits 中**检索 TopN 个相似节点** | 按 KB 循环拉取画像：`get_kb_portraits(kb_id)` → `search_kb_portraits(kb_id)` 且**未传 query_vector**，走 scroll，且**未按 kb_id 过滤**，得到的是“前 limit 条”而非“全局 TopN 相似”；也**未**用查询向量做检索 | ❌ **不满足** |
| 对节点按公式累加：Score(KB_x) = Σ (Sim × log(ClusterSize)) | 按 KB 循环画像，做的是 **加权平均** `sum(sim×weight)/sum(weight)`，且 weight=log(cluster_size+1)，与策略中的 **求和** 不一致 | ❌ **不满足** |
| 将所有 KB 的 Score **归一化到 [0,1]** | 无归一化，直接用原始分数排序、阈值判断 | ❌ **不满足** |
| 第 2+ 名与第一名差距小 → 多库；差距大 → 单库 | 有类似逻辑（如 0.3、0.2 的硬编码阈值），语义与策略一致 | ✅ **部分满足**（缺归一化下的统一阈值语义） |
| 所有 KB Score 都偏小 → 路由失败、全库检索 | 用 `min_confidence=0.1` 过滤，低时 `target_kb_ids=list(kb_scores.keys())`，等价全库 | ✅ **满足** |

### 3.2 差距 1：检索方式与“TopN 相似节点”完全不符

**策略**：用 processed_query 的向量在 **整个 kb_portraits** 里做**一次向量检索**，取 **TopN 个最相似的主题节点**，再在这些节点上按 kb_id 聚合。

**现状**：

- 路由入口拿到的是 `refined_query`（即 processed_query）✅  
- 但画像获取方式为：对每个 KB 调 `get_kb_portraits(kb_id)` → `search_kb_portraits(kb_id)`，且**不传 query_vector**：
  - 走 `scroll(collection_name="kb_portraits", limit=limit)`；
  - **未使用** query 向量；
  - **未**按 kb_id 过滤（scroll 无 filter），得到的是一集合的“前 limit 条”，既不是“该 KB 的画像”，也不是“与查询最相关的 TopN 节点”。
- 因此：**既没有“用查询向量检索”，也没有“TopN 相似节点”**，与策略不一致。

**应改为**（示意）：

- 先对 processed_query 做向量化；
- 调用 `vector_store.search_kb_portraits(query_vector=query_vector, limit=TopN)`（或新方法），在 **全表 kb_portraits** 上做 **query_points**，取 TopN；
- 对这 TopN 个节点按 kb_id 聚合，再按策略公式算 Score(KB_x)。

同时需在 `search_kb_portraits` 中支持“仅按 query_vector + limit”的全局检索，并保证返回结构中包含 **vector** 与 **cluster_size**（或可从 payload 解析），见下文。

### 3.3 差距 2：打分公式是“求和”而非“加权平均”

**策略**：  
$$Score(KB_x) = \sum_{node \in KB_x} \big( Similarity(node) \times \log(ClusterSize) \big)$$

**现状**（`_calculate_kb_similarities`）：

- 对每个 portrait：`weight = np.log(cluster_size + 1)`，`kb_total_score += similarity * weight`，`kb_total_weight += weight`；
- 最后：`kb_scores[kb_id] = kb_total_score / kb_total_weight`。

即实现的是 **按 log(ClusterSize+1) 的加权平均**，不是 **按节点求和**。  
策略要求的是“对 TopN 中属于 KB_x 的节点直接求和”，不除以权重和。若改为“先检索 TopN，再只在这些节点上按 kb_id 累加 Sim×log(ClusterSize)”，则与策略一致。

### 3.4 差距 3：缺少“归一化到 [0,1]”

**策略**：将所有 KB 的 Score 归一化到 [0, 1]，再基于归一化后的分数做“差距较小/较大”“都偏小”等判断。

**现状**：未做 min-max（或其它）归一化，直接用原始加权和/加权平均与 0.1、0.2、0.3 等阈值比较。  
若后续补上“先求和、再归一化、再阈值与差距判断”，则与策略一致。

### 3.5 差距 4：画像结构与 router 假设不一致

**策略**：计算需要每个节点的 **Similarity(node)** 与 **ClusterSize**。

**现状**：

- `search_kb_portraits` 返回 `{id, score, payload}`，**未带向量**；scroll/query_points 若未传 `with_vectors=True`，则无法在 router 里重新算 Similarity。
- `cluster_size` 在 Qdrant 的 payload 里，而 router 使用 `portrait.get("cluster_size")`，若未把 payload 展平或兼容读取 payload，则可能拿不到。
- 因此：**要么**在检索层返回 `vector` 与 `cluster_size`（或等价信息），**要么**在“用 query 做 TopN 检索”时直接使用 Qdrant 返回的 `score` 作为 Similarity(node)，并只从 payload 中读 cluster_size。  
当前既未做“TopN 检索”，也未统一好数据结构，导致与策略所依赖的节点信息不一致。

---

## 四、结论与改动建议

### 4.1 策略是否合理

- **是**。加权投票、log(ClusterSize)、归一化、单库/多库/全库的规则都站得住脚，可作为实现的目标行为。

### 4.2 当前实现是否满足策略

- **不满足**。主要差距：
  1. **检索逻辑**：未用 processed_query 向量在 kb_portraits 上做“全局 TopN 相似检索”，而是按 KB 拉画像且 scroll 未按 kb_id 过滤、未用查询向量。
  2. **打分公式**：实现为“加权平均”，策略要求为“求和”。
  3. **归一化**：未将各 KB Score 归一化到 [0,1]。
  4. **数据形态**：返回的画像中缺少 vector（或等价的 similarity），且 cluster_size 的取用方式与 payload 结构未统一，不利于按策略正确算分。

### 4.3 建议的改动顺序（与策略对齐）

1. **检索方式**
   - 路由时：先对 refined_query 向量化，再在 **kb_portraits 全集**上做 **query_points(limit=TopN)**；
   - 保证 `search_kb_portraits` 支持“仅按 query_vector + limit”的全局检索，且返回的每条节点带 **vector**（或由调用方用 Qdrant 返回的 score 作为 Similarity）与 **cluster_size**（可从 payload 统一到顶层或约定读取方式）。

2. **打分公式**
   - 仅对上述 TopN 个节点，按 kb_id 分组后计算：  
     `Score(KB_x) = sum(Similarity(node) * log(ClusterSize))`  
     不再除以权重和，即改为“求和”而不是“加权平均”。

3. **归一化与决策**
   - 对所有 KB 的 Score 做 min-max 到 [0,1]；
   - “所有都偏小”改为对归一化后的分数设阈值（如 max < 0.2 或类似）；
   - “差距较小/较大”的阈值可在归一化后的分数上配置（如 0.1～0.3），便于与策略文案对应。

4. **scroll 与 kb_id（若保留“按 KB 拉全量”的其它用途）**
   - 若仍有按 kb_id 拉取画像的需求，scroll 需加 `scroll_filter` 按 `kb_id` 过滤，避免与“TopN 全局检索”语义混淆。

按以上顺序调整后，当前实现即可在行为上与文档中的在线路由策略一致。

---

## 五、已完成的实现调整（2025-01）

1. **VectorStore**
   - 新增 `search_kb_portraits_topn(query_vector, limit)`：在 kb_portraits 全表做 `query_points`，返回 TopN 节点，每条含 `score`（作 Similarity）、`kb_id`、`cluster_size`。
   - `search_kb_portraits(kb_id, limit)` 仅保留按 kb_id 的 scroll；scroll 增加 `scroll_filter` 按 `kb_id` 过滤；移除 `query_vector` 参数。

2. **Router**
   - 路由流程：向量化 processed_query → `search_kb_portraits_topn` 取 TopN → `_calculate_kb_scores_from_topn` 按 kb_id 求和  
     `Score(KB_x) = Σ (Similarity(node) × log(ClusterSize))` → `_normalize_scores` min-max 到 [0,1] → `_apply_routing_strategy`。
   - 策略常量：`ROUTING_TOP_N=30`、`ROUTING_ALL_LOW_THRESHOLD=0.08`、`ROUTING_GAP_DOMINANT=0.25`。
   - 全部偏小（`max_raw < ROUTING_ALL_LOW_THRESHOLD`）→ 全库检索；否则归一化后按与第一名差距 ≥ `ROUTING_GAP_DOMINANT` 则单库，否则多库（最多 2 个）。

3. **测试**
   - 集成测试的 patch 列表已加入 `search_kb_portraits_topn`。
