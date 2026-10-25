"""Language selection changes authored prompts, not scope, evidence, or tool protocols."""
import asyncio
import json
import re
from types import SimpleNamespace

import pytest

from app.core.prompt_language import get_prompt_language, prompt_language
from app.modules.pi_agent.contracts import RunRequest
from app.modules.pi_agent.gateway import point_text
from app.modules.pi_agent.language import translate_prompt
from app.modules.pi_agent.media import MediaInspector
from app.modules.pi_agent.store import RunConflict, RunStore, canonical, fingerprint
from app.modules.pi_agent.tools import definitions
from test_pi_agent_supervisor import make_host


def without_descriptions(value):
    if isinstance(value, dict):
        return {key: without_descriptions(item) for key, item in value.items() if key != "description"}
    if isinstance(value, list):
        return [without_descriptions(item) for item in value]
    return value


def descriptions(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "description":
                yield item
            else:
                yield from descriptions(item)
    elif isinstance(value, list):
        for item in value:
            yield from descriptions(item)


@pytest.mark.parametrize("checks,plan", [(False, False), (True, False), (False, True), (True, True)])
def test_tool_languages_have_identical_protocol_and_complete_english_descriptions(checks, plan):
    zh = definitions(checks, plan)
    en = definitions(checks, plan, "en-US")
    assert without_descriptions(zh) == without_descriptions(en)
    assert list(descriptions(zh)) != list(descriptions(en))
    assert all(not re.search(r"[\u4e00-\u9fff]", text) for text in descriptions(en))
    assert definitions(checks, plan) == zh  # The English call cannot mutate shared schemas.


def test_request_language_defaults_and_normalization():
    request = RunRequest(client_request_id="language-key", session_id="s", message="原问题")
    assert request.language == "zh-CN"
    assert RunRequest.model_validate({**request.model_dump(), "language": "en-US"}).message == "原问题"
    for value in ("invalid", "en", "", None, 123):
        assert RunRequest.model_validate({**request.model_dump(), "language": value}).language == "zh-CN"
        assert RunRequest.model_validate_json(json.dumps({**request.model_dump(), "language": value})).language == "zh-CN"


def test_legacy_runs_read_and_retry_as_chinese_without_rewriting_stored_request(tmp_path):
    store = RunStore(tmp_path / "ledger.db")
    old_request = {"client_request_id": "legacy-key", "session_id": "s", "message": "原问题"}
    run, _ = store.create(owner="alice", request=old_request, config={})
    # A pre-language record has neither a language field nor its hash contribution.
    with store._connection(write=True) as db:
        db.execute("UPDATE pi_runs SET request_json=?, request_hash=?, config_json=? WHERE id=?",
                   (canonical(old_request), fingerprint(old_request), "{}", run["id"]))
    reopened = RunStore(store.path)
    saved = reopened.get(run["id"])
    assert saved["request"]["language"] == saved["config"]["language"] == "zh-CN"
    same, created = reopened.create(owner="alice", request={**old_request, "language": "zh-CN"}, config={})
    assert not created and same["id"] == run["id"]
    with pytest.raises(RunConflict):
        reopened.create(owner="alice", request={**old_request, "language": "en-US"}, config={})
    with reopened._connection() as db:
        assert json.loads(db.execute("SELECT request_json FROM pi_runs").fetchone()[0]) == old_request


@pytest.mark.asyncio
async def test_concurrent_runs_freeze_language_pass_localized_tools_and_preserve_user_data(tmp_path, monkeypatch):
    script = r'''
import {createInterface} from 'node:readline';
let config, feedback;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.type==='start') {
  config=m.config;
  console.log(JSON.stringify({type:'request',id:'bad',method:'tool',params:{tool_call_id:'bad',name:'search',args:{query:''}}}));
 } else if(m.type==='response' && m.id==='bad') {
  feedback=m.result.details;
  const summary={language:config.language,description:config.tools.find(t=>t.name==='search').description,prompt:JSON.parse(config.prompt),feedback};
  console.log(JSON.stringify({type:'request',id:'ask',method:'tool',params:{tool_call_id:'ask',name:'ask_user',args:{question:JSON.stringify(summary)}}}));
 } else if(m.type==='response') {
  console.log(JSON.stringify({type:'settled',result:m.result.details}));process.exit();
 }
});
'''
    host = make_host(tmp_path, monkeypatch, script=script, max_concurrent_runs=2, yield_to_legacy=False)
    try:
        requests = [RunRequest(client_request_id=f"locale-{language}", session_id="s", message="中文原问题 English?",
                    language=language, history=[{"role": "user", "content": "原始历史"}]) for language in ["zh-CN", "en-US"]]
        runs = await asyncio.gather(*(host.start(request, "alice") for request in requests))
        # Changing the caller's object cannot change an already admitted run.
        for request in requests:
            request.language = "en-US" if request.language == "zh-CN" else "zh-CN"
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 5)
        for run, language in zip(runs, ["zh-CN", "en-US"]):
            saved = host.store.get(run["id"])
            assert saved["status"] == "needs_input"
            assert saved["request"]["language"] == saved["config"]["language"] == language
            result = json.loads(saved["state"]["answer"])
            assert result["language"] == language
            assert result["prompt"]["current_question"] == "中文原问题 English?"
            assert result["prompt"]["history_for_context_only_not_evidence"] == [{"role": "user", "content": "原始历史"}]
            assert bool(re.search(r"[\u4e00-\u9fff]", result["description"])) == (language == "zh-CN")
            assert bool(re.search(r"[\u4e00-\u9fff]", result["feedback"]["message"])) == (language == "zh-CN")
            assert result["feedback"]["code"] == "invalid_arguments"
        async def thread_language(language):
            with prompt_language(language):
                return await host.blocking(get_prompt_language)
        assert await asyncio.gather(thread_language("en-US"), thread_language("zh-CN")) == ["en-US", "zh-CN"]
        assert get_prompt_language() == "zh-CN"
    finally:
        await host.close()


def test_language_does_not_change_indexed_text_or_evidence_offsets():
    payload = {"caption": "中文图像描述", "asr_text": "原始声音 English"}
    zh = point_text(payload, "video")
    with prompt_language("en-US"):
        assert point_text(payload, "video") == zh
        assert translate_prompt("工具参数不符合接口定义") == "Tool arguments do not match the interface contract."


def test_table_policy_language_preserves_original_cells_and_result(tmp_path):
    from app.modules.pi_agent.tables import query_table

    table = tmp_path / "原始表格.csv"
    table.write_text("项目,数值\n原始内容,=1+2\n", encoding="utf-8")
    args = {"filters": [], "operation": "select", "offset": 0, "limit": 10}
    zh = query_table(table, args)
    with prompt_language("en-US"):
        en = query_table(table, args)
    assert en.pop("formula_policy") == "Formulas are returned as original text, not executed; potentially stale cached values are not used."
    assert zh.pop("formula_policy") == "公式作为原文返回，不执行、不使用可能过期的缓存数值"
    assert en == zh
    assert en["result"] == [{"_row": "2", "项目": "原始内容", "数值": "=1+2"}]


@pytest.mark.asyncio
async def test_online_media_prompt_is_english_but_question_and_observation_are_unchanged(monkeypatch):
    captured = []
    async def observe(parts, **kwargs):
        captured.append(parts)
        return "原始观察内容", {}
    async def blocking(function, *args):
        return function(*args)
    monkeypatch.setattr("app.modules.pi_agent.media.image_bytes", lambda *_: (b"image", {"page": 1}))
    inspector = MediaInspector(SimpleNamespace(download=lambda *_: None), object(), SimpleNamespace(observe=observe),
                               SimpleNamespace(record_media=lambda *_: None), object(), blocking)
    source = SimpleNamespace(modality="image", name="原始文件.jpg", id="source", version="v1", attachment=False)
    try:
        with prompt_language("en-US"):
            result = await inspector.inspect(source, question="这个字是什么？", start_sec=0, end_sec=None, view="visual", page=1, span_id="test")
    finally:
        await inspector.close()
    assert captured[0][0]["text"].startswith("Describe only what is actually visible.")
    assert captured[0][0]["text"].endswith("这个字是什么？")
    assert result.content == "原始观察内容" and result.file_name == "原始文件.jpg"


def test_english_not_found_boilerplate_cannot_retain_candidate_citations():
    from app.modules.pi_agent.answers import citation_errors
    args = {"answer": "No relevant content was found in the knowledge base. [1]", "evidence_ids": [1],
            "outcome": "answer", "status": "completed", "limitations": []}
    with prompt_language("en-US"):
        errors = citation_errors(args, {1: object()})
    assert any(error["code"] == "unsupported_citations" for error in errors)
