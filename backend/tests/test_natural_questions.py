"""Grounded question generation reuses multimodal evidence and rejects bad output."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.knowledge.natural_questions import (
    NATURAL_QUESTION_VERSION,
    evidence_from_preview,
    generate_natural_questions,
    make_evidence,
    sample_evidence_for_kb,
    validate_questions,
)


def source(text="茶树最初作为药用植物，后来逐渐被用于饮用。", **kwargs):
    return make_evidence(text, kb_id="bio", kb_name="生物科普", file_id="tea", kind="document", **kwargs)


def response(evidence, text="茶树是怎么从药用植物变成日常饮品的？", quote=None, **kwargs):
    return {"text": text, "quote": quote if quote is not None else evidence["text"],
            "evidence_id": evidence["id"], **kwargs}


def test_preview_keeps_distributed_document_and_media_evidence_without_file_name():
    details = {"chunks": [{"text": f"第{i}章介绍了不同生态区域中茶树的种植条件。"} for i in range(20)],
               "caption": "种子内部可见胚芽，根系围绕种子生长。",
               "transcript": "我们决定从下周开始每周检查一次茶园里的温度和湿度。"}
    evidence = evidence_from_preview(details, kb_id="bio", kb_name="生物科普", file_id="tea",
                                     file_name="clipboard-opaque-file.png")
    text = "\n".join(item["text"] for item in evidence)
    assert "第0章" in text and "第19章" in text and "根系" in text and "每周检查" in text
    assert "clipboard" not in text


def test_duplicate_caption_and_description_do_not_repeat_evidence():
    text = "种子内部可见胚芽，根系围绕种子生长。"
    evidence = evidence_from_preview({"caption": text, "description": text},
                                     kb_id="bio", kb_name="生物科普", file_id="seed")
    assert len(evidence) == 1


def test_validation_checks_real_quote_and_owns_provenance():
    evidence = source()
    candidate = response(evidence, kb_id="injected", file_id="wrong")
    questions = validate_questions(json.dumps({"questions": [candidate]}, ensure_ascii=False),
                                   [evidence], max_questions=6)
    assert len(questions) == 1
    assert questions[0]["file_id"] == "tea" and questions[0]["kb_id"] == "bio"
    assert questions[0]["evidence_hash"] == evidence["hash"]
    assert questions[0]["strategy"] == NATURAL_QUESTION_VERSION


@pytest.mark.parametrize("changes", [
    {"quote": "茶树起源于三千万年前的青藏高原。"},
    {"evidence_id": "nonexistent"},
    {"text": "请梳理「生物科普」的资料中的重要概念和结论？"},
    {"text": "这张图里有什么？"},
    {"text": "这首歌为什么给人一种伤感的感觉？"},
    {"text": "那首歌用了哪些乐器？"},
    {"text": "茶树的药用价值是怎么逐步发展…"},
    {"quote": "茶树"},
])
def test_validation_discards_unverifiable_or_template_questions(changes):
    evidence = source()
    raw = json.dumps({"questions": [response(evidence, **changes)]}, ensure_ascii=False)
    assert validate_questions(raw, [evidence], max_questions=6) == []


def test_validation_deduplicates_minor_question_variations():
    evidence = source()
    raw = json.dumps({"questions": [response(evidence), response(evidence, text="茶树是如何从药用植物变成日常饮品的？")]})
    assert len(validate_questions(raw, [evidence], max_questions=6)) == 1


@pytest.mark.asyncio
async def test_generation_accepts_fewer_questions_without_padding():
    evidence = source()
    llm = SimpleNamespace(chat=AsyncMock(return_value=SimpleNamespace(success=True,
        model_used="flash", data={"choices": [{"message": {"content": json.dumps({
            "questions": [response(evidence)]}, ensure_ascii=False)}}]})))
    result = await generate_natural_questions([evidence], max_questions=6, llm=llm)
    assert len(result["questions"]) == 1 and result["source"] == "llm"
    args = llm.chat.call_args.kwargs
    assert args["task_type"] == "suggestion_generation"
    assert args["response_format"] == {"type": "json_object"}
    assert "生物科普" not in args["messages"][1]["content"]


@pytest.mark.asyncio
async def test_empty_preview_does_not_call_llm():
    llm = SimpleNamespace(chat=AsyncMock())
    evidence = evidence_from_preview({}, kb_id="bio", kb_name="生物科普", file_id="tea",
                                     file_name="茶树介绍.pdf")
    assert (await generate_natural_questions(evidence, llm=llm))["questions"] == []
    llm.chat.assert_not_awaited()


@pytest.mark.asyncio
async def test_generation_failure_does_not_create_templates():
    llm = SimpleNamespace(chat=AsyncMock(return_value=SimpleNamespace(success=False, error="timeout")))
    result = await generate_natural_questions([source()], llm=llm)
    assert result["questions"] == [] and result["source"] == "generation_failed"


@pytest.mark.asyncio
async def test_sampling_reads_video_scene_caption_and_asr_with_strict_scope():
    payload = {"file_id": "video1", "scene_summary": "讲师站在茶园里，介绍茶树育苗的全过程。",
               "caption": "讲师把幼苗放进花盆，然后用松土覆盖根系。",
               "asr_text": "这里不能浇太多水，否则幼苗的根部会腐烂。"}
    scroll = MagicMock(side_effect=lambda **kw: (
        [SimpleNamespace(payload=payload)] if kw["collection_name"] == "video_shot_vectors" else [], None))
    service = SimpleNamespace(_kb_id_candidates=lambda kb: [kb, "kb-alias"],
                              vector_store=SimpleNamespace(client=SimpleNamespace(scroll=scroll)))
    evidence = await sample_evidence_for_kb(service, "bio", "生物科普", file_ids=["video1"])
    assert {item["kind"] for item in evidence} == {"video_scene", "video_shot", "video_asr"}
    assert all(item["kb_id"] == "bio" and item["file_id"] == "video1" for item in evidence)
    for call in scroll.call_args_list:
        conditions = call.kwargs["scroll_filter"].must
        assert conditions[0].key == "kb_id" and conditions[1].key == "file_id"
        assert conditions[1].match.any == ["video1"]
        assert call.kwargs["with_vectors"] is False


@pytest.mark.asyncio
async def test_sampling_resolves_restored_bucket_id_but_keeps_api_identity():
    discover = AsyncMock(return_value="original-qdrant-uuid")

    def scroll(**kwargs):
        conditions = kwargs["scroll_filter"].must
        assert conditions and conditions[0].key == "kb_id"
        if conditions[0].match.value == "original-qdrant-uuid" and kwargs["collection_name"] == "image_vectors":
            return [SimpleNamespace(payload={"file_id": "image1", "caption": "种子内部可见胚芽，根系围绕种子生长。"})], None
        return [], None

    service = SimpleNamespace(_kb_id_candidates=lambda kb: [kb],
                              _discover_kb_id_from_bucket_async=discover,
                              vector_store=SimpleNamespace(client=SimpleNamespace(scroll=MagicMock(side_effect=scroll))))
    evidence = await sample_evidence_for_kb(service, "sanitized-bucket-id", "图片收集")
    discover.assert_awaited_once_with("sanitized-bucket-id")
    assert len(evidence) == 1 and evidence[0]["kb_id"] == "sanitized-bucket-id"
    assert service.vector_store.client.scroll.call_args_list[0].kwargs["scroll_filter"].must[0].match.value == "original-qdrant-uuid"


@pytest.mark.asyncio
async def test_mapping_failure_still_reads_original_scoped_candidates():
    scroll = MagicMock(return_value=([], None))
    service = SimpleNamespace(_kb_id_candidates=lambda kb: [kb],
                              _discover_kb_id_from_bucket_async=AsyncMock(side_effect=TimeoutError()),
                              vector_store=SimpleNamespace(client=SimpleNamespace(scroll=scroll)))
    assert await sample_evidence_for_kb(service, "bio", "生物科普") == []
    assert scroll.call_count == 4
    assert all(call.kwargs["scroll_filter"].must[0].match.value == "bio" for call in scroll.call_args_list)


def test_song_question_can_use_a_distinctive_lyric_when_no_title_is_known():
    evidence = source("男声唱着：故事的小黄花，从出生那年就飘着，童年的荡秋千，随记忆一直晃到现在。")
    question = response(evidence, text="唱着“故事的小黄花”的那首歌描绘了哪些童年回忆？")
    assert len(validate_questions(json.dumps({"questions": [question]}), [evidence], max_questions=6)) == 1


@pytest.mark.parametrize("text,question", [
    ("其立面设有多个尖顶塔楼、绿色铜质锥形屋顶、拱形窗框与装饰性壁龛。", "汉堡仓库城的红砖建筑为什么有绿色尖顶？"),
    ("主体为一座建于水边石台上的木结构歇山顶亭阁。", "江南园林里为什么常在水边建亭子？"),
    ("汤米坐在红色电话亭中操作老式打字机，桌上散落文件与硬币。", "汤米为什么坐在红色电话亭里打字？"),
    ("Agent sandbox infrastructure has diversified into several distinct product categories.", "智能体沙箱为什么分化出多个产品类别？"),
    ("建筑的底部有多根粗大的石柱，表面饰有镂空花纹。", "建筑底部的镂空石柱有什么用？"),
])
def test_causal_questions_require_an_explanation_in_the_quote(text, question):
    evidence = source(text)
    raw = json.dumps({"questions": [response(evidence, text=question)]})
    assert validate_questions(raw, [evidence], max_questions=6) == []


@pytest.mark.parametrize("text,question", [
    ("这些峰林由数亿年前沉积形成的石英砂岩经长期风化侵蚀与流水切割作用形成。", "张家界的石柱峰林是怎么形成的？"),
    ("为了防止磨好的咖啡变质，联邦军士兵甚至会随身背着磨豆机出征。", "南北战争时联邦军士兵为什么随身带着磨豆机？"),
    ("The hook is designed to enforce policy without changing the agent core.", "治理钩子在智能体架构中有什么作用？"),
    ("需要在工具调用前执行权限检查，因此系统引入生命周期钩子。", "智能体为什么需要生命周期钩子？"),
])
def test_causal_or_functional_questions_keep_explicit_source_explanations(text, question):
    evidence = source(text)
    raw = json.dumps({"questions": [response(evidence, text=question)]})
    assert len(validate_questions(raw, [evidence], max_questions=6)) == 1


@pytest.mark.parametrize("quote,expected", [
    ("头部呈仰视姿态，目光专注向上凝望，面部毛色为典型的布伦海姆色型。", 0),
    ("骑士查理王小猎犬目光专注地看向远方，颈部佩戴项圈。", 0),
    ("骑士查理王小猎犬看着手持食物的主人，颈部佩戴项圈。", 1),
])
def test_gaze_questions_distinguish_target_from_direction(quote, expected):
    evidence = source(quote)
    raw = json.dumps({"questions": [response(evidence, text="仰头的骑士查理王小猎犬在看什么？")]})
    assert len(validate_questions(raw, [evidence], max_questions=6)) == expected


@pytest.mark.asyncio
async def test_prompt_preserves_file_groups_for_linking_transcript_and_description():
    description = source("男声演唱了一首中国民谣歌曲，以木吉他伴奏。")
    transcript = make_evidence("和我在成都的街头走一走，直到所有的灯都熄灭了也不停留。",
                               kb_id="bio", kb_name="生物科普", file_id="tea", kind="audio_asr")
    unrelated = make_evidence("一种竹笛主奏的纯音乐，开头宁静，随后变得轻快。",
                              kb_id="bio", kb_name="生物科普", file_id="other", kind="audio_description")
    llm = SimpleNamespace(chat=AsyncMock(return_value=SimpleNamespace(success=True, model_used="flash",
        data={"choices": [{"message": {"content": '{"questions":[]}'}}]})))
    await generate_natural_questions([description, transcript, unrelated], llm=llm)
    sent = json.loads(llm.chat.call_args.kwargs["messages"][1]["content"])["evidence"]
    by_id = {item["evidence_id"]: item for item in sent}
    assert by_id[description["id"]]["source_group"] == by_id[transcript["id"]]["source_group"]
    assert by_id[description["id"]]["source_group"] != by_id[unrelated["id"]]["source_group"]


def test_generated_answer_hint_is_preserved_as_drafting_evidence():
    evidence = source()
    raw = json.dumps({"questions": [response(evidence, answer_hint="先作药用，后来用于饮用。") ]})
    questions = validate_questions(raw, [evidence], max_questions=6)
    assert questions[0]["answer_hint"] == "先作药用，后来用于饮用。"
