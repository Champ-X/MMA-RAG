"""
飞书交互卡片 JSON（msg_type=interactive）。

- 主面板等仍可用 JSON 1.0（根级 elements + 按钮 value.cmd）。
- 含输入框 / 表单提交的子卡片须用 JSON 2.0：schema=2.0、body.elements，表单项放在 tag=form 内，
  提交按钮需 form_action_type=submit 且 behaviors 含 type=callback（回传 cmd）。
  见 feishu_handler.on_card_action_sync（form_value / value）。
"""

from __future__ import annotations

from typing import Any, Dict, List


def _btn(text: str, cmd: str, btn_type: str = "default") -> Dict[str, Any]:
    return {
        "tag": "button",
        "text": {"tag": "plain_text", "content": text},
        "type": btn_type,
        "value": {"cmd": cmd},
    }


def _action_row(actions: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"tag": "action", "actions": actions}


def _hr() -> Dict[str, Any]:
    return {"tag": "hr"}


def _lark_md(content: str) -> Dict[str, Any]:
    return {
        "tag": "div",
        "text": {"tag": "lark_md", "content": content.strip()},
    }


def _section_label(text: str) -> Dict[str, Any]:
    return _lark_md(f"**{text}**")


def _tip_note(content: str) -> Dict[str, Any]:
    return {
        "tag": "note",
        "elements": [{"tag": "plain_text", "content": content}],
    }


def _markdown_v2(content: str) -> Dict[str, Any]:
    """卡片 JSON 2.0 正文 Markdown（与 1.0 的 div+lark_md 不同）。"""
    return {
        "tag": "markdown",
        "content": content.strip(),
        "text_align": "left",
        "text_size": "normal",
    }


def _form_submit_button(
    *, text: str, cmd: str, btn_type: str, name: str
) -> Dict[str, Any]:
    """表单内提交按钮：触发 card.action.trigger，value 中带 cmd。"""
    return {
        "tag": "button",
        "type": btn_type,
        "text": {"tag": "plain_text", "content": text},
        "behaviors": [{"type": "callback", "value": {"cmd": cmd}}],
        "form_action_type": "submit",
        "name": name,
    }


def _options_from_kbs(kbs: List[Dict[str, Any]], max_n: int = 35) -> List[Dict[str, Any]]:
    opts: List[Dict[str, Any]] = []
    for kb in kbs[:max_n]:
        kid = str(kb.get("id") or "").strip()
        if not kid:
            continue
        nm = (kb.get("name") or kid)[:56]
        opts.append(
            {
                "text": {"tag": "plain_text", "content": nm},
                "value": kid,
            }
        )
    return opts


def build_kb_create_form_card() -> dict:
    """创建知识库：JSON 2.0 表单容器内 input + 提交（回传 form_value.kb_name / kb_desc）。"""
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "green",
            "title": {"tag": "plain_text", "content": "创建知识库"},
            "subtitle": {"tag": "plain_text", "content": "在卡片内填写后提交"},
        },
        "body": {
            "elements": [
                _markdown_v2(
                    "填写 **名称**（必填）与 **描述**（可选），点击 **提交创建**。"
                ),
                {
                    "tag": "form",
                    "name": "kb_create_form",
                    "elements": [
                        {
                            "tag": "input",
                            "name": "kb_name",
                            "width": "fill",
                            "required": True,
                            "placeholder": {
                                "tag": "plain_text",
                                "content": "知识库名称（必填）",
                            },
                            "default_value": "",
                        },
                        {
                            "tag": "input",
                            "name": "kb_desc",
                            "width": "fill",
                            "required": False,
                            "placeholder": {
                                "tag": "plain_text",
                                "content": "描述（可选）",
                            },
                            "default_value": "",
                        },
                        _form_submit_button(
                            text="✅ 提交创建",
                            cmd="kb_create_submit",
                            btn_type="primary",
                            name="btn_kb_create_submit",
                        ),
                    ],
                },
            ],
        },
    }


def build_kb_dropdown_action_card(
    *,
    header_template: str,
    title: str,
    subtitle: str,
    hint_md: str,
    submit_cmd: str,
    submit_text: str,
    btn_type: str,
    kbs: List[Dict[str, Any]],
    max_options: int = 35,
) -> dict:
    """通用：JSON 2.0 表单内 select_static + 提交（form_value.kb_id）。"""
    opts = _options_from_kbs(kbs, max_options)
    if not opts:
        raise ValueError("knowledge base list empty")
    form_name = f"form_{submit_cmd}"
    btn_name = f"btn_{submit_cmd}"[:40]
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "template": header_template,
            "title": {"tag": "plain_text", "content": title},
            "subtitle": {"tag": "plain_text", "content": subtitle},
        },
        "body": {
            "elements": [
                _markdown_v2(hint_md),
                {
                    "tag": "form",
                    "name": form_name,
                    "elements": [
                        {
                            "tag": "select_static",
                            "name": "kb_id",
                            "placeholder": {
                                "tag": "plain_text",
                                "content": "请选择知识库",
                            },
                            "options": opts,
                            "type": "default",
                            "width": "fill",
                            "required": True,
                        },
                        _form_submit_button(
                            text=submit_text,
                            cmd=submit_cmd,
                            btn_type=btn_type,
                            name=btn_name,
                        ),
                    ],
                },
            ],
        },
    }


def build_kb_delete_select_card(kbs: List[Dict[str, Any]]) -> dict:
    return build_kb_dropdown_action_card(
        header_template="red",
        title="删除知识库",
        subtitle="下拉选择 → 获取验证码",
        hint_md=(
            "请选择要删除的知识库，点按钮后将提示 **确认删除 + 验证码**。\n"
            "（若列表不全，请用 `/kb` 看完整 ID 后走 `/kb delete`）"
        ),
        submit_cmd="kb_delete_submit",
        submit_text="下一步：获取验证码",
        btn_type="danger",
        kbs=kbs,
    )


def build_kb_set_default_select_card(kbs: List[Dict[str, Any]]) -> dict:
    return build_kb_dropdown_action_card(
        header_template="blue",
        title="设置默认检索",
        subtitle="本会话优先检索该库",
        hint_md=(
            "**单选**一个知识库。需要绑定 **多个** 时请在输入框发送：\n"
            "`/kb set 名称或ID1,名称或ID2`"
        ),
        submit_cmd="kb_set_default_submit",
        submit_text="设为默认",
        btn_type="primary",
        kbs=kbs,
    )


def build_kb_upload_target_select_card(kbs: List[Dict[str, Any]]) -> dict:
    return build_kb_dropdown_action_card(
        header_template="blue",
        title="选择入库目标",
        subtitle="绑定后发送文件消息",
        hint_md=(
            "选择要写入的知识库并点确认；**再在会话里单独发一条文件消息**（飞书卡片不支持在卡片里同时选文件并提交）。\n"
            "支持 pdf / Office / 图片 / 音视频等。取消绑定：`/入库 clear`"
        ),
        submit_cmd="kb_upload_bind_submit",
        submit_text="确认绑定目标库",
        btn_type="primary",
        kbs=kbs,
    )


def build_kb_update_form_card(kbs: List[Dict[str, Any]], max_options: int = 35) -> dict:
    """修改元数据：表单内下拉选库 + 可选输入新名称/描述/标签（JSON 2.0）。"""
    opts = _options_from_kbs(kbs, max_options)
    if not opts:
        raise ValueError("knowledge base list empty")
    return {
        "schema": "2.0",
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "orange",
            "title": {"tag": "plain_text", "content": "修改知识库元数据"},
            "subtitle": {"tag": "plain_text", "content": "选库后填写要改的项目"},
        },
        "body": {
            "elements": [
                _markdown_v2(
                    "至少填写 **新名称**、**新描述**、**标签** 中的一项；未填的项保持原样。\n"
                    "标签为英文逗号分隔；列表仅展示前若干条，完整 ID 见 `/kb`。"
                ),
                {
                    "tag": "form",
                    "name": "kb_update_form",
                    "elements": [
                        {
                            "tag": "select_static",
                            "name": "kb_id",
                            "placeholder": {
                                "tag": "plain_text",
                                "content": "请选择要修改的知识库",
                            },
                            "options": opts,
                            "type": "default",
                            "width": "fill",
                            "required": True,
                        },
                        {
                            "tag": "input",
                            "name": "kb_new_name",
                            "width": "fill",
                            "required": False,
                            "placeholder": {
                                "tag": "plain_text",
                                "content": "新名称（可选）",
                            },
                            "default_value": "",
                        },
                        {
                            "tag": "input",
                            "name": "kb_new_desc",
                            "width": "fill",
                            "required": False,
                            "placeholder": {
                                "tag": "plain_text",
                                "content": "新描述（可选）",
                            },
                            "default_value": "",
                        },
                        {
                            "tag": "input",
                            "name": "kb_tags",
                            "width": "fill",
                            "required": False,
                            "placeholder": {
                                "tag": "plain_text",
                                "content": "标签，英文逗号分隔（可选）",
                            },
                            "default_value": "",
                        },
                        _form_submit_button(
                            text="✅ 提交修改",
                            cmd="kb_update_submit",
                            btn_type="primary",
                            name="btn_kb_update_submit",
                        ),
                    ],
                },
            ],
        },
    }


def build_feishu_main_menu_card() -> dict:
    """主操作面板：分区 + 子能力入口（含打开表单/下拉卡片）。"""
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "template": "blue",
            "title": {"tag": "plain_text", "content": "知识库助手"},
            "subtitle": {"tag": "plain_text", "content": "操作面板 · 一键常用能力"},
        },
        "elements": [
            _tip_note(
                "创建 / 删除 / 修改元数据 / 默认检索 / 入库目标 均支持 **子卡片表单**（下拉或输入框）。"
            ),
            _hr(),
            _section_label("🔎 查阅与帮助"),
            _action_row(
                [
                    _btn("📖 使用说明", "help", "default"),
                    _btn("📋 知识库列表", "kb_list", "primary"),
                ]
            ),
            _hr(),
            _section_label("📚 知识库管理"),
            _action_row(
                [
                    _btn("➕ 创建知识库", "open_kb_create_card", "primary"),
                    _btn("🗑️ 删除知识库", "open_kb_delete_card", "danger"),
                ]
            ),
            _action_row(
                [
                    _btn("✏️ 修改元数据", "open_kb_update_card", "default"),
                    _btn("📌 当前会话知识库", "session_kb", "default"),
                ]
            ),
            _hr(),
            _section_label("⚙️ 本会话检索范围"),
            _action_row(
                [
                    _btn("🎯 设置默认检索", "open_kb_set_default_card", "default"),
                    _btn("🧹 清除会话默认库", "kb_clear", "default"),
                ]
            ),
            _hr(),
            _section_label("📎 文件入库"),
            _action_row(
                [
                    _btn("📁 选择入库目标", "open_kb_upload_card", "primary"),
                    _btn("❓ 入库步骤说明", "upload_tip", "default"),
                ]
            ),
            _hr(),
            _lark_md(
                "💡 **检索**：在下方输入框直接发问题即可。  \n"
                "✨ **命令行**：仍可使用 `/kb update 名称或ID name=… desc=… tags=…`。"
            ),
            _action_row(
                [
                    _btn("🔄 刷新面板", "menu_refresh", "primary"),
                    _btn("📋 知识库列表", "kb_list", "default"),
                ]
            ),
        ],
    }
