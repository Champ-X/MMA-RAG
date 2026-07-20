# 飞书 IM 接入（Nexus v2）

Nexus v2 保留飞书 IM，但不再维护一套独立的“飞书知识库/会话/RAG”实现。飞书只是同一组 Space、Raw-first Ingestion、Quick/Research Run、Evidence 与 Artifact 领域服务的渠道适配器，因此 Web 与 IM 不会产生两份业务真相。

## 能力

- `lark-oapi` WebSocket 长连接接收 `im.message.receive_v1`；无需 HTTP Webhook。
- 单聊直接触发；群聊仅处理 `@机器人`，避免无意扩大检索范围。
- `/spaces`、`/kb`、`/菜单`、`/面板` 列出 Space；`/space <名称、slug 或 ID>` 固定当前聊天范围。
- 直接提问创建持久 Quick Run；`/research <目标>` 创建持久 Research Run。
- 图片、音频、视频和文件先下载原始字节，再进入与 Web 完全相同的 Raw-first 摄取管线。
- Redis 负责事件去重、聊天到 Space 的映射和健康心跳；Redis 故障时 worker 不丢失 PostgreSQL 中的 Run/Source，并会自动重连。
- 默认返回静态 Markdown 富卡片；可切换纯文本。引用使用稳定 Evidence Revision ID。

旧版 CardKit 流式正文、飞书专属 Session、Pending Attachment、知识库命令控制面和卡片回调没有原样保留：它们绑定旧内存 Session、临时引用号或独立知识库权威。v2 用持久 Run/SSE、立即 Raw 入库、Space 命令与稳定 Evidence 替代。静态富卡片仍保留 IM 展示能力，但不重新引入第二套状态机。

## 开放平台配置

1. 创建企业自建应用，记录 App ID 与 App Secret。
2. 开启机器人能力，授予接收单聊/群聊 @消息、以机器人身份回复、读取消息资源所需的最小权限。
3. 在“事件订阅”选择“使用长连接接收事件”，订阅 `im.message.receive_v1`。
4. 发布应用版本并配置可用范围。Nexus v2 不依赖 `card.action.trigger` 回调。

## 环境变量

```dotenv
FEISHU_WS_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=***
FEISHU_ENCRYPT_KEY=
FEISHU_VERIFICATION_TOKEN=
FEISHU_DEFAULT_SPACE_IDS=
FEISHU_REPLY_IN_THREAD=false
NEXUS_FEISHU_REPLY_FORMAT=card
NEXUS_FEISHU_RUN_TIMEOUT_SECONDS=180
```

- `FEISHU_DEFAULT_SPACE_IDS` 可填 Space ID、slug 或唯一名称；只解析出一个 Space 时自动绑定。
- `NEXUS_FEISHU_REPLY_FORMAT` 为 `card`（默认）或 `text`。
- Secret 只来自环境变量，不写入 PostgreSQL、日志或健康响应。

标准 Profile 已包含 `feishu-worker`：

```bash
./start-dev.sh --profile standard
```

## 验证与健康语义

```http
GET http://127.0.0.1:8000/api/v1/system/health
```

`feishu.status=ready` 必须同时满足：功能启用、App 凭证存在、租户令牌认证成功、worker 在 Redis 中发布的新鲜心跳。仅仅“进程启动”不会报告 Ready。验证时可在单聊发送 `/spaces`，选择 Space 后提问；不要在生产机器人上用自动化脚本发送消息。

代码入口：

- `backend/src/nexus/infrastructure/feishu/worker.py`
- `backend/src/nexus/infrastructure/feishu/channel.py`
- `backend/src/nexus/infrastructure/feishu/parser.py`
- `backend/tests/nexus/test_feishu_channel.py`
