# 百炼 Decision 原生接入验证

验证日期：2026-10-09。接入模型为 `decision-model-preview`，路由名为 `bailian`。没有将百炼输出转换为聊天补全，也没有补造概率、置信度、输出 token 或费用。

## 原生协议与配置

- 官方 [System One API](https://help.aliyun.com/zh/model-studio/decision-model-api) 说明一次请求可包含 Noul、Choice、Score；Choice / Score 返回概率分布及 confidence。
- 官方响应只保证 `usage.input_tokens`。本应用保留其原生缺项，不把缺少金额理解为免费；诊断为 `cost_source=unavailable`。
- 当前入口为 `https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone`。[地域文档](https://help.aliyun.com/zh/model-studio/beijing-access-information) 将它定义为功能验证入口，无生产 SLA。
- `BAILIAN_DECISION_API_KEY` 独立于原百炼聊天的 `ALIYUN_BAILIAN_API_KEY`。`BAILIAN_DECISION_ENDPOINT` 可配置密钥所属地域的官方业务空间地址，接受北京和新加坡的 System One HTTPS 地址。不会把凭据发送到任意自定义域名。
- 没有更改保存的 Decision 模型或模式。服务商选择、连接测试仍是草稿操作；只有明确保存才变更后续请求配置。

## 真实调用

先固定三组请求，再各调用一次，无重试。全部成功：

| 验证内容 | 请求数 | HTTP | 本机完整响应耗时 |
|---|---:|---|---:|
| Noul + Choice + Score，共享对象 state | 1 | 200 | 300 ms |
| 中文证据 Choice，原生对象 instructions | 1 | 200 | 102 ms |
| 16 个混合问题，数组 state | 1 | 200 | 153 ms |

在实现完成后，再通过真实 `JevClient.evaluate` 和应用 `/api/decision/test` 的 ASGI 路由各调用一次，均通过同一严格响应校验，约 204 ms / 213 ms。应用测试前后保存配置文件 SHA-256 一致。

这些五次调用证明接入与输出契约，不证明检索效果、通用准确率、跨模型速度优势或生产可靠性。Preview 响应未提供固定日期快照；业务空间入口未做真实调用。

原始脱敏收据、请求协议和官方页面快照位于本机忽略目录 `ops/bailian-decision-integration/`：`contract-protocol.json`、`contract-live.jsonl`、`application-contract-live.json`。不记录鉴权头或密钥。

## 空 state 兼容问题与独立修复验证

后续真实检索流水线 `live-v2` 暴露出此前连接测试没有覆盖的边界：生产批量引用核验将证据放在各问题的对象 `instructions` 中，共享 `state={}`。百炼四组请求均返回 HTTP 400。固定同一个无敏感信息的 Choice 问题各调用一次后确认：

- 空对象 `state` 返回 `InvalidParameter`，明确消息为 `state must not be empty: state`。
- `state={"context":"No shared evidence. Each question contains its own claim and cited sources."}` 返回 HTTP 200，原生 Choice 分布与 `usage.input_tokens` 完整。

生产批量提示版本因此升级为 `citation-batch-choice-v7-reference-text-isolated`，所有供应商使用同一固定非空说明，各引用单元的实际证据仍只在自己的问题中。全局原生传输没有替换 state；冻结的 legacy v5 继续使用原始 `{}`。逐条核验原本就携带非空 claim / cited_sources，无需修改。回归同时检查三家供应商下两种策略的证据、来源范围规则与 Choice 标准一致，没有重试或聊天回退。

使用旧 `live-v2` 保存的回答和引用文本，固定版本、3 秒总预算、8 条上限，单独重放四次生产批量核验。未重新检索或生成，未回填之前的端到端失败记录：

| 原有回答 | HTTP | 完成核验 / 有引用单元 | 本次总耗时 | 保留的未核验原因 |
|---|---|---:|---:|---|
| science-source | 200 | 7 / 7 | 394 ms | 无 |
| compound-story | 200 | 6 / 6 | 334 ms | 无 |
| audio-scope | 200 | 8 / 10 | 407 ms | 2 条超过 8 条上限 |
| document-only | 200 | 4 / 4 | 266 ms | 无 |

共 25 个可核验单元获得原生判断。这些判断是模型的诊断输出，不能当作正确性真值；图片、音视频仍仅依据已提供的描述或转写，不检查原媒体。未引用段落的数量和提取边界全部保持原样。原 `live-v2` 回执与保存设置哈希在重放前后一致。

固定空 state 对照的协议与脱敏 400/200 回执位于 `ops/bailian-decision-integration/empty-state-contract/`。独立重放的协议、实际原生请求、响应、源代码快照和新结果位于 `ops/bailian-decision-integration/citation-v7-replay/`。初始连接测试的成功不能代替该生产边界验证，旧端到端失败仍保留在 `ops/decision-strategy-pipeline/live-v2/`。

## 生产重排的 16 问题上限

后续电影选材请求的影子重排再次返回 HTTP 400。2026-10-09 固定相同合成材料，1/16 个问题均 200，20 个问题在普通英文查询和原电影查询下均 400，脱敏服务端错误为：

```text
ValidationError: questions: 20 exceeds the limit of 16
```

这与当前官方页面的“问题数接口不设上限（建议 ≤ 16）”不一致。应用以当前北京试用入口的实测约束配置百炼批次上限；业务空间入口未再次实测，不宣称各地域都具有相同服务端限制。

客户端保留所有候选，20 项按 16 + 4 请求，最多 64 项的应用总上限保留。分批共享原 state、原问题 ID、一次总超时和整体预算，逐批严格校验再整体返回，不重试、截断或采用部分成功。一次真实应用客户端验证取得 20/20 个分数，原生批次 `[16, 4]` 均 200，用量按两批真实 input_tokens 汇总；未提供的费用保持未知。

原始失败与修复后的独立协议没有互相覆盖，保存在 `ops/decision-session-fbb3fe3d-20261009/rerank-contract-v1/` 与 `native-batching-live-v1/`。新增边界回归包含第二批错误、响应串批、缺项、总期限、取消、预算预留和其他供应商单批不变。详见 [调用设计与验收](../research/decision-strategy-2026-10/call-design.md)。

## 回归与界面

运行：

```sh
PYTHONPATH=backend .venv-main/bin/python -m pytest \
  backend/tests/test_bailian_decision.py \
  backend/tests/test_decision_transport.py \
  backend/tests/test_decision_settings.py \
  backend/tests/test_jev.py backend/tests/test_jev_settings.py -q
PYTHONPATH=backend .venv-main/bin/python -m pytest \
  backend/tests/test_decision_citation_sources.py \
  backend/tests/test_jev_citation_batch.py \
  backend/tests/test_bailian_decision.py backend/tests/test_decision_transport.py \
  backend/tests/test_jev_citations.py backend/tests/test_jev_answer_audit.py -q
npm --prefix frontend test
npm --prefix frontend run build
```

后端验证包括三类原生响应、缺失 usage、缺失分布 / confidence、错误模型、域名与地域路径约束、独立凭据、缓存预算、旧配置迁移，以及不保存的连接测试。前端沿用百炼本地品牌图，显示试用 / 业务空间及地域信息，缺钥提示使用专用变量。

空 state 修正后的引用相关回归为 154 passed，包含冻结 legacy v5、三供应商生产原生请求、单元来源隔离、总体预算、取消与失败边界。

受控浏览器验收覆盖：键盘选择服务商、模型联动、两处品牌图加载、草稿连接测试请求、明确保存、缺钥禁用、业务空间提示、390 px 浅色 / 深色无页面横向溢出。浏览器中的测试与保存请求被拦截验证，真实配置未变更。真实模型契约由上面的服务端调用验证。结果与截图为 `browser-results.json`、`bailian-*.png`。
