"""
飞书 CardKit OpenAPI（卡片实体创建、流式更新正文、关闭 streaming_mode）。

需应用权限：cardkit:card:write；与创建实体相同的 tenant_access_token。
文档：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/cardkit-v1/card/create
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

import httpx

from app.core.logger import get_logger

logger = get_logger(__name__)

FEISHU_TENANT_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
FEISHU_CARDKIT_BASE = "https://open.feishu.cn/open-apis/cardkit/v1/cards"


def feishu_tenant_access_token_sync(*, app_id: str, app_secret: str) -> Optional[str]:
    if not app_id or not app_secret:
        return None
    try:
        with httpx.Client(timeout=20.0) as hc:
            r = hc.post(
                FEISHU_TENANT_TOKEN_URL,
                json={"app_id": app_id, "app_secret": app_secret},
            )
            r.raise_for_status()
            j = r.json()
            if j.get("code") != 0:
                logger.warning(f"飞书 tenant_token 失败: {j}")
                return None
            t = j.get("tenant_access_token")
            return str(t) if t else None
    except Exception as e:
        logger.warning(f"飞书 tenant_token 异常: {e}")
        return None


def feishu_cardkit_create_card_sync(
    *, token: str, card: Dict[str, Any]
) -> Optional[str]:
    """POST /cardkit/v1/cards，返回 card_id。"""
    payload = {"type": "card_json", "data": json.dumps(card, ensure_ascii=False)}
    try:
        with httpx.Client(timeout=30.0) as hc:
            r = hc.post(
                FEISHU_CARDKIT_BASE,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json; charset=utf-8",
                },
                json=payload,
            )
            j = r.json()
            if j.get("code") != 0:
                logger.warning(
                    f"飞书 cardkit 创建卡片失败: code={j.get('code')} msg={j.get('msg')!r}"
                )
                return None
            data = j.get("data") or {}
            cid = data.get("card_id")
            return str(cid) if cid else None
    except Exception as e:
        logger.warning(f"飞书 cardkit 创建卡片异常: {e}", exc_info=True)
        return None


def feishu_cardkit_put_element_content_sync(
    *,
    token: str,
    card_id: str,
    element_id: str,
    content: str,
    sequence: int,
) -> bool:
    """PUT …/elements/:element_id/content（全量正文 + 递增 sequence）。"""
    url = f"{FEISHU_CARDKIT_BASE}/{card_id}/elements/{element_id}/content"
    body = {"content": content, "sequence": int(sequence)}
    try:
        with httpx.Client(timeout=30.0) as hc:
            r = hc.put(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json; charset=utf-8",
                },
                json=body,
            )
            j = r.json()
            if j.get("code") != 0:
                logger.warning(
                    f"飞书 cardkit 流式更新失败: element_id={element_id!r} "
                    f"code={j.get('code')} msg={j.get('msg')!r}"
                )
                return False
            return True
    except Exception as e:
        logger.warning(f"飞书 cardkit 流式更新异常: {e}", exc_info=True)
        return False


def feishu_cardkit_patch_settings_sync(
    *,
    token: str,
    card_id: str,
    settings: Dict[str, Any],
    sequence: int,
) -> bool:
    """PATCH …/settings，例如关闭 streaming_mode。"""
    url = f"{FEISHU_CARDKIT_BASE}/{card_id}/settings"
    body = {
        "settings": json.dumps(settings, ensure_ascii=False),
        "sequence": int(sequence),
    }
    try:
        with httpx.Client(timeout=30.0) as hc:
            r = hc.patch(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json; charset=utf-8",
                },
                json=body,
            )
            j = r.json()
            if j.get("code") != 0:
                logger.warning(
                    f"飞书 cardkit 更新配置失败: code={j.get('code')} msg={j.get('msg')!r}"
                )
                return False
            return True
    except Exception as e:
        logger.warning(f"飞书 cardkit 更新配置异常: {e}", exc_info=True)
        return False


def feishu_upload_im_file_with_duration_sync(
    *,
    token: str,
    file_bytes: bytes,
    filename: str,
    file_type: str,
    duration_ms: int,
) -> Optional[str]:
    """multipart 上传 im/v1/files（OPUS 等需带 duration 毫秒）。"""
    if not file_bytes:
        return None
    url = "https://open.feishu.cn/open-apis/im/v1/files"
    fn = (filename or "file.bin").strip() or "file.bin"
    try:
        with httpx.Client(timeout=120.0) as hc:
            r = hc.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                files={
                    "file": (fn, file_bytes, "application/octet-stream"),
                },
                data={
                    "file_type": file_type,
                    "file_name": fn,
                    "duration": str(max(1, int(duration_ms))),
                },
            )
            j = r.json()
            if j.get("code") != 0:
                logger.warning(
                    f"飞书上传文件(含时长)失败: code={j.get('code')} msg={j.get('msg')!r}"
                )
                return None
            data = j.get("data") or {}
            fk = data.get("file_key")
            return str(fk) if fk else None
    except Exception as e:
        logger.warning(f"飞书上传文件(含时长)异常: {e}", exc_info=True)
        return None
