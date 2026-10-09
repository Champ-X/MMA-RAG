"""Request-local Decision receipts for chat transport and history.

These helpers only project existing stage receipts. They never invoke models or
infer that a configured stage executed. Raw retrieval payloads and credentials
are excluded; bounded presentation snippets already in stage receipts survive.
"""
from copy import deepcopy


RUN_FIELDS = (
    "jev_decision", "reranking_scorer", "target_modality_fallback",
    "total_candidates", "total_time", "fast_path", "preplanned_query",
    "decision_coverage",
)


def retrieval_diagnostics(result, config, *, observed=None):
    debug = getattr(result, "debug_info", None) or observed or {}
    runs = debug.get("retrieval_runs") or [debug]
    projected = []
    for run in runs:
        receipt = {key: deepcopy(run[key]) for key in RUN_FIELDS if key in run}
        for key, mode in (("jev_decision", config.intent_mode),
                          ("reranking_scorer", config.rerank_mode)):
            existing = receipt.get(key) or {}
            # A no-candidate rerank historically reports only mode=off even
            # when enabled. Preserve actual receipts, clarify proven skips.
            missing = not existing or (existing == {"mode": "off"} and mode != "off")
            if not missing:
                continue
            if mode == "off":
                info = {"mode": mode, "status": "disabled"}
            elif run.get("fast_path"):
                info = {"mode": mode, "status": "skipped", "reason": "fast_path"}
            elif key == "jev_decision" and run.get("preplanned_query"):
                info = {"mode": mode, "status": "skipped", "reason": "preplanned"}
            elif key == "reranking_scorer" and run.get("total_candidates") == 0:
                info = {"mode": mode, "status": "skipped", "reason": "no_candidates"}
            else:
                info = {"mode": mode, "status": "unavailable", "reason": "not_recorded"}
            if key == "jev_decision":
                info["accepted"] = False
            receipt[key] = info
        projected.append(receipt)
    diagnostics = {"jev_config": config.model_dump(), "runs": projected}
    if debug.get("decision_coverage"):
        diagnostics["decision_coverage"] = deepcopy(debug["decision_coverage"])
    if debug.get("context_checkpoint"):
        diagnostics["context_checkpoint"] = deepcopy(debug["context_checkpoint"])
    if result is not None and hasattr(result, "reranked_results"):
        final_additions = [item.get("id") for item in result.reranked_results or []
                           if (item.get("metadata") or {}).get("decision_assist")]
        if config.rerank_mode == "assist" or final_additions:
            # Agent runs may each propose two additions; only the merged final
            # list describes what was actually forwarded to answer generation.
            diagnostics["final_added_ids"] = list(dict.fromkeys(
                debug.get("context_checkpoint", {}).get("added_ids", final_additions)))
    return diagnostics


def chat_diagnostics(retrieval, *, citation_audit=None, answer=None):
    diagnostics = {"retrieval": deepcopy(retrieval)}
    if citation_audit is not None:
        audit = deepcopy(citation_audit)
        if isinstance(answer, str):
            for unit in audit.get("units", []):
                start, end = unit.get("start"), unit.get("end")
                if type(start) is int and type(end) is int and 0 <= start <= end <= len(answer):
                    # Slice on the server: Python offsets count code points,
                    # unlike JS UTF-16. This is displayed answer text only.
                    unit["statement"] = answer[start:end]
        diagnostics["jev_citation_audit"] = audit
    return diagnostics


def failure_diagnostics(retrieval, config, *, required_failure=None):
    diagnostics = chat_diagnostics(retrieval)
    if required_failure is not None:
        # Retain the original strict-error keys for existing consumers.
        diagnostics.update(required_failure.diagnostics())
        key = {"intent": "jev_decision", "rerank": "reranking_scorer"}.get(required_failure.stage)
        if key:
            runs = diagnostics["retrieval"]["runs"]
            run = runs[-1] if runs else {}
            if not runs:
                runs.append(run)
            run[key] = {
                **run.get(key, {}), **deepcopy(getattr(required_failure, "decision_info", {}) or {}),
                "mode": "force", "status": "failed",
                "reason": required_failure.reason, "fallback_used": False,
            }
            downstream = run.get("reranking_scorer", {})
            if (required_failure.stage == "intent"
                    and downstream.get("status") == "unavailable"
                    and downstream.get("reason") == "not_recorded"):
                # A required intent failure stops retrieval before ranking.
                # Preserve any real earlier-run receipt or disabled setting;
                # only resolve the otherwise unknown downstream stage.
                run["reranking_scorer"] = {
                    **downstream, "status": "skipped", "reason": "upstream_failed",
                }
    if config.citation_mode == "shadow":
        diagnostics["jev_citation_audit"] = {
            "mode": "shadow", "strategy": config.citation_strategy,
            "diagnostic_only": True, "status": "not_evaluated",
            "reason": "generation_not_completed",
        }
    return diagnostics
