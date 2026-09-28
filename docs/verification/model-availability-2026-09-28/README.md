# 全任务模型可用性与失败切换审计

本文为替换前快照；用户随后要求处理超时模型，当前生效配置与结果见[模型替换验收](../model-replacement-2026-09-28/README.md)。下文原始实测数值保留不变。

检查时间：2026-09-28 00:26 起（Asia/Shanghai）。代码：`a0148c858146a25b4a5f9f9a7b4c5de005e965cc`。
当前服务：127.0.0.1:8000，PID 44267，9/27 20:21:10 启动，cwd 为本 checkout/backend。

**结论：全部 11 个注册任务的默认模型本次可调用；存在 3 个不可用备用模型；历史日志确有 90–100 秒主模型超时后切换。此次默认查询未失败或切模型，主要耗时来自 Kimi 生成。**

证据：[主备模型实测和完整覆盖矩阵](model-probes.json)、[默认查询整链实测](live-default-chain.json)、[本地编码模型实测](local-probes.json)。未修改应用代码、模型配置或重启服务。

## 覆盖与方法

- 读取当前服务 `/api/chat/models`、`/api/jev/settings`，核对静态路由、环境覆盖与持久化配置。
- 覆盖所有 11 个 registry task、29 个主备路由位置，按模型和调用类型去重为 27 项记录、16 个远程模型 ID。
- 24 次真实网络探测：21 成功、3 失败；另 3 条媒体探测被同模型先前的真实 403 触发冷却而跳过，不算重复网络失败。
- 模型直连探测禁用自动换模型，并发 3，45 秒上限；所有真实探测均未触及该上限。图片、音频、视频传入合成媒体。
- 另外在当前 8000 服务运行一次无 model override 的 direct 查询，验证真实 Jev 意图/重排、改写、向量化、检索和默认流式回答。
- 普通短提示证明模型可调用；复用同模型证据覆盖分块、画像、Agent 规划等任务，不代表已验证长文分块、画像质量或所有业务 JSON 输出。纯音探测也不代表语音转写准确率。

## 每个任务阶段

| 任务 | 配置的默认模型 | 实测结果 | 当前运行路径说明 |
|---|---|---|---|
| 意图识别 | 百炼 qwen3.5-plus | 成功，4.996s | Jev intent=force 时实际走 Jev；Qwen 仍单独实测 |
| 查询改写 | 官方 deepseek-flash | 成功，0.611s | 当前仍使用；唯一备用 Kimi-K2.5 已禁用 |
| 图片理解/附件摘要 | 百炼 qwen3-vl-plus-2025-12-19 | 图片输入成功，1.043s | 入库、附件路径均使用该任务 |
| 文档分块 | SiliconFlow Kimi-K2.6 | 同模型文本探测成功，7.924s | 不启用 provider fallback；失败走本地结构化规划 |
| 最终回答 | SiliconFlow Kimi-K2.6 | 短文本成功，7.924s；真实流式也成功 | Agent planner 也复用 final_generation 路由 |
| 知识库画像 | SiliconFlow Kimi-K2.6 | 复用同模型成功证据 | 备用 DeepSeek 可用，Kimi-K2.5 不可用 |
| 模型健康检查 | 官方 deepseek-flash | 复用同模型成功证据 | 无备用 |
| 重排 | SiliconFlow Qwen3-Reranker-8B | 成功，0.306s，返回 2 条 | Jev rerank=force 时实际走 Jev；Qwen 仍单独实测 |
| 向量化/知识库路由/语义检索 | SiliconFlow Qwen3-Embedding-8B | 成功，0.472s，4096 维 | 无备用嵌入模型 |
| 音频转写/附件摘要 | 百炼 qwen3-omni-flash | 音频输入成功，0.927s | 两个 OpenRouter Gemini 备用当前访问被拒绝 |
| 视频解析 | 百炼 qwen3.5-omni-plus-2026-03-15 | 本地视频输入成功，2.421s | 两个百炼 Omni 备用均通过视频输入探测 |
| Jev 意图识别 | jev-1.13.0 | 真实查询成功，1.623s | 当前 force；失败终止，无换模型 |
| Jev 重排 | jev-1.13.0 | 真实查询成功，0.497s | 当前 force；失败终止，无换模型 |
| 稀疏向量编码/检索 | 本地 BAAI/bge-m3 | 查询和文档编码均成功，12/14 个非零权重 | 失败跳过稀疏分支，不换模型 |
| 图片/视频视觉向量 | 本地 openai/clip-vit-large-patch14 | 文本和合成图片编码均成功，768 维 | 失败降级相关视觉分支 |
| 音频声学向量/检索 | 本地 laion/clap-htsat-fused | 文本和合成音频编码均成功，512 维 | 音频检索还有 Qwen 语义向量路径 |

Jev 引用诊断当前为 off，不进入查询关键路径。Jev 不记录到 LLMManager 的 ModelHealth，已由整链 diagnostics 单独验证。

本地 6 项编码均调用生产方法，向量非零、数值有限。使用项目虚拟环境和现有模型缓存，HF_HUB_OFFLINE=1、TRANSFORMERS_OFFLINE=1，无下载；总计 17.29s。这是隔离进程的加载与编码时间，不是已预热服务的单请求延迟。

## 不可用备用及影响

| 模型 | 实际错误 | 失败等待 | 配置影响 |
|---|---|---:|---|
| SiliconFlow Pro/moonshotai/Kimi-K2.5 | HTTP 403，code 30003，model_disabled；目录 missing | 0.194s | 查询改写唯一备用；意图/图片/画像第二备用；最终回答第三备用 |
| OpenRouter google/gemini-3-flash-preview | HTTP 403，access_denied；目录 present | 0.423s | 音频第二备用 |
| OpenRouter google/gemini-2.5-flash | HTTP 403，access_denied；目录 present | 0.239s | 音频第三备用 |

两个 Gemini 的 403 只证明当前配置下访问被拒绝，不能据此断言模型下架。目录存在也不等于账户能调用。

非流式故障转移最多尝试主模型加两个备用；流式最多 3 次实际调用，主模型因冷却被跳过时也可能尝试 3 个备用。第三备用在主模型和前两个备用均实际尝试后不会再被尝试；前项因冷却/模态不兼容被跳过时，后项才可能进入。因此“配置在备用列表”不代表每次失败都会依次走完整张表。

图片路径的一个具体隐患：第二备用 Kimi-K2.5 首次失败会消耗一次备用尝试，可能使第三备用、实测可用的 Qwen3-Omni-Instruct 无法进入当次尝试。后续冷却中跳过 Kimi 才可能到达第三备用。

其余探测到的备用均成功，包括 DeepSeek Flash、百炼 Qwen3.5-Plus、Qwen3 Omni Captioner/Instruct、Qwen3-Reranker-4B、BGE reranker、百炼 qwen-omni-turbo / qwen3-omni-flash。完整顺序和媒体证据见 JSON。

## 已发生的超时与切换

以下均在当前 PID 44267 启动前发生，属于真实 API 超时，不能与单测产生的 0ms 假错误混算。

| 时间 | 调用 | 后继行为 | 额外失败等待与总耗时 |
|---|---|---|---|
| 9/27 17:35:10 | 意图识别 qwen3.5-plus | 换 DeepSeek Flash 成功 | 主模型 90.079s + 备用 9.341s；意图阶段 99.421s |
| 9/27 17:38:59 | Agent 的 final_generation 非流式 Kimi-K2.6 | 换百炼 Qwen3.5-Plus 成功 | 主模型 100.145s + 备用 55.139s，约 155.284s |
| 9/27 18:43:17 | Qwen3-Embedding-8B | 没换模型，改默认路由，Dense/Visual 降级为空，Sparse 继续 | 主调用 ReadTimeout 60.003s |

另有 17:36:55 的 Kimi 100.130s 超时；归档中随后出现 Qwen 22.664s 成功，但并发日志缺少 request ID，关联强度较低，不用该条精算单请求总时长。

可复核位置：

- `logs/chat-fix-verification-backend.log:63–73`：Qwen 90.079s、DeepSeek 9.341s、intent=99.421s。
- `logs/chat-fix-verification-backend.log:223–227`：Kimi 100.145s 后 Qwen 55.139s。
- `logs/restored-backend.log:1018–1029`：embedding 60.003s 及分支降级。
- `backend/logs/app.2026-09-27_00-20-02_300621.log.zip` 内部日志 847–848、944：另一 Kimi 超时及随后 Qwen 成功。
- `logs/restored-backend.log:2537`：当前 PID 启动边界。

当前进程在本轮探测前只记录了 DeepSeek、embedding、Kimi 各一次成功，零失败；此前 9/27 20:27 的 Kimi 流式生成约 56s，未见换模型。这只是本进程的小样本，不能否定旧进程的超时。

## 本次真实默认查询

查询“简要介绍茶叶的驯化史，并引用资料。”，direct、无模型覆盖。返回 703 字符、10 个来源，完整收到 complete。

| 阶段 | 耗时 |
|---|---:|
| Jev 意图识别 | 1.623s |
| DeepSeek 改写 | 1.616s |
| 知识库路由 | 1.183s |
| 检索 | 0.466s |
| Jev 重排 | 0.500s（含阶段封装） |
| Kimi 生成 | 53.953s |
| 整体 / 首个正文 | 59.346s / 44.841s |

DeepSeek、embedding、Kimi 的 ModelHealth 各增加一次成功，失败计数均无增加；两个 Jev diagnostics 均成功。**这次慢在 Kimi 请求内等待与生成，没有主模型失败后换模型。** 首正文前的时间不能单凭客户端日志进一步拆成服务端排队、推理或网络耗时。

## 优先处理建议

1. 清理/替换已证实不可用的 3 个备用，首先修复查询改写“唯一备用已禁用”，再修复图片备用占用尝试名额、音频两个不可访问备用。替代模型仍应验证真实任务和媒体兼容性。
2. 对意图、Agent 规划、最终回答分别设定延迟预算；当前非流式 Qwen 90s、Kimi 100s 才超时，已产生真实浪费。不要从一次短提示成功推断适合所有阶段，也不要凭本次样本武断设置统一短超时。
3. 每请求保留 attempt model、provider、错误、耗时、fallback 原因和总耗时。现有成功 fallback 的 `LLMCallResult.duration` 只计算备用本次，遗漏此前主模型等待；ModelHealth 又只保留最近一次时长。需要 request ID 才能准确归因并发日志。
4. embedding 当前无备用，失败时会损失召回分支。若增加备用，必须保持与已入库向量空间兼容，不能只凭维数相同直接换模型。

已排除：9/28 00:06 的 a/b/c/embed 与 0ms 403/401/400 为单测日志；`scope_fallback` 和 `target_modality_fallback` 是业务检索兜底；8002、显式 DeepSeek 的旧 32.665s 成绩不是默认 Kimi 的性能。
