# 接入飞书机器人和云文档

飞书 IM 通过长连接接收消息，使用常规 Direct 检索和生成回答。知识库还可以单独导入飞书 Docx 或 Wiki 链接。收消息需要启用机器人长连接，读取云文档需要资源的阅读权限。两项功能可以分别配置。

## 创建机器人

1. 在[飞书开放平台](https://open.feishu.cn/app)创建企业自建应用，启用机器人，记下 App ID 和 App Secret。
2. 根据要使用的能力申请下表中的权限。在事件订阅中选择**使用长连接接收事件**，订阅 `im.message.receive_v1`。这条路径由运行中的后端主动连接飞书。
3. 需要单聊入口或已读事件时，可订阅 `im.chat.access_event.bot_p2p_chat_entered_v1` 和 `im.message.message_read_v1`。使用交互卡片按钮时，在回调配置中选择长连接并添加 `card.action.trigger`。
4. 发布应用版本，设置可见范围。用户可在单聊发送问题，或在群内 @ 机器人。可选的底部菜单使用「发送文字消息」动作，发送 `/help`、`/kb` 或 `/菜单` 等已支持的命令。[已注册事件](../backend/app/integrations/feishu_ws.py) · [知识库命令](../backend/app/integrations/feishu_kb_commands.py)

| 能力 | 权限 |
| --- | --- |
| 接收单聊和群内 @、以机器人身份回复 | `im:message.p2p_msg:readonly`、`im:message.group_at_msg:readonly`、`im:message:send_as_bot`。按开放平台相应事件和接口要求补充读取权限。 |
| 收发图片、音频和文件 | `im:resource` |
| CardKit 流式卡片 | `cardkit:card:write` |
| 用户进入单聊时展示入口 | `im:chat.access_event.bot_p2p_chat:read` |

## 配置后端

源码开发在 `backend/.env` 填写真实凭证，重启后端生效。示例文件已设 `FEISHU_WS_ENABLED=true`，未提供该配置时，代码默认关闭长连接。[环境示例](../backend/.env.example) · [配置定义](../backend/app/core/config.py)

```dotenv
FEISHU_WS_ENABLED=true
FEISHU_APP_ID=your-app-id
FEISHU_APP_SECRET=your-app-secret
```

| 变量 | 作用 |
| --- | --- |
| `FEISHU_ENCRYPT_KEY`、`FEISHU_VERIFICATION_TOKEN` | 对应开放平台的事件加密及校验设置。 |
| `FEISHU_DEFAULT_KB_IDS` | 逗号分隔的默认知识库 ID。本条消息指定的库优先，其次是会话选择和环境默认值。三者都为空时使用自动路由。 |
| `FEISHU_GROUP_TRIGGER_PREFIX` | 配置群聊的文字触发前缀，例如 `/rag`。 |
| `FEISHU_WEB_BASE_URL` | 回复中的网页链接使用的前端地址，应能从飞书客户端访问。 |
| `FEISHU_RAG_REPLY_FORMAT`、`FEISHU_RAG_CARD_STREAMING` | 用 `post` 发送富文本，或用 `card_v2` 发送交互卡片。启用流式更新时需要卡片写权限。 |
| `FEISHU_IMAGE_SEND_ENABLED`、`FEISHU_MAX_REPLY_IMAGES` | 控制是否发送图片及张数。音频卡片的 OPUS 转换取决于 `FEISHU_RAG_CARD_OPUS_AUDIO` 和 FFmpeg。 |
| `FEISHU_WS_OPEN_TIMEOUT`、`FEISHU_WS_PREFER_IPV4` | 握手等待时间与 IPv4 偏好。可用于排查 WSL、代理或 VPN 环境下的连接问题。 |

## 导入 Docx 与 Wiki

在素材空间的链接导入入口提供 `/docx/` 或 `/wiki/` 链接。默认用 App ID 和 Secret 申请 `tenant_access_token`。也可用 `FEISHU_DOC_ACCESS_TOKEN` 提供短期用户令牌，过期后需更新。

为文档应用授权时，要同时处理应用权限和具体资源的可见性。用 tenant token 读取私有文档时，在目标文档的「添加文档应用」中授予阅读权限。Wiki 节点、内嵌 Sheet、Base 和画板同样需要可读。

| 文档内容 | 按需申请的权限 |
| --- | --- |
| 新版文档、Wiki 链接 | `docx:document:readonly`，Wiki 还需节点读取权限。 |
| 图片、附件、画板 | `docs:document.media:download`、`board:whiteboard:node:read` |
| 内嵌电子表格、多维表格 | `sheets:spreadsheet:readonly`、`bitable:app:readonly` |

导入保留标题、段落、列表、代码和原生表格。图片与画板缩略图进入图片索引，画板文字进入文本索引。默认最多读取 5000 个文档块、100 个素材、每张内嵌电子表格 200 行、多维表格 200 条记录。可分别调整 `FEISHU_DOC_MAX_BLOCKS`、`FEISHU_DOC_MAX_ASSETS`、`FEISHU_DOC_MAX_SHEET_ROWS` 和 `FEISHU_DOC_MAX_BITABLE_RECORDS`。

## 验证连接

源码开发环境可直接访问后端。

```bash
curl -sS http://localhost:8000/api/feishu/ws-status
```

先看 `ws_thread_alive`（线程已启动）和 `ws_transport_connected`（传输已连接），再读 `diagnosis_hint`。最后在单聊发送一个已知知识库能回答的问题，检查回复中的引用。[状态接口](../backend/app/api/feishu.py)

- 线程未启动时，检查开关和凭证。线程已启动却连不上时，检查出口网络、代理、IPv4 设置与握手超时。
- 已连接但收不到群消息时，检查应用版本、可见范围、事件订阅和 @ 或前缀触发条件。
- 卡片更新失败时检查 CardKit 权限。回复缺图或音频时检查素材开关、MinIO、上传权限和 FFmpeg。
- 云文档返回 400 或 403 时，分别核对应用 scope、令牌和具体资源的共享权限。
