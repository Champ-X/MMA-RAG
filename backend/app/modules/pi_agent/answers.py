"""Deterministic answer coverage and source-identity checks, not an entailment judge.

The Agent supplies the prose, statement kinds and support selections. The host
checks that none are omitted and that every pointer resolves to delivered text.
Original source text and numeric citation identities remain immutable.
"""
from __future__ import annotations

import re

import markdown
from markdown.treeprocessors import Treeprocessor


def text_units(text, prefix, *, maximum=None):
    units, offset = [], 0
    for line in text.splitlines(keepends=True):
        width = maximum or len(line)
        for start in range(0, len(line), width):
            part = line[start:start + width]
            if part.strip():
                units.append({"id": f"{prefix}{len(units) + 1}", "start": offset + start,
                              "end": offset + start + len(part), "text": part})
        offset += len(line)
    return units


def evidence_units(evidence):
    units = text_units(evidence.content, f"e{evidence.id}s", maximum=1200)
    origin = evidence.provenance.get("text_origin")
    if not origin or origin.get("version") != 1:
        # Historical evidence keeps its original unit IDs and exact offsets.
        return units
    spans, annotated = origin["generated_spans"], []
    for unit in units:
        boundaries = sorted({unit["start"], unit["end"], *(position for span in spans
            for position in (span["start"], span["end"]) if unit["start"] < position < unit["end"])})
        for start, end in zip(boundaries, boundaries[1:]):
            text = evidence.content[start:end]
            if text.strip():
                generated = any(span["start"] <= start and end <= span["end"] for span in spans)
                annotated.append({"id": f"e{evidence.id}s{len(annotated) + 1}", "start": start, "end": end,
                                  "text": text, "origin": "generated_caption" if generated else "unmarked_parsed_text"})
    return annotated


def evidence_payload(evidence):
    # Send each source character once, with stable labels the Agent can use
    # without copying quotes or counting Unicode offsets itself.
    return {**evidence.model_dump(exclude={"content"}), "content_units": evidence_units(evidence)}


def answer_units(answer, limitations):
    units = text_units(answer, "a")
    units.extend({"id": f"l{index}", "start": 0, "end": len(text), "text": text}
                 for index, text in enumerate(limitations, 1))
    return units


def character_counts(answer):
    counted = re.sub(r"\[\d+\]|[\s#*`>]", "", answer)
    ascii_letters = len(re.findall(r"[A-Za-z]", counted))
    return {"total": len(counted), "ascii_letters": ascii_letters,
            "other_characters": len(counted) - ascii_letters}


def character_count(answer):
    return character_counts(answer)["total"]


def citation_errors(args, delivered, *, allow_uncited=False):
    """The original Pi citation checks, shared with the experimental contract."""
    errors = []
    used, declared = {int(n) for n in re.findall(r"\[(\d+)\]", args["answer"])}, set(args["evidence_ids"])
    if args["outcome"] == "not_found" and (used or declared or args["status"] != "partial"):
        errors.append({"code": "unsupported_citations", "message": "未找到相关依据时必须提交 partial，且不得附候选或来源介绍的引用"})
    if used != declared or not used <= delivered.keys():
        errors.append({"code": "citation_mismatch", "message": "正文引用与 evidence_ids 不一致，或引用了本轮尚未返回的证据。请修正后重新提交。"})
    if not used and not allow_uncited and (args["status"] != "partial" or not args["limitations"]):
        errors.append({"code": "missing_evidence", "message": "无来源支撑时请提交 partial，并说明证据缺口；不能当作已核验的回答。"})
    if args["status"] == "partial" and not args["limitations"]:
        errors.append({"code": "missing_limitations", "message": "部分回答必须具体说明哪些用户要求尚未交付"})
    if args["status"] == "completed" and args["limitations"]:
        errors.append({"code": "answer_status_mismatch", "message": "completed的limitations须为空；一般来源说明必要时写在正文末尾，确有用户要求未交付才用partial。"})
    if "知识库中未找到相关内容" in args["answer"] and used:
        errors.append({"code": "unsupported_citations", "message": "没有相关证据的回答不能保留候选引用"})
    return errors


def markdown_image_targets(text):
    """Collect rendered images, leaving code, escapes and raw HTML as data."""
    targets = []

    class CollectImages(Treeprocessor):
        def run(self, root):
            targets.extend(node.get("src", "") for node in root.iter("img"))

    parser = markdown.Markdown(extensions=["fenced_code"])
    parser.treeprocessors.register(CollectImages(parser), "source_images", 5)
    parser.convert(text)
    return targets


def media_target_errors(answer, image_targets, *, preserved_inputs=()):
    """Resolve images to selected sources or actual user-input transformations.

    Numeric citations remain the normal source presentation contract. A mixed
    research/transformation task may also preserve Markdown from user input.
    """
    image_targets = set(image_targets)
    for text in preserved_inputs:
        image_targets.update(markdown_image_targets(text))
    targets = markdown_image_targets(answer)
    invalid = list(dict.fromkeys(target for target in targets if target not in image_targets))
    if not invalid:
        return []
    return [{"code": "invalid_media_target",
             "message": "正文图片地址未对应本次选中并交付的图片来源。使用该来源的数字[编号]即可展示媒体；不要把来源身份、文件名或未取得的地址当作图片链接。",
             "invalid_targets": [target[:160] for target in invalid[:4]]}]


def source_notices(statements):
    """Describe selected origins, without inferring the answer's meaning."""
    notices = []
    for statement in statements:
        generated = [source for source in statement["source_spans"]
                     if source.get("origin") == "generated_caption"]
        if generated:
            notices.append({"code": "generated_caption_selected", "unit_id": statement["unit_id"],
                "evidence_ids": sorted({source["evidence_id"] for source in generated}),
                "source_spans": sorted({source["span_id"] for source in generated}),
                "message": "这些选中片段按既有标记识别为生成图注，不能仅凭parsed_text类型当作作者正文。回答作者的定义、机制或结论时，请核对相关正文；若使用图像描述，应明确其观察性质与局限。是否支持当前主张仍须由你判断，本提示不作语义裁决。"})
    return notices


def assess_answer(args, delivered, *, allow_uncited=False):
    """Require complete self-assessment and resolve its actual source anchors."""
    units = answer_units(args["answer"], args["limitations"])
    expected = {unit["id"]: unit for unit in units}
    statements, errors, resolved = args["statements"], citation_errors(args, delivered, allow_uncited=allow_uncited), []
    # Keep the default Pi contract unchanged. The experimental checks expose
    # what was actually parsed, rather than asking the Agent to guess why a
    # grouped marker or source-span label failed numeric citation identity.
    for error in errors:
        if error["code"] == "citation_mismatch":
            recognized = {int(n) for n in re.findall(r"\[(\d+)\]", args["answer"])}
            declared = set(args["evidence_ids"])
            error.update(
                message="正文每个数字引用必须单独加方括号，例如[1][2]；[1,2]和[e1s1]都不是有效正文引用，e1s1只用于source_spans。evidence_ids须与正文实际识别的编号一致，且全部来自本轮已返回证据。请自行核对原文并修订，格式示例不证明语义支持。",
                recognized_evidence_ids=sorted(recognized), declared_evidence_ids=sorted(declared),
                unavailable_evidence_ids=sorted((recognized | declared) - delivered.keys()))
    if not any(uid.startswith("a") for uid in expected):
        errors.append({"code": "empty_answer", "message": "回答正文不能为空或只有空白。"})
    ids = [item["unit_id"] for item in statements]
    if len(ids) != len(set(ids)) or set(ids) != set(expected):
        errors.append({"code": "incomplete_statements", "message":
            "必须恰好评价正文每个非空行(a1起)和每条limitations(l1起)，不得遗漏、重复或新增编号。",
            "expected_units": list(expected)})
    source_units = {unit["id"]: (evidence, unit) for evidence in delivered.values() for unit in evidence_units(evidence)}
    for item in statements:
        uid, kind = item["unit_id"], item["kind"]
        unit = expected.get(uid)
        if unit is None:
            continue
        anchors = item["source_spans"]
        markers = {int(number) for number in re.findall(r"\[(\d+)\]", unit["text"])}
        sources = []
        if len(anchors) != len(set(anchors)):
            errors.append({"code": "duplicate_support", "unit_id": uid})
        for anchor in anchors:
            found = source_units.get(anchor)
            if found is None:
                errors.append({"code": "unavailable_support", "unit_id": uid, "source_span": anchor})
                continue
            evidence, support = found
            sources.append({"span_id": anchor, "evidence_id": evidence.id, "source_id": evidence.source_id,
                            "version": evidence.version, "observation": evidence.observation,
                            **({"origin": support["origin"]} if "origin" in support else {}),
                            "start": support["start"], "end": support["end"], "text": support["text"]})
        factual = kind in {"fact", "inference"}
        if factual and not anchors and not allow_uncited:
            errors.append({"code": "missing_support", "unit_id": uid,
                           "message": "事实或推断必须关联已返回的原文片段；缺乏依据时删除该断言或改为本次未找到支持。"})
        if factual and uid.startswith("l"):
            errors.append({"code": "fact_in_limitations", "unit_id": uid,
                           "message": "limitations只记录研究缺口；资料内容的事实断言须移到正文并给出支持。"})
        if not factual and (anchors or markers):
            errors.append({"code": "nonfactual_citations", "unit_id": uid,
                           "message": "拒答、限制说明和纯标题不附来源候选；含来源事实的整行应归为fact或inference。"})
        if factual and markers != {source["evidence_id"] for source in sources}:
            selected = sorted({source["evidence_id"] for source in sources})
            errors.append({"code": "statement_citation_mismatch", "unit_id": uid,
                           "message": "该行实际识别的正文引用须与所选source_spans的来源编号一致，每个数字单独加方括号。示例只说明格式，仍须自行核对原文是否支持整行事实。",
                           "recognized_evidence_ids": sorted(markers), "selected_source_evidence_ids": selected,
                           "citation_format_example": "".join(f"[{number}]" for number in selected)})
        if args["outcome"] == "not_found" and factual:
            errors.append({"code": "not_found_factual_assertion", "unit_id": uid,
                           "message": "not_found只说明本次检索缺乏支持，不能断言整篇或全库没有某类信息。"})
        if not unit["text"].strip():
            errors.append({"code": "empty_statement", "unit_id": uid})
        resolved.append({"unit_id": uid, "kind": kind, "start": unit["start"], "end": unit["end"],
                         "source_spans": sources})
    counts, limit = character_counts(args["answer"]), args.get("max_characters")
    size = counts["total"]
    if limit is not None and size > limit:
        errors.append({"code": "answer_too_long", "actual": size, "maximum": limit,
                       "over_by": size - limit,
                       "message": "正文超出所声明的用户篇幅要求，请由Pi缩短后重新检查或提交。"})
    notices = source_notices(resolved)
    return {"protocol_valid": not errors, "errors": errors, "answer_units": units,
            "body_characters": size, "declared_max_characters": limit, "statements": resolved,
            "body_character_counts": counts,
            **({"source_notices": notices} if notices else {}),
            "semantic_support": "Agent self-assessment; coverage and source identity checked, entailment not independently verified.",
            **({"basis": "user_input"} if allow_uncited else {})}


def repair_feedback(report):
    """Expose measured units so Pi can repair prose without guessing line counts."""
    size, limit = report["body_characters"], report["declared_max_characters"]
    over_by = max(0, size - limit) if limit is not None else 0
    notices = report.get("source_notices", [])
    preview = [{**notice, **({"source_spans": notice["source_spans"][:6],
        "source_span_count": len(notice["source_spans"]),
        "source_spans_truncated": True} if len(notice["source_spans"]) > 6 else {})}
        for notice in notices[:4]]
    return {"body_characters": size, "declared_max_characters": limit, "over_by": over_by,
            "suggested_body_characters": max(1, int(limit * 0.85)) if over_by else None,
            "instruction": "正文单元按非空行而非句子编号；整行全部事实共用该单元的来源列表。超长时保留用户所问事实与引用，整体精简到建议字数留出余量，不要只反复删少数字符，也不要调高或省略已声明的上限。ascii_letters是正文中A-Z/a-z所占字符，不是词数，也不表示这些内容可以删除。中文答复可把一般术语准确译为中文，必要英文专名保留一次；优先重述措辞、去掉重复名称和背景，不要靠删除关键事实、条件或比较维度来满足限长。",
            **({"body_character_counts": report["body_character_counts"]} if "body_character_counts" in report else {}),
            **({"source_notices": preview, "source_notice_count": len(notices),
                "source_notices_truncated": len(preview) < len(notices) or any(
                    notice.get("source_spans_truncated", False) for notice in preview)} if notices else {}),
            "units": [{"unit_id": unit["id"], "characters": character_count(unit["text"]),
                       "text_prefix": unit["text"][:100]} for unit in report["answer_units"][:12]],
            "units_truncated": len(report["answer_units"]) > 12, "errors": report["errors"][:8]}


def compact_assessment(report):
    return {"version": 1, "body_characters": report["body_characters"],
            **({"basis": report["basis"]} if "basis" in report else {}),
            "declared_max_characters": report["declared_max_characters"],
            **({"body_character_counts": report["body_character_counts"]} if "body_character_counts" in report else {}),
            "semantic_support": report["semantic_support"],
            **({"source_notices": report["source_notices"]} if report.get("source_notices") else {}),
            "statements": [{**item, "source_spans": [{key: value for key, value in source.items() if key != "text"}
                             for source in item["source_spans"]]} for item in report["statements"]]}
