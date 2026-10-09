# 模型连接测试与调用排查

## 在设置中测试当前模型路由

「设置 → 模型与路由」支持逐项测试与「测试全部」。测试使用页面当前选择，包括尚未保存的草稿；不会保存、更换任务模型，也不会修改知识库或向量索引。切换服务商或模型后，旧选择的结果不会显示为新选择的检测结果。

「测试全部」按服务商、模型和能力合并重复项，最多同时检测两条不同路由。例如回答生成、意图识别、查询改写与知识库画像使用同一聊天模型时，只发起一次聊天检测。停止批量测试会停止继续调度，已经提交的上游调用仍可能完成。

测试使用固定合成输入，并产生少量模型调用费用：

| 路由能力 | 检测方式 |
|---|---|
| 文本对话 | 短提示，检查是否返回有效正文 |
| 文本向量化 | 单条短文本，检查向量结构与有限数值 |
| 检索结果重排 | 一个查询与两条候选，检查返回索引与分数 |
| 图像描述 | 小型合成图片，调用图像输入接口 |
| 音频转写 | 短合成音频，调用音频输入接口 |
| 视频解析 | 短合成视频，调用项目实际适配的视频输入接口 |

结果显示成功或失败、耗时和可操作的失败原因。测试直接调用所选服务商与模型，不经过业务备用链，也不会触发业务健康记录的冷却。通过只说明这次合成输入完成了对应接口调用，不代表回答质量、完整检索流程或长期可用性。

接口为 `POST /api/chat/models/test`，请求体为 `{provider, model, capability}`，其中 `model` 是配置目录中的完整模型 ID，`capability` 为 `chat / embedding / reranker / vision / audio / video`。服务端负责目录及能力校验、探测并发限制、超时和错误脱敏；密钥、用户资料和完整模型响应不返回浏览器。

2026-10-09 本地真实验证：当前 DeepSeek Flash 文本、SiliconFlow Qwen3 向量化 / 重排、百炼 Qwen 图像 / 音频 / 视频六类调用均通过。向量返回 4096 维，视频使用随代码附带的 2 秒合成 MP4。检测前后任务配置、Decision 配置、配置文件哈希及业务健康记录一致。回执保存在本地忽略目录 `ops/model-connectivity-qa/api-results.json`；这些单次调用不构成性能基准或质量评测。

## 2026-09-12 历史排查与修复

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
