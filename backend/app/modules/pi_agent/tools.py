"""The tool contract is the Agent's entire authority. All arguments validate again here."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import re
import tempfile
import time
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .contracts import Evidence
from .answers import assess_answer, citation_errors, compact_assessment, evidence_payload, repair_feedback
from .policy import ToolError
from .requirements import apply_requirements, bind_requirements
from .store import fingerprint
from .tables import query_table


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ListSources(Args):
    query: str = Field(default="", max_length=200)
    modalities: list[Literal["doc", "image", "audio", "video"]] = Field(default_factory=list, max_length=4,
        description="可选：在分页前按来源模态筛选。查找文档可只选doc；省略或空列表列出所有可读模态，不扩大原任务范围。")
    offset: int = Field(default=0, ge=0, le=20000)
    limit: int = Field(default=20, ge=1, le=30)


class Search(Args):
    query: str = Field(min_length=1, max_length=1000)
    mode: Literal["hybrid", "exact"] = "hybrid"
    modalities: list[Literal["doc", "image", "audio", "video"]] = Field(default_factory=lambda: ["doc", "image", "audio", "video"], min_length=1, max_length=4)
    knowledge_base_ids: list[str] = Field(default_factory=list, max_length=100)
    source_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=list, max_length=32,
        description="可选：仅搜索已发现的这些source_id，可来自list_sources或此前返回的证据。空列表沿用本轮检索范围；只能缩小范围，不能搜索只读引用或输入附件。")
    limit: int = Field(default=6, ge=1, le=8)


class ReadSource(Args):
    source_id: str = Field(min_length=1, max_length=100)
    start: int = Field(default=0, ge=0, le=100000)
    limit: int = Field(default=3, ge=1, le=4)
    text_offset: int = Field(default=0, ge=0, le=2000000,
        description="单个索引片段内的Unicode字符位置，默认从头读取。续读使用返回的text_continuations参数，且limit必须为1。")
    expected_record_version: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$",
        description="续读时原样传入text_continuations中的版本，防止将已变化的索引片段拼接到旧文字。")


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


class AnswerStatement(Args):
    unit_id: str = Field(pattern=r"^[al][1-9][0-9]*$", max_length=12,
        description="正文按非空行从a1编号；每条limitations依次为l1、l2等。必须恰好覆盖所有单元。")
    kind: Literal["fact", "inference", "abstention", "limitation", "formatting"] = Field(
        description="只要含实质性事实就用fact或inference。abstention仅陈述本次未找到支持；全文或全库不存在某信息是fact，不能伪装成abstention或limitation。")
    source_spans: list[Annotated[str, Field(pattern=r"^e[1-9][0-9]*s[1-9][0-9]*$", max_length=32)]] = Field(default_factory=list, max_length=30,
        description="fact/inference关联工具返回的content_units.id，如e2s1，且须支持整行全部事实；其余类型留空。")


class SubmitAnswer(Args):
    answer: str = Field(min_length=1, max_length=24000)
    evidence_ids: list[int] = Field(default_factory=list, max_length=100)
    outcome: Literal["answer", "not_found"] = Field(default="answer",
        description="没有回答用户问题的相关依据时必须用 not_found，不得引用只匹配主题或介绍来源的材料")
    status: Literal["completed", "partial"] = "completed"
    limitations: list[str] = Field(default_factory=list, max_length=20)


class CheckedAnswer(SubmitAnswer):
    answer: str = Field(min_length=1, max_length=24000,
        description="你撰写的正文。引用每个数字单独加方括号，如[1][2]，不能写成[1,2]或[e1s1]；content_units.id只填在source_spans。编号须来自本轮实际返回且支持该行事实的证据。")
    statements: list[AnswerStatement] = Field(default_factory=list, max_length=160)
    max_characters: int | None = Field(default=None, ge=1, le=24000,
        description="兼容参数；如填写必须等于set_answer_requirements中已登记的上限。省略或null仍由宿主执行已登记上限，不能解除限长。")


class AnswerRequirements(Args):
    max_characters: int | None = Field(ge=1, le=24000,
        description="先从用户问题理解正文字符上限；有明确要求时填其上限，否则null。汉字、英文字母、数字和标点逐个计数。")
    length_quote: str | None = Field(min_length=1, max_length=500,
        description="对应限长的用户原句，逐字引用当前问题或提供的用户历史；无限长时为null。不能引用材料或助手的话。")
    required_points: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(min_length=1, max_length=12,
        description="你从用户要求中理解的必答要点和格式要求。只登记任务要求，不填写研究结论。")


class AskUser(Args):
    question: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(default_factory=list, max_length=4)


DEFINITIONS = {
    "set_answer_requirements": (AnswerRequirements, "研究开始前登记你对本轮回答要求的理解：正文上限、对应用户原句和必答要点。登记只写入本轮账本，不检索资料或生成答案。登记后本轮不可修改，检查和提交始终执行该上限；理解有歧义时可ask_user。"),
    "list_sources": (ListSources, "列出当前可读来源和输入材料，在分页前按名称及可选modalities过滤。查找文档可让modalities只选doc，避免被抽取图片占满目录页。目录项不能作证据，先读取。"),
    "search": (Search, "在宿主限定范围内搜索已建索引的文本、图片描述、音频描述/转写、视频镜头。hybrid 为语义+词面融合；exact 为原短语包含匹配。可用source_ids将本次查询收窄到已发现的具体来源，用modalities选择文档原文或媒体索引。图片证据如带provenance.parent_document，可用其source_id继续读取所属文档；该链接只是导航，尚未取得文档正文。返回证据、截断及服务错误。输入附件不参与搜索。"),
    "read_source": (ReadSource, "按 source_id 深读已解析来源。文档 start 为 chunk_index，媒体 start 为索引片段偏移。next_start读取后续片段；text_continuations给出当前长片段的续读参数，避免遗漏截断后的条件。图片证据如带provenance.parent_document，可用其source_id继续读取所属文档；导航链接不代表已读取该文档。媒体索引描述不能代替直接观察。"),
    "expand_context": (ExpandContext, "读取已返回文档证据的前后相邻 chunk，核对条件、指代和上下文。"),
    "recall_evidence": (RecallEvidence, "复读本轮已交付的证据，每次最多4条，编号和内容保持不变。用于核对上下文中已归档的原文；预算收尾阶段最多使用一次，然后提交回答，不读取新来源。"),
    "inspect_media": (InspectMedia, "直接读取原图片、PDF 指定页、音频或视频的指定区间。每次至多 60 秒，默认前 30 秒；视频最多 6 帧并记录实际时间。可选 visual/audio/both，观察模型独立于最终回答模型。"),
    "query_table": (QueryTable, "确定性读取 CSV/TSV/XLSX 原表并按列过滤、分组、计数或计算。保留原行号、单位和操作；不执行公式、Python 或 SQL。PDF 表格请读取原文并核对页图。"),
    "check_answer": (CheckedAnswer, "检查你写的草稿：返回非空行/限制说明编号、篇幅、逐项覆盖与实际支持原文。不会终结任务或调用模型。可先留空statements取得编号，再按原文自查并修订；始终执行已登记的正文上限，无需再次填写max_characters。研究阶段可用，预算收尾时直接submit_answer也执行同样检查。检查只证明完整性和来源身份，不证明语义正确。"),
    "submit_answer": (CheckedAnswer, "提交你完成并逐项核验的最终回答。statements必须覆盖每个正文非空行(a1起)和每条限制(l1起)；fact/inference的source_spans须支持该行全部事实，且与就近[编号]引用一致。evidence_ids恰好等于正文引用。始终执行已登记的正文上限，无需再次填写max_characters。证据不足用partial并说明limitations；无相关依据用not_found、partial、空引用，仅说明本次未找到支持，不能断言整篇/全库没有信息。只做完整性与身份检查，不代写答案或证明语义正确。"),
    "ask_user": (AskUser, "缺失的信息会影响结论时，提出具体澄清问题并结束本次运行；用户回复后开始关联的新运行。"),
}


def tool_contracts(answer_checks_enabled=False):
    if answer_checks_enabled:
        return DEFINITIONS
    return {name: (SubmitAnswer, "提交你完成的最终回答。事实主张就近用 [编号]；evidence_ids 必须恰好等于正文实际引用且此前返回的编号。证据不足 status=partial 并说明 limitations。没有相关依据时 outcome=not_found、status=partial、evidence_ids=[]，只说明未找到及范围，不附候选引用。只检查协议，不代写答案或证明语义正确。")
            if name == "submit_answer" else spec for name, spec in DEFINITIONS.items() if name not in {"check_answer", "set_answer_requirements"}}


def definitions(answer_checks_enabled=False):
    return [{"name": name, "label": name, "description": description, "parameters": args.model_json_schema()}
            for name, (args, description) in tool_contracts(answer_checks_enabled).items()]


class ToolSet:
    def __init__(self, run_id, store, catalog, scope, ledger, gateway, media, emit, blocking, *, answer_checks_enabled=False):
        self.run_id, self.store, self.catalog, self.scope = run_id, store, catalog, scope
        self.ledger, self.gateway, self.media, self.emit, self.blocking = ledger, gateway, media, emit, blocking
        self.answer_checks_enabled = answer_checks_enabled
        self.contracts = tool_contracts(answer_checks_enabled)
        self.evidence_payload = evidence_payload if answer_checks_enabled else lambda e: e.model_dump()
        self.delivered: dict[int, Evidence] = {}
        self.final_result = None
        self.calls = set()
        self.answer_requirements = store.get(run_id)["state"].get("answer_requirements") if answer_checks_enabled else None

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
            if name not in self.contracts or call_id in self.calls:
                raise ToolError("invalid_tool", "未知工具或重复调用标识")
            args = self.contracts[name][0].model_validate(raw).model_dump()
            if self.answer_checks_enabled and self.answer_requirements is None and name not in {"set_answer_requirements", "ask_user"}:
                raise ToolError("answer_requirements_missing", "请先用set_answer_requirements登记当前用户的正文上限、原句和必答要点，再自主研究或提交。")
            self.calls.add(call_id)
            self.ledger.reserve_tool(name)
        except (ToolError, ValidationError) as error:
            return self._error(name, span, started, error, executed=False)
        self.emit("tool.started", {"name": name, "args": args, "tool_call_id": call_id}, span_id=span)
        try:
            result, observations, terminal = await asyncio.wait_for(self._dispatch(name, args, span), self.ledger.limits.tool_seconds)
            # Every numbered source unit repeats its evidence ID. Bound the ID's
            # width before registration; a fixed margin undercounts many short lines.
            # No await occurs between this read and registration in the single host.
            number_bound = self.store.next_evidence_id(self.run_id) + len(observations) - 1 if observations else 0
            provisional = {**result, "evidence": [self.evidence_payload(e.model_copy(update={"id": number_bound})) for e in observations]}
            size = len(json.dumps(provisional, ensure_ascii=False))
            self.ledger.account_output(size)
            if name == "set_answer_requirements":
                # No await between charging output and committing the immutable
                # requirements. Failed/oversized tool results cannot register them.
                self.answer_requirements = self.store.record_answer_requirements(self.run_id,
                    result["answer_requirements"], parent_span_id=span)
            assigned = [self.store.add_evidence(self.run_id, e) for e in observations]
            output = {**result, **({"evidence": [self.evidence_payload(e) for e in assigned]} if assigned else {})}
            artifact = "tool_" + fingerprint(call_id)[:24]
            self.store.put_artifact(self.run_id, artifact, output)
            self.delivered.update({e.id: e for e in assigned})
            details = {"artifact_id": artifact, "evidence_ids": [e.id for e in assigned], **(terminal or {})}
            if name == "set_answer_requirements":
                details["answer_requirements"] = self.answer_requirements
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
        # A completed emit follows the persisted tool.started arguments. The
        # worker may archive a superseded draft only with this host attestation;
        # schema/budget rejections before execution do not have a saved draft.
        details = {**value, **({"rejected_answer_span_id": span}
            if self.answer_checks_enabled and executed and name == "submit_answer" else {})}
        return {"isError": True, "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "details": details}

    async def _dispatch(self, name, args, span):
        if name == "set_answer_requirements":
            requirements = bind_requirements(args, self.store.get(self.run_id)["request"])
            if self.answer_requirements is not None and self.answer_requirements != requirements:
                raise ToolError("answer_requirements_locked", "本轮回答要求已经登记，不能因草稿超长而解除或提高上限。")
            return {"status": "recorded", "answer_requirements": requirements}, [], None
        if name == "list_sources":
            sources = sorted(self.catalog.visible(self.scope), key=lambda s: (not s.attachment, s.kb_id, s.name, s.id))
            sources = [s for s in sources if args["query"].casefold() in s.name.casefold()
                       and (not args["modalities"] or s.modality in args["modalities"])]
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
        if name in {"check_answer", "submit_answer"}:
            if self.answer_checks_enabled:
                args = apply_requirements(args, self.answer_requirements)
            assessment = assess_answer(args, self.delivered) if self.answer_checks_enabled else None
            if name == "check_answer":
                return {"status": "checked" if assessment["protocol_valid"] else "needs_revision", **assessment}, [], None
            used = {int(i) for i in re.findall(r"\[(\d+)\]", args["answer"])}
            if assessment and not assessment["protocol_valid"]:
                feedback = json.dumps(repair_feedback(assessment), ensure_ascii=False)
                bound = min(6000, self.ledger.limits.tool_output_chars // 2)
                if len(feedback) > bound:
                    feedback = feedback[:bound] + "…（反馈已截断）"
                raise ToolError(assessment["errors"][0]["code"], f"逐项检查未通过，请按宿主实际计数与正文单元整体修订：{feedback}")
            if not assessment:
                errors = citation_errors(args, self.delivered)
                if errors:
                    raise ToolError(errors[0]["code"], errors[0]["message"])
            terminal = {"terminal": args["status"], "outcome": args["outcome"], "answer": args["answer"], "limitations": args["limitations"],
                        **({"answer_checks": compact_assessment(assessment)} if assessment else {}),
                        "citations": [self.citation(self._evidence(i)) for i in sorted(used)]}
            return {"status": "accepted"}, [], terminal
        terminal = {"terminal": "needs_input", "answer": args["question"], "question": args["question"], "options": args["options"], "citations": []}
        return {"status": "accepted"}, [], terminal
