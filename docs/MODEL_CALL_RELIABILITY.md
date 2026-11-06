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

## 模型生命周期与配置迁移

模型注册表会排除已经确认下架或在项目接入端点不可用的 ID，并读取 OpenRouter 目录的 `expiration_date`。按 UTC 日期计算，已经到期或剩余不超过 30 天的模型无法被选择或调用；设置页与初始化向导使用相同筛选结果。模型详情仍保留到期日期与生命周期状态，便于审计。供应商将日期明确更新为 `null` 时会撤销此前的到期标记。

旧任务路由、环境变量和托管配置通过 `backend/app/core/llm/model_lifecycle.py` 的明确映射升级；没有映射但不再可用的主模型，会在存在兼容候选时切换到该任务的备用模型。目录缺失本身不是下架依据，也不会触发向量空间迁移。

默认媒体路由（用户保存的配置可覆盖）：

| 任务 | 主模型 | 备用模型 |
| --- | --- | --- |
| 图片理解 | 百炼 `qwen3.8-flash` | 百炼 `qwen3-vl-plus`、SiliconFlow `Qwen/Qwen3-Omni-30B-A3B-Captioner` |
| 音频转写、视频解析 | 百炼 `qwen3.8-omni-flash` | 百炼 `qwen3.5-omni-plus`、`qwen3.5-omni-flash` |

Pi 的独立媒体默认配置和前端旧媒体默认配置同步迁移。视频任务候选必须支持项目的本地视频传输及音轨理解；Realtime 模型使用不同协议，不作为这些 HTTP 任务的候选。文本与向量模型继续分别使用 `deepseek:deepseek-flash` 和 `Qwen/Qwen3-Embedding-8B`，现有索引无需重建。

维护生命周期清单时需核对官方公告与实际接入端点；地域差异、目录缺失和单次调用失败不能单独证明模型已全球下架。参考 [SiliconFlow 下架公告](https://docs.siliconflow.cn/docs/release-notes/overview)、[百炼生命周期](https://help.aliyun.com/zh/model-studio/model-depreciation)、[百炼视觉模型](https://help.aliyun.com/zh/model-studio/vision-model)、[Omni 能力](https://help.aliyun.com/zh/model-studio/omni/)及 [OpenRouter 目录](https://openrouter.ai/api/v1/models?output_modalities=all)。逐次探测回执放在本地忽略目录，不能作为当前可用性的长期保证。

## 故障转移与排查

普通调用的模型健康状态在进程内维护：禁用、权限、限流和网络错误触发不同的冷却；运行失败不会改写用户保存的模型路由。流式回答在输出正文前可故障转移，已有正文后出错则明确结束，避免混合两个模型的回答。目录存在不代表当前账户有额度或地域权限。

1. 在设置中测试失败任务对应的具体模型与能力。
2. 检查 `./start-dev.sh logs` 中的阶段、状态码与超时；分享日志前脱敏。
3. 检查服务商余额、地域、模型权限和网络。不要用聊天接口成功推断 embedding、重排或视频也可用。
4. 调整路由后保存，再测试一条实际业务请求并核对引用。

开发者可在根目录进行独立探测（会产生模型费用）：

```bash
PYTHONPATH=backend .venv/bin/python backend/scripts/check_model_routes.py \
  --tasks video_parsing --include-fallbacks --media --output ops/video-model-routes.json
```

探测使用合成媒体。结果属于该次请求，不代表质量或延迟保证；独立 CLI 的健康状态不写回运行中的服务。总超时限制调用方等待，无法撤回供应商已收到的付费请求。配置入口在 `backend/app/core/llm/`，本地模型共享加载与查询向量缓存分别位于 `core/local_models.py` 和 `core/llm/query_embeddings.py`。
