import json
import subprocess
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.chat.attachment_summarizer import _classify_attachment, ChatAttachmentSummarizer
from app.modules.chat.media_probe import inspect_attachment_media, sample_video
from app.modules.generation.context_builder import ContextBuilder
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter
from app.modules.generation.stream_manager import _reference_map_to_frontend_refs
from app.modules.generation.citation_selection import select_answer_references


@pytest.mark.asyncio
async def test_local_evidence_has_distinct_numeric_ids_and_only_cited_successes_survive():
    builder = ContextBuilder.__new__(ContextBuilder)
    builder.max_context_length = 4000
    builder.formatter = MultiModalFormatter()
    builder.minio_adapter = SimpleNamespace(get_presigned_url=AsyncMock())
    builder._process_retrieval_results = AsyncMock(return_value=[{
        'id': 'chunk', 'content_type': 'doc', 'file_path': 'guide.md', 'file_type': 'md',
        'content': 'Knowledge evidence', 'score': .8, 'metadata': {'kb_id': 'kb'},
    }])
    attachments = [dict(id='a', index=1, name='same.png', kind='image', status='ready', summary='green mountains'),
                   dict(id='b', index=2, name='same.png', kind='image', status='ready', summary='red flowers'),
                   dict(id='c', index=3, name='failed.wav', kind='audio', status='failed', summary='not evidence')]
    built = await builder.build_context(SimpleNamespace(reranked_results=[]), 'compare', attachment_files=attachments + attachments[:1])
    assert list(built.reference_map) == ['1', '2', '3']
    assert '本机附件A1' in built.context_string and '【材料 2】' in built.context_string
    assert 'not evidence' not in built.context_string
    refs = _reference_map_to_frontend_refs(built.reference_map)
    assert refs[1]['attachment_id'] == 'a' and refs[2]['attachment_id'] == 'b'
    assert refs[1]['source'] == 'attachment' and refs[1]['file_name'] == 'same.png'
    assert not {'file_path', 'debug_info', 'scores', 'img_url'} & refs[1].keys()
    assert [r['id'] for r in select_answer_references('山水 [2]；参考指南 [1]。再次 [2]。', refs)] == [2, 1]
    assert select_answer_references('没有足够依据回答。', refs) == []
    builder.minio_adapter.get_presigned_url.assert_not_awaited()
    builder.max_context_length = 1
    compressed = await builder._optimize_context_length(built.context_string, built.reference_map)
    assert 'green mountains' in compressed and '本机附件A2' in compressed


@pytest.fixture
def tiny_video(tmp_path):
    path = tmp_path / 'sample.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=160x90:d=2:r=5',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-shortest', str(path)], check=True, timeout=20)
    return path.read_bytes()


def test_video_validates_tracks_and_samples_real_timestamps(tiny_video):
    assert _classify_attachment('sample.mp4', 'video/mp4', tiny_video) == 'video'
    facts = inspect_attachment_media(tiny_video, 'video')
    assert facts['duration_seconds'] == 2 and facts['has_audio']
    frames, audio = sample_video(tiny_video, facts)
    assert 1 <= len(frames) <= 6 and all(0 <= second < 2 for second, _ in frames)
    assert all(frame.startswith(b'\xff\xd8') for _, frame in frames)
    assert audio.startswith(b'RIFF')
    audio_facts = inspect_attachment_media(audio, 'audio')
    assert abs(audio_facts['duration_seconds'] - 2) < .1
    with pytest.raises(ValueError):
        inspect_attachment_media(audio, 'video')


@pytest.mark.asyncio
async def test_video_audio_failure_keeps_observed_frames_and_declares_the_gap(monkeypatch, tiny_video):
    from app.modules.chat import attachment_summarizer as module
    chat = AsyncMock(return_value=SimpleNamespace(success=True, data={'choices': [{'message': {'content': '纯青绿色画面。'}}]}))
    monkeypatch.setattr(module.llm_manager, 'chat', chat)
    monkeypatch.setattr(ChatAttachmentSummarizer, 'summarize_audio', AsyncMock(side_effect=RuntimeError('unavailable')))
    info = inspect_attachment_media(tiny_video, 'video')
    result = await ChatAttachmentSummarizer().summarize_video(tiny_video, 'sample.mp4', '描述视频', info)
    assert '未逐帧分析' in result and '音轨解析失败' in result
    assert info['audio_status'] == 'failed' and info['sampled_seconds']
    assert len([part for part in chat.call_args.kwargs['messages'][0]['content'] if part['type'] == 'image_url']) == len(info['sampled_seconds'])


def test_long_video_is_rejected_before_model_analysis(monkeypatch):
    from app.modules.chat import media_probe
    monkeypatch.setattr(media_probe.subprocess, 'run', lambda *args, **kwargs: SimpleNamespace(stdout=json.dumps({
        'streams': [{'codec_type': 'video', 'width': 320, 'height': 180}], 'format': {'duration': '61'},
    })))
    with pytest.raises(ValueError, match='60 秒'):
        inspect_attachment_media(b'video', 'video')


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['direct', 'agent'])
@pytest.mark.parametrize('cited', [True, False])
async def test_upload_to_generation_to_history_keeps_only_adopted_attachment_sources(monkeypatch, mode, cited):
    import httpx
    from fastapi import FastAPI
    from app.api import chat
    from app.modules.generation.service import GenerationService
    from app.modules.generation.stream_manager import StreamManager

    builder = ContextBuilder.__new__(ContextBuilder)
    builder.max_context_length = 4000
    builder.formatter = MultiModalFormatter()
    builder._process_retrieval_results = AsyncMock(return_value=[])
    service = GenerationService.__new__(GenerationService)
    service.context_builder = builder
    service.prompt_manager = SimpleNamespace(build_system_prompt=lambda *args: 'system')
    service.stream_manager = StreamManager()
    async def generate(**kwargs):
        prompt = json.dumps(kwargs, ensure_ascii=False)
        assert 'green mountains' in prompt and '【材料 1】' in prompt
        yield '山水图 [1]。' if cited else '此问题与附件无关。'
    service.llm_manager = SimpleNamespace(stream_chat=generate, registry=SimpleNamespace(get_task_model=lambda _: 'test'))
    retrieval = SimpleNamespace(reranked_results=[], context=SimpleNamespace(intent_type='factual'))
    async def direct(**kwargs):
        yield '_result', retrieval
    async def agent(**kwargs):
        yield '_result', SimpleNamespace(retrieval_result=retrieval, metadata=lambda: {'enabled': True})
    monkeypatch.setattr(chat, 'sessions', {})
    monkeypatch.setattr(chat, 'generation_service', service)
    monkeypatch.setattr(chat, 'retrieval_service', SimpleNamespace(search_stream=direct))
    monkeypatch.setattr(chat, 'agentic_retrieval_service', SimpleNamespace(search_stream=agent))
    monkeypatch.setattr(chat, 'summarize_chat_attachments', AsyncMock(return_value=('解析', [
        dict(index=1, modality='image', filename='山水.png', status='ready', summary='green mountains')
    ])))
    monkeypatch.setattr('app.modules.generation.service.maybe_audit_answer', AsyncMock(return_value=None))
    app = FastAPI()
    app.include_router(chat.router, prefix='/api/chat')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/api/chat/stream', data={
            'message': '描述附件', 'attachmentIds': '["local-image"]', 'sessionId': 'local-citations', 'agentMode': mode,
        }, files={'files': ('山水.png', b'image', 'image/png')})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
        assert events[-1]['type'] == 'complete', events
        candidates = [event['data']['references'] for event in events if event['type'] == 'citation']
        assert candidates[0][0]['attachment_id'] == 'local-image'
        assert candidates[0][0]['source'] == 'attachment'
        assert len(candidates[-1]) == int(cited)
        history = (await client.get('/api/chat/history', params={'sessionId': 'local-citations'})).json()
        assert history['messages'][-1]['citations'] == candidates[-1]
