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
| 当前 UI 必需图片、许可、来源清单及文档示例 | Git 跟踪；删除旧图前检查源码、动态路径、测试与持久数据引用 |
| README 中英文介绍视频 | `docs/media/tessmora-intro/` 仅分发两份 720p 轻量版及封面/字幕；视频各约 21 MiB，来源与哈希见该目录清单 |
| 启动及可复用运维工具 | Git 跟踪，记录参数与运行前提 |
| 生成的前端、依赖、模型权重 | 本地生成或独立发布，不放 Git |
| 用户配置与知识数据 | `backend/.env`、`backend/data/`、`data/`、MinIO/Qdrant 持久目录；忽略 |
| 临时 QA、截图、实验脚本与模型回执 | `ops/` 或仓库外归档；忽略 |
| 冻结实验与大语料 | 独立研究归档/发布资产；主仓库仅保留生产准入所需的小型证据 |

`evals/` 不是评测输出目录。当前只保留 `baseline_v1/` 的合成语料与题集、`baselines/` 中用于比较器回归的报告，以及 `decision_plan_v2/`、`decision_plan_v2_holdout/` 的生产准入证据。后两者含哈希绑定的源快照；文件较旧不等于无用，不应随代码格式化或“更新日期”而改写。消费者与运行方式见 [评测目录](../evals/README.md)。新运行结果显式写到忽略的 `evals/runs/`、`evals/reports/` 或 `ops/`。

共享的 `PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json` 是产品与设计约定，应与实现同步；聊天过程、候选提案和逐次验收记录放到忽略目录。文档中的历史截图与架构图应标明源码版本和已知差异，当前行为以技术说明和实现为准。

`.gitignore` 不能移除已跟踪文件，清理必须同时更新 Git 索引。删除当前文件也不会自动减少完整 clone 的历史对象。`git gc` 只能压缩本地对象，不能清理 GitHub 上仍被分支引用的历史。

## 历史与恢复

普通清理通过删除当前树中的过时文件完成，Git 历史仍可用于恢复。具有独立价值的本地记录可先移到忽略的 `ops/maintenance/`，保留原路径与 SHA-256，再从分发目录移除；不清空运行数据、模型缓存或用户资料。

强制历史重写会改变后续提交 ID，并要求其他工作区和贡献者重新同步，应作为独立维护任务处理。当前树体积和 Git 历史体积需要分别测量；一次旧测量不能代表当前 clone 成本。

恢复历史文件可先在外部目录检查：

```bash
git log --all -- docs/ONBOARDING_VERIFICATION.md
# 将 COMMIT 替换为仍包含所需文件的历史提交
git show COMMIT:docs/ONBOARDING_VERIFICATION.md > /tmp/onboarding-verification.md
```

浅克隆需先获取对应历史。旧记录用于解释当时实验，不代表当前实现或验证状态。归档恢复不应重新加入默认提交集合。

## 持续检查

`python3 scripts/check_repository.py` 以 Git 索引中的文件名检查当前工作区内容：分发边界、Markdown 本地链接和单文件大小。CI 在干净 checkout 中执行同一检查，防止本地存在而 clone 缺失的文件被误判为可用。未暂存的新增或删除可先用 `--worktree` 检查，它纳入未被忽略的新文件、排除待删除文件，不修改暂存区。精确暂存后仍需运行默认检查。

```bash
python3 scripts/check_repository.py --worktree
python3 scripts/test_check_repository.py
git diff --check
```

检查器同时拒绝运行数据、依赖、制作工程、临时设计和测试输出；即使使用 `git add -f` 也不能绕过 CI。`.gitignore` 用于日常排除，检查器用于检查实际分发集合，两者需同步维护。新增大文件应先考虑独立发布和下载缓存。

默认单文件上限仍为 **5 MiB**。README 需要随仓库分发的 `docs/media/tessmora-intro/tessmora-intro-zh.mp4` 与 `tessmora-intro-en.mp4` 各有 **24 MiB** 的精确路径例外，合计约增加 42 MiB 的当前 checkout 内容。1080p 母片、制作工程和逐次验收记录继续保留在忽略的 `video-production/` 中；不要把例外扩大到整个目录或所有 MP4。视频更新时同步 [媒体清单](media/tessmora-intro/manifest.json)，超出上限时优先改用外部发布资产。

维护者可以分别测量当前树与历史：

```bash
git ls-tree -r -l HEAD
git count-objects -vH
git rev-list --disk-usage --objects HEAD
```

真正的分发验收应从干净 clone 或 `git archive` 导出检查链接、安装依赖、测试并构建。不能用工作区里忽略的实验文件、环境配置或构建缓存掩盖缺失依赖。
