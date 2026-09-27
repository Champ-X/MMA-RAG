# 模型调用排查与修复（2026-09-12）

> 当前配置更新：按用户要求，所有任务主备路由中的 DeepSeek 系列已统一改为官方 `deepseek:deepseek-flash`（实际 API 模型 ID 为 `deepseek-flash`）。已移除旧 DeepSeek 静态注册和旧别名兼容入口；下文 V3.2 的调用结果为上一轮历史排查记录，不再代表当前配置。Flash 最新验证见 [验证记录](verification/deepseek-flash-2026-09-12.json)。

## 实测结论

对当前任务配置中的 30 个不同主备模型进行了独立调用，关闭故障转移，避免备用成功掩盖主模型失效。21 个成功，9 个明确失败。文本探测使用合成短提示；Embedding/Rerank 使用各自实际端点。

| Provider | 失效模型 | 实测错误 |
|---|---|---|
| SiliconFlow | `Qwen/Qwen3.5-397B-A17B`（查询改写主模型） | HTTP 403，code 30003，Model disabled |
| SiliconFlow | `Qwen/Qwen3-235B-A22B-Instruct-2507` | 同上 |
| SiliconFlow | `Qwen/Qwen3-235B-A22B-Thinking-2507` | 同上 |
| SiliconFlow | `Pro/zai-org/GLM-5` | 同上 |
| SiliconFlow | `moonshotai/Kimi-K2-Thinking` | 同上 |
| SiliconFlow | `Pro/MiniMaxAI/MiniMax-M2.5` | 同上 |
| SiliconFlow | `Qwen/Qwen3-VL-235B-A22B-Instruct` | 同上 |
| SiliconFlow | `zai-org/GLM-4.6V` | 同上 |
| OpenRouter | `google/gemini-3-pro-preview` | HTTP 404，No endpoints found |

四个 Provider 的目录均能访问。本次 SiliconFlow 返回 94 条、百炼 249 条、DeepSeek 2 条；OpenRouter 去掉原有 `limit=500` 后从 500 条增加到 600 条。以上为当次响应数量，不是长期容量承诺。

目录缺失不等于模型不可用：`Pro/moonshotai/Kimi-K2.5` 未出现在本次 SiliconFlow 目录中，但文本和图片请求均成功。因此不能简单删除所有“目录外模型”。

## 根因与修改

1. **失效主备项反复进入路由。** 原管理器普通重试次数已经是 0，主要放大因素是跨模型故障转移及后续请求再次调用同一个失效模型。清理了上述失效备用项；查询改写主模型改为原备用链中首个已验证成功的 `deepseek-ai/DeepSeek-V3.2`，同时更新默认配置与持久化覆盖文件。
2. **没有跨请求的失败记忆。** 新增按 Provider、原始模型 ID、调用方法记录的健康证据。禁用/不存在/权限失败冷却 600 秒；401/402 在 Provider 范围冷却 60 秒；429 冷却 30 秒；网络/5xx 冷却 15 秒。普通 400 不隔离模型，防止把单次输入错误误认成模型下架。冷却到期允许再次调用。
3. **故障转移可能连续尝试十余个模型。** 最多尝试主模型及两个可用备用；已冷却模型直接跳过。非流式调用默认共享 180 秒总预算，视频任务 360 秒；流式默认 360 秒。调用方可传 `total_timeout`。总预算覆盖主备等待；各 Provider 的 `timeout` 参数不再被随意忽略。
4. **流式路径没有统一的失败处理。** 流式在输出正文之前可以故障转移；输出任何正文后发生错误直接终止，不重放或拼接另一模型的回答。HTTP、SDK、SSE 错误保留可分类的状态码。SiliconFlow Rerank 改为调用内客户端，消除旧的跨事件循环客户端恢复重试路径。
5. **目录只增加、能力只取并集。** 同步后分别标记 `present/missing/unknown` 与检查时间；失败刷新保留旧快照并标记 stale。新元数据可以撤回能力或降低明确给出的上下文上限；上游未给出限制时不再伪造默认容量。OpenRouter 未注册模型不再一律视为全模态；生成图片的模型不再默认作为聊天模型。
6. **刷新依赖用户访问设置页。** FastAPI 生命周期启动可取消的后台目录维护，每 600 秒检查刷新；目录单请求 10 秒、单 Provider 总计最多 25 秒。TTL 按 Registry 实例记录，避免另一实例误用全局“已刷新”时间。强制刷新接口保留。
7. **“支持视频”不等于适配项目视频管道。** 视频解析任务候选限制为当前适配本地视频及音轨的百炼 Omni 路径。故障转移还会检查实际消息的图像/音频/视频输入类型，跳过不兼容候选。
8. **健康检查误导。** 基类不再调用虚构的 `model="test"`；SiliconFlow 检查实际配置的 Embedding 路由。结果明确为单模型、单接口探测，不代表整个 Provider 的全部模型健康。

`GET /api/chat/models` 增加 `model_health`；模型详情包含 `catalog_presence`、`catalog_checked_at`、`capability_source` 和 `call_health`。任务候选保留已配置偏好，但冷却候选降序并附原因。运行失败不会写回覆盖文件，从而避免短暂故障永久改变用户偏好。

## 验证

- 修复后：21 个保留的不同模型，32 项独立真实探测全部成功，包含实际图片、音频、本地视频、Embedding、Rerank 请求。媒体由探测脚本生成，不使用用户资料。
- 实际查询“发布失败后如何回滚到上一版本？”：意图识别成功，89.28 秒；改写成功，7.45 秒，返回多视角查询与关键词。Kimi 流式生成有正文，7.49 秒。
- 连续两次指定已禁用 Qwen 模型：两次均成功转到 DeepSeek；原模型实际失败计数仅 1，第二次在本地冷却阶段跳过。
- 117 项定向回归通过，随后新增的两项健康展示/Embedding 保护测试通过，共 119 个不同用例。其中新可靠性测试 28 项，覆盖分类、恢复、预算、流式不重放、能力撤回、目录失败保留、TTL 隔离、四 Provider 的超时与错误码传递。
- `compileall` 与 `git diff --check` 通过。
- 完整 `pytest tests` 因本地 Qdrant/MinIO 不可达在收集阶段等待并中断，不能算作全套通过。本次没有运行完整知识库问答或启动应用服务。

本次失效模型通常在 0.1–0.5 秒内返回错误，不能把所有分钟级等待都归因于它们。意图识别的 89 秒是真实成功请求耗时，没有失败重试；其速度仍需独立的模型参数与质量对比实验。本次不据单条样本更换有效的意图识别模型，也不更改 Embedding 模型或现有向量空间。

## 复现与边界

在项目根目录运行（真实推理产生 Provider 常规费用）：

```bash
PYTHONPATH=backend .venv/bin/python backend/scripts/check_model_routes.py \
  --include-fallbacks --media --timeout 60 --output /tmp/model-routes.json
```

仅验证某个任务：

```bash
PYTHONPATH=backend .venv/bin/python backend/scripts/check_model_routes.py \
  --tasks video_parsing --include-fallbacks --media --output /tmp/video-model-routes.json
```

机器可读证据见 [model-call-audit-2026-09-12.json](verification/model-call-audit-2026-09-12.json)。报告不含密钥、完整 Provider 响应或用户文档。

- 健康记录当前为进程内状态，重启后重新建立，不跨 worker 共享。CLI 是独立探测进程，不会把探测结果写入另一个运行中的服务实例。
- 目录刷新不等于付费推理探测；目录中“存在”不保证当前账户有额度或权限。Provider 不提供明确模态元数据时，能力仍是注明来源的推断。
- 总预算限制调用方的等待；DashScope 同步 SDK 在线程中执行，取消等待不能强制撤销已经提交的远端请求。SDK 自身的连接恢复行为也不等同于管理器的模型故障转移。
- 连通性、短样本延迟与协议检查不等于线上质量、吞吐或 P95 保证。
