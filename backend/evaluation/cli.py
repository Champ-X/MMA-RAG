"""Command-line interface for validating, collecting, scoring, and comparing RAG runs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

from .judge import JudgeConfig, JudgeError, OpenAICompatibleJudge
from .live import (
    LiveEvaluationError,
    TessmoraEvaluationClient,
    collect_predictions,
    ensure_corpus,
    ensure_isolated_target,
    judge_predictions,
)
from .metrics import score_dataset
from .schema import (
    EvalDataset,
    EvaluationDataError,
    load_predictions,
    write_predictions,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = REPO_ROOT / "evals" / "baseline_v1" / "manifest.json"


def _dataset_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--dataset",
        type=Path,
        default=DEFAULT_DATASET,
        help=f"dataset manifest (default: {DEFAULT_DATASET})",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rag-eval",
        description="Tessmora's isolated, versioned RAG evaluation baseline",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate", help="validate dataset hashes and schema")
    _dataset_argument(validate_parser)

    score_parser = subparsers.add_parser("score", help="score an existing JSONL prediction set")
    _dataset_argument(score_parser)
    score_parser.add_argument("--predictions", type=Path, required=True)
    score_parser.add_argument("--report-out", type=Path)
    score_parser.add_argument("--k", type=int, nargs="+", default=(1, 3, 5))

    judge_parser = subparsers.add_parser(
        "judge", help="rejudge saved generated answers without rerunning Tessmora"
    )
    _dataset_argument(judge_parser)
    judge_parser.add_argument("--predictions", type=Path, required=True)
    judge_parser.add_argument("--predictions-out", type=Path, required=True)
    judge_parser.add_argument("--report-out", type=Path)
    judge_parser.add_argument("--k", type=int, nargs="+", default=(1, 3, 5))
    judge_parser.add_argument("--judge-base-url")
    judge_parser.add_argument("--judge-model")
    judge_parser.add_argument("--judge-api-key")
    judge_parser.add_argument("--judge-timeout", type=float, default=120.0)

    run_parser = subparsers.add_parser(
        "run", help="collect predictions from a live, isolated Tessmora instance"
    )
    _dataset_argument(run_parser)
    run_parser.add_argument("--base-url", default="http://127.0.0.1:18000")
    run_parser.add_argument("--kb-id")
    run_parser.add_argument(
        "--allow-shared-read-only",
        action="store_true",
        help="allow a normal instance only with an explicit pre-provisioned --kb-id",
    )
    run_parser.add_argument("--predictions-out", type=Path, required=True)
    run_parser.add_argument("--report-out", type=Path)
    run_parser.add_argument("--k", type=int, nargs="+", default=(1, 3, 5))
    run_parser.add_argument("--top-k", type=int, default=5)
    run_parser.add_argument(
        "--agent-mode", choices=("direct", "auto", "agent"), default="direct"
    )
    run_parser.add_argument("--retrieval-only", action="store_true")
    run_parser.add_argument(
        "--judge", choices=("none", "openai-compatible"), default="none"
    )
    run_parser.add_argument("--judge-base-url")
    run_parser.add_argument("--judge-model")
    run_parser.add_argument("--judge-api-key")
    run_parser.add_argument("--judge-timeout", type=float, default=120.0)

    compare_parser = subparsers.add_parser(
        "compare", help="fail when a candidate regresses beyond the allowed tolerance"
    )
    compare_parser.add_argument("--baseline", type=Path, required=True)
    compare_parser.add_argument("--candidate", type=Path, required=True)
    compare_parser.add_argument("--max-regression", type=float, default=0.03)
    return parser


def _write_json(path: Optional[Path], payload: Mapping[str, Any]) -> None:
    rendered = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if path is None:
        sys.stdout.write(rendered)
        return
    destination = path.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(rendered, encoding="utf-8")
    sys.stdout.write(
        json.dumps(
            {"ok": True, "output": str(destination)}, ensure_ascii=False, sort_keys=True
        )
        + "\n"
    )


def _inferred_run_metadata(predictions: Mapping[str, Any]) -> Dict[str, Any]:
    explicit = []
    for prediction in predictions.values():
        run = prediction.metadata.get("run")
        if isinstance(run, Mapping):
            explicit.append(dict(run))
    if explicit and all(value == explicit[0] for value in explicit[1:]):
        metadata = explicit[0]
    else:
        agent_modes = sorted(
            {
                str(prediction.metadata.get("agent_mode"))
                for prediction in predictions.values()
                if prediction.metadata.get("agent_mode")
            }
        )
        metadata = {
            "top_k": max(
                (len(prediction.retrieved_contexts) for prediction in predictions.values()),
                default=0,
            ),
            "retrieval_only": all(not prediction.answer for prediction in predictions.values()),
            "judge": {
                "backend": (
                    "embedded"
                    if any(
                        prediction.generation_judgment is not None
                        for prediction in predictions.values()
                    )
                    else "none"
                )
            },
        }
        if agent_modes:
            metadata["agent_mode"] = agent_modes[0] if len(agent_modes) == 1 else agent_modes

    generation_models = sorted(
        {
            str(model)
            for prediction in predictions.values()
            for response in (prediction.metadata.get("response"),)
            if isinstance(response, Mapping)
            for model in (response.get("model_used"),)
            if model
        }
    )
    metadata["generation_models"] = generation_models
    return metadata


def _load_report(path: Path) -> Mapping[str, Any]:
    try:
        value = json.loads(path.expanduser().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read report {path}: {error}") from error
    if not isinstance(value, Mapping):
        raise ValueError(f"report {path} must contain a JSON object")
    return value


def _metric_values(report: Mapping[str, Any]) -> Dict[str, Optional[float]]:
    aggregate = report.get("aggregate")
    if not isinstance(aggregate, Mapping):
        raise ValueError("report has no aggregate object")
    values: Dict[str, Optional[float]] = {}
    for family in ("retrieval", "generation"):
        metrics = aggregate.get(family)
        if not isinstance(metrics, Mapping):
            raise ValueError(f"report has no aggregate.{family} object")
        for name, raw in metrics.items():
            if not isinstance(raw, Mapping):
                continue
            value = raw.get("value")
            if value is not None and not isinstance(value, (int, float)):
                raise ValueError(f"metric {family}.{name} has a non-numeric value")
            values[f"{family}.{name}"] = None if value is None else float(value)
    return values


def compare_reports(
    baseline: Mapping[str, Any],
    candidate: Mapping[str, Any],
    *,
    max_regression: float,
) -> Tuple[Dict[str, Any], bool]:
    if max_regression < 0:
        raise ValueError("max_regression must be non-negative")
    baseline_dataset = baseline.get("dataset")
    candidate_dataset = candidate.get("dataset")
    if not isinstance(baseline_dataset, Mapping) or not isinstance(candidate_dataset, Mapping):
        raise ValueError("both reports must contain dataset metadata")
    if baseline_dataset.get("fingerprint") != candidate_dataset.get("fingerprint"):
        raise ValueError("cannot compare reports from different dataset fingerprints")
    baseline_configuration = baseline.get("configuration")
    candidate_configuration = candidate.get("configuration")
    if isinstance(baseline_configuration, Mapping):
        if not isinstance(candidate_configuration, Mapping):
            raise ValueError("candidate report has no configuration metadata")
        for key in (
            "agent_mode",
            "top_k",
            "ks",
            "retrieval_only",
            "generation_models",
            "judge",
        ):
            if key not in baseline_configuration:
                continue
            if candidate_configuration.get(key) != baseline_configuration[key]:
                raise ValueError(
                    f"cannot compare reports with different configuration.{key} values"
                )
    baseline_values = _metric_values(baseline)
    candidate_values = _metric_values(candidate)
    rows: Dict[str, Any] = {}
    passed = True
    for metric, baseline_value in baseline_values.items():
        candidate_value = candidate_values.get(metric)
        if baseline_value is None:
            status = "not_baselined"
            delta = None
        elif candidate_value is None:
            status = "missing"
            delta = None
            passed = False
        else:
            delta = candidate_value - baseline_value
            status = "pass" if delta >= -max_regression else "regression"
            passed = passed and status == "pass"
        rows[metric] = {
            "baseline": baseline_value,
            "candidate": candidate_value,
            "delta": None if delta is None else round(delta, 6),
            "status": status,
        }
    return {
        "passed": passed,
        "max_regression": max_regression,
        "dataset_fingerprint": baseline_dataset.get("fingerprint"),
        "metrics": rows,
    }, passed


def _progress(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def execute(args: argparse.Namespace) -> int:
    if args.command == "validate":
        dataset = EvalDataset.load(args.dataset)
        _write_json(
            None,
            {
                "ok": True,
                "dataset": dataset.name,
                "version": dataset.version,
                "fingerprint": dataset.fingerprint,
                "cases": len(dataset.cases),
                "documents": len(dataset.documents),
            },
        )
        return 0

    if args.command == "score":
        dataset = EvalDataset.load(args.dataset)
        predictions = load_predictions(args.predictions)
        report = score_dataset(
            dataset,
            predictions,
            ks=args.k,
            run_metadata=_inferred_run_metadata(predictions),
        )
        _write_json(args.report_out, report)
        return 0

    if args.command == "judge":
        dataset = EvalDataset.load(args.dataset)
        predictions = load_predictions(args.predictions)
        judge = OpenAICompatibleJudge(
            JudgeConfig.from_environment(
                base_url=args.judge_base_url,
                model=args.judge_model,
                api_key=args.judge_api_key,
                timeout_seconds=args.judge_timeout,
            )
        )
        judged_predictions = judge_predictions(
            dataset=dataset,
            predictions=predictions,
            judge=judge,
            progress=_progress,
        )
        write_predictions(args.predictions_out, judged_predictions)
        judged_by_id = {
            prediction.case_id: prediction for prediction in judged_predictions
        }
        report = score_dataset(
            dataset,
            judged_by_id,
            ks=args.k,
            run_metadata=_inferred_run_metadata(judged_by_id),
        )
        _write_json(args.report_out, report)
        return 0

    if args.command == "run":
        if args.top_k <= 0 or args.top_k > 50:
            raise ValueError("top-k must be between 1 and 50")
        if max(args.k) > args.top_k:
            raise ValueError("top-k must be at least the largest requested metric k")
        if args.retrieval_only and args.judge != "none":
            raise ValueError("a generation judge cannot be used with --retrieval-only")
        dataset = EvalDataset.load(args.dataset)
        client = TessmoraEvaluationClient(args.base_url)
        health = client.health()
        allow_provisioning = ensure_isolated_target(
            health,
            kb_id=args.kb_id,
            allow_shared_read_only=args.allow_shared_read_only,
        )
        kb_id = ensure_corpus(
            client,
            dataset,
            kb_id=args.kb_id,
            allow_provisioning=allow_provisioning,
            progress=_progress,
        )
        judge = None
        if args.judge == "openai-compatible":
            judge = OpenAICompatibleJudge(
                JudgeConfig.from_environment(
                    base_url=args.judge_base_url,
                    model=args.judge_model,
                    api_key=args.judge_api_key,
                    timeout_seconds=args.judge_timeout,
                )
            )
        predictions, run_metadata = collect_predictions(
            client=client,
            dataset=dataset,
            kb_id=kb_id,
            top_k=args.top_k,
            agent_mode=args.agent_mode,
            retrieval_only=args.retrieval_only,
            judge=judge,
            service_metadata={
                key: health[key]
                for key in ("service", "version", "evaluation_mode")
                if key in health
            },
            progress=_progress,
        )
        write_predictions(args.predictions_out, predictions)
        run_metadata = {**run_metadata, "knowledge_base_id": kb_id}
        report = score_dataset(
            dataset,
            {prediction.case_id: prediction for prediction in predictions},
            ks=args.k,
            run_metadata=run_metadata,
        )
        _write_json(args.report_out, report)
        return 0

    if args.command == "compare":
        result, passed = compare_reports(
            _load_report(args.baseline),
            _load_report(args.candidate),
            max_regression=args.max_regression,
        )
        _write_json(None, result)
        return 0 if passed else 1

    raise ValueError(f"unsupported command: {args.command}")


def main(argv: Optional[Sequence[str]] = None) -> int:
    try:
        return execute(build_parser().parse_args(argv))
    except (EvaluationDataError, LiveEvaluationError, JudgeError, ValueError) as error:
        print(f"rag-eval: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
