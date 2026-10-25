"""Document checkpoints and stable index writes survive transient failures."""
import asyncio
import copy
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from minio.error import S3Error

from app.modules.ingestion.document_checkpoints import DocumentCheckpoints, retry_capabilities
from app.modules.ingestion.embedding import IngestionEmbeddingError
from app.modules.ingestion.service import IngestionService
from app.modules.ingestion.storage.vector_store import VectorStore
from test_processing_retirement import TransactionRedis, service, seed


class Response(io.BytesIO):
    def release_conn(self):
        pass


class Objects:
    def __init__(self):
        self.values = {}

    def get_object(self, bucket, path):
        if (bucket, path) not in self.values:
            raise S3Error("NoSuchKey", "missing", path, "request", "host", None)
        return Response(self.values[bucket, path])

    def put_object(self, bucket, path, stream, length, **_kwargs):
        self.values[bucket, path] = stream.read()
        assert len(self.values[bucket, path]) == length

    def stat_object(self, bucket, path):
        if (bucket, path) not in self.values:
            raise S3Error("NoSuchKey", "missing", path, "request", "host", None)


def test_checkpoint_roundtrip_binary_restart_and_identity():
    async def run():
        objects = Objects()
        cp = DocumentCheckpoints(objects, bucket="kb", file_id="file", object_path="documents/file.pdf")
        assert await cp.load("parsed") is None
        data = {"markdown": "正文", "extracted_images": [{"image_bytes": b"\x00\xffimage"}]}
        await cp.save("parsed", data)
        other = DocumentCheckpoints(objects, bucket="kb", file_id="file", object_path="documents/file.pdf")
        assert await other.load("parsed") == data
        wrong = DocumentCheckpoints(objects, bucket="kb", file_id="file", object_path="documents/new.pdf")
        with pytest.raises(ValueError, match="identity"):
            await wrong.load("parsed")
        with pytest.raises(ValueError):
            await cp.save("../other", {})
    asyncio.run(run())


def test_old_failure_is_retryable_but_unsaved_deleted_and_refused_are_not():
    status = dict(file_type="pdf", file_id="f", bucket="kb", object_path="documents/f.pdf", status="failed",
                  error="文本密集向量化失败: ReadTimeout: transport (HTTP None)")
    enriched = retry_capabilities(status)
    assert enriched["retry_supported"] and enriched["retryable"]
    assert enriched["failed_stage"] == "dense_embedding"
    assert enriched["error_code"] == "dense_embedding_timeout"
    assert "retry_supported" not in status  # read-only enrichment
    for patch in ({"file_id": None}, {"storage_persisted": False}, {"status": "deleted"}):
        assert retry_capabilities({**status, **patch})["retry_supported"] is False
    assert retry_capabilities({**status, "retryable": False})["retryable"] is False


def test_document_dense_failure_resumes_chunks_without_reparse_or_duplicate_images(monkeypatch):
    from app.core import portrait_trigger
    monkeypatch.setattr(portrait_trigger, "trigger_portrait_rebuild", Mock())
    async def run():
        owner = service(TransactionRedis())
        state = {**seed(owner), "file_type": "pdf", "file_path": "source.pdf"}
        owner._persist_processing_status(state)
        objects = Objects()
        objects.values[state["bucket"], state["object_path"]] = b"original"
        owner.minio_adapter = SimpleNamespace(client=objects, get_file_content=AsyncMock())
        owner.parser_factory = SimpleNamespace(parse_file=AsyncMock())
        chunks = [{"text": "first", "file_id": "file", "temp_id": "a"}, {"text": "second", "file_id": "file", "temp_id": "b"}]
        owner._prepare_document_chunks = AsyncMock(return_value=chunks)
        failure = IngestionEmbeddingError("timed out", error_code="dense_embedding_timeout", retryable=True)
        owner._embed_ingestion = AsyncMock(side_effect=[failure, [[0.1, 0.2], [0.3, 0.4]]])
        owner.sparse_encoder = SimpleNamespace(encode_corpus=lambda texts, batch_size: [{"sparse": {1: 0.5}} for _ in texts])
        owner.vector_store = SimpleNamespace(upsert_text_chunks=AsyncMock(return_value={"points_inserted": 2}))
        with pytest.raises(IngestionEmbeddingError):
            await owner._process_document({"file_type": "pdf"}, state, "space", "task", "source.pdf")
        owner.vector_store.upsert_text_chunks.assert_not_awaited()
        # A new process reads persisted checkpoints, with no source parse or image work.
        owner._prepare_document_chunks.reset_mock()
        result = await owner._reprocess_persisted_document(processing_id="task", status=state)
        assert result["vectors_stored"] == 2
        owner._prepare_document_chunks.assert_not_awaited()
        owner.parser_factory.parse_file.assert_not_awaited()
        owner.minio_adapter.get_file_content.assert_not_awaited()
        assert owner.get_processing_status_sync("task")["status"] == "completed"
        assert owner.get_processing_status_sync("task")["file_id"] == "file"
    asyncio.run(run())


def test_document_retry_rejects_duplicate_runner_and_preserves_file_identity():
    async def run():
        owner = service(TransactionRedis())
        owner._persist_processing_status({**seed(owner), "file_type": "pdf"})
        entered, release = asyncio.Event(), asyncio.Event()
        async def resume(**kwargs):
            entered.set()
            await release.wait()
            return {"file_id": kwargs["status"]["file_id"]}
        owner._reprocess_persisted_document = AsyncMock(side_effect=resume)
        receipt = owner.retry_file_processing("task")
        assert receipt["file_id"] == "file" and receipt["storage_persisted"] is True
        assert receipt["updated_at"]
        task = owner._background_upload_tasks["task"]
        await entered.wait()
        with pytest.raises(ValueError, match="仍在运行"):
            owner.retry_file_processing("task")
        release.set()
        await task
        assert owner._reprocess_persisted_document.await_count == 1
    asyncio.run(run())


def test_stable_text_ids_and_context_are_written_together_without_followups():
    async def run():
        store = VectorStore.__new__(VectorStore)
        store.client = SimpleNamespace(upsert=Mock(return_value=SimpleNamespace(operation_id=1)), set_payload=Mock())
        chunks = [{"file_id": "file", "text": "A", "vector": [1.0, 2.0], "temp_id": "a", "context_window": {"next_chunk_id": "b"}},
                  {"file_id": "file", "text": "B", "vector": [2.0, 3.0], "temp_id": "b", "context_window": {"prev_chunk_id": "a"}}]
        await store.upsert_text_chunks("kb", copy.deepcopy(chunks))
        await store.upsert_text_chunks("kb", copy.deepcopy(chunks))
        first, second = [call.kwargs["points"] for call in store.client.upsert.call_args_list]
        assert [p.id for p in first] == [p.id for p in second]
        assert first[1].id in first[0].payload["context_window"]
        assert first[0].id in first[1].payload["context_window"]
        store.client.set_payload.assert_not_called()
        assert store.client.upsert.call_args.kwargs["wait"] is True
    asyncio.run(run())


def test_replacement_prunes_only_old_points_of_exact_file_after_acknowledgement():
    async def run():
        store = VectorStore.__new__(VectorStore)
        events = []
        def upsert(**kwargs):
            events.append("upsert")
            return SimpleNamespace(operation_id=1)
        def delete(**kwargs):
            events.append("delete")
            filt = kwargs["points_selector"].filter
            assert {c.key: c.match.value for c in filt.must} == {"kb_id": "kb", "file_id": "file"}
            assert len(filt.must_not[0].has_id) == 1
        store.client = SimpleNamespace(upsert=Mock(side_effect=upsert), delete=Mock(side_effect=delete))
        chunks = [{"file_id": "file", "text": "A", "vector": [1.0]}]
        await store.upsert_text_chunks("kb", chunks, replace_file_id="file")
        assert events == ["upsert", "delete"]
        store.client.upsert.side_effect = OSError("unacknowledged")
        store.client.delete.reset_mock()
        with pytest.raises(OSError):
            await store.upsert_text_chunks("kb", chunks, replace_file_id="file")
        store.client.delete.assert_not_called()
    asyncio.run(run())


@pytest.mark.parametrize("kind", ["checkpoint", "vectors"])
def test_cancelled_write_settles_before_task_releases_ownership(kind):
    import threading
    async def run():
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        def write(*_args, **_kwargs):
            entered.set()
            assert release.wait(3)
            finished.set()
            return SimpleNamespace(operation_id=1)
        if kind == "checkpoint":
            cp = DocumentCheckpoints(SimpleNamespace(put_object=write), bucket="kb", file_id="file", object_path="documents/f.pdf")
            pending = asyncio.create_task(cp.save("chunks", []))
        else:
            store = VectorStore.__new__(VectorStore)
            store.client = SimpleNamespace(upsert=write)
            pending = asyncio.create_task(store.upsert_text_chunks("kb", [{"text": "A", "file_id": "file", "vector": [1.0]}]))
        await asyncio.to_thread(entered.wait, 2)
        pending.cancel()
        await asyncio.sleep(0.01)
        assert not pending.done() and not finished.is_set()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert finished.is_set()
    asyncio.run(run())


@pytest.mark.parametrize("same_image,stable_old_id,cleanup_fails", [(True, False, False), (False, True, False), (False, False, False), (False, False, True)])
def test_legacy_images_require_content_identity_and_never_delete_replacement(same_image, stable_old_id, cleanup_fails):
    import uuid
    async def run():
        owner = service(TransactionRedis())
        state = {**seed(owner), "file_type": "pdf"}
        objects = Objects()
        new_fid = str(uuid.uuid5(uuid.NAMESPACE_URL, "file:1:0"))
        new_point = str(uuid.uuid5(uuid.NAMESPACE_URL, f"image:space:{new_fid}"))
        previous = {"caption": "old caption", "object_path": "images/old.jpg",
                    "point_id": new_point if stable_old_id else str(uuid.uuid4())}
        owner._existing_document_images = AsyncMock(return_value={"1:0": previous})
        owner.minio_adapter = SimpleNamespace(
            client=objects, get_file_content=AsyncMock(return_value=b"image" if same_image else b"changed"),
            upload_file=AsyncMock(return_value={"file_id": new_fid, "object_path": "images/new.jpg"}),
            delete_file=AsyncMock(return_value=True),
        )
        image_parser = SimpleNamespace(parse=AsyncMock(return_value={}))
        owner.parser_factory = SimpleNamespace(get_parser=lambda _type: image_parser)
        owner._process_image = AsyncMock(return_value={"caption": "new caption", "vectors_stored": 1})
        owner.vector_store = SimpleNamespace(client=SimpleNamespace(delete=Mock(side_effect=OSError("cleanup failed") if cleanup_fails else None)))
        owner.agentic_document_chunker = SimpleNamespace(chunk_parse_result=AsyncMock(return_value=[{"text": "text"}]))
        parsed = {"file_type": "pdf", "markdown": "![figure](image.jpg)", "extracted_images": [
            {"page": 1, "image_index": 0, "image_bytes": b"image", "markdown_ref": "![figure](image.jpg)"}
        ]}
        if cleanup_fails:
            with pytest.raises(RuntimeError, match="图片未处理完成"):
                await owner._prepare_document_chunks(parsed, state, "space", "task")
            owner.agentic_document_chunker.chunk_parse_result.assert_not_awaited()
            assert await owner._document_checkpoints(state).load("images") is None
            return
        await owner._prepare_document_chunks(parsed, state, "space", "task")
        markdown = owner.agentic_document_chunker.chunk_parse_result.call_args.args[0]["markdown"]
        if same_image:
            owner._process_image.assert_not_awaited()
            owner.minio_adapter.upload_file.assert_not_awaited()
            assert "old caption" in markdown
        else:
            owner._process_image.assert_awaited_once()
            assert "new caption" in markdown and "old caption" not in markdown
        if same_image or stable_old_id:
            owner.vector_store.client.delete.assert_not_called()
        else:
            owner.vector_store.client.delete.assert_called_once()
    asyncio.run(run())


def test_empty_document_never_replaces_existing_index():
    async def run():
        owner = service(TransactionRedis())
        state = seed(owner)
        owner.minio_adapter = SimpleNamespace(client=Objects())
        owner._prepare_document_chunks = AsyncMock(return_value=[])
        owner.vector_store = SimpleNamespace(upsert_text_chunks=AsyncMock())
        with pytest.raises(ValueError, match="未得到可索引文本"):
            await owner._process_document({}, state, "space", "task")
        owner.vector_store.upsert_text_chunks.assert_not_awaited()
        assert await owner._document_checkpoints(state).load("chunks") is None
    asyncio.run(run())


def test_document_completion_never_claimed_if_shared_status_write_fails():
    from app.modules.ingestion.service import ProcessingStatusUnavailableError
    owner = service(TransactionRedis())
    owner._persist_processing_status({**seed(owner), "file_type": "pdf", "status": "processing"})
    owner._get_processing_status_redis_client = lambda: None
    with pytest.raises(ProcessingStatusUnavailableError):
        owner._update_processing_status("task", {"status": "completed", "progress": 100})
    assert owner._processing_status["task"]["status"] == "processing"


def test_document_caption_refusal_keeps_structured_failure_and_cannot_be_cached():
    from app.modules.ingestion.document_checkpoints import DocumentProcessingError, usable_image_caption
    async def run():
        owner = service(TransactionRedis())
        result = SimpleNamespace(success=False, error="refused", error_category="content_policy",
                                 retryable=False, provider_code="DataInspectionFailed", request_id="req", model_used="model")
        owner.llm_manager = SimpleNamespace(chat=AsyncMock(return_value=result))
        with pytest.raises(DocumentProcessingError) as caught:
            await owner._generate_image_caption("aW1hZ2U=", "task", strict=True)
        fields = caught.value.status_fields()
        assert fields["retryable"] is False and fields["provider_request_id"] == "req"
        assert fields["error_code"] == "content_policy"
        assert not usable_image_caption("无法生成图片描述，VLM API调用失败")
    asyncio.run(run())


@pytest.mark.parametrize("legacy", [False, True])
def test_document_preview_reads_every_page_instead_of_truncating_at_200(legacy):
    from app.modules.knowledge.service import KnowledgeBaseService
    kb = KnowledgeBaseService.__new__(KnowledgeBaseService)
    pages = [(list(range(200)), "next"), (list(range(200, 284)), None)]
    kb.vector_store = SimpleNamespace(client=SimpleNamespace(scroll=Mock(side_effect=pages)))
    points = kb._scroll_text_points_by_file_id("file") if legacy else kb._scroll_text_points("kb", "file")
    assert points == list(range(284))
    calls = kb.vector_store.client.scroll.call_args_list
    assert calls[0].kwargs["offset"] is None and calls[1].kwargs["offset"] == "next"
    assert calls[1].kwargs["with_vectors"] is False
