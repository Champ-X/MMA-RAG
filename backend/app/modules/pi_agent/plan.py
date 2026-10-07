"""Agent-owned deliverables and verbatim retained evidence.

The host checks coverage and source identity, never interprets the question or
chooses a recommendation. Retention does not create a new observation.
"""
from __future__ import annotations

import json

from .answers import evidence_units
from .policy import ToolError


def _identities(items):
    return [(item["id"], item["requirement"], item["quote"], item["modality"], item.get("basis", "sources"))
            for item in items]


def bind_plan(items, request, previous, delivered, *, retained_spans=None):
    identities = _identities(items)
    if len({item[0] for item in identities}) != len(items):
        raise ToolError("invalid_answer_plan", "回答要点编号不能重复。")
    if previous and identities[:len(previous["items"])] != _identities(previous["items"]):
        raise ToolError("answer_plan_locked", "既有要点、顺序、用户原句、依据类型和来源类型不可删除或改写；可追加遗漏项，更新证据与进度。")
    user_messages = [request["message"], *(entry["content"] for entry in request.get("history", [])
                                        if entry.get("role") == "user")]
    for item in items:
        if not item["requirement"].strip() or not item["quote"].strip() or item["quote"] not in request["message"]:
            raise ToolError("invalid_answer_plan", "quote必须逐字来自当前用户问题，不能来自资料或你自己的解释。")
        input_quotes = item.get("input_quotes", [])
        if any(not quote.strip() or not any(quote in message for message in user_messages) for quote in input_quotes):
            raise ToolError("invalid_answer_plan", "input_quotes须逐字来自当前或历史用户消息，不能来自助手或工具资料。")
        selected, support = item["evidence_ids"], item["supporting_evidence_ids"]
        if len(set(selected)) != len(selected) or len(set(support)) != len(support):
            raise ToolError("invalid_answer_plan", "同一要点的证据编号不能重复。")
        for number in selected + support:
            if number not in delivered:
                raise ToolError("invalid_evidence", "回答要点只能选择本轮工具已实际交付的证据。")
        if item["modality"] != "any" and any(delivered[number].modality != item["modality"] for number in selected):
            raise ToolError("answer_plan_modality", "主要证据须符合已登记来源类型；其他补充依据放入supporting_evidence_ids。")
        if item.get("basis", "sources") == "user_input":
            if selected or support or item["modality"] != "any":
                raise ToolError("invalid_answer_plan", "user_input只处理用户提供的输入，modality用any且不选择外部证据；需要来源时登记sources项。")
            if item["status"] in {"ready", "incomplete"} and not input_quotes:
                raise ToolError("answer_plan_input_missing", "user_input的ready/incomplete须用input_quotes绑定实际用户输入。")
        elif item["status"] in {"ready", "incomplete"} and not selected:
            raise ToolError("answer_plan_evidence_missing", "ready/incomplete要点须有实际选中的evidence_ids，目录项或文件名不能替代证据；完全没有依据用unavailable。")
        if item["status"] in {"incomplete", "unavailable"} and not item["gap"].strip():
            raise ToolError("invalid_answer_plan", "incomplete/unavailable须在gap中说明该用户要求具体未交付的部分，不能用一般来源说明代替。")
        if item["status"] == "unavailable" and (selected or support):
            raise ToolError("invalid_answer_plan", "unavailable要点须清空证据；已有部分结果但仍缺少用户要求的内容用incomplete，并保留已有依据。")
        if item["status"] not in {"incomplete", "unavailable"} and item["gap"]:
            raise ToolError("invalid_answer_plan", "gap只用于实际未交付的要求；仍缺少结果用incomplete/unavailable，一般来源说明必要时写在正文末尾。")
    numbers = {number for item in items for number in item["evidence_ids"] + item["supporting_evidence_ids"]}
    spans = ([span for span in (previous or {}).get("retained_spans", []) if span["evidence_id"] in numbers]
             if retained_spans is None else retained_spans)
    if len({span["evidence_id"] for span in spans}) != len(spans):
        raise ToolError("invalid_retained_span", "同一证据只能指定一个保留区间。")
    for span in spans:
        number, start, end = span["evidence_id"], span["start"], span["end"]
        if number not in numbers or not 0 <= start < end <= len(delivered[number].content):
            raise ToolError("invalid_retained_span", "保留区间必须指向已选且已交付原文中的有效Unicode字符范围。")
    return {"items": items, "retained_spans": spans}


def _selection_order(plan):
    # Round-robin over deliverables before their secondary candidates. A large
    # item must not consume all navigation slots ahead of later requirements.
    selections = [item["evidence_ids"] + item["supporting_evidence_ids"] for item in plan["items"]]
    result = []
    for offset in range(max((len(ids) for ids in selections), default=0)):
        for ids in selections:
            if offset < len(ids) and ids[offset] not in result:
                result.append(ids[offset])
    return result


def retained_evidence(plan, delivered, *, checked=False):
    numbers = _selection_order(plan)
    explicit = {span["evidence_id"]: (span["start"], span["end"]) for span in plan.get("retained_spans", [])}

    def packet(number):
        original = delivered[number]
        start, end = explicit.get(number, (0, len(original.content)))
        payload = {"content": original.content[start:end]}
        if checked:
            # Clip original units instead of recomputing their identities on a
            # substring. Tail excerpts must retain original IDs and offsets.
            units = []
            for unit in evidence_units(original):
                left, right = max(start, unit["start"]), min(end, unit["end"])
                if left >= right:
                    continue
                clipped = {**unit, "start": left, "end": right, "text": original.content[left:right]}
                if (left, right) != (unit["start"], unit["end"]):
                    clipped.update(original_start=unit["start"], original_end=unit["end"], truncated=True)
                units.append(clipped)
            payload = {"content_units": units}
        locator = {key: value for key, value in original.locator.items() if key in {
            "point_id", "collection", "chunk_index", "page", "page_number", "text_start", "text_end", "start_sec", "end_sec",
            "shot_start_time", "shot_end_time"} and (isinstance(value, (int, float)) or isinstance(value, str) and len(value) <= 128)}
        return {"id": number, "source_id": original.source_id, "file_name": original.file_name[:128],
                       **({"file_name_truncated": True} if len(original.file_name) > 128 else {}),
                       "modality": original.modality, "observation": original.observation,
                       "version": original.version, "locator": locator,
                       **({"locator_omitted_fields": sorted(set(original.locator) - set(locator))} if locator != original.locator else {}),
                       **payload,
                       "retained_range": {"start": start, "end": end, "original_characters": len(original.content),
                                          "truncated": start > 0 or end < len(original.content)}}

    return [packet(number) for number in numbers]


def plan_payload(plan, delivered, *, checked=False):
    memory = retained_evidence(plan, delivered, checked=checked)
    return {"status": "recorded", "answer_plan": plan, "retained_evidence": memory,
            "retention": {"selected_count": len(memory), "retained_count": len(memory), "omitted_evidence_ids": [],
                "text_characters": sum(entry["retained_range"]["end"] - entry["retained_range"]["start"] for entry in memory)}}


def allows_input_only_answer(plan):
    return bool(plan and plan["items"] and all(item.get("basis", "sources") == "user_input"
        and item["status"] == "ready" and item.get("input_quotes")
        and not item["evidence_ids"] and not item["supporting_evidence_ids"] for item in plan["items"]))


def validate_delivery(args, plan):
    if plan is None:
        raise ToolError("answer_plan_missing", "先用update_answer_plan登记用户要求的全部交付项。")
    # Plans track research progress; they must never force unnecessary citations
    # into the answer or hide citations the model chose while drafting.
    pending = [item["id"] for item in plan["items"] if item["status"] == "pending"]
    gaps = [item["gap"] for item in plan["items"] if item["status"] in {"incomplete", "unavailable"}]
    if pending:
        raise ToolError("answer_delivery_incomplete", "请先核对尚未完成的用户要求："
                        + json.dumps(pending, ensure_ascii=False)
                        + "。继续研究或如实记录缺口，再提交回答。")
    if gaps and args["status"] != "partial":
        raise ToolError("answer_delivery_gap", "仍有用户要求未交付，须使用status=partial，并将每项gap原样列入limitations。")
    if not gaps and args["status"] == "partial":
        raise ToolError("answer_status_mismatch", "所有交付项均为ready，不能仅因来源范围或一般说明提交partial。若已满足用户要求，提交completed、limitations=[]，必要说明写在正文末尾；若确有用户要求未交付，先将对应项更新为incomplete/unavailable并说明具体gap。")
    if set(args["limitations"]) != set(gaps):
        raise ToolError("answer_delivery_gap", "limitations须恰好对应incomplete/unavailable项的gap，不得添加一般来源说明；必要说明由你写在正文末尾。")
    if args["outcome"] == "not_found" and any(item["status"] != "unavailable" for item in plan["items"]):
        raise ToolError("answer_delivery_gap", "not_found须将所有要点标为unavailable并清空选择，不能附带已选候选。")
