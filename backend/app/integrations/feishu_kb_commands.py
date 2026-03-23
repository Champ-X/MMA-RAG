"""
飞书侧：帮助、知识库列表/会话默认/单条作用域、CRUD、入库、画像触发等。
入库结果等仍可用交互卡片推送；知识库列表与 /help 一致走 post+md。
"""

from __future__ import annotations

import asyncio
import re
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

from app.core.logger import get_logger
from app.core.config import settings
from app.integrations.feishu_sessions import (
    clear_feishu_default_kb_ids,
    clear_feishu_pending_kb_delete,
    get_feishu_default_kb_ids,
    get_feishu_pending_kb_delete,
    get_feishu_upload_kb_id,
    set_feishu_default_kb_ids,
    set_feishu_pending_kb_delete,
    set_feishu_upload_kb_id,
)
from app.integrations.feishu_client import (
    feishu_reply_post_md,
    feishu_reply_text,
    feishu_send_interactive_to_chat,
    feishu_send_text_to_chat,
)
from app.integrations.feishu_md_post import feishu_normalize_markdown_for_post

if TYPE_CHECKING:
    from lark_oapi import Client

logger = get_logger(__name__)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)
_PER_MSG_KB_RES = (
    re.compile(r"^\s*\(kb:([^)]+)\)\s*", re.I),
    re.compile(r"^\s*【kb[:：]\s*([^】]+)】\s*"),
)
_CONFIRM_DEL_RE = re.compile(r"^\s*确认删除\s+([A-Za-z0-9]{6})\s*$", re.I)
_NL_SET_KB_RES = (
    re.compile(r"^(?:设置知识库|知识库设为)[:：]?\s*(.+)$", re.I),
)

_INGEST_EXT = frozenset(
    {
        ".pdf",
        ".doc",
        ".docx",
        ".ppt",
        ".pptx",
        ".txt",
        ".md",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".tiff",
        ".tif",
        ".mp3",
        ".wav",
        ".m4a",
        ".flac",
        ".aac",
        ".ogg",
        ".wma",
        ".opus",
        ".mp4",
        ".avi",
        ".mov",
        ".mkv",
        ".webm",
        ".flv",
        ".wmv",
        ".m4v",
    }
)


def feishu_file_looks_ingestible(filename: str, raw: bytes) -> bool:
    if not raw:
        return False
    suf = Path(filename or "").suffix.lower()
    if suf and suf in _INGEST_EXT:
        return True
    if len(raw) >= 5 and raw[:5] == b"%PDF-":
        return True
    if len(raw) >= 4 and raw[:4] == b"\xd0\xcf\x11\xe0":
        return True
    if len(raw) >= 2 and raw[:2] == b"PK":
        return True
    return False


def strip_per_message_kb_scope(query: str) -> Tuple[Optional[str], str]:
    q = query or ""
    for rx in _PER_MSG_KB_RES:
        m = rx.match(q)
        if m:
            return (m.group(1).strip(), rx.sub("", q).strip())
    return (None, q.strip())


def merge_feishu_kb_context(
    *,
    per_message_kb_ids: Optional[List[str]],
    session_key: str,
) -> Optional[Dict[str, Any]]:
    if per_message_kb_ids:
        return {"kb_ids": per_message_kb_ids, "kb_names": []}
    sids = get_feishu_default_kb_ids(session_key)
    if sids:
        return {"kb_ids": sids, "kb_names": []}
    raw = (settings.feishu_default_kb_ids or "").strip()
    if raw:
        ids = [x.strip() for x in raw.split(",") if x.strip()]
        if ids:
            return {"kb_ids": ids, "kb_names": []}
    return None


def _kb_svc():
    from app.api.knowledge import kb_service

    return kb_service


async def _list_kb_dicts() -> List[Dict[str, Any]]:
    return await _kb_svc().list_knowledge_bases(user_id=None)


async def resolve_kb_identifier(token: str) -> Tuple[Optional[str], str]:
    t = (token or "").strip()
    if not t:
        return None, "知识库标识为空"
    if _UUID_RE.match(t):
        kb = await _kb_svc().get_knowledge_base(t)
        if kb:
            return t, ""
        return None, f"未找到 ID 为 `{t}` 的知识库"

    kbs = await _list_kb_dicts()
    name_lower = t.lower()
    exact = [kb for kb in kbs if (kb.get("name") or "").strip().lower() == name_lower]
    if len(exact) == 1:
        return str(exact[0]["id"]), ""
    if len(exact) > 1:
        return None, f"名称 `{t}` 匹配到多个知识库，请改用完整 ID"

    prefix = [kb for kb in kbs if (kb.get("name") or "").lower().startswith(name_lower)]
    if len(prefix) == 1:
        return str(prefix[0]["id"]), ""
    if len(prefix) > 1:
        names = ", ".join((k.get("name") or k["id"])[:20] for k in prefix[:5])
        return None, f"名称前缀 `{t}` 不唯一（如：{names}…），请写全名或 UUID"

    return None, f"未找到名为「{t}」的知识库，使用 `/kb` 查看列表"


async def resolve_kb_ids_multi(spec: str) -> Tuple[Optional[List[str]], str]:
    parts = [p.strip() for p in (spec or "").split(",") if p.strip()]
    if not parts:
        return None, "未指定知识库"
    ids: List[str] = []
    for p in parts:
        kid, err = await resolve_kb_identifier(p)
        if not kid:
            return None, err
        ids.append(kid)
    # 去重保序
    seen: set = set()
    out: List[str] = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out, ""


async def resolve_per_message_kb_ids(token: str) -> Tuple[Optional[List[str]], str]:
    return await resolve_kb_ids_multi(token)


def _help_md() -> str:
    return """## 飞书指令说明

**检索**：直接发问题即可；可先发图片/语音再发文字（短延迟内会合并）。

**单条指定知识库**（仅本次提问生效）：
- 开头写 `(kb:知识库ID或名称)` 或 `【kb：名称】` 再接问题。

**会话默认知识库**（覆盖 `.env` 默认，直至清除）：
- `/kb set 名称或ID` 或多库：`/kb set id1,id2`
- `/kb clear` 清除会话默认
- 自然语言：`设置知识库：名称` / `知识库设为：名称`

**知识库列表**：`/kb` 或 `/知识库`

**新建**：`/kb create 名称 | 描述（可选）`

**删除**（二次确认）：
1. `/kb delete 名称或ID`
2. 按提示回复：`确认删除 XXXXXX`（6 位验证码）

**改元数据**：`/kb update 名称或ID name=新名 desc=新描述 tags=a,b`

**文件入库**：`/入库 名称或ID` 后，再发 **文件**（pdf/Office/图片/音视频等）；`/入库 clear` 取消目标库。受理后会再发一条处理结果。

**主题画像再生**：`/kb portrait 名称或ID`（大库可能较久，优先走异步任务）

**帮助**：`/help` / `帮助`
"""


# 飞书里「行内代码灰底」来自 **post 消息的 md 节点**，不是交互卡片：
# - post：`msg_type=post`，content 内 zh_cn.content 含 `{"tag":"md","text":"..."}`（见 feishu_client._post_md_content），
#   客户端按富文本 Markdown 渲染，支持 **粗体**、`-` 列表、`` `行内代码` `` 等（与 /help 相同）。
# - 交互卡片 `elements[].text.tag=lark_md` 是另一套解析器，列表/反引号常不生效，故知识库列表不优先用它。


async def _reply_md_or_text(
    client: "Client", *, message_id: str, md: str, reply_in_thread: bool
) -> None:
    body = md.strip()
    if settings.feishu_reply_post_md:
        ok = await feishu_reply_post_md(
            client,
            message_id=message_id,
            markdown=body,
            reply_in_thread=reply_in_thread,
        )
        if ok:
            return
    await feishu_reply_text(
        client,
        message_id=message_id,
        text=body,
        reply_in_thread=reply_in_thread,
    )


def _kb_list_name_plain(name_or_id: Any, max_len: int = 80) -> str:
    """名称写入 `**...**` 前去掉 **，避免打断粗体。"""
    t = str(name_or_id or "").replace("\r", " ").replace("\n", " ")
    t = " ".join(t.split()).replace("**", "∗∗").strip()
    return t[:max_len] if max_len else t


def _kb_list_post_md(kbs: List[Dict[str, Any]]) -> str:
    """与 /help 相同走 post+md：每库一行「列表 + 行内代码」，紧凑且 ID 有灰底。"""
    lines = [
        "### 知识库列表",
        "",
    ]
    for kb in kbs[:40]:
        nm = _kb_list_name_plain(kb.get("name") or kb["id"])
        kid = str(kb.get("id") or "").strip().replace("`", "'")
        lines.append(f"- **{nm}** `{kid}`")
    if len(kbs) > 40:
        lines.append("")
        lines.append(f"… 共 **{len(kbs)}** 个，此处仅列出前 40 个。")
    return "\n".join(lines)


async def _try_reply_kb_list(
    client: "Client", *, message_id: str, reply_in_thread: bool
) -> None:
    kbs = await _list_kb_dicts()
    if not kbs:
        await feishu_reply_text(
            client,
            message_id=message_id,
            text="当前还没有知识库，可用 `/kb create 名称` 创建。",
            reply_in_thread=reply_in_thread,
        )
        return
    md = feishu_normalize_markdown_for_post(_kb_list_post_md(kbs))
    await _reply_md_or_text(
        client,
        message_id=message_id,
        md=md,
        reply_in_thread=reply_in_thread,
    )


async def _handle_confirm_delete(
    client: "Client",
    *,
    message_id: str,
    session_key: str,
    text: str,
    reply_in_thread: bool,
) -> bool:
    m = _CONFIRM_DEL_RE.match(text.strip())
    if not m:
        return False
    tok = m.group(1).upper()
    pending = get_feishu_pending_kb_delete(session_key)
    if not pending:
        await feishu_reply_text(
            client,
            message_id=message_id,
            text="没有待确认删除的知识库，请先使用 `/kb delete 名称或ID`。",
            reply_in_thread=reply_in_thread,
        )
        return True
    exp = float(pending.get("expires_at") or 0)
    if time.time() > exp:
        clear_feishu_pending_kb_delete(session_key)
        await feishu_reply_text(
            client,
            message_id=message_id,
            text="确认已过期，请重新执行 `/kb delete`。",
            reply_in_thread=reply_in_thread,
        )
        return True
    if str(pending.get("token") or "").upper() != tok:
        await feishu_reply_text(
            client,
            message_id=message_id,
            text="验证码不匹配，请核对大小写与空格后重试。",
            reply_in_thread=reply_in_thread,
        )
        return True
    kb_id = str(pending.get("kb_id") or "")
    clear_feishu_pending_kb_delete(session_key)
    ok = await _kb_svc().delete_knowledge_base(kb_id)
    if ok:
        await feishu_reply_text(
            client,
            message_id=message_id,
            text=f"已删除知识库 `{kb_id}`。",
            reply_in_thread=reply_in_thread,
        )
    else:
        await feishu_reply_text(
            client,
            message_id=message_id,
            text="删除失败：知识库不存在或已被删除。",
            reply_in_thread=reply_in_thread,
        )
    return True


def _parse_update_kv(rest: str) -> Dict[str, Any]:
    """解析 name=xx desc=yy tags=a,b（空格分隔，值可含空格至下一 key=）"""
    out: Dict[str, Any] = {}
    if not rest.strip():
        return out
    pattern = re.compile(
        r"(name|desc|description|tags)\s*=\s*",
        re.I,
    )

    def _norm_key(k: str) -> str:
        k = k.lower()
        if k == "description":
            return "desc"
        return k

    ms = list(pattern.finditer(rest))
    for i, m in enumerate(ms):
        key = _norm_key(m.group(1))
        start = m.end()
        end = ms[i + 1].start() if i + 1 < len(ms) else len(rest)
        val = rest[start:end].strip()
        if key == "tags":
            out["tags"] = [x.strip() for x in val.split(",") if x.strip()]
        else:
            out[key] = val
    return out


async def handle_feishu_line(
    client: "Client",
    *,
    message_id: str,
    chat_id: str,
    session_key: str,
    text: str,
) -> bool:
    """
    处理管理类指令。返回 True 表示已消费，主流程不应再走 RAG。
    """
    rt = bool(settings.feishu_reply_in_thread)
    raw = (text or "").strip()
    if not raw:
        return False

    if await _handle_confirm_delete(
        client, message_id=message_id, session_key=session_key, text=raw, reply_in_thread=rt
    ):
        return True

    for rx in _NL_SET_KB_RES:
        m = rx.match(raw)
        if m:
            spec = m.group(1).strip()
            ids, err = await resolve_kb_ids_multi(spec)
            if not ids:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=f"无法设置会话知识库：{err}",
                    reply_in_thread=rt,
                )
                return True
            set_feishu_default_kb_ids(session_key, ids)
            await feishu_reply_text(
                client,
                message_id=message_id,
                text=f"已设置本会话默认检索知识库（{len(ids)} 个）：`{', '.join(ids)}`",
                reply_in_thread=rt,
            )
            return True

    low = raw.lower()
    if low in ("/help", "/帮助", "帮助", "help", "/?"):
        await _reply_md_or_text(
            client, message_id=message_id, md=_help_md(), reply_in_thread=rt
        )
        return True

    if low in ("/kb", "/知识库", "/kb list", "/知识库 list"):
        await _try_reply_kb_list(client, message_id=message_id, reply_in_thread=rt)
        return True

    parts = raw.split(maxsplit=2)
    head = parts[0].lower() if parts else ""

    if head in ("/kb", "/知识库") and len(parts) >= 2:
        sub = parts[1].lower()
        rest = parts[2] if len(parts) > 2 else ""

        if sub in ("set", "use", "绑定"):
            spec = rest.strip()
            ids, err = await resolve_kb_ids_multi(spec)
            if not ids:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=f"无法解析知识库：{err}",
                    reply_in_thread=rt,
                )
                return True
            set_feishu_default_kb_ids(session_key, ids)
            await feishu_reply_text(
                client,
                message_id=message_id,
                text=f"已设置本会话默认检索：`{', '.join(ids)}`",
                reply_in_thread=rt,
            )
            return True

        if sub in ("clear", "reset", "清除"):
            clear_feishu_default_kb_ids(session_key)
            await feishu_reply_text(
                client,
                message_id=message_id,
                text="已清除本会话默认知识库，将回退到环境变量 FEISHU_DEFAULT_KB_IDS（若已配置）。",
                reply_in_thread=rt,
            )
            return True

        if sub == "create" and rest.strip():
            name_part = rest.strip()
            desc = ""
            if "|" in name_part:
                name_part, desc = [x.strip() for x in name_part.split("|", 1)]
            if not name_part:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text="用法：`/kb create 名称 | 描述（可选）`",
                    reply_in_thread=rt,
                )
                return True
            meta = {"tags": []} if False else None
            created = await _kb_svc().create_knowledge_base(
                name=name_part,
                description=desc,
                metadata=None,
            )
            kid = created["id"]
            await feishu_reply_text(
                client,
                message_id=message_id,
                text=f"已创建知识库 **{name_part}**，ID：`{kid}`",
                reply_in_thread=rt,
            )
            return True

        if sub == "delete" and rest.strip():
            kid, err = await resolve_kb_identifier(rest.strip())
            if not kid:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=f"无法删除：{err}",
                    reply_in_thread=rt,
                )
                return True
            kb = await _kb_svc().get_knowledge_base(kid)
            name = (kb or {}).get("name") or kid
            token = secrets.token_hex(3).upper()
            set_feishu_pending_kb_delete(
                session_key,
                {
                    "token": token,
                    "kb_id": kid,
                    "name": name,
                    "expires_at": time.time() + 600,
                },
            )
            await feishu_reply_text(
                client,
                message_id=message_id,
                text=(
                    f"即将删除知识库 **{name}**（`{kid}`）。\n"
                    f"确认请 **10 分钟内** 回复：`确认删除 {token}`\n"
                    "（区分大小写，验证码为大写十六进制）"
                ),
                reply_in_thread=rt,
            )
            return True

        if sub == "update" and rest.strip():
            bits = rest.strip().split(None, 1)
            target = bits[0]
            kv_rest = bits[1] if len(bits) > 1 else ""
            kid, err = await resolve_kb_identifier(target)
            if not kid:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=f"无法更新：{err}",
                    reply_in_thread=rt,
                )
                return True
            kv = _parse_update_kv(kv_rest)
            if not kv:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text="用法：`/kb update 名称或ID name=新名 desc=描述 tags=a,b`",
                    reply_in_thread=rt,
                )
                return True
            kb_row = await _kb_svc().get_knowledge_base(kid)
            upd_name = kv.get("name")
            upd_desc = kv.get("desc")
            tags_upd = kv.get("tags")
            meta_arg = None
            if tags_upd is not None:
                meta = dict((kb_row or {}).get("metadata") or {})
                meta["tags"] = tags_upd
                meta_arg = meta
            result = await _kb_svc().update_knowledge_base(
                kb_id=kid,
                name=upd_name,
                description=upd_desc,
                metadata=meta_arg,
            )
            if not result:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text="更新失败：知识库不存在。",
                    reply_in_thread=rt,
                )
                return True
            await feishu_reply_text(
                client,
                message_id=message_id,
                text=f"已更新知识库 `{kid}`。",
                reply_in_thread=rt,
            )
            return True

        if sub in ("portrait", "画像") and rest.strip():
            kid, err = await resolve_kb_identifier(rest.strip())
            if not kid:
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=f"无法触发画像：{err}",
                    reply_in_thread=rt,
                )
                return True
            try:
                discovered = await _kb_svc()._discover_kb_id_from_bucket_async(kid)
                effective = discovered or kid
            except Exception:
                effective = kid
            try:
                from app.modules.knowledge.portraits import build_kb_portrait_task

                build_kb_portrait_task.delay(effective, True)
                await feishu_reply_text(
                    client,
                    message_id=message_id,
                    text=(
                        f"已提交知识库主题画像再生任务（`{effective}`）。"
                        "完成后可重试检索；若长时间无结果请查看服务端/Celery 日志。"
                    ),
                    reply_in_thread=rt,
                )
            except Exception as e:
                logger.warning(f"飞书画像异步触发失败，尝试同步: {e}")
                from app.modules.knowledge.portraits import PortraitGenerator

                gen = PortraitGenerator()
                result = await gen.update_kb_portrait(effective, force_update=True)
                st = result.get("status")
                if st == "insufficient_data":
                    await feishu_reply_text(
                        client,
                        message_id=message_id,
                        text=result.get("message", "数据量不足，无法生成画像"),
                        reply_in_thread=rt,
                    )
                else:
                    await feishu_reply_text(
                        client,
                        message_id=message_id,
                        text=f"画像已更新完成（clusters≈{result.get('clusters', 0)}）。",
                        reply_in_thread=rt,
                    )
            return True

    if head in ("/入库", "/upload"):
        rest_p = raw.split(maxsplit=1)
        arg = rest_p[1].strip() if len(rest_p) > 1 else ""
        if not arg or arg.lower() in ("clear", "reset", "取消"):
            set_feishu_upload_kb_id(session_key, None)
            await feishu_reply_text(
                client,
                message_id=message_id,
                text="已取消「文件入库」目标知识库。",
                reply_in_thread=rt,
            )
            return True
        kid, err = await resolve_kb_identifier(arg)
        if not kid:
            await feishu_reply_text(
                client,
                message_id=message_id,
                text=f"无法绑定入库目标：{err}",
                reply_in_thread=rt,
            )
            return True
        set_feishu_upload_kb_id(session_key, kid)
        await feishu_reply_text(
            client,
            message_id=message_id,
            text=(
                f"已指定入库知识库：`{kid}`。\n请接着发送 **文件消息**（pdf/Office/图片/音视频等）。"
                "处理完成后会再发一条结果通知。"
            ),
            reply_in_thread=rt,
        )
        return True

    if head in ("/画像",):
        remainder = raw[len(parts[0]) :].strip() if parts else ""
        if remainder:
            return await handle_feishu_line(
                client,
                message_id=message_id,
                chat_id=chat_id,
                session_key=session_key,
                text=f"/kb portrait {remainder}",
            )

    return False


async def feishu_run_ingest_and_notify(
    client: "Client",
    *,
    chat_id: str,
    kb_id: str,
    filename: str,
    raw: bytes,
) -> None:
    """异步：入库完成后向会话推送交互卡片（失败则纯文本）。"""
    from app.modules.ingestion.service import get_ingestion_service

    fn = filename or "upload.bin"
    try:
        ing = get_ingestion_service()
        result = await ing.process_file_upload(
            file_content=raw,
            file_path=fn,
            kb_id=kb_id,
            user_id=None,
        )
        fid = result.get("file_id", "")
        chunks = result.get("chunks_processed", "")
        vec = result.get("vectors_stored", "")
        line = (
            f"**入库完成** `{fn}` → 知识库 `{kb_id}`\n"
            f"- file_id: `{fid}`\n"
            f"- chunks: {chunks}  vectors: {vec}"
        )
        card = {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "green",
                "title": {"tag": "plain_text", "content": "入库完成"},
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": line[:8000]},
                }
            ],
        }
        ok = await feishu_send_interactive_to_chat(client, chat_id=chat_id, card=card)
        if not ok:
            plain = line.replace("**", "").replace("`", "")
            await feishu_send_text_to_chat(client, chat_id=chat_id, text=plain)
    except Exception as e:
        err = str(e).strip() or type(e).__name__
        logger.warning(f"飞书入库失败: {e}", exc_info=True)
        fail_card = {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "red",
                "title": {"tag": "plain_text", "content": "入库失败"},
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {
                        "tag": "lark_md",
                        "content": f"`{fn}`\n{err[:2000]}",
                    },
                }
            ],
        }
        if not await feishu_send_interactive_to_chat(client, chat_id=chat_id, card=fail_card):
            await feishu_send_text_to_chat(
                client,
                chat_id=chat_id,
                text=f"入库失败 {fn}：{err[:500]}",
            )


def schedule_feishu_ingest_task(
    client: "Client",
    *,
    chat_id: str,
    kb_id: str,
    filename: str,
    raw: bytes,
) -> None:
    asyncio.create_task(
        feishu_run_ingest_and_notify(
            client,
            chat_id=chat_id,
            kb_id=kb_id,
            filename=filename,
            raw=raw,
        )
    )
