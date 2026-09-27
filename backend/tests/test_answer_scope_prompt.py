"""The answer scope contract must survive intent variants and shortened prompts."""
import pytest
from app.modules.generation.templates.system_prompts import SystemPromptManager, ANSWER_SCOPE_INSTRUCTIONS
from app.modules.generation.templates.multimodal_fmt import MultiModalFormatter

@pytest.mark.parametrize('intent', ['factual','analysis','comparison','coding','creative','agentic'])
def test_scope_contract_survives_prompt_variants(intent):
    manager = SystemPromptManager()
    for prompt in manager.get_prompt_variants(intent):
        assert ANSWER_SCOPE_INSTRUCTIONS in prompt
    assert ANSWER_SCOPE_INSTRUCTIONS in manager._get_fallback_prompt()
    assert ANSWER_SCOPE_INSTRUCTIONS in manager.optimize_prompt_for_length(manager.build_system_prompt(intent), 1)

def test_candidate_context_is_preserved_for_explicit_comparisons():
    context = '【材料 1】推荐内容\n【材料 2】不适合的歌曲'
    question = '比较这两个选项，解释为什么不选第二个。'
    formatted = MultiModalFormatter().format_user_query(question, context)
    assert question in formatted and context in formatted
    assert '不需要逐条点评或展示未采用项' in formatted
