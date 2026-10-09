"""Observed evidence coverage, distinct from model confidence or answer support.

No query keywords, new searches, or inferred corpus absence. Callers opt in by
carrying the Decision requirements contract; the all-off path is unchanged.
"""
from collections import Counter
from copy import deepcopy
import re

FIELDS = {"image": "visual_intent", "audio": "audio_intent", "video": "video_intent"}
VERSION = "decision-coverage-v1"


def modality(item):
    kind = item.get("content_type")
    if kind in {"image", "audio", "video"}:
        return kind
    payload = item.get("payload") or {}
    if any(key in payload for key in ("shot_id", "scene_summary", "video_format", "segment_id")):
        return "video"
    if "transcript" in payload:
        return "audio"
    return "image" if "caption" in payload else "doc"


def counts(items):
    seen, result = set(), Counter()
    for index, item in enumerate(items):
        identity = (modality(item), str(item.get("id", f"row-{index}")))
        if identity not in seen:
            seen.add(identity)
            result[identity[0]] += 1
    return result


def coverage_receipt(context, raw_results, retained, *, branch_names=(), embedding_failures=()):
    policy = getattr(context, "decision_requirements", None)
    if not policy:
        return {}
    raw = counts([item for rows in raw_results.values() for item in rows])
    kept = counts(retained)
    branches = set(raw_results) | set(branch_names)
    rows = {}
    for kind, field in FIELDS.items():
        requirement = (policy.get("modalities") or {}).get(kind, {})
        searched = (kind in branches or (kind == "image" and "visual" in branches)
                    or ("selected_file" in branches
                        and kind in (getattr(context, "selected_file_modalities", []) or [])))
        rows[kind] = {
            "requirement": requirement.get("status", "uncertain"),
            "effective_intent": getattr(context, field, "unnecessary"),
            "searched": searched, "candidate_count": raw[kind],
            "retained_count": kept[kind], "context_count": None,
            "status": ("retained" if kept[kind] else "filtered" if raw[kind]
                       else "no_candidates" if searched else "not_searched"),
        }
    return {
        "version": VERSION,
        "scope": {"kb_ids": list(getattr(context, "target_kb_ids", []) or []),
                  "file_ids": list(getattr(context, "target_file_ids", []) or [])},
        "modalities": rows,
        "grounding": {"signal_state": (policy.get("planning") or {}).get("grounding_state", "uncertain")},
        "limitations": ["availability_not_sufficiency", "empty_results_not_corpus_absence"],
        "warnings": ["query_embedding_failed"] if embedding_failures else [],
    }


def finalize_coverage(retrieval_result, reference_map, *, context_string=None):
    """Record actual references after context selection; never alter their IDs."""
    debug = getattr(retrieval_result, "debug_info", None)
    if not isinstance(debug, dict) or not debug.get("decision_coverage"):
        return ""
    receipt = deepcopy(debug["decision_coverage"])
    # A reference map can survive formatting failure. Only count references
    # actually represented in the final context supplied to generation.
    present = set(reference_map)
    if isinstance(context_string, str):
        present = set(re.findall(r"^【材料 (\d+)】", context_string, re.M))
    available = Counter(ref.content_type for key, ref in reference_map.items() if key in present)
    for kind, row in receipt["modalities"].items():
        row["context_count"] = available[kind]
        if available[kind]:
            row["status"] = "included"
        elif row["retained_count"]:
            row["status"] = "not_in_context"
    debug["decision_coverage"] = receipt
    labels = {"image": "图片", "audio": "音频", "video": "视频"}
    statuses = {"not_searched": "本轮未执行该类检索", "no_candidates": "本轮未返回候选",
                "filtered": "候选未进入最终检索结果", "not_in_context": "候选未进入生成上下文"}
    lines = []
    if "query_embedding_failed" in receipt.get("warnings", []):
        lines.append("本轮部分查询向量化失败，检索覆盖可能不完整；不能据此断言资料不存在。")
    for kind, row in receipt["modalities"].items():
        if row["effective_intent"] == "explicit_demand":
            lines.append(f"{labels[kind]}：" + (f"上下文包含 {row['context_count']} 项参考材料" if row["context_count"]
                         else statuses.get(row["status"], "上下文未包含此类参考材料")))
    if not lines:
        return ""
    return ("\n\n本轮证据覆盖记录（系统观测）：\n" + "\n".join(lines)
            + "\n请逐项回应用户需求。材料可用不代表内容足以支持结论；缺少证据时明确本轮未能完成的部分。"
              "未检索或未返回候选不能推断整个知识库没有资料；不要虚构文件、歌曲、画面或引用。")


def sync_effective_requirements(preprocessing, *, action):
    policy = preprocessing.get("decision_requirements")
    if not policy:
        return preprocessing
    updated = dict(preprocessing)
    policy = deepcopy(policy)
    for kind, field in FIELDS.items():
        record = (policy.get("modalities") or {}).get(kind)
        if record is not None and record.get("effective_intent") != updated.get(field, "unnecessary"):
            record.update(effective_intent=updated.get(field, "unnecessary"), action=action)
    updated["decision_requirements"] = policy
    if updated.get("jev_decision"):
        updated["jev_decision"] = {**updated["jev_decision"], "requirements": deepcopy(policy)}
    return updated


def adopted_exclusions(policy):
    return {kind for kind, record in (policy or {}).get("modalities", {}).items()
            if record.get("status") == "forbidden" and record.get("action") == "adopted"}


def apply_grounding_fallback(preprocessing, *, target_kb_ids, inventory):
    """Use available source media only inside existing routes, with abstention.

    A positive generic grounding need and a negative source exclusion are both
    required. Independent output media demands cannot suppress source grounding.
    """
    policy = preprocessing.get("decision_requirements") or {}
    planning = policy.get("planning") or {}
    if planning.get("grounding_state") != "positive" or planning.get("context_signal", 1) > .15:
        return preprocessing, {}
    updated, additions = dict(preprocessing), []
    for kb_id in target_kb_ids:
        source = inventory.get(kb_id) or {}
        if int(source.get("text") or 0) > 0:
            continue
        # Already enabled speech/motion sources can provide background content.
        if any(int(source.get(kind) or 0) > 0 and updated.get(FIELDS[kind], "unnecessary") != "unnecessary"
               for kind in ("audio", "video")):
            continue
        eligible = []
        for kind in ("video", "audio", "image"):
            record = (policy.get("modalities") or {}).get(kind, {})
            if (int(source.get(kind) or 0) > 0
                    and updated.get(FIELDS[kind], "unnecessary") == "unnecessary"
                    and record.get("signal_states", {}).get("forbidden") == "negative"
                    and record.get("status") not in {"forbidden", "conflict"}):
                eligible.append(kind)
        if not eligible:
            continue
        kind = max(eligible, key=lambda m: (m != "image", int(source.get(m) or 0), m == "video"))
        updated[FIELDS[kind]] = "implicit_enrichment"
        updated[FIELDS[kind].replace("_intent", "_reasoning")] = "已选知识库缺少文本索引，补充媒体中的背景证据；保留原检索范围"
        additions.append({"kb_id": kb_id, "modality": kind, "available_count": int(source[kind])})
        if len(additions) >= 2:
            break
    return updated, ({"policy_version": VERSION, "reason": "source_grounding", "additions": additions} if additions else {})
