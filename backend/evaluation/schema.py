"""Versioned data contracts for the Tessmora RAG evaluation baseline."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple


SCHEMA_VERSION = "1"
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
_INGESTED_FILE_PREFIX_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(.+)$",
    re.IGNORECASE,
)


class EvaluationDataError(ValueError):
    """Raised when a dataset or prediction violates the evaluation contract."""


def _require_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise EvaluationDataError(f"{label} must be an object")
    return value


def _require_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise EvaluationDataError(f"{label} must be a non-empty string")
    return value.strip()


def _safe_relative_path(value: Any, label: str) -> Path:
    text = _require_text(value, label).replace("\\", "/")
    posix = PurePosixPath(text)
    if posix.is_absolute() or ".." in posix.parts:
        raise EvaluationDataError(f"{label} must stay inside the dataset directory")
    return Path(*posix.parts)


def _as_float(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise EvaluationDataError(f"{label} must be numeric")
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise EvaluationDataError(f"{label} must be numeric") from error


def normalize_document_id(value: str) -> str:
    """Normalize API file names and local paths to the qrel identifier space."""
    file_name = value.replace("\\", "/").rsplit("/", 1)[-1].strip()
    match = _INGESTED_FILE_PREFIX_RE.fullmatch(file_name)
    if match:
        file_name = match.group(1)
    return file_name.casefold()


@dataclass(frozen=True)
class CorpusDocument:
    document_id: str
    path: Path
    sha256: str

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any], index: int) -> "CorpusDocument":
        prefix = f"manifest.corpus[{index}]"
        document_id = _require_text(raw.get("document_id"), f"{prefix}.document_id")
        if normalize_document_id(document_id) != document_id.casefold():
            raise EvaluationDataError(
                f"{prefix}.document_id must be a file name without directories"
            )
        path = _safe_relative_path(raw.get("path"), f"{prefix}.path")
        sha256 = _require_text(raw.get("sha256"), f"{prefix}.sha256").lower()
        if not re.fullmatch(r"[0-9a-f]{64}", sha256):
            raise EvaluationDataError(f"{prefix}.sha256 must be a SHA-256 hex digest")
        if path.name.casefold() != document_id.casefold():
            raise EvaluationDataError(
                f"{prefix}.document_id must match the corpus file name {path.name!r}"
            )
        return cls(document_id=document_id, path=path, sha256=sha256)


@dataclass(frozen=True)
class Qrel:
    document_id: str
    relevance: int

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any], label: str) -> "Qrel":
        document_id = _require_text(raw.get("document_id"), f"{label}.document_id")
        relevance = raw.get("relevance")
        if isinstance(relevance, bool) or not isinstance(relevance, int):
            raise EvaluationDataError(f"{label}.relevance must be an integer")
        if not 1 <= relevance <= 3:
            raise EvaluationDataError(f"{label}.relevance must be between 1 and 3")
        return cls(document_id=document_id, relevance=relevance)


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    question: str
    reference_answer: str
    qrels: Tuple[Qrel, ...]
    tags: Tuple[str, ...] = ()

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any], line_number: int) -> "EvalCase":
        label = f"cases.jsonl line {line_number}"
        case_id = _require_text(raw.get("id"), f"{label}.id")
        if not _ID_RE.fullmatch(case_id):
            raise EvaluationDataError(
                f"{label}.id must match {_ID_RE.pattern!r}; got {case_id!r}"
            )
        question = _require_text(raw.get("question"), f"{label}.question")
        reference_answer = _require_text(
            raw.get("reference_answer"), f"{label}.reference_answer"
        )
        raw_qrels = raw.get("qrels")
        if not isinstance(raw_qrels, list) or not raw_qrels:
            raise EvaluationDataError(f"{label}.qrels must be a non-empty array")
        qrels = tuple(
            Qrel.from_mapping(
                _require_mapping(value, f"{label}.qrels[{index}]"),
                f"{label}.qrels[{index}]",
            )
            for index, value in enumerate(raw_qrels)
        )
        normalized = [normalize_document_id(item.document_id) for item in qrels]
        if len(normalized) != len(set(normalized)):
            raise EvaluationDataError(f"{label}.qrels contains duplicate document_id values")

        raw_tags = raw.get("tags", [])
        if not isinstance(raw_tags, list) or any(
            not isinstance(tag, str) or not tag.strip() for tag in raw_tags
        ):
            raise EvaluationDataError(f"{label}.tags must be an array of strings")
        tags = tuple(dict.fromkeys(tag.strip() for tag in raw_tags))
        return cls(
            case_id=case_id,
            question=question,
            reference_answer=reference_answer,
            qrels=qrels,
            tags=tags,
        )


@dataclass(frozen=True)
class EvidenceContext:
    document_id: str
    content: str
    score: Optional[float] = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any], label: str) -> "EvidenceContext":
        document_id = raw.get("document_id", "")
        if not isinstance(document_id, str):
            raise EvaluationDataError(f"{label}.document_id must be a string")
        content = raw.get("content", "")
        if not isinstance(content, str):
            raise EvaluationDataError(f"{label}.content must be a string")
        score_raw = raw.get("score")
        score = None if score_raw is None else _as_float(score_raw, f"{label}.score")
        metadata = raw.get("metadata", {})
        if not isinstance(metadata, Mapping):
            raise EvaluationDataError(f"{label}.metadata must be an object")
        return cls(
            document_id=document_id.strip(),
            content=content,
            score=score,
            metadata=dict(metadata),
        )

    def to_mapping(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "document_id": self.document_id,
            "content": self.content,
        }
        if self.score is not None:
            result["score"] = self.score
        if self.metadata:
            result["metadata"] = dict(self.metadata)
        return result


@dataclass(frozen=True)
class ClaimJudgment:
    claim: str
    supported: bool
    reason: str = ""

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any], label: str) -> "ClaimJudgment":
        claim = _require_text(raw.get("claim"), f"{label}.claim")
        supported = raw.get("supported")
        if not isinstance(supported, bool):
            raise EvaluationDataError(f"{label}.supported must be boolean")
        reason = raw.get("reason", "")
        if not isinstance(reason, str):
            raise EvaluationDataError(f"{label}.reason must be a string")
        return cls(claim=claim, supported=supported, reason=reason.strip())

    def to_mapping(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {"claim": self.claim, "supported": self.supported}
        if self.reason:
            result["reason"] = self.reason
        return result


@dataclass(frozen=True)
class GenerationJudgment:
    claims: Tuple[ClaimJudgment, ...]
    answer_relevance: float
    context_relevance: Tuple[bool, ...]

    @classmethod
    def from_mapping(
        cls,
        raw: Mapping[str, Any],
        label: str = "generation_judgment",
    ) -> "GenerationJudgment":
        raw_claims = raw.get("claims")
        if not isinstance(raw_claims, list):
            raise EvaluationDataError(f"{label}.claims must be an array")
        claims = tuple(
            ClaimJudgment.from_mapping(
                _require_mapping(item, f"{label}.claims[{index}]"),
                f"{label}.claims[{index}]",
            )
            for index, item in enumerate(raw_claims)
        )
        answer_relevance = _as_float(
            raw.get("answer_relevance"), f"{label}.answer_relevance"
        )
        if not 0.0 <= answer_relevance <= 1.0:
            raise EvaluationDataError(f"{label}.answer_relevance must be in [0, 1]")
        raw_context_relevance = raw.get("context_relevance")
        if not isinstance(raw_context_relevance, list) or any(
            not isinstance(value, bool) for value in raw_context_relevance
        ):
            raise EvaluationDataError(
                f"{label}.context_relevance must be an array of booleans"
            )
        return cls(
            claims=claims,
            answer_relevance=answer_relevance,
            context_relevance=tuple(raw_context_relevance),
        )

    def to_mapping(self) -> Dict[str, Any]:
        return {
            "claims": [item.to_mapping() for item in self.claims],
            "answer_relevance": self.answer_relevance,
            "context_relevance": list(self.context_relevance),
        }


@dataclass(frozen=True)
class Prediction:
    case_id: str
    answer: str
    retrieved_contexts: Tuple[EvidenceContext, ...]
    generation_contexts: Tuple[EvidenceContext, ...] = ()
    generation_judgment: Optional[GenerationJudgment] = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any], line_number: int = 0) -> "Prediction":
        label = f"predictions.jsonl line {line_number}" if line_number else "prediction"
        case_id = _require_text(raw.get("id"), f"{label}.id")
        answer = raw.get("answer", "")
        if not isinstance(answer, str):
            raise EvaluationDataError(f"{label}.answer must be a string")

        def contexts_for(key: str) -> Tuple[EvidenceContext, ...]:
            values = raw.get(key, [])
            if not isinstance(values, list):
                raise EvaluationDataError(f"{label}.{key} must be an array")
            return tuple(
                EvidenceContext.from_mapping(
                    _require_mapping(item, f"{label}.{key}[{index}]"),
                    f"{label}.{key}[{index}]",
                )
                for index, item in enumerate(values)
            )

        retrieved_contexts = contexts_for("retrieved_contexts")
        generation_contexts = contexts_for("generation_contexts")
        judgment_raw = raw.get("generation_judgment")
        judgment = None
        if judgment_raw is not None:
            judgment = GenerationJudgment.from_mapping(
                _require_mapping(judgment_raw, f"{label}.generation_judgment"),
                f"{label}.generation_judgment",
            )
            judged_contexts = generation_contexts or retrieved_contexts
            if len(judgment.context_relevance) != len(judged_contexts):
                raise EvaluationDataError(
                    f"{label}.generation_judgment.context_relevance has "
                    f"{len(judgment.context_relevance)} values for "
                    f"{len(judged_contexts)} contexts"
                )
        metadata = raw.get("metadata", {})
        if not isinstance(metadata, Mapping):
            raise EvaluationDataError(f"{label}.metadata must be an object")
        return cls(
            case_id=case_id,
            answer=answer,
            retrieved_contexts=retrieved_contexts,
            generation_contexts=generation_contexts,
            generation_judgment=judgment,
            metadata=dict(metadata),
        )

    def to_mapping(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "id": self.case_id,
            "answer": self.answer,
            "retrieved_contexts": [item.to_mapping() for item in self.retrieved_contexts],
            "generation_contexts": [item.to_mapping() for item in self.generation_contexts],
        }
        if self.generation_judgment is not None:
            result["generation_judgment"] = self.generation_judgment.to_mapping()
        if self.metadata:
            result["metadata"] = dict(self.metadata)
        return result


@dataclass(frozen=True)
class EvalDataset:
    manifest_path: Path
    name: str
    version: str
    description: str
    documents: Tuple[CorpusDocument, ...]
    cases: Tuple[EvalCase, ...]
    fingerprint: str

    @property
    def root(self) -> Path:
        return self.manifest_path.parent

    @property
    def document_paths(self) -> Tuple[Path, ...]:
        return tuple((self.root / document.path).resolve() for document in self.documents)

    @classmethod
    def load(cls, manifest_path: Path | str) -> "EvalDataset":
        path = Path(manifest_path).expanduser().resolve()
        try:
            manifest_bytes = path.read_bytes()
        except OSError as error:
            raise EvaluationDataError(f"cannot read dataset manifest {path}: {error}") from error
        try:
            raw = _require_mapping(json.loads(manifest_bytes), "manifest")
        except json.JSONDecodeError as error:
            raise EvaluationDataError(f"invalid JSON in {path}: {error}") from error
        if str(raw.get("schema_version")) != SCHEMA_VERSION:
            raise EvaluationDataError(
                f"manifest.schema_version must be {SCHEMA_VERSION!r}"
            )
        name = _require_text(raw.get("name"), "manifest.name")
        version = _require_text(raw.get("version"), "manifest.version")
        description = _require_text(raw.get("description"), "manifest.description")

        raw_documents = raw.get("corpus")
        if not isinstance(raw_documents, list) or not raw_documents:
            raise EvaluationDataError("manifest.corpus must be a non-empty array")
        documents = tuple(
            CorpusDocument.from_mapping(
                _require_mapping(item, f"manifest.corpus[{index}]"), index
            )
            for index, item in enumerate(raw_documents)
        )
        document_ids = [normalize_document_id(item.document_id) for item in documents]
        if len(document_ids) != len(set(document_ids)):
            raise EvaluationDataError("manifest.corpus contains duplicate document_id values")

        cases_relative = _safe_relative_path(raw.get("cases"), "manifest.cases")
        cases_path = (path.parent / cases_relative).resolve()
        if path.parent not in cases_path.parents:
            raise EvaluationDataError("manifest.cases resolves outside the dataset directory")
        try:
            cases_bytes = cases_path.read_bytes()
        except OSError as error:
            raise EvaluationDataError(f"cannot read cases file {cases_path}: {error}") from error
        cases = _load_cases(cases_bytes, cases_path)
        case_ids = [case.case_id for case in cases]
        if len(case_ids) != len(set(case_ids)):
            raise EvaluationDataError("cases.jsonl contains duplicate case ids")

        known_documents = set(document_ids)
        for case in cases:
            unknown = sorted(
                {
                    qrel.document_id
                    for qrel in case.qrels
                    if normalize_document_id(qrel.document_id) not in known_documents
                }
            )
            if unknown:
                raise EvaluationDataError(
                    f"case {case.case_id!r} references unknown corpus documents: {unknown}"
                )

        digest = hashlib.sha256()
        digest.update(manifest_bytes)
        digest.update(cases_bytes)
        for document in documents:
            document_path = (path.parent / document.path).resolve()
            if path.parent not in document_path.parents:
                raise EvaluationDataError(
                    f"corpus path resolves outside the dataset directory: {document.path}"
                )
            try:
                document_bytes = document_path.read_bytes()
            except OSError as error:
                raise EvaluationDataError(
                    f"cannot read corpus document {document_path}: {error}"
                ) from error
            actual_sha = hashlib.sha256(document_bytes).hexdigest()
            if actual_sha != document.sha256:
                raise EvaluationDataError(
                    f"SHA-256 mismatch for {document.document_id}: "
                    f"expected {document.sha256}, got {actual_sha}"
                )
            digest.update(document.document_id.encode("utf-8"))
            digest.update(document_bytes)

        return cls(
            manifest_path=path,
            name=name,
            version=version,
            description=description,
            documents=documents,
            cases=cases,
            fingerprint=digest.hexdigest(),
        )


def _load_cases(raw: bytes, path: Path) -> Tuple[EvalCase, ...]:
    cases: List[EvalCase] = []
    for line_number, line in enumerate(raw.decode("utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise EvaluationDataError(
                f"invalid JSON in {path} line {line_number}: {error}"
            ) from error
        cases.append(
            EvalCase.from_mapping(
                _require_mapping(value, f"{path.name} line {line_number}"), line_number
            )
        )
    if not cases:
        raise EvaluationDataError(f"{path} contains no evaluation cases")
    return tuple(cases)


def load_predictions(path: Path | str) -> Dict[str, Prediction]:
    prediction_path = Path(path).expanduser().resolve()
    try:
        lines = prediction_path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise EvaluationDataError(f"cannot read predictions {prediction_path}: {error}") from error
    predictions: Dict[str, Prediction] = {}
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            raw = _require_mapping(
                json.loads(line), f"predictions.jsonl line {line_number}"
            )
        except json.JSONDecodeError as error:
            raise EvaluationDataError(
                f"invalid JSON in {prediction_path} line {line_number}: {error}"
            ) from error
        prediction = Prediction.from_mapping(raw, line_number)
        if prediction.case_id in predictions:
            raise EvaluationDataError(
                f"duplicate prediction for case {prediction.case_id!r}"
            )
        predictions[prediction.case_id] = prediction
    if not predictions:
        raise EvaluationDataError(f"{prediction_path} contains no predictions")
    return predictions


def write_predictions(path: Path | str, predictions: Iterable[Prediction]) -> None:
    destination = Path(path).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        json.dumps(prediction.to_mapping(), ensure_ascii=False, sort_keys=True)
        for prediction in predictions
    ]
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
