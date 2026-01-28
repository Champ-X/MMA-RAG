# BGE-M3 稀疏检索实现总结

## 概述

本次优化将后端的 SPLADE 稀疏检索从简化版本升级为使用真正的 BGE-M3 模型实现，在存储侧和检索侧都采用了 BGE-M3 的稀疏向量能力。

## 实现内容

### 1. 创建 BGE-M3 稀疏向量编码器模块

**文件：** `backend/app/core/sparse_encoder.py`

- 实现了 `BGEM3SparseEncoder` 类
- 支持懒加载模型（首次使用时加载）
- 提供 `encode_query()` 方法：编码查询文本生成稀疏向量
- 提供 `encode_corpus()` 方法：批量编码文档文本生成稀疏向量
- 使用 Float16 模式减小模型大小（约 1.06GB）

### 2. 修改 VectorStore 支持稀疏向量存储

**文件：** `backend/app/modules/ingestion/storage/vector_store.py`

**修改内容：**
- 在 `text_chunks` Collection 配置中添加了 `sparse_vectors_config`
- 修改 `upsert_text_chunks()` 方法，支持同时存储密集向量和稀疏向量
- 添加 `search_text_chunks_sparse()` 方法，使用稀疏向量进行检索
- 更新集合创建逻辑，支持稀疏向量配置

**关键实现：**
```python
# Collection 配置
"sparse_vectors_config": {
    "sparse": SparseVectorParams(
        index=SparseIndexParams(on_disk=False)
    )
}

# 存储时同时包含密集和稀疏向量
vectors = {
    "dense": dense_vector,  # 4096维密集向量
    "sparse": SparseVector(indices=[...], values=[...])  # 稀疏向量
}
```

### 3. 修改 IngestionService 在存储时生成稀疏向量

**文件：** `backend/app/modules/ingestion/service.py`

**修改内容：**
- 在 `__init__()` 中初始化 BGE-M3 编码器
- 修改 `_vectorize_text_chunks()` 方法：
  - 使用 Qwen3-Embedding-8B 生成密集向量（保持不变）
  - 使用 BGE-M3 生成稀疏向量（新增）
  - 将两种向量都传递给 VectorStore

**流程：**
```
文档文本
  ↓
Qwen3-Embedding-8B → 密集向量 (4096维)
  ↓
BGE-M3.encode_corpus() → 稀疏向量 {token_id: weight}
  ↓
同时存储到 Qdrant
```

### 4. 修改 SearchEngine 在检索时使用 BGE-M3 稀疏向量

**文件：** `backend/app/modules/retrieval/search_engine.py`

**修改内容：**
- 在 `__init__()` 中初始化 BGE-M3 编码器
- 重写 `_sparse_search()` 方法：
  - 使用 `dense_query` 或 `keywords` 构建查询文本
  - 使用 `BGE-M3.encode_query()` 生成查询的稀疏向量
  - 调用 `vector_store.search_text_chunks_sparse()` 进行稀疏检索

**流程：**
```
查询文本
  ↓
BGE-M3.encode_query() → 查询稀疏向量 {token_id: weight}
  ↓
Qdrant 稀疏向量检索
  ↓
检索结果
```

### 5. 更新依赖

**文件：** `backend/requirements.txt`

添加了：
```
FlagEmbedding>=1.2.0  # BGE-M3 稀疏向量编码
```

## 技术细节

### 稀疏向量格式

BGE-M3 生成的稀疏向量格式：
```python
{
    token_id_1: weight_1,  # 例如: {12345: 2.123456}
    token_id_2: weight_2,  #         {67890: 1.987654}
    ...
}
```

### Qdrant 存储格式

转换为 Qdrant 的 `SparseVector` 格式：
```python
models.SparseVector(
    indices=[12345, 67890, ...],  # token_id 列表
    values=[2.123, 1.987, ...]    # 对应的权重列表
)
```

### 检索机制

Qdrant 使用点积（Dot Product）计算稀疏向量相似度：
```
相似度分数 = Σ(query_weight_i × doc_weight_i)
```

只计算两个向量中都存在的 token_id（交集）。

## 使用方式

### 存储阶段

文档入库时自动生成稀疏向量：
```python
# 在 IngestionService._vectorize_text_chunks() 中
sparse_results = self.sparse_encoder.encode_corpus(texts, batch_size=32)
# 每个文档都会生成稀疏向量
```

### 检索阶段

查询时自动使用稀疏向量：
```python
# 在 SearchEngine._sparse_search() 中
sparse_result = self.sparse_encoder.encode_query(query_text)
query_sparse = sparse_result["sparse"]
# 使用稀疏向量检索
search_results = await self.vector_store.search_text_chunks_sparse(
    query_sparse=query_sparse,
    kb_ids=target_kb_ids,
    limit=15
)
```

## 优势

1. **真正的稀疏检索**：使用 BGE-M3 模型生成语义稀疏向量，而非简单的关键词匹配
2. **中文支持优秀**：BGE-M3 对中文支持良好，适合中文文档检索
3. **混合检索**：密集向量和稀疏向量可以同时使用，通过 RRF 融合结果
4. **性能优化**：稀疏向量只存储非零值，节省存储空间

## 注意事项

1. **模型大小**：BGE-M3 模型约 1.06GB（Float16），首次加载需要时间
2. **向后兼容**：如果 BGE-M3 加载失败，系统会回退到只使用密集向量
3. **集合迁移**：如果已有 `text_chunks` Collection，需要删除并重新创建以支持稀疏向量

## 测试建议

1. 测试文档入库时稀疏向量是否正确生成
2. 测试稀疏检索是否能正确返回结果
3. 测试混合检索（Dense + Sparse）的 RRF 融合效果
4. 测试 BGE-M3 模型加载失败时的回退机制

## 后续优化

1. 可以考虑将 BGE-M3 模型部署为独立服务，避免每次加载
2. 可以优化批处理大小，根据文档长度动态调整
3. 可以添加稀疏向量的缓存机制，避免重复编码
