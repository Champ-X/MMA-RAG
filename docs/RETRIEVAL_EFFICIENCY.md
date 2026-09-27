# 检索链路效率优化与验证

本次以 `46c09229d1699ae7ca6d2d646dbaceac4482eb43` 为对照版本，目标是在保留检索语义、召回范围和排序规则的前提下，消除无效工作和重复等待。

## 执行路径

| 阶段 | 优化 | 准确性约束 |
|---|---|---|
| 纯问候 | 聊天入口允许首轮完整匹配的问候直接进入生成 | 有历史、附件或指定范围时保持检索；检索 API 默认不启用问候分流；“你好，请找文档”、书名和问句不匹配 |
| 空索引 | 预处理前检查全部检索集合与画像集合 | 使用实时精确计数，不依赖可能缺失的知识库元数据；任一集合有数据即保留检索；检查失败/超时视为未知；不跨请求缓存；指定范围和附件保持原流程 |
| 意图识别、查询改写 | 保留原模型、提示词及依赖顺序，补充各阶段耗时 | 不删除多视角扩展，不以小模型或关闭推理替代现有模型 |
| 路由及文本/图像/音频/视频向量化 | 在单次检索内复用成功向量 | 文本必须完全相同，模型和配置必须相同；不复用失败、备用模型或不完整批次；部分命中时仍原样发送完整批次；复制向量避免被调用方修改 |
| 多路召回 | 并行运行全部启用的检索分支及指定文件直取；Dense 多查询最多同时执行 4 路 | 等待全部分支，不增加丢弃慢结果的截止时间；按原分支和查询顺序合并，保持同分排序及主查询归属 |
| 阻塞操作 | Qdrant 查询移入线程；本地 BGE-M3 查询使用单线程执行器 | 查询参数、过滤条件和编码参数保持原值；本地查询编码保持串行，避免多个查询同时进入模型 |
| 融合、重排、生成 | 保留现有实现 | 保留 RRF 权重、阈值、候选数量、Cross-Encoder 精排和多模态保护规则 |

新增 `debug_info.preprocessing_stages`、`search_branch_times`、`reused_embedding_vectors`；原先固定为零的预处理时间改为实际测量值。模型调用失败日志补充异常类型和耗时。

## 验证结果（2026-09-10）

- 浏览器实际发送首轮“你好”：15:20:45 开始，15:20:50 回答完整显示。检索前置处理约 0.0001 秒；生成使用原有 Kimi-K2.6。页面显示全部阶段完成，未出现浏览器异常。
- 最终代码加载后追加真实 SSE 验证：首段回答 5.330 秒、完整回答 6.598 秒，命中 `standalone_greeting`，收到 `complete`。
- 新增 33 项测试全部通过，覆盖流式/非流式链路、问候误判保护、空索引与新增数据、存储故障、向量复用隔离、全部分支重叠执行、慢分支保留、取消、同分顺序、KB/文件过滤，以及服务层将同一向量批次复用到多模态分支。
- 对照原 Git 版本做 48 组混合召回回放、12 组 Dense 多查询回放：原始候选、RRF 分数和顺序、重排分数和顺序、查询来源、过滤参数、阈值和数量均无差异。回放固定上游响应，包含同分、重复候选、不同模态意图及指定文件场景。
- 使用独立临时 Qdrant 集合验证真实 Dense/Sparse 查询：正确保留目标 KB/文件的记录，排除其它 KB 和其它文件；有数据时空索引探测返回 false。临时集合已删除。
- 真实 BGE-M3 对“发布失败后如何回滚到上一版本”的同步与线程执行输出完全相同（10 个非零词项）。
- 回归范围共 152 项通过、1 项跳过、2 项既有失败；两项失败均在单独导出的原 Git 版本中复现：
  - `tests/integrations/test_feishu_parser_media.py::test_extract_file_pdf_rejected`：测试期待拒绝 PDF，现有解析器允许下载任意文件。
  - `test_video_statistics_and_ingestion.py::test_video_keyframe_artifacts_stay_with_the_original_video_bucket`：测试创建的 `IngestionService` 缺少 `_processing_status`。

## 复现命令

在仓库根目录执行固定响应对照：

```bash
.venv/bin/python backend/scripts/verify_retrieval_efficiency.py \
  --baseline 46c09229d1699ae7ca6d2d646dbaceac4482eb43 \
  --output /tmp/retrieval-efficiency-replay.json
```

在 `backend/` 执行测试：

```bash
../.venv/bin/python -m pytest tests/test_retrieval_efficiency.py -q
../.venv/bin/python -m pytest tests \
  test_video_scene_shot.py test_video_keyframe_pipeline.py \
  test_video_statistics_and_ingestion.py test_video_portrait_sampling.py \
  test_video_answer_presentation.py -q
```

## 验证边界

上述对照验证的是执行重排与复用的结果等价性，不是新的线上语料 Recall/nDCG 评测。未改动已保存的评测基线，也未向用户知识库写入评测文档。5 秒是一次真实问候请求的观测值，不代表所有问题的响应时间承诺。

有实质检索需求的问题仍保留意图识别、查询改写和完整召回，因此远端模型本身缓慢或故障时仍可能等待。进一步更换模型、合并提示词或缩短检索预算，应先按 [RAG_EVALUATION.md](RAG_EVALUATION.md) 在隔离语料上比较逐题召回、排序和回答质量，不能仅凭速度替换现有链路。
