> **相关文档**：[WebSocket 长连接接入方案](./飞书接入方案分析-websocket.md)（免公网回调、适合内网/本地调试；与本文二选一配置事件订阅）。

现在我对项目已有全面理解，可以给出详细的飞书接入分析。

---

## 飞书接入方案分析（Webhook）

### 一、核心挑战：推拉模式差异

当前 Web 端是**拉取模式**（前端主动请求 → SSE 流式接收），而飞书机器人是**推送模式**：

```
飞书服务器 → POST 推送消息到你的 Webhook → 你处理后调飞书 API 回复
```

两个关键约束：
1. **飞书要求你在 3 秒内返回 HTTP 200**，但 RAG 检索+生成通常需要 5~30 秒
2. **不支持 SSE**，必须生成完整答案后调用飞书消息 API 发送

---

### 二、整体架构设计

```
飞书用户 → 发消息到机器人
    ↓
飞书服务器 POST /api/feishu/webhook
    ↓ (3秒内返回 200)
FastAPI 即刻 ack → 触发后台任务 (asyncio.create_task)
    ↓ (后台异步执行)
RetrievalService.search() ← 复用现有服务
    ↓
GenerationService.generate_response() ← 复用现有服务
    ↓
飞书消息 API → 回复用户
```

---

### 三、需要新增的文件与改动

#### 3.1 新增：飞书 API 客户端 `backend/app/integrations/feishu_client.py`

需要实现以下能力：

```python
# 核心功能
async def get_access_token() -> str:
    """获取 tenant_access_token（有效期2小时，需缓存）"""
    # POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal

async def send_text_message(chat_id: str, text: str):
    """发送文字消息"""
    # POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id

async def send_rich_message(chat_id: str, content: dict):
    """发送富文本/卡片消息（用于展示引用来源）"""
    # 使用飞书消息卡片 JSON 格式

def verify_signature(timestamp: str, nonce: str, body: bytes, secret: str) -> bool:
    """验证飞书推送签名（防伪造请求）"""
    # sha256(timestamp + nonce + encrypt_key + body)
```

#### 3.2 新增：Webhook 路由 `backend/app/api/feishu.py`

```python
@router.post("/webhook")
async def feishu_webhook(request: Request, background_tasks: BackgroundTasks):
    body = await request.body()
    data = await request.json()

    # 1. URL 验证挑战（首次配置时飞书发的验证请求）
    if "challenge" in data:
        return {"challenge": data["challenge"]}

    # 2. 验证签名
    # verify_signature(timestamp, nonce, body, FEISHU_ENCRYPT_KEY)

    # 3. 去重（飞书会重试，header 有 X-Lark-Request-Id）
    # 检查 Redis 中是否已处理过

    # 4. 立即返回 200，后台异步处理
    background_tasks.add_task(handle_feishu_message, data)
    return {"code": 0}


async def handle_feishu_message(event_data: dict):
    """后台处理：检索 → 生成 → 回复飞书"""
    msg = event_data["event"]["message"]
    sender_chat_id = event_data["event"]["sender"]["sender_id"]["open_id"]
    chat_id = msg["chat_id"]
    text = extract_text(msg)  # 解析 text/rich_text 消息

    # 复用现有服务
    retrieval_result = await retrieval_service.search(
        query=text,
        kb_context={"kb_ids": DEFAULT_KB_IDS},
        session_context=get_session_context(chat_id)  # 用 chat_id 做会话管理
    )
    generation_result = await generation_service.generate_response(
        query=text,
        retrieval_result=retrieval_result
    )

    # 构建飞书消息卡片（含引用来源）
    card = build_answer_card(generation_result)
    await feishu_client.send_card_message(chat_id, card)
```

#### 3.3 修改：`backend/app/core/config.py`

在 `Settings` 类中新增飞书凭据配置：

```python
# 飞书机器人配置
feishu_app_id: Optional[str] = Field(default=None, validation_alias="FEISHU_APP_ID")
feishu_app_secret: Optional[str] = Field(default=None, validation_alias="FEISHU_APP_SECRET")
feishu_encrypt_key: Optional[str] = Field(default=None, validation_alias="FEISHU_ENCRYPT_KEY")
feishu_verification_token: Optional[str] = Field(default=None, validation_alias="FEISHU_VERIFICATION_TOKEN")
# 飞书机器人默认使用的知识库 ID（逗号分隔）
feishu_default_kb_ids: str = Field(default="", validation_alias="FEISHU_DEFAULT_KB_IDS")
```

#### 3.4 修改：`backend/app/main.py`

```python
from app.api import feishu
app.include_router(feishu.router, prefix="/api/feishu", tags=["feishu"])
```

---

### 四、关键实现细节

#### 4.1 Token 缓存（重要）

飞书的 `tenant_access_token` 有效期 2 小时，每次请求都去换 Token 会造成不必要的开销，可利用现有 Redis 缓存：

```python
async def get_access_token() -> str:
    # 先查 Redis
    cached = redis_client.get("feishu:access_token")
    if cached:
        return cached
    # 不存在则换取并缓存（7000秒，留余量）
    token = await _fetch_token()
    redis_client.setex("feishu:access_token", 7000, token)
    return token
```

#### 4.2 会话管理

飞书的 `chat_id`（群聊）或 `open_id`（私聊）可以直接映射到现有的 `sessions` 字典：

```python
# 用飞书 chat_id 作为 session_id
session_id = f"feishu_{chat_id}"
session = sessions.get(session_id) or create_session(session_id)
```

#### 4.3 消息卡片格式（引用来源可视化）

飞书支持结构化的消息卡片，可展示 RAG 引用来源：

```json
{
  "type": "template",
  "data": {
    "template_id": "...",
    "template_variable": {
      "answer": "生成的回答文本",
      "references": [
        {"title": "文档A", "source": "第3页"},
        {"title": "文档B", "source": "第7页"}
      ]
    }
  }
}
```

#### 4.4 去重机制（防止飞书重试导致重复回答）

飞书在你没有及时响应时会重试，`X-Lark-Request-Id` 是唯一请求 ID，可利用 Redis 去重：

```python
request_id = request.headers.get("X-Lark-Request-Id")
if redis_client.exists(f"feishu:processed:{request_id}"):
    return {"code": 0}  # 已处理，直接忽略
redis_client.setex(f"feishu:processed:{request_id}", 300, "1")
```

---

### 五、飞书开放平台配置步骤

1. 在[飞书开放平台](https://open.feishu.cn)创建**企业自建应用**
2. 开启**机器人**能力
3. 权限管理中申请：`im:message`（接收消息）、`im:message:send_as_bot`（发消息）
4. 事件订阅 → 添加事件：`im.message.receive_v1`（接收消息）
5. 配置**请求网址**：`https://你的域名/api/feishu/webhook`
   - 注意：飞书要求必须是**公网可访问的 HTTPS** 地址（本地开发可用 ngrok/frp 内网穿透）
6. 设置加密策略，获取 `Encrypt Key` 和 `Verification Token`

---

### 六、与现有架构的对比

| 对比维度 | Web 端（现有） | 飞书机器人（新增） |
|---|---|---|
| **触发方式** | 前端主动 HTTP 请求 | 飞书服务器 POST 推送 |
| **响应模式** | SSE 流式实时输出 | 完整答案后一次性发送 |
| **核心服务复用** | `RetrievalService` + `GenerationService` | ✅ 完全复用，无需修改 |
| **会话管理** | 前端维护 `sessionId` | 后端用 `feishu_chat_id` 映射 |
| **知识库选择** | 前端 UI 手动选择 | 后端配置默认 KB，或指令切换 |
| **媒体内容** | 展示 MinIO 预签名 URL | URL 需公网可访问，或转为文字描述 |
| **超时处理** | 前端可等待 | 必须 3s 内 ack，后台异步处理 |

---

### 七、实施优先级建议

1. **阶段一（核心功能）**：文字问答通路打通（Webhook → RAG → 飞书回复文字）
2. **阶段二（体验优化）**：消息卡片格式、引用来源展示、"正在思考中..." 占位消息
3. **阶段三（高级功能）**：指令切换知识库（`/switch kb_id`）、多模态图片问答、管理员上传文件到知识库

这套方案的最大优势是**零改动现有核心逻辑**，`RetrievalService` 和 `GenerationService` 直接复用，只需新增飞书通道的适配层即可。