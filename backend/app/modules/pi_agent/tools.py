"""The tool contract is the Agent's entire authority. All arguments validate again here."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import re
import tempfile
import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .contracts import Evidence
from .policy import ToolError
from .store import fingerprint
from .tables import query_table


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ListSources(Args):
    query: str = Field(default="", max_length=200)
    offset: int = Field(default=0, ge=0, le=20000)
    limit: int = Field(default=20, ge=1, le=30)


class Search(Args):
    query: str = Field(min_length=1, max_length=1000)
    mode: Literal["hybrid", "exact"] = "hybrid"
    modalities: list[Literal["doc", "image", "audio", "video"]] = Field(default_factory=lambda: ["doc", "image", "audio", "video"], min_length=1, max_length=4)
    knowledge_base_ids: list[str] = Field(default_factory=list, max_length=100)
    limit: int = Field(default=6, ge=1, le=8)


class ReadSource(Args):
    source_id: str = Field(min_length=1, max_length=100)
    start: int = Field(default=0, ge=0, le=100000)
    limit: int = Field(default=3, ge=1, le=4)


class ExpandContext(Args):
    evidence_id: int = Field(ge=1)
    radius: int = Field(default=1, ge=0, le=1)


class RecallEvidence(Args):
    evidence_ids: list[int] = Field(min_length=1, max_length=4)


class InspectMedia(Args):
    source_id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=1, max_length=1000)
    start_sec: float = Field(default=0, ge=0, le=86400)
    end_sec: float | None = Field(default=None, ge=0, le=86400)
    view: Literal["visual", "audio", "both"] = "both"
    page: int = Field(default=1, ge=1, le=10000)


class TableFilter(Args):
    column: str = Field(min_length=1, max_length=200)
    op: Literal["eq", "contains", "gt", "lt"]
    value: str = Field(max_length=1000)


class QueryTable(Args):
    source_id: str = Field(min_length=1, max_length=100)
    sheet: str | None = Field(default=None, max_length=200)
    columns: list[str] = Field(default_factory=list, max_length=20)
    filters: list[TableFilter] = Field(default_factory=list, max_length=10)
    operation: Literal["select", "count", "sum", "mean", "min", "max"] = "select"
    value_column: str | None = Field(default=None, max_length=200)
    group_by: str | None = Field(default=None, max_length=200)
    offset: int = Field(default=0, ge=0, le=20000)
    limit: int = Field(default=10, ge=1, le=30)


class SubmitAnswer(Args):
    answer: str = Field(min_length=1, max_length=24000)
    evidence_ids: list[int] = Field(default_factory=list, max_length=100)
    status: Literal["completed", "partial"] = "completed"
    limitations: list[str] = Field(default_factory=list, max_length=20)


class AskUser(Args):
    question: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(default_factory=list, max_length=4)


DEFINITIONS = {
    "list_sources": (ListSources, "列出当前可读来源和输入材料，按名称过滤并分页。目录项不能作证据，先读取。"),
    "search": (Search, "在宿主限定范围内搜索已建索引的文本、图片描述、音频描述/转写、视频镜头。hybrid 为语义+词面融合；exact 为原短语包含匹配。返回证据、截断及服务错误。输入附件不参与搜索。"),
    "read_source": (ReadSource, "按 source_id 深读已解析来源。文档 start 为 chunk_index，媒体 start 为索引片段偏移；根据 next_start 翻页。媒体索引描述不能代替直接观察。"),
    "expand_context": (ExpandContext, "读取已返回文档证据的前后相邻 chunk，核对条件、指代和上下文。"),
    "recall_evidence": (RecallEvidence, "重新读取本轮已获得的证据。用于恢复上下文中已归档的工具结果，编号保持不变。"),
    "inspect_media": (InspectMedia, "直接读取原图片、PDF 指定页、音频或视频的指定区间。每次至多 60 秒，默认前 30 秒；视频最多 6 帧并记录实际时间。可选 visual/audio/both，观察模型独立于最终回答模型。"),
    "query_table": (QueryTable, "确定性读取 CSV/TSV/XLSX 原表并按列过滤、分组、计数或计算。保留原行号、单位和操作；不执行公式、Python 或 SQL。PDF 表格请读取原文并核对页图。"),
    "submit_answer": (SubmitAnswer, "提交你完成的最终回答。事实主张就近用 [编号]；evidence_ids 必须恰好等于正文实际引用且此前返回的编号。证据不足 status=partial 并说明 limitations。只检查协议，不代写答案或证明语义正确。"),
    "ask_user": (AskUser, "缺失的信息会影响结论时，提出具体澄清问题并结束本次运行；用户回复后开始关联的新运行。"),
}


def definitions():
    return [{"name": name, "label": name, "description": description, "parameters": args.model_json_schema()}
            for name, (args, description) in DEFINITIONS.items()]


class ToolSet:
    def __init__(self, run_id, store, catalog, scope, ledger, gateway, media, emit, blocking):
        self.run_id, self.store, self.catalog, self.scope = run_id, store, catalog, scope
        self.ledger, self.gateway, self.media, self.emit, self.blocking = ledger, gateway, media, emit, blocking
        self.delivered: dict[int, Evidence] = {}
        self.final_result = None
        self.calls = set()

    def citation(self, evidence):
        source = self.catalog.get(evidence.source_id, self.scope)
        path = f"/api/pi/runs/{self.run_id}/sources/{source.id}/content"
        media_key = {"image": "img_url", "audio": "audio_url", "video": "video_url"}.get(source.modality)
        return {**evidence.citation, "id": evidence.id, "source": evidence.source, "content": evidence.content, "pi_run_id": self.run_id,
                "file_path": path, **({media_key: path} if media_key else {})}

    def _evidence(self, number):
        if number not in self.delivered:
            raise ToolError("invalid_evidence", "只能使用本轮工具实际返回的证据编号")
        return self.delivered[number]

    async def execute(self, call_id, name, raw):
        span, started = f"tool:{call_id}", time.monotonic()
        try:
            if self.final_result:
                raise ToolError("already_submitted", "任务结果已经提交")
            if name not in DEFINITIONS or call_id in self.calls:
                raise ToolError("invalid_tool", "未知工具或重复调用标识")
            args = DEFINITIONS[name][0].model_validate(raw).model_dump()
            self.calls.add(call_id)
            self.ledger.reserve_tool(name)
        except (ToolError, ValidationError) as error:
            return self._error(name, span, started, error, executed=False)
        self.emit("tool.started", {"name": name, "args": args, "tool_call_id": call_id}, span_id=span)
        try:
            result, observations, terminal = await asyncio.wait_for(self._dispatch(name, args, span), self.ledger.limits.tool_seconds)
            # Validate output allowance before registering/delivering evidence. IDs can
            # only be assigned under the store transaction, so reserve a small margin.
            provisional = {**result, "evidence": [e.model_dump() for e in observations]}
            size = len(json.dumps(provisional, ensure_ascii=False))
            self.ledger.account_output(size + 512 if observations else size)
            assigned = [self.store.add_evidence(self.run_id, e) for e in observations]
            output = {**result, **({"evidence": [e.model_dump() for e in assigned]} if assigned else {})}
            artifact = "tool_" + fingerprint(call_id)[:24]
            self.store.put_artifact(self.run_id, artifact, output)
            self.delivered.update({e.id: e for e in assigned})
            details = {"artifact_id": artifact, "evidence_ids": [e.id for e in assigned], **(terminal or {})}
            self.emit("tool.completed", {"name": name, "tool_call_id": call_id, "artifact_id": artifact,
                      "evidence_ids": [e.id for e in assigned], "status": result.get("status", "ok"),
                      "duration_ms": round((time.monotonic() - started) * 1000)}, span_id=span)
            if terminal:
                self.final_result = terminal
                self.emit("answer.accepted" if name == "submit_answer" else "question.accepted", terminal, span_id=span)
            return {"content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False)}], "details": details}
        except asyncio.CancelledError:
            self.emit("tool.cancelled", {"name": name, "duration_ms": round((time.monotonic() - started) * 1000)}, span_id=span)
            raise
        except (ToolError, asyncio.TimeoutError) as error:
            return self._error(name, span, started, error, executed=True)
        except Exception:
            return self._error(name, span, started, ToolError("tool_failed", "工具执行失败，尚未取得有效结果", retryable=True), executed=True)

    def _error(self, name, span, started, error, *, executed):
        code = error.code if isinstance(error, ToolError) else "invalid_arguments" if isinstance(error, ValidationError) else "tool_timeout"
        message = str(error) if isinstance(error, ToolError) else "工具参数不符合接口定义" if isinstance(error, ValidationError) else "工具执行超时"
        value = {"code": code, "message": message, "retryable": getattr(error, "retryable", False)}
        self.emit("tool.failed" if executed else "tool.rejected", {"name": name, **value, "executed": executed,
                  "duration_ms": round((time.monotonic() - started) * 1000)}, span_id=span)
        return {"isError": True, "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "details": value}

    async def _dispatch(self, name, args, span):
        if name == "list_sources":
            sources = sorted(self.catalog.visible(self.scope), key=lambda s: (not s.attachment, s.kb_id, s.name, s.id))
            sources = [s for s in sources if args["query"].casefold() in s.name.casefold()]
            end = args["offset"] + args["limit"]
            return {"sources": [s.public(self.scope) for s in sources[args["offset"]:end]], "total": len(sources),
                    "next_offset": end if end < len(sources) else None, "scope": self.scope.public()}, [], None
        if name == "search":
            observations, result = await self.gateway.search(**args, span_id=span)
            return result, observations, None
        if name == "read_source":
            source = self.catalog.get(args.pop("source_id"), self.scope)
            observations, result = await self.gateway.read(source, **args)
            return result, observations, None
        if name == "expand_context":
            evidence = self._evidence(args["evidence_id"])
            if evidence.modality != "doc" or "chunk_index" not in evidence.locator:
                raise ToolError("no_adjacent_chunks", "该证据没有文档邻接片段，请使用 read_source 或 inspect_media")
            source = self.catalog.get(evidence.source_id, self.scope)
            observations, result = await self.gateway.read(source, start=max(0, evidence.locator["chunk_index"] - args["radius"]), limit=1 + 2 * args["radius"])
            return result, observations, None
        if name == "recall_evidence":
            return {"status": "recalled"}, [self._evidence(n) for n in args["evidence_ids"]], None
        if name == "inspect_media":
            source = self.catalog.get(args.pop("source_id"), self.scope)
            return {"status": "observed"}, [await self.media.inspect(source, **args, span_id=span)], None
        if name == "query_table":
            source = self.catalog.get(args.pop("source_id"), self.scope)
            with tempfile.TemporaryDirectory(prefix="tessmora-pi-table-") as directory:
                path = Path(directory) / ("table" + Path(source.name).suffix.lower())
                await self.blocking(self.catalog.download, self.media.storage, source, path, max_bytes=8 * 1024 * 1024)
                result = await self.blocking(query_table, path, args)
            content = json.dumps(result, ensure_ascii=False)
            evidence = Evidence(source_id=source.id, modality="doc", file_name=source.name, content=content,
                version=fingerprint({"source_version": source.version, "query": args, "result": result}),
                observation="calculation", locator={"sheet": result["sheet"], "query": args},
                provenance={"source_version": source.version, "engine": "deterministic_table"},
                citation={"type": "doc", "file_name": source.name})
            return {"status": "partial" if result["truncated"] else "ok"}, [evidence], None
        if name == "submit_answer":
            used = {int(i) for i in re.findall(r"\[(\d+)\]", args["answer"])}
            declared = set(args["evidence_ids"])
            if used != declared or not used <= self.delivered.keys():
                raise ToolError("citation_mismatch", "正文引用与 evidence_ids 不一致，或引用了本轮尚未返回的证据。请修正后重新提交。")
            if not used and (args["status"] != "partial" or not args["limitations"]):
                raise ToolError("missing_evidence", "无来源支撑时请提交 partial，并说明证据缺口；不能当作已核验的回答。")
            if args["status"] == "partial" and not args["limitations"]:
                raise ToolError("missing_limitations", "部分回答必须具体说明尚未覆盖的范围")
            if "知识库中未找到相关内容" in args["answer"] and used:
                raise ToolError("unsupported_citations", "没有相关证据的回答不能保留候选引用")
            terminal = {"terminal": args["status"], "answer": args["answer"], "limitations": args["limitations"],
                        "citations": [self.citation(self._evidence(i)) for i in sorted(used)]}
            return {"status": "accepted"}, [], terminal
        terminal = {"terminal": "needs_input", "answer": args["question"], "question": args["question"], "options": args["options"], "citations": []}
        return {"status": "accepted"}, [], terminal
