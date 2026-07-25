from app.modules.agent.mode_router import normalize_agent_mode, resolve_agent_mode


def test_agent_mode_normalizes_legacy_booleans_and_strings():
    assert normalize_agent_mode(True) == "agent"
    assert normalize_agent_mode(False) == "direct"
    assert normalize_agent_mode("true") == "agent"
    assert normalize_agent_mode("false") == "direct"
    assert normalize_agent_mode("auto") == "auto"


def test_auto_mode_keeps_focused_question_on_direct_retrieval():
    decision = resolve_agent_mode("auto", query="这份报告的发布日期是什么？")

    assert decision.selected_mode == "direct"
    assert decision.enabled is False
    assert decision.score < 3


def test_auto_mode_enables_agent_for_comparison():
    decision = resolve_agent_mode(
        "auto",
        query="对比方案 A 和方案 B 的关键差异，并给出证据依据。",
    )

    assert decision.selected_mode == "agent"
    assert decision.enabled is True
    assert "对比" in decision.reason


def test_auto_mode_enables_agent_for_cross_modal_research():
    decision = resolve_agent_mode(
        "auto",
        query="综合文档、图片和视频中的信息，分析这个产品的设计演变。",
    )

    assert decision.selected_mode == "agent"
    assert "跨模态" in decision.reason


def test_manual_mode_is_never_overridden_by_auto_policy():
    direct = resolve_agent_mode("direct", query="请深入调研并全面对比所有方案")
    agent = resolve_agent_mode("agent", query="发布日期是什么？")

    assert direct.selected_mode == "direct"
    assert agent.selected_mode == "agent"
