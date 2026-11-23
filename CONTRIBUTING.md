# 参与贡献

**简体中文** · [English](CONTRIBUTING-en.md)

欢迎提交中文或英文的 Issue 和 Pull Request。使用问题请附操作系统、安装方式和提交号。检索问题还请附模式、模型、搜索范围，以及一份可以公开的最小样例。涉及凭证或私人资料时，请按[安全报告流程](SECURITY.md#reporting)联系维护者。

## 准备工作区

从自己的 fork 创建分支。将 `YOUR_GITHUB_USERNAME` 替换为你的 GitHub 账号。

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/MMA-RAG.git
cd MMA-RAG
git remote add upstream https://github.com/Champ-X/MMA-RAG.git
git switch -c docs/my-change
```

只改文档需要 Git 和 Python 3。运行应用需要 Python 3.11 或 3.12、Node.js 22.19+、Docker 和 Compose。按[源码开发](README.md#从源码开发)安装后端、前端和 Pi 依赖。修改安装器时另运行 `npm --prefix packages/cli ci`。音视频处理使用 FFmpeg/ffprobe，Office 转换使用 LibreOffice。

开发启动器在本机运行 FastAPI 和 Vite，在 Docker 中启动或复用存储。准备好 `backend/.env` 后，运行 `./start-dev.sh doctor` 检查环境，再用 `./start-dev.sh` 启动。Pi 恢复测试应使用独立的 `PI_AGENT_DATA_DIR`，每个目录只由一个宿主持锁。[本地启动](docs/LOCAL_STARTUP.md) · [Pi 恢复](docs/pi-agent-durable.md)

## 选择验证命令

以下命令从仓库根目录运行。完整后端测试使用专用 MinIO、Qdrant 和 Redis。`PORTRAIT_TRIGGER_TEST_REDIS_URL` 可指向单独的测试 Redis 数据库，测试会写入触发器状态。模型测试用的 `test-only` 是占位密钥。真实服务商和私有语料应使用独立实例。

| 改动 | 检查 |
| --- | --- |
| 文档和资源 | `python3 scripts/check_repository.py --worktree` · `git diff --check` |
| 前端 | `npm --prefix frontend test` · `npm --prefix frontend run test:dom` · `npm --prefix frontend run build` |
| Pi Node 运行时 | `npm --prefix agent-runtime test` |
| 安装管理 CLI | `npm --prefix packages/cli test` · `(cd packages/cli && npm pack --dry-run)` |
| 启动器和 Nginx | `python3 scripts/test_dev.py` · `python3 scripts/test_deploy_nginx.py` |
| 评测输入 | `./scripts/rag-eval validate` |

运行完整后端测试，也可以把最后一行替换为相关测试文件。

```bash
SILICONFLOW_API_KEY=test-only PYTHONPATH=backend .venv/bin/python -m pytest \
  backend/tests backend/test_*.py -q
```

仓库检查器的 `--worktree` 会计入未忽略的新增文件，排除工作区已删除的文件。默认模式按 Git 索引的文件名检查工作区内容。`npm pack --dry-run` 会通过 `prepack` 同步 `packages/cli/assets/`。Nginx 测试需要 Docker。界面行为改动应在浏览器检查受影响的语言、交互和屏幕尺寸。

推送到 `main` 和提交 PR 会运行仓库、启动器、Nginx、前端、Pi 和安装器检查。改动分发相关路径的 PR 或手动触发还会构建 Linux AMD64 和 ARM64 镜像，验证空实例安装、任务和重启。完整后端测试和带真实模型的评测单独运行。[仓库工作流](.github/workflows/checks.yml) · [发行工作流](.github/workflows/distribution.yml)

## 提交改动

1. 行为或选项改变时更新对应指南。修改双语页面时同步命令、默认值和限制，并检查两个语言入口都能到达目标。
2. 将改动、相关回归和必要夹具一起提交。运行数据、密钥、日志和模型缓存放在 Git 之外。已发布的图表文件继续跟踪，新增草图由忽略规则处理。默认单文件上限为 5 MiB，两段介绍视频各有 24 MiB 的例外。
3. 将 PR 提交到上游 `main`，说明用户能观察到的变化、测试命令和结果。附复现问题所需的最少资料。检索变化请说明比较的输入、模式和质量指标。

评测目录包含与历史准入记录绑定的数据。新的实验输出放到忽略目录。仓库当前没有项目级开源许可证。[评测输入](evals/README.md) · [仓库维护](docs/REPOSITORY.md)
