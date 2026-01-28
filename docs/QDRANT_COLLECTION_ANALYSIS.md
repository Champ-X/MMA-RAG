# Qdrant Collection 结构设计分析报告

## 总体评估

当前实现与方案要求**基本一致**，但存在一些差异和需要改进的地方。

---

## 1. Text Collection (`text_chunks`)

### ✅ 已实现的字段

| 字段名 | 方案要求 | 当前实现 | 状态 |
|--------|---------|---------|------|
| `id` | UUID | `str(uuid.uuid4())` | ✅ 一致 |
| `vector` | Dense Vectors (4096维) | 4096维向量 | ✅ 一致 |
| `text_content` | String | `payload.text_content` | ✅ 一致 |
| `kb_id` | Keyword | `payload.kb_id` | ✅ 一致 |
| `file_id` | Keyword | `payload.file_id` | ✅ 一致 |
| `file_path` | String | `payload.file_path` | ✅ 一致 |
| `file_type` | Keyword | `payload.file_type` | ✅ 一致 |
| `context_window` | String/JSON | `payload.context_window` | ⚠️ 字段存在但未填充 |
| `metadata` | JSON | `payload.metadata` | ✅ 一致 |

### ⚠️ 问题：`context_window` 字段未正确填充

**问题描述：**
- 方案要求：`context_window` 应存储该 chunk 的前后相邻 Chunk ID，用于 Small-to-Big 策略扩大上下文窗口
- 当前实现：在 `vector_store.py:197` 中，`context_window` 字段存在但默认值为空字典 `{}`
- 在 `service.py` 的分块逻辑中，没有填充相邻 chunk 的 ID

**影响：**
- 无法实现 Small-to-Big 策略
- 检索到单个 chunk 后无法直接拉取其前后文

**建议修复：**
在 `_split_text_into_chunks` 方法返回 chunks 后，为每个 chunk 填充 `context_window` 字段，包含前一个和后一个 chunk 的 ID。

### 📝 额外字段（方案中未提及）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `chunk_index` | Integer | chunk 在文件中的索引位置 |
| `created_at` | String | 创建时间戳 |

这些字段不影响功能，但建议在方案文档中补充说明。

---

## 2. Image Collection (`image_vectors`)

### ✅ 已实现的字段

| 字段名 | 方案要求 | 当前实现 | 状态 |
|--------|---------|---------|------|
| `id` | UUID | `str(uuid.uuid4())` | ✅ 一致 |
| `vectors.clip_vec` | Dense Vectors (768维) | 768维 CLIP 向量 | ✅ 一致 |
| `vectors.text_vec` | Dense Vectors (4096维) | 4096维文本嵌入向量 | ✅ 一致 |
| `kb_id` | Keyword | `payload.kb_id` | ✅ 一致 |
| `file_id` | Keyword | `payload.file_id` | ✅ 一致 |
| `file_path` | String | `payload.file_path` | ✅ 一致 |
| `caption` | Text | `payload.caption` | ✅ 一致 |
| `image_source_type` | Keyword | `payload.image_source_type` | ✅ 一致 |
| `img_format` | Keyword | `payload.img_format` | ✅ 一致 |

### 📝 额外字段（方案中未提及）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `width` | Integer | 图片宽度（像素） |
| `height` | Integer | 图片高度（像素） |
| `created_at` | String | 创建时间戳 |

这些字段不影响功能，但建议在方案文档中补充说明。

---

## 3. kb_portraits Collection (`kb_portraits`)

### ✅ 已实现的字段

| 字段名 | 方案要求 | 当前实现 | 状态 |
|--------|---------|---------|------|
| `id` | UUID | `str(uuid.uuid4())` | ✅ 一致 |
| `vector` | Dense Vector (4096维) | 4096维向量 | ✅ 一致 |
| `payload.kb_id` | Keyword | `payload.kb_id` | ✅ 一致 |
| `payload.topic_summary` | Text | `payload.topic_summary` | ✅ 一致 |
| `payload.cluster_size` | Integer | `payload.cluster_size` | ✅ 一致 |

### 📝 额外字段（方案中未提及）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `created_at` | String | 创建时间戳 |
| `metadata` | JSON | 可选的额外元数据（如果 portrait 包含） |

这些字段不影响功能，但建议在方案文档中补充说明。

---

## 总结

### ✅ 符合方案的部分

1. **Collection 命名**：`text_chunks`、`image_vectors`、`kb_portraits` 与方案一致
2. **向量维度**：所有向量维度与方案要求一致
3. **核心字段**：所有方案要求的核心字段都已实现
4. **多向量配置**：Image Collection 的多向量配置（clip_vec + text_vec）正确实现

### ⚠️ 需要改进的部分

1. **`context_window` 字段未填充**：
   - 当前只是预留了字段，但没有在分块时填充相邻 chunk ID
   - 需要实现逻辑来记录每个 chunk 的前后邻居

### 📝 建议

1. **补充方案文档**：将额外字段（如 `chunk_index`、`width`、`height`、`created_at`）补充到方案文档中
2. **实现 `context_window` 填充逻辑**：在分块完成后，为每个 chunk 填充前后相邻 chunk 的 ID
3. **字段类型验证**：确保所有字段类型与 Qdrant 的 Keyword、String、Integer、JSON 类型匹配

---

## 代码位置参考

- **Collection 定义**：`backend/app/modules/ingestion/storage/vector_store.py:45-64`
- **Text Chunks 插入**：`backend/app/modules/ingestion/storage/vector_store.py:168-225`
- **Image Vectors 插入**：`backend/app/modules/ingestion/storage/vector_store.py:227-290`
- **KB Portraits 插入**：`backend/app/modules/ingestion/storage/vector_store.py:292-351`
- **文本分块逻辑**：`backend/app/modules/ingestion/service.py:316-395`
