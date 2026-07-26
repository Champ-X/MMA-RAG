from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.api import retrieval as retrieval_api
from app.modules.retrieval.service import RetrievalResult


def _result(rows):
    return RetrievalResult(
        context=SimpleNamespace(
            refined_query="部署失败后的回滚步骤",
            intent_type="procedural",
            target_kbs=[{"id": "kb-1", "name": "部署资料", "score": 0.93}],
        ),
        raw_results={},
        reranked_results=rows,
        processing_time=0.42,
        debug_info={},
    )


def test_search_request_requires_one_kb_for_file_ids():
    with pytest.raises(ValidationError):
        retrieval_api.KnowledgeSearchRequest(
            query="回滚",
            knowledge_base_ids=["kb-1", "kb-2"],
            file_ids=["file-1"],
        )


def test_serialize_search_response_compacts_multimodal_payloads():
    request = retrieval_api.KnowledgeSearchRequest(query="怎么回滚", top_k=2)
    result = _result(
        [
            {
                "id": "video-1",
                "content_type": "video",
                "final_score": 0.91,
                "payload": {
                    "kb_id": "kb-1",
                    "file_id": "file-video",
                    "file_path": "videos/deploy-demo.mp4",
                    "scene_summary": "发布失败后的处理",
                    "caption": "工程师打开版本管理页面",
                    "asr_text": "点击回滚到上一版本",
                    "shot_start_time": 12.5,
                    "shot_end_time": 19.0,
                },
            },
            {
                "id": "doc-1",
                "content_type": "doc",
                "final_score": 0.88,
                "payload": {
                    "kb_id": "kb-1",
                    "file_id": "file-doc",
                    "file_path": "documents/deploy.pdf",
                    "text_content": "停止新版本实例并恢复上一版本。",
                    "page_number": 27,
                    "chunk_index": 3,
                },
            },
            {
                "id": "image-1",
                "content_type": "image",
                "final_score": 0.7,
                "payload": {"caption": "回滚按钮截图"},
            },
        ]
    )

    response = retrieval_api.serialize_search_response(
        request=request,
        retrieval_result=result,
    )

    assert len(response.results) == 2
    assert response.results[0].modality == "video"
    assert response.results[0].source.file_name == "deploy-demo.mp4"
    assert response.results[0].source.start_seconds == 12.5
    assert "语音：点击回滚到上一版本" in response.results[0].content
    assert response.results[1].source.page == 27
    assert response.target_knowledge_bases[0]["name"] == "部署资料"


@pytest.mark.asyncio
async def test_search_endpoint_builds_selected_file_context(monkeypatch):
    calls = []

    class FakeRetrieval:
        async def search(self, **kwargs):
            calls.append(kwargs)
            return _result([])

    monkeypatch.setattr(retrieval_api, "retrieval_service", FakeRetrieval())
    request = retrieval_api.KnowledgeSearchRequest(
        query="  回滚   步骤 ",
        knowledge_base_ids=["kb-1"],
        file_ids=["file-1"],
    )

    response = await retrieval_api.search_knowledge(request)

    assert response.query == "  回滚   步骤 "
    assert calls == [
        {
            "query": "回滚 步骤",
            "kb_context": {
                "kb_ids": ["kb-1"],
                "kb_names": [],
                "selected_files": [{"kb_id": "kb-1", "file_id": "file-1"}],
            },
        }
    ]
