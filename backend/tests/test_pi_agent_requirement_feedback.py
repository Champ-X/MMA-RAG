"""Quote-repair feedback preserves exact binding and the visible-user boundary."""
import asyncio
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from types import SimpleNamespace

import pytest

from app.modules.pi_agent.policy import ToolError
from app.modules.pi_agent.requirements import bind_requirements
from app.modules.pi_agent.supervisor import WORKER
from test_pi_agent_requirements import declaration
from test_pi_agent_supervisor import Registry, make_host, request


def candidate(message):
    return json.JSONDecoder().raw_decode(message.split("空白差异候选：", 1)[1])[0]


@pytest.mark.parametrize("original,quoted", [
    ("正文不超过250字", "正文不超过 250 字"),
    ("正文不超过\t250\u00a0字", "正文不超过250字"),
    ("answer within 250 characters", "answer within250 characters"),
])
def test_whitespace_hint_preserves_exact_original_and_does_not_accept_the_wrong_quote(original, quoted):
    message = "😀要求：" + original + "，说明依据。"
    args = declaration(250, quoted)
    before = deepcopy(args)
    with pytest.raises(ToolError) as caught:
        bind_requirements(args, {"message": message})
    assert caught.value.code == "unknown_requirement_quote"
    hint = candidate(str(caught.value))
    assert hint == {"length_quote": original, "length_origin": {
        "kind": "current_question", "history_index": None, "start": 4, "end": 4 + len(original)}}
    assert args == before
    corrected = bind_requirements({**args, "length_quote": hint["length_quote"]}, {"message": message})
    assert corrected["length_quote"] == original and corrected["max_characters"] == 250
    assert corrected["length_origin"] == hint["length_origin"]


def test_feedback_prefers_current_then_newest_visible_user_but_exact_binding_takes_priority():
    history = [{"role": "user", "content": "正文不超过250 字"},
               {"role": "user", "content": "后续，正文不超过 250字"}]
    args = declaration(250, "正文不超过250字")
    with pytest.raises(ToolError) as caught:
        bind_requirements(args, {"message": "继续", "history": history})
    assert candidate(str(caught.value))["length_origin"] == {
        "kind": "history", "history_index": 1, "start": 3, "end": 13}
    with pytest.raises(ToolError) as caught:
        bind_requirements(args, {"message": "正文不超过\t250字", "history": history})
    assert candidate(str(caught.value))["length_origin"]["kind"] == "current_question"
    exact = bind_requirements(args, {"message": "正文不超过 250字", "history": [
        {"role": "user", "content": "正文不超过250字"}]})
    assert exact["length_origin"]["kind"] == "history"


@pytest.mark.parametrize("history", [
    [{"role": "assistant", "content": "正文不超过250字"}],
    [{"role": "tool", "content": "正文不超过250字"}],
    [{"role": "system", "content": "正文不超过250字"}],
    [{"role": "user", "content": "正文不超过250字"}] + [{"role": "assistant", "content": "随后"}] * 8,
    [{"role": "user", "content": "长" * 2000 + "正文不超过250字"}],
])
def test_hints_never_recover_quotes_from_ineligible_or_invisible_history(history):
    with pytest.raises(ToolError) as caught:
        bind_requirements(declaration(250, "正文不超过 250 字"), {"message": "问题", "history": history})
    assert caught.value.code == "unknown_requirement_quote"
    assert "空白差异候选" not in str(caught.value)


@pytest.mark.parametrize("text,quote", [
    ("正文不超过500字", "正文不超过 250 字"),
    ("正文至少250字", "正文不超过 250 字"),
    ("正文不超过250字。", "正文不超过 250 字，"),
])
def test_feedback_does_not_repair_numbers_negation_or_punctuation(text, quote):
    with pytest.raises(ToolError) as caught:
        bind_requirements(declaration(250, quote), {"message": text})
    assert "空白差异候选" not in str(caught.value)


def test_pathological_whitespace_cannot_make_an_oversized_hint_or_change_the_requirement():
    with pytest.raises(ToolError) as caught:
        bind_requirements(declaration(250, "正文不超过250字"), {
            "message": "正文不超过" + " " * 10000 + "250字"})
    assert "空白差异候选" not in str(caught.value)
    assert len(str(caught.value)) < 500


@pytest.mark.asyncio
async def test_real_pi_roundtrip_delivers_hint_and_persists_failure_before_corrected_registration(tmp_path, monkeypatch):
    requests, hints = [], []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            tool, args = "ask_user", {"question": "受控反馈检查已结束。"}
            if len(requests) == 1:
                tool, args = "set_answer_requirements", declaration(250, "正文不超过 250 字")
            elif len(requests) == 2:
                payload = next(m["content"] for m in reversed(body["messages"]) if m["role"] == "tool")
                feedback = json.loads(payload)["message"]
                if "空白差异候选：" in feedback:
                    hint = candidate(feedback)
                    hints.append(hint)
                    tool, args = "set_answer_requirements", declaration(250, hint["length_quote"])
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            frames = [
                {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0,
                    "id": f"quote-{len(requests)}", "type": "function", "function": {
                        "name": tool, "arguments": json.dumps(args, ensure_ascii=False)}}]}}]},
                {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 30, "total_tokens": 130}},
            ]
            self.wfile.write(("".join("data: " + json.dumps(f) + "\n\n" for f in frames)
                + "data: [DONE]\n\n").encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    class LocalRegistry(Registry):
        def get_provider(self, name):
            return SimpleNamespace(api_key="local-test-only", base_url=f"http://127.0.0.1:{server.server_port}")

    host = make_host(tmp_path, monkeypatch, answer_checks_enabled=True, yield_to_legacy=False)
    host.registry, host.worker = LocalRegistry(), WORKER
    spec = request()
    spec.message = "问题，正文不超过250字，请引用依据。"
    try:
        run = await host.start(spec, "alice")
        await asyncio.wait_for(asyncio.gather(*host.jobs.values()), 8)
        saved = host.store.get(run["id"])
        assert saved["status"] == "needs_input"
        assert len(requests) == saved["state"]["usage"]["model_requests"] == 3
        assert saved["state"]["usage"]["model_tokens"] == 390
        assert saved["state"]["usage"]["searches"] == 0
        bound = saved["state"]["answer_requirements"]
        assert bound["length_quote"] == hints[0]["length_quote"] == "正文不超过250字"
        assert bound["max_characters"] == 250
        events = host.store.events(run["id"])
        failures = [e for e in events if e["type"] == "tool.failed"]
        registrations = [e for e in events if e["type"] == "answer.requirements"]
        assert len(failures) == len(registrations) == 1
        assert failures[0]["data"]["code"] == "unknown_requirement_quote"
        assert candidate(failures[0]["data"]["message"]) == hints[0]
        assert failures[0]["seq"] < registrations[0]["seq"]
        assert registrations[0]["data"] == bound
        rejected_args = next(e["data"]["args"] for e in events if e["span_id"] == "tool:quote-1" and e["type"] == "tool.started")
        assert rejected_args["length_quote"] == "正文不超过 250 字"
    finally:
        await host.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
