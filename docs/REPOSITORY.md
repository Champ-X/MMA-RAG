# 仓库维护与轻量获取

主仓库分发当前产品源码、必要资源、回归测试、可复用工具与维护文档。私人数据和阶段实验不随 clone 分发。

## 获取代码

只运行或评估当前版本，推荐浅克隆：

```bash
git clone --depth 1 --single-branch https://github.com/Champ-X/MMA-RAG.git
```

后续正常 `git pull --ff-only`。需要完整主分支历史时执行 `git fetch --unshallow`；单分支 clone 不自动取得其他分支。开发者需要历史但希望延迟下载旧文件内容，可使用：

```bash
git clone --filter=blob:none --single-branch https://github.com/Champ-X/MMA-RAG.git
```

部分克隆仍会下载当前 checkout 所需的 blob；访问旧版本时再获取对应内容。下载 ZIP 只包含当前树，不包含 Git 历史，适合无需提交代码的使用者。

## 文件边界

| 内容 | 位置与策略 |
| --- | --- |
| 产品源码、测试与最小夹具 | Git 跟踪 |
| 当前 UI 必需图片及文档示例 | Git 跟踪；复用资源，避免同时提交重复原图/副本 |
| 启动及可复用运维工具 | Git 跟踪，记录参数与运行前提 |
| 生成的前端、依赖、模型权重 | 本地生成或独立发布，不放 Git |
| 用户配置与知识数据 | `backend/.env`、本地配置、`data/`、MinIO/Qdrant 持久目录；忽略 |
| 临时 QA、截图、实验脚本与模型回执 | `ops/` 或仓库外归档；忽略 |
| 冻结实验与大语料 | 独立研究归档/发布资产；主仓库仅保留生产准入所需的小型证据 |

`.gitignore` 不能移除已跟踪文件，清理必须同时更新 Git 索引。删除当前文件也不会自动减少完整 clone 的历史对象。`git gc` 只能压缩本地对象，不能清理 GitHub 上仍被分支引用的历史。

## 历史与恢复

整理前主分支为 `28d639b`，有 392 次提交，可达对象占用约 83 MiB。大对象主要来自旧构建、图片与实验语料，不是提交数量本身。当前树清理与浅克隆能够减少首次获取成本，保留历史便于定位回归与恢复研究依据。

本次采用普通提交，不改写共享分支历史。强制历史重写会改变后续提交 ID，并要求其他工作区和贡献者重新同步；只有大文件或泄密等需求确实值得承担迁移成本时才单独协调。旧研究分支也有各自的历史，不应未经确认删除。

恢复历史文件可先在外部目录检查：

```bash
git show 28d639b:docs/PI_AGENT_VERIFICATION.md > /tmp/pi-agent-verification.md
```

浅克隆需先获取对应历史。旧记录用于解释当时实验，不代表当前实现或验证状态。归档恢复不应重新加入默认提交集合。

## 持续检查

`python3 scripts/check_repository.py` 校验 Git 跟踪范围、Markdown 本地链接和单文件大小。CI 执行同一检查，防止本地存在而 clone 缺失的文件被误判为可用。新增大文件应先考虑独立发布和下载缓存；实际需要时明确评审并调整检查规则。

维护者可以分别测量当前树与历史：

```bash
git ls-tree -r -l HEAD
git count-objects -vH
git rev-list --disk-usage --objects HEAD
```

真正的分发验收应从干净 clone 或 `git archive` 导出检查链接、安装依赖、测试并构建。不能用工作区里忽略的实验文件、环境配置或构建缓存掩盖缺失依赖。
