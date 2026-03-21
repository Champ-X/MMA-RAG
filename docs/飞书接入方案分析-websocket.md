# 飞书接入方案分析（WebSocket 长连接模式）

> 本文在 [`飞书接入方案分析-webhook.md`](./飞书接入方案分析-webhook.md) 的业务目标与 RAG 复用方式上一致，**仅将事件接收方式从 HTTP Webhook 换为飞书「长连接 / WebSocket」**。二者选其一即可，勿在同一应用上重复配置两套订阅以免重复消费。

---

## 一、与 Webhook 的取舍

| 维度 | Webhook（HTTP 回调） | WebSocket（长连接） |
|------|----------------------|---------------------|
| **公网入口** | 需飞书可访问的 HTTPS URL（常需域名、证书、内网穿透） | **通常只需服务器能访问公网**，由本服务主动连接飞书 |
| **本地/内网调试** | 多依赖 ngrok/frp | **一般更省事** |
| **多实例扩容** | 负载均衡 + 多副本较自然 | 飞书侧为**集群推送**：多连接时**仅随机一条连接**收到事件，需**单消费者**或队列架构 |
| **连接数限制** | 无「连接数」概念 | 单应用有**最大连接数上限**（以[官方文档](https://open.feishu.cn)为准，常见为数十量级） |
| **RAG 耗时长** | 须快速 HTTP 响应 + 后台任务 | **事件处理/确认仍有时限**（常见约 3 秒内），长检索生成必须**异步**，与 Webhook 相同 |
| **回复用户** | IM 开放接口发消息 | 相同，**仍走 HTTP IM API**，WebSocket **不负责**向用户流式吐字（飞书侧非 SSE） |

**结论**：若无法或不愿暴露公网回调地址，优先长连接；若 K8s 多 Pod 无状态水平扩展为主，优先 Webhook 或「**唯一 WS 消费者 + 队列**」。

---

## 二、核心挑战（与 Web 端差异）

当前 Web 端是**浏览器主动请求 + SSE**；飞书侧无论 Webhook 还是 WebSocket，对用户而言都是**服务端事件驱动**：

```
飞书 →（长连接 WebSocket）→ 本服务收到 im.message.receive_v1
    → 尽快完成协议层确认 / handler 快速返回
    → 后台异步：检索 + 生成
    → 调用飞书 IM API 发送文本/卡片
```

两个关键约束（与 Webhook 文档一致）：

1. **事件须在时限内完成处理/确认**（官方长连接说明中常见为约 **3 秒**），而 RAG 全流程常需更久 → **必须异步**（`asyncio.create_task` / 任务队列）。
2. **飞书会话内仍不支持类似网页 SSE 的 token 流**，最终答复以**一条或多条消息**（文本/卡片）发出。

---

## 三、整体架构设计

```
飞书用户 → 发消息给机器人
    ↓
飞书事件服务 → 经 WebSocket 推送到已建立长连接的本进程
    ↓
事件 Handler：解析消息 → 去重 → 投递后台任务（勿阻塞）
    ↓（异步）
RetrievalService.search()  ← 与 Web 端相同，复用现有模块
    ↓
GenerationService.generate_response()  ← 同上
    ↓
feishu_client：tenant_access_token + IM v1 messages → 回复用户
```

与 Webhook 方案的唯一架构差异：**无入站 `POST /webhook`**，改为**进程内（或独立 worker）常驻 WebSocket 客户端**。

---

## 四、需要新增的文件与改动

### 4.1 飞书 API 客户端 `backend/app/integrations/feishu_client.py`

与 Webhook 版**相同部分**：`get_access_token`（建议 Redis 缓存）、`send_text_message`、`send_card_message` / 富文本等 **IM 发送**能力。

**WebSocket 版差异**：

- **可不实现** HTTP 回调专用的 `verify_signature(timestamp, nonce, body)`；长连接场景下加解密/协议帧处理优先交给**官方 SDK**。
- 若自研 WebSocket 协议（不推荐），需严格按[飞书长连接文档](https://open.feishu.cn/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM)实现鉴权、心跳与事件确认。

### 4.2 长连接入口：推荐官方 Python SDK

飞书提供基于 WebSocket 的客户端封装，典型用法（示例仅表达结构，版本以 SDK 为准）：

```python
# 依赖：lark-oapi（包名以官方为准）
import lark_oapi as lark
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1

def on_im_message_receive(data: P2ImMessageReceiveV1) -> None:
    # 1. 快速去重（message_id / event_id + Redis）
    # 2. asyncio.create_task(handle_feishu_message(data))  # 勿在此长时间 await RAG
    pass

event_handler = (
    lark.EventDispatcherHandler.builder("", "")
    .register_p2_im_message_receive_v1(on_im_message_receive)
    .build()
)

# 阻塞式启动长连接（宜放到独立线程或独立进程，避免阻塞 Uvicorn 事件循环）
cli = lark.ws.Client("APP_ID", "APP_SECRET", event_handler=event_handler)
cli.start()
```

**与 FastAPI 集成方式（二选一）**：

1. **lifespan + 后台线程**：在 `lifespan` 启动时在线程中 `cli.start()`，关闭时停止客户端。  
2. **独立进程**：`api` 与 `feishu-ws-worker` 分进程，worker 只负责收事件并调用内部 HTTP/队列触发 RAG（利于多副本时只跑一个 worker）。

### 4.3 可选：运维探活 `backend/app/api/feishu.py`

WebSocket 模式**不依赖** `POST /webhook`。可选增加：

- `GET /api/feishu/ws-status`：最近一次心跳时间、连接是否建立（内存/Redis 标记），仅供运维。

### 4.4 修改：`backend/app/core/config.py`

至少：

```python
feishu_app_id: Optional[str] = Field(default=None, validation_alias="FEISHU_APP_ID")
feishu_app_secret: Optional[str] = Field(default=None, validation_alias="FEISHU_APP_SECRET")
feishu_default_kb_ids: str = Field(default="", validation_alias="FEISHU_DEFAULT_KB_IDS")
# 是否启用长连接（便于本地无飞书环境时关闭）
feishu_ws_enabled: bool = Field(default=False, validation_alias="FEISHU_WS_ENABLED")
```

加密策略若完全走 SDK 长连接，以控制台与 SDK 要求为准；**与 Webhook 混用时**再配置 `FEISHU_ENCRYPT_KEY`、`FEISHU_VERIFICATION_TOKEN`。

### 4.5 修改：`backend/app/main.py`

在 **FastAPI lifespan** 中按 `FEISHU_WS_ENABLED` 启动/停止 WS 客户端；**不要**默认再注册 Webhook 路由（除非明确做双模）。

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    stop_event = asyncio.Event()
    ws_thread = None
    if settings.feishu_ws_enabled:
        ws_thread = start_feishu_ws_in_background_thread(stop_event)
    yield
    stop_event.set()
    # join / stop client
```

（具体线程与 SDK 的 `stop()` 方式以实现时 SDK API 为准。）

### 4.6 业务处理 `handle_feishu_message`（与 Webhook 版逻辑一致）

从事件体解析 `chat_id`、文本内容 → `RetrievalService` + `GenerationService` → `send_*` 回复。会话映射仍建议：

```python
session_id = f"feishu_{chat_id}"
```

---

## 五、关键实现细节

### 5.1 Token 缓存

与 [`飞书接入方案分析-webhook.md`](./飞书接入方案分析-webhook.md) **第 4.1 节相同**：`tenant_access_token` 缓存至 Redis，避免频繁请求。

### 5.2 会话管理

与 Webhook 文档 **4.2 节相同**：用 `chat_id`（或私聊场景下的标识）映射 `sessions`。

### 5.3 消息卡片（引用来源）

与 Webhook 文档 **4.3 节相同**：用卡片模板变量展示 `answer` 与 `references`。

### 5.4 去重（长连接版）

Webhook 使用 `X-Lark-Request-Id`；**长连接应使用事件负载中的唯一键**（以实际回调结构为准，常见为 **`event_id`**、**`message.message_id`** 等）：

```python
def should_skip_duplicate(dedup_key: str, ttl_sec: int = 300) -> bool:
    # Redis SET key NX EX ttl —— 若已存在则跳过
    ...
```

### 5.5 连接存活、重连与部署

- SDK 通常内置**心跳与断线重连**；仍需监控日志，避免静默断连导致长时间无消息。  
- **多副本**：多个进程各建一条长连接时，**同一条用户消息只会被其中一个实例收到**。可选策略：  
  - **仅一个 Pod/进程**启用 `FEISHU_WS_ENABLED`；或  
  - 单独 **feishu-consumer** Deployment，`replicas: 1`；或  
  - consumer 收消息后写入 **Redis Stream / Celery**，由多个 worker 做 RAG（consumer 仍建议单实例）。

---

## 六、飞书开放平台配置步骤（长连接）

1. 在[飞书开放平台](https://open.feishu.cn)创建**企业自建应用**（长连接通常仅支持自建应用，以官方说明为准）。  
2. 开启**机器人**能力。  
3. 权限：`im:message`、`im:message:send_as_bot` 等（与 Webhook 文档一致）。  
4. **事件订阅** → 添加 `im.message.receive_v1`。  
5. 订阅方式选择 **「使用长连接接收事件」**（控制台文案以飞书为准），**无需配置**公网请求 URL。  
6. 本地开发：保证本机可访问 `open.feishu.cn` 相关域名与端口（含 WSS）。

---

## 七、与 Web 端及 Webhook 方案的对比

| 对比维度 | Web 端（现有） | 飞书 Webhook | 飞书 WebSocket（本文） |
|----------|----------------|--------------|-------------------------|
| **事件入口** | 浏览器 → 本服务 API | 飞书 POST 本服务 URL | **本服务 WSS 连飞书** |
| **公网回调** | 不需要 | **需要** | **不需要**（一般） |
| **回复用户** | SSE + 页面渲染 | IM API | IM API |
| **核心 RAG** | `RetrievalService` + `GenerationService` | 复用 | 复用 |
| **超时** | 用户可久等 | HTTP 快速返回 + 异步 | **事件快速确认 + 异步** |

---

## 八、实施优先级建议

1. **阶段一**：长连接打通 → 文本问答（`im.message.receive_v1` → RAG → `send_text`）。  
2. **阶段二**：卡片引用、发送「正在处理…」占位消息（若 IM API 支持且产品需要）。  
3. **阶段三**：指令切换知识库、多模态消息解析、与 Webhook 文档相同的进阶能力。

---

## 九、小结

- WebSocket 长连接解决的是**事件如何进入本服务**（免公网回调、开发便捷），**不替代** IM 发消息 API，也**不解决** RAG 慢的问题——仍依赖异步与去重。  
- 与 [`飞书接入方案分析-webhook.md`](./飞书接入方案分析-webhook.md) 共享同一套 **MMAA-RAG 业务内核**；实现时建议**二选一**订阅方式，并做好**多实例下的消费策略**设计。
