# 本机数据迁移记录（2026-09-27）

迁移时的源目录：`/Users/champ/Projects/mma-data`（后续已移除；运行不依赖该目录）。
本次恢复使用的项目目录：`/Users/champ/orca/workspaces/MMA-RAG/feat-jev-optm-2`。

## 启动与使用

```bash
cd /Users/champ/orca/workspaces/MMA-RAG/feat-jev-optm-2
./scripts/start-restored.sh
```

- 网页：<http://localhost:3001>；API：<http://localhost:8000/docs>。
- MinIO：<http://localhost:9001>；Qdrant：<http://localhost:6333/dashboard>。
- 已运行时直接访问网页。再次执行脚本会在端口检查时退出，避免启动重复实例。
- `Ctrl+C` 关闭该脚本启动的前后端，存储容器继续运行。
- 后端聊天历史仍存放在进程内存中；普通启动脚本不会自动加载本次验收时手工导出、恢复的会话快照。需要保留服务端历史时，应在停止进程前另外导出并安排恢复。MinIO/Qdrant 的持久化不等同于聊天历史持久化。
- 后端日志：`logs/restored-backend.log`；前端日志：`logs/restored-frontend.log`。
- 前端端口可通过 `FRONTEND_PORT` 修改；API 固定 8000，与 Vite 代理一致。
- 使用已有 `backend/.env` 和模型配置。查看文件复用本地数据；语义检索仍调用已配置的查询嵌入、意图分析、重排等模型服务，需要网络和有效凭证。

本机 `.venv` 是指向已有 `feat-agentic/.venv` 的忽略跟踪链接，用于复用已安装的 Python 3.12 依赖；它不是数据存储位置。不要移除该环境，或通过 `MMA_PYTHON=/path/to/venv/bin/python ./scripts/start-restored.sh` 指定另一个完整后端环境。前端复用当前项目的 `frontend/node_modules`。

脚本显式指定 Compose 文件和项目名，避免继承本机旧的 `COMPOSE_FILE` 配置。只启动 MinIO、Qdrant、Redis、后端和前端，不启动解析 worker、上传任务、重新解析或重新向量化。Qdrant 固定 v1.16.2，MinIO 固定 RELEASE.2025-09-07T16-13-09Z。

Docker context 默认选择已经存在的 `colima-mma-rag`，不存在时使用当前 context；可通过 `MMA_DOCKER_CONTEXT=<本地context名称> ./scripts/start-restored.sh` 显式指定。所有 Compose、容器状态和 Redis 检查使用同一 context，脚本不切换全局 Docker context。只有选中 `colima-mma-rag` 且该 daemon 不可用时，脚本才尝试 `colima start --profile mma-rag --activate=false`；其他 context 需自行启动。此入口使用本机数据目录和 localhost 健康检查，仅接受本地 Unix socket context，不适用于远端 Docker daemon。

## 数据清单

源目录复制到项目的 `minio_data/` 与 `qdrant_storage/`，恢复后的容器绑定这两个独立副本。迁移操作未改写源目录；后续源目录已移除。复制后、启动存储前逐文件 SHA-256 比对通过：MinIO 1,128 个物理文件，Qdrant 1,169 个物理文件，共 3,225,346,573 字节。MinIO 的 xl.meta 是内部存储格式，不能作为原始文件直接上传。

| 知识库 | 内容 |
|---|---|
| music | 16 个音频 |
| 杂七杂八 | 1 个 Markdown 文档，35 个文本块 |
| movies | 4 个视频，90 个镜头 |
| 图片收集 | 16 张图片 |
| 生物科普 | 3 个视频，397 个镜头 |
| Harness Paper | 2 个 PDF，319 个文本块，22 张文档提取图片 |
| 风景人文 | 21 张图片、2 个视频，3 个镜头 |

合计 65 个原始文件；文件列表还展示 22 张论文提取图片，因此 API 返回 87 个文件项。MinIO 共 845 个逻辑对象，包含元数据、视频解析清单和关键帧。全部对象均已通过完整读取与长度校验；所有索引内的文件路径、解析清单、关键帧路径均能找到对象。

| Qdrant 集合 | 向量点数 |
|---|---:|
| text_chunks_agentic | 354 |
| image_vectors | 59 |
| audio_vectors | 16 |
| video_shot_vectors | 490 |
| video_keyframe_vectors | 742 |
| kb_portraits | 32 |

迁移验收时所有集合状态为 green。历史数据中部分 Qdrant `kb_id` 为完整 UUID，MinIO 使用旧缩写桶名；项目已有兼容发现机制，当时的检索与文件列表验证已覆盖这些关联，未修改原有向量或 payload。

## 验证证据

本地证据保存在 Git 忽略目录 `data/migration-20260927/`：

- `copy-manifest.json`：源数据逐文件 SHA-256 与复制校验清单。
- `storage-audit.json`：全部对象读取校验、各集合精确数量、知识库文件列表、引用缺失检查（0 条）。
- `payloads.json`：恢复后的索引 payload 清单。
- `preview-checks.json`：10 个代表性文件的预览接口、原文件读取，以及 PDF/Markdown 解析内容读取。
- `search-*.json`：实际在线检索的完整结果与耗时，保留失败/空结果样例。
- `previous-containers.json`：旧容器挂载与运行配置，仅本地保留。

浏览器扩展通信超时，未完成页面视觉验收；HTTP/API 验证不代表视觉验收。

实际检索样例（每次返回 3 条证据；耗时包含在线模型调用）：

| 模态 | 查询 | 首条命中 | 耗时 |
|---|---|---|---:|
| 文档 | Agent Harness 中 sandbox 的作用是什么？ | Agent Harness Engineering-A Survey.pdf，chunk 31 | 42.2 秒 |
| 图片 | 江南园林里有红叶和亭子的风景 | 园林秋.png | 80.7 秒 |
| 音频 | 晴天这首歌曲 | 晴天.mp3 | 34.3 秒 |
| 视频 | 找出讲解甜瓜起源和驯化历史的视频片段 | 吃了一千种瓜原来全是甜瓜.mp4，151.7–177.7 秒 | 85.8 秒 |

迁移验收时发现：仅问“甜瓜的起源和驯化历史”时，路由把视频通道判为 unnecessary，返回 0 条结果；明确要求“视频片段”后正常命中。这是当时的检索路由行为，不是缺少迁移索引。两次原始结果均保留，迁移操作本身未改动检索算法。后续已为普通检索补充按目标知识库实际模态召回的逻辑，修复与茶史复测见 [Jev 开关对比与漏召回修复](qa/jev-tea-retrieval.md)。

## 旧数据与回滚

迁移前本机存储挂载在 `feat-agentic` 工作目录，当时 API 返回的知识库列表为空。旧目录没有覆盖，旧容器停止并保留为：

- `mmrag_minio_before_20260927`
- `mmrag_qdrant_before_20260927`
- `mmrag_redis_before_20260927`

如需恢复旧实例，先停止当前前后端，再执行以下命令（不要同时运行两个占用相同端口的实例）：

```bash
DOCKER_CONTEXT=colima-mma-rag docker-compose -p feat-jev-optm-2 -f docker-compose.yml --env-file backend/.env stop minio qdrant redis
docker --context colima-mma-rag start mmrag_minio_before_20260927 mmrag_qdrant_before_20260927 mmrag_redis_before_20260927
```

以上是本次本机 `colima-mma-rag` context 中的回滚命令，其他机器需对应调整。迁移副本仍保留。重新使用迁移数据时，先在同一 context 停止三个 `_before_20260927` 容器，再运行 `./scripts/start-restored.sh`。两个实例各自使用独立 Redis，旧队列不会被带入恢复后的实例。
