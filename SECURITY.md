# Tessmora 安全说明

**简体中文** · [English](SECURITY-en.md)

Tessmora 面向本机单用户或可信网络。常规 API 目前没有统一登录、租户隔离或按知识库授权的机制。能访问这些接口的人可能读取或修改资料。

<a id="reporting"></a>

## 私下报告安全问题

查看仓库的 [Security 页面](https://github.com/Champ-X/MMA-RAG/security)。如有 **Report a vulnerability**，使用该入口私下报告。也可以使用维护者提供的私密联系方式。若两者都不可用，可在 [Issues](https://github.com/Champ-X/MMA-RAG/issues) 仅请求私密联系渠道，将技术细节留待私下沟通。

报告中附 `git rev-parse HEAD` 的结果、安装方式、受影响的权限或数据、预期与实际行为，以及使用合成资料的最小复现。发送日志前移除密钥、连接链接和用户内容。项目没有公布支持版本矩阵或响应时限。普通安装问题可按[贡献指南](CONTRIBUTING.md)反馈。

## 接口与凭证

| 入口 | 当前行为 |
| --- | --- |
| 知识库、上传、导入、检索、普通对话 | 请求有输入校验。网络可达性决定谁能访问，服务缺少统一的用户和知识库访问控制。FastAPI 的 CORS 允许任意来源。 |
| Pi 与网络素材采集 | 两者共用工作区检查。配置 `PI_AGENT_API_TOKEN` 后校验工作区凭证。没有令牌时校验回环连接、主机和可选 Origin。Pi 会话 cookie 有效 6 小时，路径为 `/api/pi`，采集请求应使用 Bearer token。 |
| 安装配置 | 读配置、写配置、模型测试和准备要求 `X-Tessmora-Setup-Token`。`status`、`storage`、`progress` 可公开读取。 |
| Pi 来源工具 | 宿主按本次运行的知识库、文件和附件限制访问。`@` 材料只供读取，搜索范围来自独立选择器。 |

[API 与 CORS](backend/app/main.py) · [工作区检查](backend/app/api/pi_agent.py) · [采集](backend/app/api/collection.py) · [安装配置](backend/app/api/setup.py)

## 部署与数据

- **完整安装。** Docker 默认仅向 `127.0.0.1` 发布网页 `3001` 和 MinIO 对象端口 `9000`。Nginx 转发 `/api/` 和 `/health`。安装器生成实例令牌和存储密码，`tessmora open --print-url` 会按要求打印含令牌的私有链接。[分发 Compose](deploy/compose.yaml)
- **源码开发。** Vite 与 FastAPI 绑定本机地址。根 Compose 的存储端口未限定回环地址，含开发用 MinIO 凭证。运行整份根 Compose 还会发布后端与监控端口。[开发 Compose](docker-compose.yml)
- **本地文件。** `backend/.env`、CLI 的 `runtime.env` 和服务端 `state/setup.json` 可能含密钥。使用受限文件权限，保护整个备份。浏览器也在本地存储和 IndexedDB 保存对话或附件。同一浏览器配置文件的其他使用者可能读到这些内容。[备份范围](packages/cli/README.md#配置与数据)
- **模型请求。** 云端解析、向量化、重排、生成和媒体观察可能将问题或资料片段发送给所选服务商。部署前核对提供商的数据政策。Pi 没有累计 Token、时长或工具调用配额。恢复中断请求可能额外计费。

## 文件、网络与共享访问

上传文件、网页和检索结果属于外部输入。网络采集下载器对目标、端口和重定向执行公网地址检查。旧 URL 导入和解析器中的网络图片使用各自的下载逻辑。共享部署应在网络层限制出站目的地。服务器文件夹导入默认关闭，启用时使用 `IMPORT_FOLDER_ALLOWED_BASE_PATHS`。`MMA_RAG_ALLOWED_ROOTS` 仅限制 `mma-rag` 命令可上传的路径。[采集下载器](backend/app/modules/collection/providers.py) · [CLI 选项](skills/mma-rag/references/cli-reference.md)

Pi 提供受限表格操作和来源工具。宿主还会运行文件解析器、FFmpeg 和 LibreOffice，宜用低权限账户运行。向其他用户开放前配置 TLS、认证、知识库授权、CORS、请求与费用限额，隔离存储和管理端口。Pi 和采集数据目录各有独占锁，普通会话仍有进程内状态。备份后应在独立实例验证恢复。[系统架构](docs/MMA_ARCHITECTURE.md) · [Pi 恢复](docs/pi-agent-durable.md)

## 凭证泄露后

立即撤销或轮换受影响的凭证，必要时限制访问。检查服务商用量与访问记录，私下保存脱敏证据，按[报告流程](#reporting)联系维护者。已经泄露的密钥即使从 Git 历史删除，仍需轮换。
