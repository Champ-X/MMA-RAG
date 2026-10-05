import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from app.api import chat
from app.modules.chat.references import normalize_attachment_ids, resolve_message_references, resolve_multipart_references
from app.modules.chat import attachment_summarizer as summaries
from app.modules.chat.context_manager import build_conversation_context
from app.modules.generation.context_builder import ContextBuilder
from app.modules.chat.media_probe import audio_input_format, inspect_attachment_media, validate_audio_observation


def fixtures():
    text = '  🖼️分析这张图@same.png\n\n和本机@same.png，\n再看@same.png。'
    refs = []
    cursor = 0
    for index in range(3):
        start = text.index('@same.png', cursor)
        end = start + len('@same.png')
        refs.append(dict(source='attachment' if index == 1 else 'knowledge', name='same.png',
                         kbId='kb', fileId='image-id', attachmentId='upload',
                         start=len(text[:start].encode('utf-16-le')) // 2,
                         end=len(text[:end].encode('utf-16-le')) // 2))
        cursor = end
    selected = [dict(kb_id='kb', file_id='image-id', name='same.png', type='png', kb_name='图片')]
    attachments = [dict(id='upload', index=1, name='same.png', type='image/png')]
    return text, refs, selected, attachments


def test_sources_repeated_references_unicode_and_attachment_ids():
    text, refs, selected, attachments = fixtures()
    canonical, query, context = resolve_message_references(text, refs, selected, attachments)
    assert query.count('〈知识库K1〉') == 2
    assert query.count('〈本机附件A1〉') == 1
    assert len(canonical) == 3
    assert canonical[1]['attachmentId'] == 'upload'
    assert 'kbId' not in canonical[1]
    assert 'image-id' in context
    assert normalize_attachment_ids('["upload"]', 1) == ['upload']
    with pytest.raises(ValueError):
        normalize_attachment_ids('["same", "same"]', 2)


@pytest.mark.parametrize('failure', ['removed', 'forged', 'offset', 'name', 'order', 'surrogate'])
def test_stale_or_forged_reference_fails_before_model_use(failure):
    text, refs, selected, attachments = fixtures()
    if failure == 'removed': attachments = []
    if failure == 'forged': refs[0]['fileId'] = 'other'
    if failure == 'offset': refs[0]['end'] += 1
    if failure == 'name': attachments[0]['name'] = 'different.png'
    if failure == 'order': refs.reverse()
    if failure == 'surrogate': refs[0]['start'] = 1
    with pytest.raises(ValueError):
        resolve_message_references(text, refs, selected, attachments)


@pytest.mark.asyncio
async def test_parallel_parsing_keeps_every_attachment_and_isolates_failure(monkeypatch):
    monkeypatch.setattr(summaries, 'inspect_attachment_media', lambda *args: {'width': 800, 'height': 480})
    async def image(self, raw, name, question):
        assert '本机附件A' in question
        if name == 'bad.png': raise RuntimeError('provider failed')
        return name + '细节' * 850
    monkeypatch.setattr(summaries.ChatAttachmentSummarizer, 'summarize_image', image)
    image_bytes = b'\x89PNG\r\n\x1a\n' + b'\0' * 20
    block, items = await summaries.summarize_chat_attachments(user_message='比较它们', files=[
        (name, 'image/png', image_bytes) for name in ['first.png', 'bad.png', 'last.png']])
    assert [item['status'] for item in items] == ['ready', 'failed', 'ready']
    assert '本机附件A3' in block and 'last.png' in block
    assert len(items[2]['summary']) > 300
    assert 'provider failed' not in block
    assert '不能据此推断' in block


@pytest.mark.asyncio
async def test_timeout_is_a_failed_attachment_not_evidence(monkeypatch):
    monkeypatch.setattr(summaries, 'inspect_attachment_media', lambda *args: {'duration_seconds': 8})
    async def slow(*args): await asyncio.sleep(1)
    monkeypatch.setattr(summaries, 'SUMMARY_TIMEOUT_SECONDS', .001)
    monkeypatch.setattr(summaries.ChatAttachmentSummarizer, 'summarize_audio', slow)
    _, items = await summaries.summarize_chat_attachments(user_message='听音乐', files=[
        ('music.mp3', 'audio/mpeg', b'ID3' + b'\0' * 20)])
    assert items[0]['status'] == 'failed'


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['direct', 'agent'])
@pytest.mark.parametrize('transport', ['plain', 'browser_legacy', 'browser_json'])
async def test_multipart_binding_reaches_retrieval_generation_and_history(monkeypatch, mode, transport):
    text, refs, selected, _ = fixtures()
    seen = {}
    result = SimpleNamespace(debug_info={})
    async def summarize(**kwargs):
        seen['summary_query'] = kwargs['user_message']
        return '本机附件A1: 青绿色山水', [dict(index=1, modality='image', status='ready', summary='青绿色山水')]
    async def search(**kwargs):
        seen['search'] = kwargs
        yield '_result', result if mode == 'direct' else SimpleNamespace(retrieval_result=result, metadata=lambda: {})
    async def generate(**kwargs):
        seen['generation'] = kwargs
        yield SimpleNamespace(type='message', data={'content': '有相似的平静氛围。'})
        yield SimpleNamespace(type='done', data={})
    async def load_references(files):
        return []  # This transport test isolates bindings from indexed media loading.
    monkeypatch.setattr(chat, 'sessions', {})
    monkeypatch.setattr(chat, 'summarize_chat_attachments', summarize)
    monkeypatch.setattr(chat, 'retrieval_service', SimpleNamespace(search_stream=search, load_reference_materials=load_references))
    monkeypatch.setattr(chat, 'agentic_retrieval_service', SimpleNamespace(search_stream=search))
    monkeypatch.setattr(chat, 'generation_service', SimpleNamespace(stream_generate_response=generate))
    app = FastAPI(); app.include_router(chat.router, prefix='/chat')
    fields = dict(message=text if transport == 'plain' else text.replace('\n', '\r\n'),
                  mentions=json.dumps(refs), selectedFiles=json.dumps(selected),
                  attachmentIds='["upload"]', sessionId='bound', agentMode=mode)
    if transport == 'browser_json':
        fields['messageJson'] = json.dumps(text)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/chat/stream', data=fields,
            files=[('files', ('same.png', b'image', 'image/png'))])
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert events[-1]['type'] == 'complete', events
    for phase in ['search', 'generation']:
        assert '〈本机附件A1〉' in seen[phase]['query']
        assert 'image-id' in seen[phase]['attachment_context']
        assert '青绿色山水' in seen[phase]['attachment_context']
        assert seen[phase]['kb_context']['reference_files'][0]['file_id'] == 'image-id'
        assert seen[phase]['kb_context']['selected_files'] == []
        assert seen[phase]['kb_context']['kb_ids'] == []
    assert '〈本机附件A1〉' in seen['summary_query']
    saved = chat.sessions['bound']['messages'][0]
    assert saved['content'] == text and len(saved['mentions']) == 3
    assert saved['attachments'][0]['id'] == 'upload'
    assert saved['attachments'][0]['status'] == 'ready'
    history = build_conversation_context(chat.sessions['bound']['messages'])
    assert '青绿色山水' in history.messages[0]['content']


@pytest.mark.asyncio
async def test_context_compression_keeps_attachment_map_and_audio_modality():
    builder = ContextBuilder.__new__(ContextBuilder)
    builder.max_context_length = 5
    original = '【本机附件A1】青绿色山水\n参考材料列表：\n' + 'long ' * 20
    refs = {'1': SimpleNamespace(content='music ' * 20, file_path='music.mp3', content_type='audio')}
    context = await builder._optimize_context_length(original, refs)
    assert '【本机附件A1】青绿色山水' in context and '类型: 音频' in context

@pytest.mark.asyncio
@pytest.mark.parametrize('case', ['all_failed', 'invalid_reference', 'too_large'])
async def test_invalid_upload_or_parse_failure_never_reaches_retrieval(monkeypatch, case):
    called = []
    async def summarize(**kwargs):
        called.append('summary')
        return '解析失败', [dict(index=1, modality='image', status='failed', summary='解析失败')]
    async def search(**kwargs):
        called.append('retrieval')
        yield '_result', None
    monkeypatch.setattr(chat, 'sessions', {})
    monkeypatch.setattr(chat, 'summarize_chat_attachments', summarize)
    monkeypatch.setattr(chat, 'retrieval_service', SimpleNamespace(search_stream=search))
    app = FastAPI(); app.include_router(chat.router, prefix='/chat')
    fields = dict(message='@same.png', attachmentIds='["upload"]', agentMode='direct')
    if case == 'invalid_reference':
        fields['mentions'] = json.dumps([dict(source='attachment', attachmentId='removed', name='same.png', start=0, end=9)])
    data = b'x' * (chat.MAX_IMAGE_BYTES + 1) if case == 'too_large' else b'image'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/chat/stream', data=fields, files=[('files', ('same.png', data, 'image/png'))])
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert events[-1]['type'] == 'error'
    assert called == (['summary'] if case == 'all_failed' else [])
    if case == 'invalid_reference':
        assert events[-1]['stage'] == 'validation'
    elif case == 'all_failed':
        assert events[-1]['stage'] == 'attachment'
    assert all(not s.get('messages') for s in chat.sessions.values())


def test_exact_crlf_offsets_are_not_rewritten_and_json_preserves_arbitrary_line_endings():
    text, refs, selected, attachments = fixtures()
    original = text.replace('\n', '\r\n')
    for ref in refs:
        prefix = text.encode('utf-16-le')[:ref['start'] * 2].decode('utf-16-le')
        extra = prefix.count('\n')
        ref['start'] += extra
        ref['end'] += extra
    for encoded in (None, json.dumps(original)):
        restored, canonical, _, _ = resolve_multipart_references(original, encoded, refs, selected, attachments)
        assert restored == original and canonical[1]['start'] == refs[1]['start']


@pytest.mark.parametrize('encoded', ['null', '{}', '[]', '42', 'malformed'])
def test_invalid_exact_message_does_not_fall_back_to_another_text(encoded):
    text, refs, selected, attachments = fixtures()
    with pytest.raises(ValueError):
        resolve_multipart_references(text, encoded, refs, selected, attachments)


@pytest.mark.parametrize('failure', ['offset', 'name', 'removed'])
def test_legacy_line_ending_repair_still_rejects_invalid_bindings(failure):
    text, refs, selected, attachments = fixtures()
    if failure == 'offset': refs[1]['start'] += 1
    if failure == 'name': attachments[0]['name'] = 'different.png'
    if failure == 'removed': attachments = []
    with pytest.raises(ValueError):
        resolve_multipart_references(text.replace('\n', '\r\n'), None, refs, selected, attachments)


def test_local_probe_checks_real_audio_duration_independent_of_filename():
    import io
    import wave
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(8000)
        audio.writeframes(b'\0\0' * 8000)
    data = buffer.getvalue()
    facts = inspect_attachment_media(data, 'audio')
    assert facts['duration_seconds'] == 1
    assert facts['sample_rate'] == 8000 and facts['channels'] == 1
    assert audio_input_format(data) == 'wav'
    with pytest.raises(ValueError):
        validate_audio_observation('这是一段约58秒的音乐，结尾0:40–0:58。', facts)
    validate_audio_observation('音频时长为1秒。说话内容：实验持续60秒。', facts)


@pytest.mark.parametrize('summary', [
    '语音内容：会议将于14:00开始，请在13:50前到场。',
    '语音播报了下午14:00至15:30的列车班次。',
])
def test_spoken_clock_times_are_not_media_offsets(summary):
    validate_audio_observation(summary, {'duration_seconds': 8})


@pytest.mark.parametrize('summary', ['结尾0:40–0:58，旋律渐弱。', '时间戳：00:09，出现人声。'])
def test_explicit_timeline_cannot_exceed_media_duration(summary):
    with pytest.raises(ValueError):
        validate_audio_observation(summary, {'duration_seconds': 8})


@pytest.mark.asyncio
async def test_impossible_model_timeline_is_not_forwarded_as_success(monkeypatch):
    monkeypatch.setattr(summaries, 'inspect_attachment_media', lambda *args: {'duration_seconds': 8, 'source': 'local_probe'})
    async def hallucinated(*args): return '音频时长约58秒，最后0:40–0:58结束。'
    monkeypatch.setattr(summaries.ChatAttachmentSummarizer, 'summarize_audio', hallucinated)
    block, items = await summaries.summarize_chat_attachments(user_message='描述音频', files=[
        ('sample.mp3', 'audio/mpeg', b'ID3' + b'\0' * 20)])
    assert items[0]['status'] == 'failed'
    assert items[0]['media_info']['duration_seconds'] == 8
    assert '58秒' not in block
