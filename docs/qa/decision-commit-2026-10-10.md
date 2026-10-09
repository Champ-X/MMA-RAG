# Decision 改动提交前验收

日期：2026-10-10。工作目录为 MMA-RAG 主仓库，分支 `main`。

## 改动范围

- 原生供应商接入：百炼独立密钥和官方地域入口，16 问题分批、整体期限、完整结果校验及真实用量保留。
- 检索与回答：先规划后核验来源动作、模型与用途准入、Agent 子查询继承排除约束、引用全文与媒体描述/转写诊断；关闭路径保留原行为。
- 诊断与恢复：流式、非流式和历史消息保留阶段回执；显式本地快照可在空会话存储启动时恢复，不是自动持久化。
- 前端：设置页只保留模型连接与两个功能开关，显式保存才迁移旧配置；回答展示实际 Decision 行为和引用诊断。
- 实验材料：保留版本化协议、测试集、源码快照、用途准入数据，以及失败、零增益和未完成结果。实验重排和补证不作为普通设置页功能。

## 本轮重新运行的检查

| 检查 | 结果 |
|---|---|
| `PYTHONPATH=backend .venv-main/bin/python -m pytest backend/tests -q` | 1555 passed，1 skipped |
| `npm --prefix frontend test` | 217 passed |
| 设置表单 DOM 交互 | 8 passed |
| 流式回答 DOM/SSE 集成 | 5 passed |
| `npm --prefix frontend run build` | 通过；保留既有的大 chunk 提示 |
| `git diff --check` | 通过 |
| 敏感信息与冻结材料检查 | 未发现真实凭据；46 个 JSON/JSONL 文件可解析，41 项冻结源码、样本与准入证据哈希匹配 |

跳过项为 `test_plain_doc_paragraphs.py` 中依赖未提供的 `tests/chunking/2.md` 的测试。后端警告主要为既有的 Pydantic / `datetime.utcnow()` 弃用提示。

冻结源码快照保留原有行尾空白；`.gitattributes` 沿用仓库研究材料的规则，禁止对这些评测材料转换行尾，并仅对源码快照关闭空白样式检查，避免破坏协议哈希。

DOM 测试在隔离的 jsdom 依赖中执行，不向生产依赖添加测试库：

```sh
cd frontend
npm install --prefix /tmp/tessmora-sidebar-dom-tests --no-package-lock --no-save jsdom@26.1.0
for suite in decisionSettings streamingRendering; do
  ./node_modules/.bin/esbuild "tests/$suite.dom.tsx" --bundle --platform=node --format=cjs \
    --external:react '--external:react/*' --external:react-dom '--external:react-dom/*' \
    --external:jsdom --loader:.css=empty --define:import.meta.env='{}' \
    --outfile="/tmp/tessmora-sidebar-dom-tests/$suite.cjs"
  NODE_PATH="$PWD/node_modules:/tmp/tessmora-sidebar-dom-tests/node_modules" \
    node --test "/tmp/tessmora-sidebar-dom-tests/$suite.cjs"
done
```

本轮日志位于本地忽略目录 `ops/decision-commit-20261010/`。

## 验证边界

设置页在前一轮已通过隔离 Chromium 的实际 Vite 页面检查，覆盖亮暗主题、1360 / 390 / 320 px、键盘开关、品牌图、取消和旧配置显式保存。测试与保存请求使用受控接口，持久配置文件哈希未改变；本轮未改前端实现，因此沿用该视觉验收。截图与回执位于本地 `ops/decision-settings-simple-20261009/browser-final/`。

本轮没有重新发起付费模型调用、修改用户保存设置或重建索引。工程测试和界面验收不代表模型质量提升；真实调用与质量边界以各冻结研究报告为准。密钥、会话快照、原始私有语料、构建产物及临时日志不纳入提交。
