# Agent 代码整理与提交前回归（2026-10-07）

本次整理从 `main@0cfb009` 开始，将连续几轮 Agent 优化分别归入后端/运行时、前端和设计/验证文档。实现提交为 `1580c25`（持续研究与任务完成度）和 `056784c`（媒体展示、任务说明及断线恢复）。

## 最终回归

日志目录：`/tmp/tessmora-publish-20261007/`。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| 后端 Pi、旧聊天引用/附件及诊断回归 | 353 项通过 | `backend-tests.log` |
| Pi 运行时 | 58 项通过 | `runtime-tests.log` |
| 前端 | 151 项通过 | `frontend-tests.log` |
| 前端类型检查与生产构建 | 通过 | `frontend-build.log` |
| 差异格式检查 | 通过 | `git diff --check` / `git diff --cached --check` |

合计 562 项自动测试通过。后端保留现有弃用警告；前端构建保留 Vite 大分包提示。复现命令分别在对应目录执行：

```sh
# backend/
../.venv/bin/python -m pytest tests/test_pi_agent_*.py tests/test_chat_references.py tests/test_attachment_answer_citations.py tests/test_pi_diagnostics.py -q
# agent-runtime/
npm test
# frontend/
npm test
npm run build
```

已检查全部变更文件的常见凭据模式、JSON 凭据字段和签名 URL。命中的三个签名 URL 均为媒体身份测试的 `storage.test` 占位地址；未发现真实凭据。环境文件、知识库数据、依赖目录及构建产物保持忽略，不纳入提交。

## 与真实运行候选的关系

对照任务完成度 v2 协议中的 181 个生产文件，180 个文件哈希一致；唯一差异是 `PiProcess.tsx` 将“含保守估算”改为“部分调用用量未知”，与只计量已知用量的后端行为一致。反向替换该文案后，文件哈希与冻结候选一致。比对回执为 `source-comparison.json`。

本次提交前回归未新增真实模型调用或浏览器验收；相关结果沿用已冻结的 [任务完成度验证](pi-agent-task-completion-2026-10-07.md)、[持续执行与回答相关性验证](pi-agent-answer-focus-unlimited-2026-10-07.md)、[媒体去重验证](pi-agent-media-dedup-2026-10-07.md)、[媒体稳定性验证](pi-agent-media-stability-2026-10-07.md) 和 [通用性验证](pi-agent-generality-2026-10-07.md)。这些历史报告中的“未提交”、`committed: false` 及旧候选描述记录的是实验当时状态，保留原样，不改写为发布后的事实。

已知未通过项继续保留：缺失数值用例在 v1、v2 均返回 completed，未达到冻结协议预设的 partial。自动测试通过只证明所覆盖的协议和程序行为，不代表所有任务的语义完成度、引用蕴含及回答精炼程度已通过验收。
