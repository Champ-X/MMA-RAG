import json
from datetime import date
from types import SimpleNamespace

import pytest

from app.modules.collection import planner


def response(value):
    return SimpleNamespace(success=True, data={"choices": [{"message": {"content": json.dumps(value)}}]})


@pytest.mark.asyncio
async def test_plan_routes_mixed_intent_and_bounds_host_owned_count(monkeypatch):
    calls = []
    async def chat(**kwargs):
        calls.append(kwargs)
        return response({"summary": "已验证所有图片可商用", "max_items": 1000, "queries": [
            {"query": "forest illustration", "kind": "image", "channel": "pixabay"},
            {"query": "森林 生态 新闻", "kind": "news", "channel": "tavily", "time_range": "week",
             "domains": ["example.org"]}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("找森林插画和本周生态新闻", 5, ["pixabay", "tavily"])
    assert result["max_items"] == 5
    assert len(result["queries"]) == 2 and len(calls) == 1
    assert "已验证" not in result["summary"]
    assert result["queries"][1]["time_range"] == "week"
    assert result["warnings"] == [] and calls[0]["fallback"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_query", [
    {"query": "猫", "kind": "image", "channel": "unknown"},
    {"query": "猫", "kind": "unsupported", "channel": "tavily"},
    {"query": "猫", "kind": "webpage", "channel": "tavily", "domains": ["http://localhost"]},
    {"query": "猫", "kind": "webpage", "channel": "tavily", "time_range": "forever"},
])
async def test_invalid_model_routes_fall_back_without_expanding_capabilities(monkeypatch, bad_query):
    async def chat(**kwargs):
        return response({"queries": [bad_query]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("猫咪图片与相关文章", 3, ["pixabay", "tavily"])
    assert {item["channel"] for item in result["queries"]} <= {"pixabay", "tavily"}
    assert {item["kind"] for item in result["queries"]} == {"image", "webpage"}
    assert "基础搜索" in result["warnings"][0]


@pytest.mark.asyncio
async def test_unavailable_model_preserves_mixed_request_including_public_media(monkeypatch):
    async def chat(**kwargs):
        raise TimeoutError("provider-secret")
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("要图片和最新报道，以及视频", 4, ["tavily", "pixabay"])
    assert {item["kind"] for item in result["queries"]} == {"news", "image", "video"}
    assert "provider-secret" not in str(result)


@pytest.mark.asyncio
async def test_rank_uses_candidate_indices_and_cannot_rewrite_provenance(monkeypatch):
    candidates = [{"title": "真实图片", "url": "https://original.example/image", "source": "pixabay",
                   "kind": "image", "provider_metadata": {"id": 42}, "license": None}]
    async def chat(**kwargs):
        return response({"selections": [{"index": 0, "reason": "主题相符", "subject_match": "exact", "subject_evidence": "真实图片", "url": "https://invented.example",
                                         "license": "verified"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    selected = await planner.rank_candidates("图", candidates, 3)
    assert selected[0]["url"] == candidates[0]["url"]
    assert selected[0]["license"] is None
    assert selected[0]["provider_metadata"] == {"id": 42}
    assert selected[0]["verification_status"] == "unverified"
    assert "selection_reason" not in candidates[0]
    assert selected[0]["ranking_status"] == "accepted"


@pytest.mark.asyncio
@pytest.mark.parametrize("selections", [[{"index": 99, "reason": "invented"}],
                                     [{"index": 0, "reason": "a", "subject_match": "exact", "subject_evidence": "原始候选"}, {"index": 0, "reason": "b"}],
                                     [{"index": True, "reason": "bool index"}]])
async def test_rank_invalid_selection_falls_back_with_visible_warning(monkeypatch, selections):
    async def chat(**kwargs):
        return response({"selections": selections})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    candidates = [{"title": "原始候选", "url": "https://example.org/a"}]
    result = await planner.rank_candidates("需求", candidates, 2)
    assert result[0]["url"] == candidates[0]["url"]
    assert "原始顺序" in result[0]["selection_reason"]
    assert any("智能筛选暂不可用" in warning for warning in result[0]["warnings"])
    assert result[0]["ranking_status"] == "unavailable"


@pytest.mark.asyncio
async def test_rank_can_reject_all_candidates(monkeypatch):
    async def chat(**kwargs):
        return response({"selections": []})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    assert await planner.rank_candidates("猫", [{"title": "无关素材"}], 3) == []


@pytest.mark.asyncio
async def test_explicit_count_is_below_ui_upper_bound(monkeypatch):
    async def chat(**kwargs):
        return response({"target_count": 5, "queries": [{"query": "cat", "kind": "image", "channel": "pixabay"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("帮我找两张猫咪图片", 5, ["pixabay"])
    assert result["max_items"] == 5 and result["target_count"] == 2
    assert result["warnings"] == []
    mixed = await planner.plan_request("2张图片和1篇文章", 5, ["pixabay"])
    assert mixed["target_count"] == 3


@pytest.mark.asyncio
async def test_mixed_rank_fallback_covers_both_types(monkeypatch):
    async def chat(**kwargs):
        raise TimeoutError()
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    candidates = [{"title": "猫图片1", "kind": "image"}, {"title": "猫图片2", "kind": "image"},
                  {"title": "猫文章", "kind": "webpage"}]
    result = await planner.rank_candidates("猫的图片和文章", candidates, 2)
    assert {item["kind"] for item in result} == {"image", "webpage"}


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt,expected", [
    ("Find 1 official MDN article about AbortController.", 1),
    ("Find 2 high resolution photos of forests.", 2),
    ("Find 1 official MDN article and 2 high-resolution photos.", 3),
])
async def test_modified_english_count_overrides_model_default(monkeypatch, prompt, expected):
    async def chat(**kwargs):
        return response({"target_count": 5, "queries": [{"query": "topic", "kind": "webpage", "channel": "tavily"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request(prompt, 5, ["tavily"])
    assert result["target_count"] == expected


@pytest.mark.parametrize("prompt", [
    "Look back 3 days for official articles.",
    "Find 1. Then search official MDN articles.",
    "Find 1\nThen search official MDN articles.",
    "Find 1 very detailed official English Mozilla MDN reference article.",
])
def test_modified_count_does_not_cross_sentences_or_unbounded_modifiers(prompt):
    assert planner._requested_count(prompt, 5) == 5


@pytest.mark.asyncio
async def test_seed_url_instruction_uses_open_web_without_search_keys(monkeypatch):
    async def chat(**kwargs):
        return SimpleNamespace(success=False)
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("从 https://papers.example/article 获取这篇论文的PDF", 5, ["open_web"])
    assert result["queries"] == [{"query": "从 https://papers.example/article 获取这篇论文的PDF", "kind": "document",
                                  "channel": "open_web", "seed_urls": ["https://papers.example/article"],
                                  "required_format": "pdf", "material_intent": "paper"}]


@pytest.mark.asyncio
async def test_model_cannot_invent_seed_download_urls(monkeypatch):
    async def chat(**kwargs):
        return response({"queries": [{"query": "paper PDF", "kind": "document", "channel": "open_web",
                                       "seed_urls": ["https://invented.example/paper.pdf"]}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("从 https://real.example/paper 获取PDF", 5, ["open_web"])
    assert result["queries"][0]["seed_urls"] == ["https://real.example/paper"]
    assert "invented" not in str(result)


@pytest.mark.asyncio
async def test_leaf_request_does_not_accept_flower_bud_as_broadly_related(monkeypatch):
    async def chat(**kwargs):
        return response({"selections": [
            {"index": 0, "subject_match": "related", "subject_evidence": "Sunflower flower bud", "reason": "植物相关，可作为叶片参考"},
            {"index": 1, "subject_match": "exact", "subject_evidence": "Green plant leaf", "reason": "叶片主体明确"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    candidates = [{"title": "Sunflower flower bud", "description": "Sunflower flower bud", "kind": "image", "url": "https://example.org/bud"},
                  {"title": "Green plant leaf", "description": "leaf close up", "kind": "image", "url": "https://example.org/leaf"}]
    result = await planner.rank_candidates("找1张植物叶片照片，用于科普参考。", candidates, 2)
    assert [item["url"] for item in result] == ["https://example.org/leaf"]


@pytest.mark.asyncio
async def test_image_subject_evidence_must_be_observed_verbatim(monkeypatch):
    async def chat(**kwargs):
        return response({"selections": [{"index": 0, "subject_match": "exact", "subject_evidence": "Green leaf", "reason": "invented subject"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    assert await planner.rank_candidates("leaf", [{"title": "sunflower bud", "kind": "image"}], 1) == []


@pytest.mark.asyncio
async def test_pixabay_non_english_plan_falls_back_to_general_search(monkeypatch):
    async def chat(**kwargs):
        assert "Pixabay必须使用" in kwargs["messages"][0]["content"]
        return response({"queries": [{"query": "植物叶片", "kind": "image", "channel": "pixabay"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("找1张植物叶片照片", 5, ["pixabay", "tavily"])
    assert result["queries"][0]["channel"] == "tavily"
    assert result["queries"][0]["query"] == "找1张植物叶片照片"


@pytest.mark.asyncio
async def test_subject_contract_rejects_shark_but_accepts_equivalent_dolphin_name(monkeypatch):
    async def chat(**kwargs):
        return response({"selections": [
            {"index": 0, "subject_match": "related", "subject_evidence": "Shark in ocean", "reason": "同为海洋动物"},
            {"index": 1, "subject_match": "equivalent", "subject_evidence": "Bottlenose dolphin", "reason": "宽吻海豚是目标主体"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    candidates = [{"title": "Shark in ocean", "kind": "image", "url": "https://example.org/shark"},
                  {"title": "Bottlenose dolphin", "kind": "image", "url": "https://example.org/dolphin"}]
    result = await planner.rank_candidates("找海豚照片", candidates, 2)
    assert [item["url"] for item in result] == ["https://example.org/dolphin"]


@pytest.mark.asyncio
async def test_refinement_uses_feedback_but_cannot_generate_unobserved_seed(monkeypatch):
    calls = []
    async def chat(**kwargs):
        calls.append(kwargs)
        return response({"queries": [{"query": "leaf veins close up", "kind": "image", "channel": "tavily"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.refine_queries("leaf photo", [{"channel": "pixabay", "query": "plant"}],
                                          {"reason": "only flower buds returned"}, ["tavily", "pixabay"])
    assert result == [{"query": "leaf veins close up", "kind": "image", "channel": "tavily"}]
    assert len(calls) == 1 and "flower buds" in calls[0]["messages"][1]["content"]


@pytest.mark.parametrize("prompt,format_,kinds", [
    ("最近前沿关于Agent RSI的论文", "pdf", ["document"]),
    ("找最新学术文献", "pdf", ["document"]),
    ("Find the latest academic literature", "pdf", ["document"]),
    ("Find recent research papers about agent self-improvement", "pdf", ["document"]),
    ("Find journal articles about reinforcement learning", "pdf", ["document"]),
    ("找这篇论文的摘要，不用下载", None, ["webpage"]),
    ("只要论文网页，不要PDF", None, ["webpage"]),
    ("Find paper abstracts without PDF", None, ["webpage"]),
    ("Find summaries of research papers", None, ["webpage"]),
    ("找论文PDF和相关网页", "pdf", ["document", "webpage"]),
    ("从网页下载PDF文件", "pdf", ["document"]),
    ("Find PDFs from this webpage", "pdf", ["document"]),
])
def test_host_material_contract_preserves_full_text_and_explicit_overview_requests(prompt, format_, kinds):
    result = planner.request_requirements(prompt)
    assert result["document_format"] == format_
    assert result["requested_kinds"] == kinds


def test_paper_intent_does_not_match_wallpaper_or_newspaper():
    assert planner.request_requirements("Find forest wallpaper")["academic_papers"] is False
    assert planner.request_requirements("Find newspaper stories")["document_format"] is None


@pytest.mark.asyncio
async def test_recent_paper_plan_repairs_webpage_routes_and_stale_model_years(monkeypatch):
    monkeypatch.setattr(planner, "_today", lambda: date(2026, 10, 29))
    calls = []
    async def chat(**kwargs):
        calls.append(json.loads(kwargs["messages"][1]["content"]))
        return response({"queries": [
            {"query": "Agent RSI paper 2025", "kind": "webpage", "channel": "tavily", "time_range": "month"},
            {"query": "recursive self-improvement AI agent arxiv", "kind": "news", "channel": "tavily"},
        ]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("最近前沿关于Agent RSI的论文", 5, ["tavily", "open_web"])
    assert calls[0]["current_date"] == "2026-10-29"
    assert calls[0]["requirements"]["document_format"] == "pdf"
    assert all(query["kind"] == "document" and query["required_format"] == "pdf"
               and query["material_intent"] == "paper" and query["time_range"] == "year"
               for query in result["queries"])
    assert "2025" not in result["summary"]
    assert result["queries"][0]["query"] == "Agent RSI paper"
    assert result["requirements"]["current_date"] == "2026-10-29"


@pytest.mark.asyncio
async def test_model_failure_retains_paper_contract_and_freshness(monkeypatch):
    async def chat(**kwargs):
        raise TimeoutError()
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("Find the latest research papers about agents", 5, ["tavily"])
    assert result["queries"][0]["kind"] == "document"
    assert result["queries"][0]["required_format"] == "pdf"
    assert result["queries"][0]["time_range"] == "year"


def test_user_publication_year_is_not_replaced_by_current_year_or_relative_window(monkeypatch):
    monkeypatch.setattr(planner, "_today", lambda: date(2026, 10, 29))
    result = planner.apply_requirements({"queries": [{"query": "Agent research papers 2024", "kind": "webpage",
        "channel": "tavily", "time_range": "month"}]}, "2024年最新的Agent论文")
    assert result["requirements"]["publication_years"] == ["2024"]
    assert "2024" in result["queries"][0]["query"]
    assert "time_range" not in result["queries"][0]


@pytest.mark.parametrize("prompt,years", [
    ("2025年的论文", ["2025"]),
    ("找2025论文", ["2025"]),
    ("找ISO2025相关论文", []),
])
def test_publication_year_boundaries_allow_chinese_but_not_embedded_identifiers(prompt, years):
    assert planner.request_requirements(prompt)["publication_years"] == years


def test_mixed_paper_and_image_request_does_not_spread_pdf_contract_to_images():
    result = planner.apply_requirements({"queries": [
        {"query": "leaf photos", "kind": "image", "channel": "google_images"},
        {"query": "leaf morphology papers", "kind": "webpage", "channel": "tavily"},
    ]}, "找植物叶片照片和相关研究论文")
    assert result["queries"][0]["kind"] == "image" and "required_format" not in result["queries"][0]
    assert result["queries"][1]["kind"] == "document" and result["queries"][1]["required_format"] == "pdf"


def test_mixed_request_adds_omitted_papers_without_removing_explicit_webpages():
    result = planner.apply_requirements({"queries": [
        {"query": "agent resources", "kind": "webpage", "channel": "tavily"},
    ]}, "Agent论文和相关网页")
    assert {query["kind"] for query in result["queries"]} == {"document", "webpage"}
    webpage = next(query for query in result["queries"] if query["kind"] == "webpage")
    assert "required_format" not in webpage


@pytest.mark.asyncio
async def test_feedback_refinement_cannot_downgrade_papers_or_reintroduce_stale_year(monkeypatch):
    monkeypatch.setattr(planner, "_today", lambda: date(2026, 10, 29))
    async def chat(**kwargs):
        payload = json.loads(kwargs["messages"][1]["content"])
        assert payload["current_date"] == "2026-10-29"
        return response({"queries": [{"query": "agent self-improvement papers 2025", "kind": "news", "channel": "tavily"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.refine_queries("最近Agent RSI论文", [], {"reason": "no PDFs"}, ["tavily"])
    assert result == [{"query": "agent self-improvement papers", "kind": "document", "channel": "tavily",
                       "required_format": "pdf", "material_intent": "paper", "time_range": "year"}]


@pytest.mark.asyncio
async def test_paper_ranking_excludes_abstract_pages_wrong_format_stale_and_future_items(monkeypatch):
    monkeypatch.setattr(planner, "_today", lambda: date(2026, 10, 29))
    candidates = [
        {"title": "RSI abstract", "kind": "webpage", "url": "https://example.org/abs/1", "published_at": "2026-10-28"},
        {"title": "RSI old paper", "kind": "document", "download_url": "https://example.org/old.pdf", "published_at": "2024-01-01"},
        {"title": "RSI future paper", "kind": "document", "download_url": "https://example.org/future.pdf", "published_at": "2027-01-01"},
        {"title": "RSI notes", "kind": "document", "download_url": "https://example.org/notes.md", "published_at": "2026-10-28"},
        {"title": "RSI original paper", "kind": "document", "url": "https://example.org/abs/2", "download_url": "https://example.org/paper.pdf", "published_at": "2026-09-22"},
        {"title": "RSI undated paper", "kind": "document", "download_url": "https://example.org/unknown.pdf"},
    ]
    async def chat(**kwargs):
        payload = json.loads(kwargs["messages"][1]["content"])
        assert payload["current_date"] == "2026-10-29"
        assert [item["title"] for item in payload["candidates"]] == ["RSI original paper", "RSI undated paper"]
        return response({"selections": [{"index": i, "subject_match": "exact", "subject_evidence": title, "reason": "研究主体匹配"}
            for i, title in enumerate(["RSI original paper", "RSI undated paper"])]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.rank_candidates("最近RSI论文", candidates, 5)
    assert len(result) == 2
    assert all(item["required_format"] == "pdf" for item in result)
    assert any("时效" in warning for warning in result[1]["warnings"])
    assert result[0]["url"] == "https://example.org/abs/2"
    assert "required_format" not in candidates[4]


@pytest.mark.asyncio
async def test_ranking_model_failure_cannot_resurrect_abstract_for_full_paper(monkeypatch):
    async def chat(**kwargs):
        raise TimeoutError()
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    candidates = [{"title": "Agent paper abstract", "kind": "webpage"},
                  {"title": "Agent paper", "kind": "document", "download_url": "https://example.org/paper.pdf"}]
    result = await planner.rank_candidates("Agent papers", candidates, 5)
    assert len(result) == 1 and result[0]["kind"] == "document"
    assert result[0]["ranking_status"] == "unavailable" and result[0]["required_format"] == "pdf"


@pytest.mark.asyncio
async def test_explicit_abstract_request_remains_a_webpage_without_pdf_contract(monkeypatch):
    async def chat(**kwargs):
        return response({"queries": [{"query": "agent paper abstract", "kind": "document", "channel": "tavily"}]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.plan_request("只要Agent论文摘要，不要PDF", 5, ["tavily"])
    assert result["queries"][0]["kind"] == "webpage" and "required_format" not in result["queries"][0]


@pytest.mark.asyncio
async def test_omitted_candidates_are_not_explicitly_rejected(monkeypatch):
    async def chat(**kwargs):
        return response({"selections": [{"index": 0, "subject_match": "exact", "subject_evidence": "Agent RSI paper",
                                         "reason": "主体明确匹配"}], "rejected_indices": []})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    candidates = [{"title": "Agent RSI paper", "kind": "document", "url": "https://example.org/first.pdf"},
                  {"title": "Recursive self-improvement of AI research agents", "kind": "document", "url": "https://example.org/second.pdf"}]
    result = await planner.rank_candidates("Agent RSI论文", candidates, 5)
    assert isinstance(result, list) and len(result) == 1
    assert result.rejected_urls == []


@pytest.mark.asyncio
async def test_only_explicit_valid_rejections_are_reported_by_resource_identity(monkeypatch):
    async def chat(**kwargs):
        return response({"selections": [], "rejected_indices": [0]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    candidates = [{"title": "Unrelated paper", "kind": "document", "url": "https://example.org/landing",
                   "download_url": "https://example.org/unrelated.pdf"},
                  {"title": "Agent RSI paper", "kind": "document", "url": "https://example.org/omitted.pdf"}]
    result = await planner.rank_candidates("Agent RSI论文", candidates, 5)
    assert result == []
    assert result.rejected_urls == ["https://example.org/unrelated.pdf"]


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", [
    "主体是agent harness而非Agent RSI本身，属于相关但非完全一致；按严格标准应排除，不选。",
    "This is not relevant and should be excluded.",
])
async def test_conflicting_selection_reason_requires_review_without_permanent_rejection(monkeypatch, reason):
    async def chat(**kwargs):
        return response({"selections": [{"index": 0, "subject_match": "exact", "subject_evidence": "Harness paper", "reason": reason}],
                         "rejected_indices": []})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.rank_candidates("Agent RSI papers", [{"title": "Harness paper", "kind": "document",
                                        "download_url": "https://example.org/harness.pdf"}], 5)
    assert len(result) == 1 and result[0]["ranking_status"] == "unavailable"
    assert "冲突" in result[0]["selection_reason"]
    assert result.rejected_urls == []


@pytest.mark.asyncio
async def test_selection_and_rejection_of_same_candidate_is_uncertain(monkeypatch):
    async def chat(**kwargs):
        return response({"selections": [{"index": 0, "subject_match": "exact", "subject_evidence": "Agent paper", "reason": "研究主题相符"}],
                         "rejected_indices": [0]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.rank_candidates("Agent papers", [{"title": "Agent paper", "kind": "document",
                                        "download_url": "https://example.org/paper.pdf"}], 5)
    assert result[0]["ranking_status"] == "unavailable"
    assert result.rejected_urls == []


@pytest.mark.asyncio
async def test_malformed_rejections_fall_back_to_review_without_blacklisting(monkeypatch):
    async def chat(**kwargs):
        return response({"selections": [], "rejected_indices": [99]})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.rank_candidates("Agent papers", [{"title": "Agent paper", "kind": "document",
                                        "download_url": "https://example.org/paper.pdf"}], 5)
    assert result[0]["ranking_status"] == "unavailable" and result.rejected_urls == []


@pytest.mark.asyncio
async def test_paper_survey_is_eligible_when_user_does_not_exclude_surveys(monkeypatch):
    async def chat(**kwargs):
        system = kwargs["messages"][0]["content"]
        assert "综述、方法、实证等论文均可按主题入选" in system
        assert "原始研究论文全文" not in system
        return response({"selections": [{"index": 0, "subject_match": "exact", "subject_evidence": "RSI survey paper",
                                         "reason": "综述涵盖用户指定研究主题"}], "rejected_indices": []})
    monkeypatch.setattr(planner.llm_manager, "chat", chat)
    result = await planner.rank_candidates("Agent RSI论文", [{"title": "RSI survey paper", "kind": "document",
                                        "download_url": "https://example.org/survey.pdf"}], 5)
    assert result[0]["ranking_status"] == "accepted" and result.rejected_urls == []


@pytest.mark.asyncio
async def test_empty_rank_is_also_list_compatible_with_no_rejections():
    result = await planner.rank_candidates("Agent papers", [], 5)
    assert result == [] and result.rejected_urls == []
