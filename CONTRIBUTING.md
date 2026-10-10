# Contributing to Tessmora

欢迎提交聚焦的 Issue 和 Pull Request。中文和英文均可。先按 [README](README.md) 准备 Python 3.11/3.12、Node ≥22.19、存储服务和模型配置。

## 工作目录

| 目录 | 维护内容 |
| --- | --- |
| `backend/app/` | 在线 API、领域逻辑、模型与存储适配 |
| `frontend/src/` / `frontend/public/` | 前端源码与实际使用的静态资源 |
| `agent-runtime/` | Pi SDK 工作进程和协议测试 |
| `backend/tests/`、`backend/test_*.py`、`frontend/tests/` | 产品回归与必要的合成夹具 |
| `backend/evaluation/` / `evals/` | 通用评测工具和最小维护数据 |
| `scripts/` / `backend/scripts/` | 启动、运维及可复用诊断工具 |
| `docs/` | 当前使用、架构、配置与维护文档 |
| `skills/mma-rag/` | 对外 CLI 与 Codex Skill |

## 验证

从根目录运行，不把某次测试数量当成长期质量承诺：

```bash
source .venv/bin/activate
python3 scripts/check_repository.py
python3 scripts/test_dev.py
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix agent-runtime ci
npm --prefix agent-runtime test
./scripts/rag-eval validate
```

后端在 Git checkout 中使用项目虚拟环境，并设置模块搜索路径。以下占位值仅用于替身测试，不具备真实模型访问权限：

```bash
SILICONFLOW_API_KEY=test-only PYTHONPATH=backend .venv/bin/python -m pytest backend/tests backend/test_*.py -q
```

部分后端模块在导入时初始化存储客户端，完整收集需要可达的本地 MinIO/Qdrant。测试通常替换模型调用，但手工验证脚本和 live 评测会使用真实服务并可能产生费用；请使用专用数据与凭证。没有这些服务时，选择不依赖它们的模块测试并在 PR 中说明未覆盖范围。不要把被卡住或中断的收集计为通过。

`frontend/tests/*.dom.tsx` 是独立的 DOM 回放检查，不包含在 `npm test` 的 Node 测试 glob 中；`replay*.tsx` 用于开发回放。涉及交互时还须通过真实浏览器核对相关流程、窄屏、深浅主题与键盘操作。构建通过不等于视觉验收。

CI 自动检查仓库规则、启动控制器、前端测试/构建和 Pi 协议。完整后端、真实模型及浏览器验收由变更作者报告，不伪装为 CI 已覆盖。

## 提交约定

- 保留产品测试和最小合成夹具。不要为了减少文件数删掉仍保护在线行为的测试。
- 临时脚本、截图、日志、逐题模型回执放在 `ops/`；下载语料、知识数据和模型缓存放在 `data/`；评测输出放在 `evals/runs/` 或 `evals/reports/`。
- 不提交 `.env`、用户配置、上传文件、数据库、模型权重、构建产物或依赖目录。`backend/data/` 下模型路由与 Decision 设置是可变本地状态。
- 新增 `evals/` 数据需要明确的维护用途、许可、哈希和测试消费者，并显式更新白名单。原始实验在仓库外归档；不能反复修改冻结候选以覆盖失败。
- 更新行为时同步技术文档，中英文 README 保持能力和安装流程一致。新的公开性能结论必须具有完整可核验来源与限制，不能只发布获胜样本。
- PR 说明具体问题、最终行为、验证命令和未验证边界。界面改动附截图，检索改动附脱敏输入与来源。

提交前检查 `git diff --check`、`git diff --cached --stat` 和新增文件列表；大文件及历史策略见 [仓库维护](docs/REPOSITORY.md)。安全问题按 [SECURITY.md](SECURITY.md#reporting) 私下报告。
