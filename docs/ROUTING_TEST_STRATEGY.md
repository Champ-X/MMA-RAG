# 在线路由测试策略与真实场景覆盖

## 一、当前状况：是否反映真实场景？

**结论：当前路由相关测试不读取 Qdrant，不能反映真实场景。**

| 测试 | 是否用 Qdrant | 是否走真实路由路径 | 说明 |
|------|----------------|--------------------|------|
| **test_routing.py** | 否 | 否 | `_make_router()` mock 掉 VectorStore / KnowledgeBaseService / PortraitGenerator；route 用例再 mock `embed`、`search_kb_portraits_topn`。**纯逻辑单测**，不连 Qdrant。 |
| **test_backend_integration.py** | 是 | 否 | 使用真实 Qdrant（test_* 集合）、真实检索；但检索**始终**传 `kb_context={"kb_ids": [test_kb_id]}`，路由走 **explicit** 分支，**从不**执行 embed → TopN 画像检索 → 打分 → 策略决策。 |

因此：

- **路由策略与打分公式**：仅由 `test_routing.py` 在 mock 下验证，**未**在真实 Qdrant + 真实画像上跑过。
- **search_kb_portraits_topn**：未在真实 `kb_portraits` 集合上做向量检索。
- **embed → TopN → 归一化 → 差距决策** 整条链路：没有在真实环境中做端到端验证。

---

## 二、优化目标（不修改业务/测试实现代码）

在 **不修改** 现有应用代码与现有测试代码的前提下：

- **继续**用 `test_routing.py` 做快速、稳定的逻辑单测（含打分、归一化、策略分支）。
- **补充**一层“真实场景”验证：**真实 Qdrant + 真实画像 + 真实路由路径**，通过 **已有 API** 触发路由，只用 **运行方式、环境与文档** 来区分与增强。

即：**不改代码，只改“怎么跑、跑什么、何时跑”**。

---

## 三、分层测试方案

### 3.1 L1：单元测试（当前即可）

- **范围**：`test_routing.py` 全部用例。
- **特点**：Mock 所有外部依赖，不连 Qdrant / MinIO / Embed API。
- **覆盖**：打分公式、归一化、全部偏小→全库、差距大→单库、多库、显式 kb、无画像等逻辑。
- **运行**：
  ```bash
  PYTHONPATH=backend python -m pytest tests/test_routing.py -v
  ```
- **用途**：CI、日常开发、重构时快速回归；**不**验证真实检索与真实路由路径。

### 3.2 L2：真实场景路由验证（建议补充的“集成层”）

- **目标**：在 **真实 Qdrant、真实 kb_portraits、真实 embed** 下，跑通  
  `embed(processed_query) → search_kb_portraits_topn(TopN) → 打分 → 归一化 → 策略决策`。
- **触发方式**：通过 **现有** 聊天/检索 API，**不传** `knowledgeBaseIds`（即 `kb_context=None`），强制走画像路由。
- **不修改**：应用代码、`test_routing.py`、`test_backend_integration.py` 均不改动；仅通过 **调用方式 + 环境准备** 实现。

---

## 四、L2 真实场景验证：具体做法

### 4.1 前置条件

1. **Qdrant** 已启动（含 `kb_portraits` 及业务使用的 text/image 集合）。
2. **至少一个 KB** 已有入库数据，且 **已生成画像**（即 `kb_portraits` 中有该 `kb_id` 的画像）。
3. **后端服务** 已启动（Embed、Chat 等接口可用）。

> 画像通常由入库流程或画像更新任务生成；若没有，需先通过现有 ingestion + 画像更新流程补全，再做 L2。

### 4.2 调用方式（不改代码）

聊天 API 在 **未传或传空 `knowledgeBaseIds`** 时，会使用 `kb_context=None`，从而走 **画像路由** 而非显式指定 KB。

**示例（curl）：**

```bash
# 不传 knowledgeBaseIds → 走真实路由
curl -X POST "http://localhost:8000/api/chat/message" \
  -H "Content-Type: application/json" \
  -d '{"message": "你的测试查询", "knowledgeBaseIds": []}'
```

流式接口同理：不传或传空 `knowledgeBaseIds` 即可。

### 4.3 验证点

当前 Chat API 响应里**不包含** `target_kb_ids`、`routing_method`，需通过 **服务端日志** 做 L2 校验：

- 日志中可查：
  - `知识库路由完成: ... 目标KB=[...]` → 即 `target_kb_ids`。
  - 同一请求前后的路由 / 检索日志 → 可推断 `routing_method`（explicit / no_portraits / low_confidence / single_kb_dominant / dual_kb 等）。
- 期望现象：embed 成功 → `search_kb_portraits_topn` 调用 → 再进入混合检索；若 `kb_portraits` 无数据则可能 `no_portraits`。

建议对多组查询（如明显属于某 KB、跨 KB、偏泛化）各调一次，结合日志目视检查路由是否符合策略文档。

### 4.4 建议执行时机

- **CI**：仅跑 L1（`test_routing.py`），不依赖 Qdrant。
- **发布前 / 集成联调**：在具备 Qdrant + 画像的环境跑一轮 L2（如上 curl 或等价 HTTP 调用），作为“真实场景”验收。
- **本地开发**：如需验证路由与检索联调，先起 Qdrant + 后端，再按 4.2 调 API 做 L2。

### 4.5 L2 脚本：`run_routing_l2_real.py`（推荐）

**`tests/run_routing_l2_real.py`** 为 **独立 Python 脚本**，直接调用应用模块（不经过 HTTP），在真实 Qdrant、真实 Embed 下完成：

1. **动态知识库画像构建**：发现或创建带数据的 KB → `PortraitGenerator.update_kb_portrait(force=True)` → 校验 `kb_portraits` 中确有该 KB 画像。
2. **智能知识库路由**：`KnowledgeRouter.route_query(query, kb_context=None)` 多组查询 → 断言 `routing_method`、`target_kb_ids` 符合预期。

**特点**：无需启动后端服务；若无可用的 KB，脚本会做最小 ingestion（需 MinIO），再构建画像并跑路由。

**运行**（项目根目录）：

```bash
# 依赖：Qdrant 已启动；Embed 可用（如 .env 中 SILICONFLOW_API_KEY）；无 KB 时需 MinIO
PYTHONPATH=backend python tests/run_routing_l2_real.py

# 指定 Qdrant
QDRANT_HOST=localhost QDRANT_PORT=6333 PYTHONPATH=backend python tests/run_routing_l2_real.py
```

**校验**：脚本内对 `RoutingResult` 做断言；退出码 0 表示通过。

---

## 五、与现有集成测试的关系

- **test_backend_integration.py**：  
  - 使用真实 Qdrant（test_* 集合）、真实检索，但 **一直传 `kb_ids`**，**不**覆盖画像路由。  
  - 仍可作为 **检索 / 生成流水线** 的集成测试；只是 **路由** 部分未被真实场景覆盖。
- **L2**：  
  - 专注 **路由** 在真实 Qdrant + 真实画像下的行为。  
  - 通过 **不传 `kb_ids`** 的 API 调用实现，**不**改任何现有代码。

---

## 六、小结

| 层级 | 内容 | 是否用 Qdrant | 是否反映真实路由场景 |
|------|------|----------------|----------------------|
| **L1** | `test_routing.py` | 否 | 否，仅逻辑 |
| **L2** | 不传 `kb_ids` 的 Chat/检索 API 调用，或 **`run_routing_l2_real.py`** 脚本 | 是 | 是 |
| **现有集成** | `test_backend_integration` | 是 | 否（路由 always explicit） |

**优化要点：**

- **保持** L1 不动，继续用于快速回归。
- **新增** L2 作为“真实场景”路由验证：**同一套代码**，通过 **运行环境 + 调用方式**（不传 `kb_ids`）触发真实路由路径。
- **不修改** 应用与现有测试实现，只通过 **文档 + 运行规范** 明确何时跑 L1、何时跑 L2、如何准备环境与如何校验结果。

这样即可在不改代码的前提下，既保留现有单测的稳定性，又补上“真实 Qdrant + 真实画像”下的路由场景覆盖。
