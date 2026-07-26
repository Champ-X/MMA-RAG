"""Safe end-to-end collection against a Tessmora evaluation instance."""

from __future__ import annotations

import json
import mimetypes
import re
import time
import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .judge import OpenAICompatibleJudge
from .schema import (
    EvalCase,
    EvalDataset,
    EvidenceContext,
    Prediction,
    normalize_document_id,
)


class LiveEvaluationError(RuntimeError):
    """Raised when live collection is unsafe or the Tessmora API fails."""


class TessmoraEvaluationClient:
    def __init__(
        self,
        base_url: str,
        *,
        request_timeout: float = 360.0,
        upload_timeout: float = 1800.0,
    ) -> None:
        if not base_url.startswith(("http://", "https://")):
            raise LiveEvaluationError("base URL must be an http(s) URL")
        self.base_url = base_url.rstrip("/")
        self.request_timeout = request_timeout
        self.upload_timeout = upload_timeout

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Mapping[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Any:
        data = None
        headers = {"Accept": "application/json"}
        if json_body is not None:
            data = json.dumps(dict(json_body), ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(
            f"{self.base_url}/{path.lstrip('/')}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=timeout or self.request_timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            raise LiveEvaluationError(
                f"Tessmora request failed: {method} {path}: HTTP {error.code}: {detail}"
            ) from error
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
            raise LiveEvaluationError(
                f"Tessmora request failed: {method} {path}: {error}"
            ) from error

    def health(self) -> Mapping[str, Any]:
        body = self._request("GET", "/health")
        if not isinstance(body, Mapping):
            raise LiveEvaluationError("health endpoint returned a non-object response")
        return body

    def list_knowledge_bases(self) -> Sequence[Mapping[str, Any]]:
        body = self._request("GET", "/api/knowledge/")
        values = body.get("knowledge_bases", []) if isinstance(body, Mapping) else []
        if not isinstance(values, list):
            raise LiveEvaluationError("knowledge-base list returned an invalid response")
        return [item for item in values if isinstance(item, Mapping)]

    def create_knowledge_base(self, name: str, description: str) -> str:
        body = self._request(
            "POST",
            "/api/knowledge/",
            json_body={"name": name, "description": description},
        )
        kb_id = body.get("id") if isinstance(body, Mapping) else None
        if not isinstance(kb_id, str) or not kb_id:
            raise LiveEvaluationError("knowledge-base create response has no id")
        return kb_id

    def list_files(self, kb_id: str) -> Sequence[Mapping[str, Any]]:
        body = self._request("GET", f"/api/knowledge/{kb_id}/files")
        values = body.get("files", []) if isinstance(body, Mapping) else []
        if not isinstance(values, list):
            raise LiveEvaluationError("file list returned an invalid response")
        return [item for item in values if isinstance(item, Mapping)]

    def knowledge_base_stats(self, kb_id: str) -> Mapping[str, Any]:
        body = self._request("GET", f"/api/knowledge/{kb_id}/stats")
        if not isinstance(body, Mapping):
            raise LiveEvaluationError("knowledge-base stats returned an invalid response")
        return body

    def upload_documents(self, kb_id: str, paths: Sequence[Path]) -> List[str]:
        if not paths:
            return []
        boundary = f"----tessmora-eval-{uuid.uuid4().hex}"
        chunks = [
            (
                f"--{boundary}\r\n"
                'Content-Disposition: form-data; name="kb_id"\r\n\r\n'
                f"{kb_id}\r\n"
            ).encode("utf-8")
        ]
        for path in paths:
            filename = path.name.replace('"', "")
            content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            chunks.extend(
                (
                    (
                        f"--{boundary}\r\n"
                        f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'
                        f"Content-Type: {content_type}\r\n\r\n"
                    ).encode("utf-8"),
                    path.read_bytes(),
                    b"\r\n",
                )
            )
        chunks.append(f"--{boundary}--\r\n".encode("ascii"))
        request = Request(
            f"{self.base_url}/api/upload/batch/start",
            data=b"".join(chunks),
            headers={
                "Accept": "application/json",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.upload_timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            raise LiveEvaluationError(
                f"corpus upload failed: HTTP {error.code}: {detail}"
            ) from error
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
            raise LiveEvaluationError(f"corpus upload failed: {error}") from error
        results = body.get("results", []) if isinstance(body, Mapping) else []
        processing_ids: List[str] = []
        failures: List[str] = []
        for result in results if isinstance(results, list) else []:
            if not isinstance(result, Mapping):
                continue
            processing_id = result.get("processing_id")
            if isinstance(processing_id, str) and processing_id:
                processing_ids.append(processing_id)
            elif str(result.get("status", "")).lower() == "failed":
                failures.append(str(result.get("error") or result.get("filename") or "unknown"))
        if failures:
            raise LiveEvaluationError(f"corpus upload rejected files: {failures}")
        if not processing_ids:
            raise LiveEvaluationError("corpus upload returned no processing ids")
        return processing_ids

    def wait_for_ingestion(
        self,
        processing_ids: Sequence[str],
        *,
        timeout_seconds: float = 5400.0,
        poll_interval: float = 2.0,
    ) -> None:
        deadline = time.monotonic() + timeout_seconds
        pending = set(processing_ids)
        while pending:
            for processing_id in tuple(pending):
                body = self._request(
                    "GET", f"/api/upload/progress/{processing_id}"
                )
                status = str(body.get("status", "")).lower() if isinstance(body, Mapping) else ""
                if status == "completed":
                    pending.remove(processing_id)
                elif status == "failed":
                    detail = body.get("error") or body.get("message") if isinstance(body, Mapping) else ""
                    raise LiveEvaluationError(
                        f"ingestion job {processing_id} failed: {detail}"
                    )
            if pending and time.monotonic() >= deadline:
                raise LiveEvaluationError(
                    f"timed out waiting for ingestion jobs: {sorted(pending)}"
                )
            if pending:
                time.sleep(poll_interval)

    def search(self, case: EvalCase, kb_id: str, top_k: int) -> Tuple[EvidenceContext, ...]:
        body = self._request(
            "POST",
            "/api/v1/retrieval/search",
            json_body={
                "query": case.question,
                "knowledge_base_ids": [kb_id],
                "top_k": top_k,
            },
        )
        raw_results = body.get("results", []) if isinstance(body, Mapping) else []
        contexts: List[EvidenceContext] = []
        for result in raw_results if isinstance(raw_results, list) else []:
            if not isinstance(result, Mapping):
                continue
            source = result.get("source") if isinstance(result.get("source"), Mapping) else {}
            document_id = str(
                source.get("file_name") or source.get("file_path") or result.get("id") or ""
            )
            metadata = {
                "evidence_id": result.get("id"),
                "modality": result.get("modality"),
                "source": dict(source),
            }
            contexts.append(
                EvidenceContext(
                    document_id=document_id,
                    content=str(result.get("content") or ""),
                    score=float(result.get("score") or 0.0),
                    metadata=metadata,
                )
            )
        return tuple(contexts)

    def ask(
        self,
        case: EvalCase,
        kb_id: str,
        *,
        agent_mode: str,
    ) -> Tuple[str, Tuple[EvidenceContext, ...], Mapping[str, Any]]:
        body = self._request(
            "POST",
            "/api/chat/message",
            json_body={
                "message": case.question,
                "knowledgeBaseIds": [kb_id],
                "agentMode": agent_mode,
            },
        )
        if not isinstance(body, Mapping) or not body.get("success", False):
            raise LiveEvaluationError(f"answer generation failed for case {case.case_id}")
        citations = body.get("citations", [])
        contexts: List[EvidenceContext] = []
        for citation in citations if isinstance(citations, list) else []:
            if not isinstance(citation, Mapping):
                continue
            metadata = citation.get("metadata")
            if not isinstance(metadata, Mapping):
                metadata = {}
            contexts.append(
                EvidenceContext(
                    document_id=str(citation.get("file_name") or citation.get("id") or ""),
                    content=str(citation.get("content") or ""),
                    score=float(citation.get("score") or 0.0),
                    metadata=dict(metadata),
                )
            )
        response_metadata = body.get("metadata")
        if not isinstance(response_metadata, Mapping):
            response_metadata = {}
        return str(body.get("message") or ""), tuple(contexts), dict(response_metadata)


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return cleaned or "dataset"


def _file_name(item: Mapping[str, Any]) -> str:
    return str(
        item.get("name")
        or item.get("filename")
        or item.get("file_name")
        or item.get("file_path")
        or ""
    )


def ensure_isolated_target(
    health: Mapping[str, Any],
    *,
    kb_id: Optional[str],
    allow_shared_read_only: bool,
) -> bool:
    """Return whether provisioning is allowed, or reject an unsafe target."""
    evaluation_mode = health.get("evaluation_mode") is True
    if evaluation_mode:
        return True
    if kb_id and allow_shared_read_only:
        return False
    raise LiveEvaluationError(
        "target is not marked evaluation_mode=true; use the isolated evaluation stack. "
        "A normal instance is accepted only with both --kb-id and "
        "--allow-shared-read-only, and will never be provisioned."
    )


def ensure_corpus(
    client: TessmoraEvaluationClient,
    dataset: EvalDataset,
    *,
    kb_id: Optional[str],
    allow_provisioning: bool,
    progress: Callable[[str], None],
) -> str:
    expected = {
        normalize_document_id(document.document_id): path
        for document, path in zip(dataset.documents, dataset.document_paths)
    }
    expected_ids = set(expected)

    def corpus_state(candidate_kb_id: str) -> Tuple[set[str], int]:
        files = client.list_files(candidate_kb_id)
        present_ids = {
            normalize_document_id(_file_name(item))
            for item in files
            if _file_name(item)
        }
        stats = client.knowledge_base_stats(candidate_kb_id)
        try:
            chunks = int(stats.get("chunks") or 0)
        except (TypeError, ValueError):
            chunks = 0
        return present_ids, chunks

    selected_kb_id = kb_id
    if selected_kb_id is None:
        if not allow_provisioning:
            raise LiveEvaluationError("a knowledge-base id is required for read-only evaluation")
        name = (
            f"__tessmora_eval__{_slug(dataset.name)}-{dataset.version}-"
            f"{dataset.fingerprint[:10]}"
        )
        candidates = [
            str(item["id"])
            for item in client.list_knowledge_bases()
            if str(item.get("name") or "") == name and item.get("id")
        ]
        for candidate_kb_id in candidates:
            present, chunks = corpus_state(candidate_kb_id)
            if expected_ids.issubset(present) and chunks >= len(expected_ids):
                progress(f"reusing isolated evaluation KB {candidate_kb_id}")
                return candidate_kb_id
            progress(
                f"ignoring incomplete evaluation KB {candidate_kb_id} "
                f"(documents={len(present)}, chunks={chunks})"
            )
        selected_kb_id = client.create_knowledge_base(
            name,
            (
                f"Synthetic RAG evaluation corpus {dataset.name} {dataset.version}; "
                f"fingerprint={dataset.fingerprint}"
            ),
        )
        progress(f"created isolated evaluation KB {selected_kb_id}")

    present, chunks = corpus_state(selected_kb_id)
    if present and chunks < len(expected_ids):
        raise LiveEvaluationError(
            f"KB {selected_kb_id} contains corpus files but only {chunks} indexed chunks; "
            "use automatic provisioning without --kb-id to create a clean isolated KB"
        )
    missing_ids = [document_id for document_id in expected if document_id not in present]
    if missing_ids and not allow_provisioning:
        raise LiveEvaluationError(
            "read-only KB does not contain the complete synthetic corpus; missing "
            + ", ".join(missing_ids)
        )
    if missing_ids:
        progress(f"uploading {len(missing_ids)} missing synthetic corpus documents")
        # Submit one document at a time. Besides reducing model-provider bursts,
        # this avoids cold-start collection races on a brand-new Qdrant volume.
        for index, document_id in enumerate(missing_ids, start=1):
            progress(f"corpus [{index}/{len(missing_ids)}] {document_id}")
            processing_ids = client.upload_documents(
                selected_kb_id, [expected[document_id]]
            )
            client.wait_for_ingestion(processing_ids)
        progress("synthetic corpus ingestion completed")
    present, chunks = corpus_state(selected_kb_id)
    if not expected_ids.issubset(present) or chunks < len(expected_ids):
        raise LiveEvaluationError(
            f"corpus verification failed for KB {selected_kb_id}: "
            f"documents={len(present)}, chunks={chunks}"
        )
    return selected_kb_id


def collect_predictions(
    *,
    client: TessmoraEvaluationClient,
    dataset: EvalDataset,
    kb_id: str,
    top_k: int,
    agent_mode: str,
    retrieval_only: bool,
    judge: Optional[OpenAICompatibleJudge],
    service_metadata: Optional[Mapping[str, Any]],
    progress: Callable[[str], None],
) -> Tuple[List[Prediction], Dict[str, Any]]:
    predictions: List[Prediction] = []
    model_names: set[str] = set()
    common_run_metadata = {
        "agent_mode": agent_mode,
        "top_k": top_k,
        "retrieval_only": retrieval_only,
        "judge": judge.metadata if judge is not None else {"backend": "none"},
        **({"service": dict(service_metadata)} if service_metadata else {}),
    }
    for index, case in enumerate(dataset.cases, start=1):
        progress(f"[{index}/{len(dataset.cases)}] {case.case_id}: retrieval")
        started = time.monotonic()
        retrieved_contexts = client.search(case, kb_id, top_k)
        retrieval_seconds = time.monotonic() - started
        answer = ""
        generation_contexts: Tuple[EvidenceContext, ...] = ()
        response_metadata: Mapping[str, Any] = {}
        generation_seconds = 0.0
        judgment = None
        if not retrieval_only:
            progress(f"[{index}/{len(dataset.cases)}] {case.case_id}: generation")
            started = time.monotonic()
            answer, generation_contexts, response_metadata = client.ask(
                case, kb_id, agent_mode=agent_mode
            )
            generation_seconds = time.monotonic() - started
            model_name = response_metadata.get("model_used")
            if isinstance(model_name, str) and model_name:
                model_names.add(model_name)
            if judge is not None:
                progress(f"[{index}/{len(dataset.cases)}] {case.case_id}: judge")
                judgment = judge.judge(
                    case=case,
                    answer=answer,
                    contexts=generation_contexts or retrieved_contexts,
                )
        predictions.append(
            Prediction(
                case_id=case.case_id,
                answer=answer,
                retrieved_contexts=retrieved_contexts,
                generation_contexts=generation_contexts,
                generation_judgment=judgment,
                metadata={
                    "retrieval_seconds": round(retrieval_seconds, 6),
                    "generation_seconds": round(generation_seconds, 6),
                    "agent_mode": agent_mode,
                    "response": dict(response_metadata),
                    "run": common_run_metadata,
                },
            )
        )
    return predictions, {
        **common_run_metadata,
        "generation_models": sorted(model_names),
    }


def judge_predictions(
    *,
    dataset: EvalDataset,
    predictions: Mapping[str, Prediction],
    judge: OpenAICompatibleJudge,
    progress: Callable[[str], None],
) -> List[Prediction]:
    """Rejudge saved answers without repeating retrieval or generation."""
    expected = {case.case_id for case in dataset.cases}
    actual = set(predictions)
    if expected != actual:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise LiveEvaluationError(
            f"prediction ids do not match dataset: missing={missing}, extra={extra}"
        )

    judged: List[Prediction] = []
    for index, case in enumerate(dataset.cases, start=1):
        prediction = predictions[case.case_id]
        if not prediction.answer.strip():
            raise LiveEvaluationError(
                f"prediction {case.case_id} has no generated answer to judge"
            )
        contexts = prediction.generation_contexts or prediction.retrieved_contexts
        progress(f"[{index}/{len(dataset.cases)}] {case.case_id}: judge")
        judgment = judge.judge(case=case, answer=prediction.answer, contexts=contexts)
        metadata = dict(prediction.metadata)
        raw_run = metadata.get("run")
        run = dict(raw_run) if isinstance(raw_run, Mapping) else {}
        run["judge"] = judge.metadata
        metadata["run"] = run
        judged.append(
            replace(
                prediction,
                generation_judgment=judgment,
                metadata=metadata,
            )
        )
    return judged
