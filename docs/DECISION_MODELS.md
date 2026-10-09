# Decision 模型配置

「设置 → Decision 模型」为意图识别、检索重排和回答引用诊断选择统一的判断模型。支持 TypeSafe Jev 直连和 OpenRouter Decisions API；查询改写与最终回答继续使用「模型与路由」中的配置。

## 选择、测试和保存

1. 选择服务商及判断模型。TypeSafe 使用服务端 `TYPESAFE_API_KEY`，OpenRouter 使用 `OPENROUTER_API_KEY`；密钥不会发给浏览器或写入 Decision 配置文件。
2. 点击「测试连接」。它用固定的无敏感数据样例检查 Noul、Choice、Score 返回结构，包括当前流程使用的概率分布与置信字段。测试使用当前草稿，不保存设置，也不改变工作模式；测试通过不等于检索质量通过评估。
3. 选择使用方式，点击「保存设置」。设置对所有会话的后续请求生效并在重启后保留。进行中的请求沿用开始时的服务商、模型及模式。

模型连接区通过品牌标识区分服务商与判断模型，并分别显示已保存配置、正在编辑的选择、连接测试结果与未保存状态。意图识别直接展示使用方式，重排、引用诊断与严格验证收在「高级设置与诊断」中。修改模型后会清除旧测试结果。「放弃更改」重新读取服务端；「全部停用」修改草稿，仍需保存。

## 日常使用与高级设置

| 功能 | 选项 | 行为 |
|---|---|---|
| 意图识别 | 沿用原模型 | 使用原意图模型 |
| 意图识别 | 自适应判断 | 符合原有简单问题门槛时使用 Decision；复杂、多轮、低置信或失败时沿用原模型 |
| 高级：重排 | 沿用原策略 | 不增加 Decision 重排调用 |
| 高级：重排 | 对照记录 | 运行 Decision 并记录差异，实际使用原排序 |
| 高级：重排 | 试用替换 | 实验性采用 Decision 排序，失败时回退原策略 |
| 高级：意图 / 重排 | 严格验证 | 所选环节只使用选定 Decision 模型；错误或无效输出终止请求，不回退 |
| 高级：引用诊断 | 逐条 / 批量 | 记录引用支持情况，不改写、拦截或认证答案；增加调用与完成等待 |

全部模式默认关闭。更换模型不会重置模式。原有自适应阈值没有针对每个新模型重新校准；原有 Jev 重排研究也没有证明可替换现有重排策略，因此不将实验性替换设为默认。原「一键强制测试」已移除：它实际修改持久配置，并不是一次测试。

## 模型目录与兼容性

目录位于 `backend/app/core/llm/decision_catalog.py`，明确列出允许的请求模型及已观测的响应版本，拒绝未指定模型的静默替换。当前有 12 条路由：

- TypeSafe：`jev-1.13.0`。
- OpenRouter：`openai/gpt-6-luna-decisions`、`typesafe/jev-1.13`、`inception/mercury-decide:free`、`perplexity/pplx-decider-v1.1-27b`、`liquid/d1`、`cloudflare/clef`、`cloudflare/clef-flash`、`togethercomputer/tev1-4b-experimental`、`jaredpalmer/kev-4b`、`upstage/solar-decide-flash`、`upstage/solar-decide`。

OpenRouter 使用 `/api/alpha/decisions`，不是普通 Chat Completions。网关回退关闭；响应模型必须匹配所选模型或目录中的已知版本。上游更换版本时，先验证兼容性再更新目录。Respan Span-01 / Lite 目前仅接受特定 Noul 输入，无法满足统一的 Choice/Score 契约，暂不列入。

客户端按服务商、模型、凭据和运行限制复用；切走再切回不重置该路由的预算和熔断。预算是每路由、每进程生命周期的输入 token 上限，不是整个账户的额度。保留 `JEV_TIMEOUT_S` 与 `JEV_MAX_INPUT_TOKENS` 环境变量。诊断区分请求模型、实际响应模型、路由及上游提供商；OpenRouter 采用上游报告费用，没有金额时标为未知，不套用 TypeSafe Jev 的价格。

## 旧配置和接口

- 原 `backend/data/jev_settings.json` 继续使用。缺少 `provider` / `model` 的旧文件按 TypeSafe `jev-1.13.0` 读取，不自动切换模型。
- 新接口为 `GET/PUT /api/decision/settings` 与 `POST /api/decision/test`；保留 `/api/jev` 同路径别名和内部 Jev 导入名称。
- 设置接口增加服务商密钥可用状态与模型目录，仅返回非敏感配置。
- 没有本地保存文件时使用 `DECISION_PROVIDER` / `DECISION_MODEL`；默认 TypeSafe Jev，OpenRouter 未指定模型时默认 Luna Decisions。`JEV_*_MODE` 和 `JEV_CITATION_STRATEGY` 继续兼容。
- 无效文件或无效环境模型会停用 Decision 并在配置接口显示可修复的错误；所选服务商缺少密钥时允许保存全部关闭，拒绝开启。
- 旧 Jev 专项评测显式固定 TypeSafe；新的检索评测记录生效的 Decision 配置，原生评测按该快照运行。历史评测产物不修改。

## 2026-10-09 本地验证

使用当前项目凭据、默认 3 秒时限和固定合成输入执行真实连接测试：TypeSafe 与上述 9 条 OpenRouter 路由通过 Noul / Choice / Score 格式检查；OpenRouter Luna 与 Jev 返回明确的地区限制 HTTP 403。目录可选不表示所有地区可访问，历史报告的成功结果不能替代当前环境测试。

报告来源：`/Users/champ/Projects/LLMs/research/jev-luna-endpoints-2026-10-08/README.md`。原报告主要验证 24 个单 Noul 样例的连通性与延迟，没有证明各模型在本项目 RAG 流程中的质量相当。本次同样不做模型质量排名。

真实 Mercury 调用还验证了现有意图识别、重排、批量引用诊断三个环节，均记录到 `inception/mercury-decide-20260930`；仅使用合成样例，不作为业务质量结论。

后端相关回归 247 项通过，前端 184 项测试与生产构建通过。真实浏览器完成选择、测试不保存、保存后刷新、高级选项草稿、放弃更改、地区错误提示和键盘操作验证；桌面深色及 390px / 320px 窄屏无横向溢出。验收后恢复 TypeSafe 与全部关闭状态。

相关回归覆盖配置迁移、校验和原子写入、草稿测试不保存、错误脱敏、服务商与模型切换、在途请求快照、预算复用、各阶段回退 / 严格失败语义，以及评测来源记录。浏览器验收与本地真实调用回执保存在忽略的 `ops/decision-qa/` 中。
