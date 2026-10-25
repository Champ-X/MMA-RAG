"""Automatic mode explanations follow each request's language without policy changes."""
import asyncio

import pytest

from app.core.prompt_language import prompt_language
from app.modules.agent.mode_router import resolve_agent_mode


@pytest.mark.parametrize('requested,query', [
    ('direct', '中文查询'), ('agent', 'English query'),
    ('auto', 'Based on the plot of Blood Oath, select a poster and theme song.'),
    ('auto', 'deep research: compare evidence and analyze the findings'),
])
def test_localized_reason_keeps_routing_and_scores(requested, query):
    with prompt_language('zh-CN'):
        chinese = resolve_agent_mode(requested, query=query)
    with prompt_language('en-US'):
        english = resolve_agent_mode(requested, query=query)
    assert (english.requested_mode, english.selected_mode, english.score) == (
        chinese.requested_mode, chinese.selected_mode, chinese.score)
    assert chinese.reason != english.reason
    assert any('\u4e00' <= char <= '\u9fff' for char in chinese.reason)
    assert not any('\u4e00' <= char <= '\u9fff' for char in english.reason)
    if english.selected_mode == 'agent' and requested == 'auto':
        assert '; ' in english.reason
        assert '；' in chinese.reason


@pytest.mark.asyncio
async def test_interleaved_request_contexts_do_not_mix_mode_explanations():
    async def run(language):
        with prompt_language(language):
            await asyncio.sleep(0)
            return resolve_agent_mode('auto', query='What is this?').reason

    english, chinese = await asyncio.gather(run('en-US'), run('zh-CN'))
    assert english == 'The request is focused and can be completed with a single multimodal retrieval pass.'
    assert chinese == '问题目标集中，单轮多模态检索即可完成'
