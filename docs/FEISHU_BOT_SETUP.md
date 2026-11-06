# 飞书机器人接入与配置说明

本文说明如何在 [飞书开放平台](https://open.feishu.cn/) 创建应用、开通权限与事件订阅，并在本仓库后端通过**长连接（WebSocket）**接入机器人，使 IM 内对话与 Web 端共用同一套 RAG 检索与生成能力。

> **当前能力边界**：飞书聊天复用多模态 `RetrievalService` 与生成能力，但目前仍是直接检索路径；`auto / direct / agent` 三态选择只在 Web Chat、Chat API 和 `mma-rag ask` 中可用。
>
> **与 Webhook 请求 URL 的区别**：本实现使用 **lark-oapi 长连接** 接收 `im.message.receive_v1` 等事件，**不需要**在开放平台填写「请求地址 URL」式的 HTTP Webhook 来完成收消息。请勿将长连接与 Webhook 混在同一套事件链路上重复配置。

---

## 一、前置条件

- 飞书企业或团队管理员权限（或具备「创建应用」权限）。
- 后端可访问公网飞书域名（`*.feishu.cn`）；若在 **WSL / 代理 / VPN** 环境下，见下文「故障排除」。
- 已按仓库说明配置 `backend/.env`，且 **MinIO / Qdrant / Redis** 与主业务后端可正常运行（与 Web 对话一致）。

---

## 二、开放平台侧配置（概要）

以下步骤在 [飞书开放平台](https://open.feishu.cn/app) → **创建企业自建应用** 中完成，具体菜单名称可能随控制台改版略有差异。

### 1. 创建应用并获取凭证

1. 创建应用，记录 **App ID**、**App Secret**（对应环境变量 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`）。

### 2. 权限（scope）

按实际能力勾选，常见包括（名称以控制台为准）：

- **获取与发送单聊、群组消息**（IM 基础能力）。
- **读取用户发给机器人的单聊消息** / **接收群聊中 @机器人 的消息**（与事件订阅配合）。
- 若使用**卡片 JSON 2.0**、流式更新正文：需开通 **创建与更新卡片**（如 `cardkit:card:write`）等与 `FEISHU_RAG_CARD_STREAMING=true` 匹配的权限。
- 若回复中带图、文件：需 **上传图片/文件** 等相关权限（与 `FEISHU_IMAGE_SEND_ENABLED`、代码中上传逻辑一致）。

按启用的功能申请权限，不使用包含无关产品权限的通用导入清单：

| 能力 | 权限配置 |
| --- | --- |
| 基础单聊与群内 @ 问答 | `im:message.p2p_msg:readonly`、`im:message.group_at_msg:readonly`、`im:message:send_as_bot`；按控制台要求补充对应消息读取权限 |
| 图片、音频和文件收发 | `im:resource`，并核对所调用上传接口的权限要求 |
| CardKit 流式卡片 | `cardkit:card:write` |
| 进入单聊时展示入口 | `im:chat.access_event.bot_p2p_chat:read` |

具体权限名称与审批要求以各接口及事件在开放平台的说明为准。启用后发布版本并限制应用可用范围；不需要为本项目授权人事文件、全员群发、消息加急、撤回或其他未使用的应用能力。

### 2.1 飞书文档链接导入权限

知识库的「URL 导入」支持 `/docx/` 与 `/wiki/` 链接。后端默认复用 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 获取 `tenant_access_token`，不依赖部署机安装 `lark-cli`。按实际文档内容开通以下只读权限：

- 查看新版文档：`docx:document:readonly`
- 解析 Wiki 节点：在控制台开通知识库节点读取权限
- 下载正文图片和附件：`docs:document.media:download`
- 解析画板节点与缩略图：`board:whiteboard:node:read`
- 文档内嵌电子表格：`sheets:spreadsheet:readonly`
- 文档内嵌多维表格：`bitable:app:readonly`

应用 scope 只是第一层权限。使用 tenant token 时，还必须在目标文档右上角的「更多」→「添加文档应用」中把该应用添加为可读协作者；Wiki、嵌入 Sheet/Base 和画板也需要调用身份拥有对应资源的读取权限。若已有短期 `user_access_token`，可配置 `FEISHU_DOC_ACCESS_TOKEN` 覆盖 tenant token，但需要自行处理过期更新。

解析结果会保留标题、段落、列表、代码、原生表格等结构；图片和画板缩略图进入知识库图片管道，画板节点文字进入文本索引，嵌入 Sheet/Base 会下钻读取受限行数。相关上限由 `FEISHU_DOC_MAX_BLOCKS`、`FEISHU_DOC_MAX_ASSETS`、`FEISHU_DOC_MAX_SHEET_ROWS`、`FEISHU_DOC_MAX_BITABLE_RECORDS` 控制。

### 3. 事件订阅：必须使用「长连接」

1. 进入 **事件订阅**。
2. 选择 **使用长连接接收事件**（不要仅依赖「请求 URL」的 HTTP 回调作为唯一收消息方式与本项目后端对接）。
3. 订阅 `im.message.receive_v1` 作为问答入口；进入单聊与已读事件按需启用。当前后端注册的 IM 事件如下：

| 事件名称 | 说明 |
|------------------|------|
| `im.chat.access_event.bot_p2p_chat_entered_v1` | **用户进入与机器人的会话**（v2.0 能力下对应「进入单聊」类事件；控制台若区分版本，选 **v2.0**） |
| `im.message.message_read_v1` | **消息已读** |
| `im.message.receive_v1` | **接收消息**（即时通讯消息接收，RAG 主入口） |

4. 其他事件可按需追加（以业务为准）。

> 仅配置 Webhook URL 而不在运行中的后端进程里建立长连接，将无法与本仓库当前实现一致地收消息。

### 4. 回调配置：长连接 + 卡片回传

与「事件订阅」并列，开放平台另有 **回调配置**（控制台顶部常见 Tab：**事件配置** / **回调配置** / **加密策略**）。若 RAG 回复使用**交互卡片**（如按钮、表单回传），需在此配置回调，否则用户点击卡片组件时无法收到推送。

1. 进入 **回调配置**。
2. **订阅方式** 选择 **使用长连接接收回调**（推荐；与事件侧一致，通过 SDK 建连，无需单独配置公网 HTTP 回调地址）。
3. 点击 **添加回调**，订阅：
   - **回调名称**：**卡片回传交互**（控制台中文名，以实际为准）
   - **标识**：`card.action.trigger`

保存后同样需**发布版本**。后端长连接进程会处理该类回调（见 `feishu_handler` 等与卡片动作相关的逻辑）。

### 5. 机器人能力与可见性

- 在应用能力中为机器人开启 **机器人** 能力，将机器人拉入目标群或允许用户单聊。
- 群内需 **@机器人** 或按你配置的 `FEISHU_GROUP_TRIGGER_PREFIX`（如 `/rag`）触发，见下文环境变量。

### 6. 机器人自定义菜单

在开放平台进入 **机器人自定义菜单**（或「菜单与快捷方式」等同级入口，名称以控制台为准）。开启后，用户在与机器人的**单聊**窗口中可使用底部菜单，与 @ 机器人、前缀触发等方式互补。

1. **展示形式**：常见为 **悬浮菜单**（单聊输入区旁展示入口，如左下角 **「菜单」** 按钮）。
2. **主菜单配置**：
   - **名称**：设置为**「菜单」**。
   - **响应动作**：设置为 **发送文字消息**（用户点击后向会话注入一条文本，通常走 **`im.message.receive_v1`**，与手动输入消息同一套处理）。
3. 控制台提示：**配置在版本发布成功后约 5 分钟内生效**，发布后请稍等再验证。
4. 当前实现没有注册 `application.bot.menu_v6` 处理器。使用「发送文字消息」动作，让菜单走已注册的 `im.message.receive_v1`；若改用自定义菜单事件，需先实现并验证相应后端处理器。

**未配置自定义菜单时**：仍可在单聊输入框直接使用 **斜杠命令**（以 `/` 开头的指令），例如 **`/help`**、**`/kb`**、**`/菜单`**、**`/面板`** 等，与帮助文档及知识库面板逻辑一致（详见后端 `feishu_kb_commands` 中的 `/help` 与命令说明）。这些消息同样走 **`im.message.receive_v1`**；底部悬浮菜单只是可选入口，**不是**使用斜杠能力的前提。

---

## 三、`backend/.env` 配置

复制 [`backend/.env.example`](../backend/.env.example) 中 `FEISHU_*` 段落到 `backend/.env` 并填写。**修改后需重启后端进程**。

### 必填（启用飞书时）

| 变量 | 说明 |
|------|------|
| `FEISHU_WS_ENABLED` | 设为 `true` 时，启动时尝试拉起飞书 WebSocket 后台线程；`false` 则完全不连接。 |
| `FEISHU_APP_ID` | 开放平台应用 App ID。 |
| `FEISHU_APP_SECRET` | 开放平台应用 App Secret。 |

### 常用选填

| 变量 | 说明 |
|------|------|
| `FEISHU_ENCRYPT_KEY` / `FEISHU_VERIFICATION_TOKEN` | 与事件订阅加密配置一致；未开启加密可留空。 |
| `FEISHU_DEFAULT_KB_IDS` | 逗号分隔的知识库 ID；**留空**则与 Web 端一致走**智能路由**。 |
| `FEISHU_GROUP_TRIGGER_PREFIX` | 群聊除 @ 外的前缀触发，如 `/rag`；留空则仅 @ 机器人。 |
| `FEISHU_WEB_BASE_URL` | 文末「完整排版」等链接指向的前端根 URL（生产环境填写你的域名）。 |
| `FEISHU_RAG_REPLY_FORMAT` | `post`：富文本 Post/多条消息；`card_v2`：交互卡片（多图混排等）。 |
| `FEISHU_RAG_CARD_STREAMING` | `true` 时流式更新卡片正文，需开放平台具备对应卡片写入权限。 |
| `FEISHU_RAG_CARD_OPUS_AUDIO` | 是否尝试用 ffmpeg 转 OPUS 嵌入卡片音频；依赖系统或 `FFMPEG_PATH` 中的 ffmpeg。 |
| `FEISHU_WS_OPEN_TIMEOUT` | WebSocket 握手超时（秒），默认较大；弱网可调高。 |
| `FEISHU_WS_PREFER_IPV4` | WSL 等环境下飞书域名解析到 IPv6 易卡住时，默认 `true` 强制 IPv4；若与代理冲突可试 `false`。 |
| `FEISHU_MAX_REPLY_IMAGES` / `FEISHU_IMAGE_SEND_ENABLED` | 回复中配图数量与是否从 MinIO 读图上传飞书。 |
| `FEISHU_DOC_ACCESS_TOKEN` | 可选的短期用户令牌；未配置时文档导入使用 App ID/Secret 换取 tenant token。 |
| `FEISHU_DOC_MAX_*` | 文档 Block、素材、嵌入 Sheet 行数和 Base 记录数的导入安全上限。 |

更多变量含义以 `backend/.env.example` 内注释为准。

---

## 四、启动与验证

1. 保存 `backend/.env`，启动后端（如 `./start-dev.sh` 或 `uvicorn app.main:app`）。
2. 查看日志中是否出现 **「飞书 WS 后台线程已启动」**；若 `FEISHU_WS_ENABLED=true` 但缺少 App ID/Secret，会打出 **跳过飞书长连接** 的告警。
3. 调用探活接口（只读）：

   ```http
   GET http://<API_HOST>:8000/api/feishu/ws-status
   ```

   返回 JSON 中包含 `feishu_ws_enabled`、`ws_thread_alive`、`ws_transport_connected` 等字段；`diagnosis_hint` 为人可读简短结论。
4. 在飞书单聊或群内 **@机器人** 发送与知识库相关的问题，确认能触发检索与回复（格式取决于 `FEISHU_RAG_REPLY_FORMAT`）。

---

## 五、故障排除（常见）

| 现象 | 处理方向 |
|------|----------|
| `ws-status` 显示线程未起 | 检查 `FEISHU_WS_ENABLED` 与 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 是否非空。 |
| 线程在跑但长期未连上 WSS | 查出口网络、代理（`HTTPS_PROXY`）、WSL 下试 `FEISHU_WS_PREFER_IPV4`、调大 `FEISHU_WS_OPEN_TIMEOUT`；日志中 SSL/Timeout 关键字。 |
| 已连上但收不到消息 | 确认控制台为**长连接**且已订阅 `im.message.receive_v1`；群内是否 @ 机器人；是否仅一处进程使用该应用凭证。 |
| 卡片流式更新失败 | 检查开放平台是否授予卡片写入权限；`FEISHU_RAG_CARD_STREAMING` 与权限是否匹配。 |
| 回复无图 / 音频失败 | 检查 `FEISHU_IMAGE_SEND_ENABLED`、MinIO 与上传权限；音频 OPUS 依赖 ffmpeg。 |
| 飞书文档导入返回 400/403 | 检查 Docx/Wiki/素材/画板/Sheets/Base 的只读 scope，并确认已通过「添加文档应用」把目标资源授权给应用。 |

代码入口可参考：`backend/app/integrations/feishu_ws.py`、`feishu_handler.py`、`feishu_rag_card_v2.py`；探活：`backend/app/api/feishu.py`（路由前缀 `/api/feishu`）。

---

## 六、相关链接

- 飞书开放平台：<https://open.feishu.cn/>
- 应用管理与凭证：<https://open.feishu.cn/app>
- 仓库架构说明：[MMA_ARCHITECTURE.md](./MMA_ARCHITECTURE.md)
