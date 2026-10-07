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
from .answers import assess_answer, citation_errors, compact_assessment, evidence_payload, media_target_errors, repair_feedback
from .policy import ToolError
from .requirements import apply_requirements, bind_requirements
from .store import fingerprint
from .tables import query_table


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ListSources(Args):
    query: str = Field(default="")
    modalities: list[Literal["doc", "image", "audio", "video"]] = Field(default_factory=list,
        description="可选：在分页前按来源模态筛选。查找文档可只选doc；省略或空列表列出所有可读模态，不扩大原任务范围。")
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1)


class Search(Args):
    query: str = Field(min_length=1)
    mode: Literal["hybrid", "exact"] = "hybrid"
    modalities: list[Literal["doc", "image", "audio", "video"]] = Field(default_factory=lambda: ["doc", "image", "audio", "video"], min_length=1)
    knowledge_base_ids: list[str] = Field(default_factory=list)
    source_ids: list[Annotated[str, Field(min_length=1)]] = Field(default_factory=list,
        description="可选：仅搜索已发现的这些source_id，可来自list_sources或此前返回的证据。空列表沿用本轮检索范围；只能缩小范围，不能搜索只读引用或输入附件。")
    limit: int = Field(default=6, ge=1)


class ReadSource(Args):
    source_id: str = Field(min_length=1)
    start: int = Field(default=0, ge=0)
    limit: int = Field(default=3, ge=1)
    text_offset: int = Field(default=0, ge=0,
        description="单个索引片段内的Unicode字符位置，默认从头读取。续读使用返回的text_continuations参数，且limit必须为1。")
    expected_record_version: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$",
        description="续读时原样传入text_continuations中的版本，防止将已变化的索引片段拼接到旧文字。")


class ExpandContext(Args):
    evidence_id: int = Field(ge=1)
    radius: int = Field(default=1, ge=0)


class RecallEvidence(Args):
    evidence_ids: list[int] = Field(min_length=1)


class InspectMedia(Args):
    source_id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    start_sec: float = Field(default=0, ge=0)
    end_sec: float | None = Field(default=None, ge=0)
    view: Literal["visual", "audio", "both"] = "both"
    page: int = Field(default=1, ge=1)


class TableFilter(Args):
    column: str = Field(min_length=1)
    op: Literal["eq", "contains", "gt", "lt"]
    value: str = Field()


class QueryTable(Args):
    source_id: str = Field(min_length=1)
    sheet: str | None = Field(default=None)
    columns: list[str] = Field(default_factory=list)
    filters: list[TableFilter] = Field(default_factory=list)
    operation: Literal["select", "count", "sum", "mean", "min", "max"] = "select"
    value_column: str | None = Field(default=None)
    group_by: str | None = Field(default=None)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=10, ge=1)


class AnswerStatement(Args):
    unit_id: str = Field(pattern=r"^[al][1-9][0-9]*$",
        description="正文按非空行从a1编号；每条limitations依次为l1、l2等。必须恰好覆盖所有单元。")
    kind: Literal["fact", "inference", "abstention", "limitation", "formatting"] = Field(
        description="只要含实质性事实就用fact或inference。abstention仅陈述本次未找到支持；全文或全库不存在某信息是fact，不能伪装成abstention或limitation。")
    source_spans: list[Annotated[str, Field(pattern=r"^e[1-9][0-9]*s[1-9][0-9]*$")]] = Field(default_factory=list,
        description="fact/inference关联工具返回的content_units.id，如e2s1，且须支持整行全部事实；其余类型留空。")


ANSWER_WRITING_GUIDANCE = (
    "直接交付用户请求的结果，并在结果旁给出必要依据与数字引用。"
    "用户提供或要求参考的背景是判断条件，不自动成为一篇背景报告；除非明确要求，正文不要先列背景概述、材料清单或研究过程。"
    "只写帮助理解、选择或使用结果的信息；不要逐条复述素材特征、扩展旁支、重复建议或强行引用研究计划中的全部材料。"
    "不写无关命中和未选候选的介绍。用户要求的比较、排除解释和影响结论的反证/局限必须保留。"
    "所交付的每个媒体结果（包括有必要的备选）都用实际数字引用展示。"
    "不影响交付的来源范围或使用说明仅在确有必要时于正文末尾简述，不重复列为任务缺口。"
)

COMPLETION_GUIDANCE = (
    "完成度以用户要求的交付结果为准，不以资料是否穷尽或研究是否达到更高标准为准。"
    "在当前范围选择匹配结果时，不自行增加权威认证、全量阅读等验收条件；用户明确要求或结论成立必需的条件仍须满足。"
    "全部交付项ready用completed；仅当用户要求的内容确实未交付时用partial。"
    "报告缺失不等于交付用户要求的具体结果，仍须保留gap；若用户所求就是缺失检查、可行性判断或明确允许未知占位，则给出该判断可完成。禁止估算不等于允许省略所需结果。"
)


class SubmitAnswer(Args):
    answer: str = Field(min_length=1, description=ANSWER_WRITING_GUIDANCE)
    evidence_ids: list[int] = Field(default_factory=list)
    outcome: Literal["answer", "not_found"] = Field(default="answer",
        description="没有回答用户问题的相关依据时必须用 not_found，不得引用只匹配主题或介绍来源的材料")
    status: Literal["completed", "partial"] = Field(default="completed", description=COMPLETION_GUIDANCE)
    limitations: list[str] = Field(default_factory=list,
        description="仅记录实际未交付的用户要求，与计划incomplete/unavailable项的gap对应；completed时为空。一般来源范围、匹配建议的性质等必要说明写在正文末尾，不导致partial，也不在此重复。")


class CheckedAnswer(SubmitAnswer):
    answer: str = Field(min_length=1,
        description=ANSWER_WRITING_GUIDANCE + "引用每个数字单独加方括号，如[1][2]，不能写成[1,2]或[e1s1]；content_units.id只填在source_spans。编号须来自本轮实际返回且支持该行事实的证据。")
    statements: list[AnswerStatement] = Field(default_factory=list)
    max_characters: int | None = Field(default=None, ge=1,
        description="兼容参数；如填写必须等于set_answer_requirements中已登记的上限。省略或null仍由宿主执行已登记上限，不能解除限长。")


class AnswerRequirements(Args):
    max_characters: int | None = Field(ge=1,
        description="先从用户问题理解正文字符上限；有明确要求时填其上限，否则null。汉字、英文字母、数字和标点逐个计数。")
    length_quote: str | None = Field(min_length=1,
        description="对应限长的用户原句，逐字引用当前问题或提供的用户历史；无限长时为null。不能引用材料或助手的话。")
    required_points: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1,
        description="你从用户要求中理解的必答要点和格式要求。只登记任务要求，不填写研究结论。")


class AskUser(Args):
    question: str = Field(min_length=1)
    options: list[str] = Field(default_factory=list)


class AnswerPlanItem(Args):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    requirement: str = Field(min_length=1,
        description="用户希望收到的结果，不是研究输入或步骤。'结合/参考/依据X完成Y'的交付项是Y；X用于支持Y，除非用户另外要求概述或解释X。")
    quote: str = Field(min_length=1, description="逐字来自当前用户问题的对应要求。")
    modality: Literal["any", "doc", "image", "audio", "video"] = "any"
    basis: Literal["sources", "user_input"] = Field(default="sources",
        description="sources用于需要工具来源的研究/事实/素材任务；user_input仅用于用户提供文本或数值的改写、翻译、推导或按要求创作，不冒充外部事实核实。")
    input_quotes: list[Annotated[str, Field(min_length=1)]] = Field(default_factory=list,
        description="逐字来自当前或历史用户消息的输入依据；user_input的ready必须填写，不能引用助手回答或资料指令。")
    status: Literal["pending", "ready", "incomplete", "unavailable"] = Field(default="pending",
        description="pending继续研究；ready已足以交付用户要求；incomplete已有部分结果但仍缺少该要求的具体内容，保留证据并填gap；unavailable完全未取得该项依据，清空证据并填gap。一般来源范围说明不影响ready，不自行增加用户未要求的验收条件。说明缺失不等于交付用户要求的具体结果，除非用户所求就是缺失判断或明确接受未知占位。")
    evidence_ids: list[Annotated[int, Field(ge=1)]] = Field(default_factory=list,
        description="最终交付的主要来源编号；sources的ready/incomplete必须填写，类型须符合modality。只选匹配用户要求的结果，与工作记忆容量分开。")
    supporting_evidence_ids: list[Annotated[int, Field(ge=1)]] = Field(default_factory=list,
        description="解释结果必需的辅助依据，如所问比较、关键反证、适用条件或推导输入；未匹配研究候选不在此列，不为展示检索过程而加入。")
    gap: str = Field(default="", description="仅incomplete/unavailable填写：该用户要求还有什么结果或必要条件未交付；提交时原样列入limitations。不是一般来源范围或更高研究标准的说明。")


class RetainedSpan(Args):
    evidence_id: int = Field(ge=1)
    start: int = Field(ge=0, description="已交付content内的Unicode字符位置；不是页码或来源全文位置。")
    end: int = Field(ge=1, description="结束位置，不包含此字符；每条证据可指定一个关键区间。")


class UpdateAnswerPlan(Args):
    items: list[AnswerPlanItem] = Field(min_length=1,
        description="只登记用户希望收到的结果；用于判断结果的背景、条件或材料归入相应项的依据，不自行扩展为独立报告。后续保留既有要求身份与顺序，可追加用户要求中的遗漏项，定稿时可收窄非必要证据选择。")
    retained_spans: list[RetainedSpan] | None = Field(default=None,
        description="可选：指定已选原文的关键Unicode区间。省略/null保留仍被选择的旧区间；[]清除指定区间、恢复完整已交付文本。不改变证据身份或限制最终引用。")


DEFINITIONS = {
    "set_answer_requirements": (AnswerRequirements, "研究开始前登记你对本轮回答要求的理解：正文上限、对应用户原句和必答要点。登记只写入本轮账本，不检索资料或生成答案。登记后本轮不可修改，检查和提交始终执行该上限；理解有歧义时可ask_user。"),
    "list_sources": (ListSources, "列出当前可读来源和输入材料，在分页前按名称及可选modalities过滤。查找文档可让modalities只选doc，避免被抽取图片占满目录页。目录项不能作证据，先读取。"),
    "search": (Search, "在宿主限定范围内搜索已建索引的文本、图片描述、音频描述/转写、视频镜头。hybrid 为语义+词面融合；exact 为原短语包含匹配。可用source_ids将本次查询收窄到已发现的具体来源，用modalities选择文档原文或媒体索引。图片证据如带provenance.parent_document，可用其source_id继续读取所属文档；该链接只是导航，尚未取得文档正文。返回证据、截断及服务错误。输入附件不参与搜索。"),
    "read_source": (ReadSource, "按 source_id 深读已解析来源。文档 start 为 chunk_index，媒体 start 为索引片段偏移。next_start读取后续片段；text_continuations给出当前长片段的续读参数，避免遗漏截断后的条件。图片证据如带provenance.parent_document，可用其source_id继续读取所属文档；导航链接不代表已读取该文档。媒体索引描述不能代替直接观察。"),
    "expand_context": (ExpandContext, "读取已返回文档证据的前后相邻 chunk，核对条件、指代和上下文。"),
    "recall_evidence": (RecallEvidence, "复读本轮已交付的证据，编号和内容保持不变。用于核对上下文中已归档的原文；不读取新来源。"),
    "inspect_media": (InspectMedia, "直接读取原图片、PDF 指定页、音频或视频的指定区间。默认读取起点后的30秒；可指定任意有效终点，较长区间自动分段处理，没有累计时长或次数限制。视频按每30秒最多6帧采样并记录时间，采样不等于逐帧观察；可用更小区间精查。可选 visual/audio/both，观察模型独立于最终回答模型。"),
    "query_table": (QueryTable, "确定性读取 CSV/TSV/XLSX 原表并按列过滤、分组、计数或计算。保留原行号、单位和操作；不执行公式、Python 或 SQL。PDF 表格请读取原文并核对页图。"),
    "check_answer": (CheckedAnswer, "检查你写的草稿：返回非空行/限制说明编号、篇幅、逐项覆盖与实际选中的证据片段；选择生成图注时返回来源提示。不会终结任务或调用模型。可先留空statements取得编号，再核对证据自查并修订；始终执行已登记的正文上限，无需再次填写max_characters。直接submit_answer也执行同样检查。检查只证明完整性和来源身份，不证明语义正确。"),
    "submit_answer": (CheckedAnswer, "提交你完成并逐项核验的最终回答。statements必须覆盖每个正文非空行(a1起)和每条限制(l1起)；fact/inference的source_spans须支持该行全部事实，且与就近[编号]引用一致。evidence_ids恰好等于正文引用。始终执行已登记的正文上限，无需再次填写max_characters。用户要求的内容确实未交付才用partial并说明limitations；无相关依据用not_found、partial、空引用，仅说明本次未找到支持，不能断言整篇/全库没有信息。只做完整性与身份检查，不代写答案或证明语义正确。"),
    "ask_user": (AskUser, "缺失的信息会影响结论时，提出具体澄清问题并结束本次运行；用户回复后开始关联的新运行。"),
}


PLAN_TOOL = (UpdateAnswerPlan, "登记用户要求的最终交付项与依据类型，不把研究步骤或一般格式约束当作额外交付物。sources项选择最终正文需要的主要证据evidence_ids和补充依据supporting_evidence_ids；未匹配候选留在研究记录。user_input项以用户原文input_quotes为依据，无需检索或伪造引用。只有明确要求特定原文类型或媒体资产时才限定modality，一般分析使用any；及时更新进度；既有要求不可删改，可追加遗漏项。最终引用数量与原文工作记忆分离；retained_spans可选已交付文本的关键区间，可按研究需要复读或调整。足以交付用户要求即为ready；已有部分结果但仍有实际缺口用incomplete并保留依据，完全未取得依据用unavailable，两者填具体gap。一般来源范围说明不降级状态，不自行增加用户未要求的认证或穷尽条件。计划是研究工作数据，不是最终引用清单。定稿时只引用回答用户问题实际需要的材料，不必逐条引用计划中的证据，也不要陈列无关候选和淘汰过程。宿主只核对状态和引用身份，不代写或证明语义正确。")


def tool_contracts(answer_checks_enabled=False, answer_plan_enabled=False):
    if answer_checks_enabled:
        contracts = dict(DEFINITIONS)
    else:
        contracts = {name: (SubmitAnswer, "提交你完成的最终回答。事实主张就近用 [编号]；evidence_ids 必须恰好等于正文实际引用且此前返回的编号。用户要求的内容确实未交付才用status=partial并说明limitations；一般来源说明必要时写在正文末尾，全部交付用completed、limitations=[]。没有相关依据时 outcome=not_found、status=partial、evidence_ids=[]，只说明未找到及范围，不附候选引用。只检查协议，不代写答案或证明语义正确。")
                     if name == "submit_answer" else spec for name, spec in DEFINITIONS.items() if name not in {"check_answer", "set_answer_requirements"}}
    return {"update_answer_plan": PLAN_TOOL, **contracts} if answer_plan_enabled else contracts


def definitions(answer_checks_enabled=False, answer_plan_enabled=False):
    return [{"name": name, "label": name, "description": description, "parameters": args.model_json_schema()}
            for name, (args, description) in tool_contracts(answer_checks_enabled, answer_plan_enabled).items()]


class ToolSet:
    def __init__(self, run_id, store, catalog, scope, ledger, gateway, media, emit, blocking, *, answer_checks_enabled=False,
                 answer_plan_enabled=False):
        self.run_id, self.store, self.catalog, self.scope = run_id, store, catalog, scope
        self.ledger, self.gateway, self.media, self.emit, self.blocking = ledger, gateway, media, emit, blocking
        self.answer_checks_enabled = answer_checks_enabled
        self.answer_plan_enabled = answer_plan_enabled
        self.contracts = tool_contracts(answer_checks_enabled, answer_plan_enabled)
        self.evidence_payload = evidence_payload if answer_checks_enabled else lambda e: e.model_dump()
        self.delivered: dict[int, Evidence] = {}
        self.final_result = None
        self.calls = set()
        self.answer_requirements = store.get(run_id)["state"].get("answer_requirements") if answer_checks_enabled else None
        self.answer_plan = store.get(run_id)["state"].get("answer_plan") if answer_plan_enabled else None

    def citation(self, evidence):
        source = self.catalog.get(evidence.source_id, self.scope)
        path = f"/api/pi/runs/{self.run_id}/sources/{source.id}/content"
        media_key = {"image": "img_url", "audio": "audio_url", "video": "video_url"}.get(source.modality)
        return {**evidence.citation, "id": evidence.id, "source": evidence.source, "content": evidence.content,
                "pi_run_id": self.run_id, "source_id": source.id,
                "file_path": path, **({media_key: path} if media_key else {})}

    def _evidence(self, number):
        if number not in self.delivered:
            raise ToolError("invalid_evidence", "只能使用本轮工具实际返回的证据编号")
        return self.delivered[number]

    def _output_size(self, result, observations, first_number):
        # Every source unit repeats the evidence ID. Bound its width using the
        # largest possible new ID, including when prior observations deduplicate.
        number_bound = first_number + len(observations) - 1 if observations else 0
        provisional = {**result, "evidence": [
            self.evidence_payload(e.model_copy(update={"id": number_bound})) for e in observations]}
        return len(json.dumps(provisional, ensure_ascii=False))

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
            if self.answer_plan_enabled and self.answer_plan is None and name not in {"update_answer_plan", "set_answer_requirements", "ask_user"}:
                raise ToolError("answer_plan_missing", "请先用update_answer_plan登记当前用户要求的全部交付项与素材类型，再研究或提交。")
            self.calls.add(call_id)
            self.ledger.record_tool(name)
        except (ToolError, ValidationError) as error:
            return self._error(name, span, started, error, executed=False)
        self.emit("tool.started", {"name": name, "args": args, "tool_call_id": call_id}, span_id=span)
        try:
            result, observations, terminal = await self._dispatch(name, args, span)
            # No await between measuring prospective IDs and registration.
            first_number = self.store.next_evidence_id(self.run_id) if observations else 0
            size = self._output_size(result, observations, first_number)
            self.ledger.account_output(size)
            if name == "update_answer_plan":
                self.answer_plan = self.store.record_answer_plan(self.run_id, result["answer_plan"], parent_span_id=span)
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
            if self.answer_checks_enabled and name == "check_answer":
                # Both the full input and exact assessment are durable now.
                # This attests storage, not semantic correctness or acceptance.
                details["checked_answer_span_id"] = span
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
        # schema rejections before execution do not have a saved draft.
        details = {**value, **({"rejected_answer_span_id": span}
            if (self.answer_checks_enabled or self.answer_plan_enabled) and executed and name == "submit_answer" else {})}
        return {"isError": True, "content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "details": details}

    async def _dispatch(self, name, args, span):
        if name == "update_answer_plan":
            from .plan import bind_plan, plan_payload
            plan = bind_plan(args["items"], self.store.get(self.run_id)["request"], self.answer_plan, self.delivered,
                             retained_spans=args["retained_spans"])
            return plan_payload(plan, self.delivered, checked=self.answer_checks_enabled), [], None
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
                await self.blocking(self.catalog.download, self.media.storage, source, path)
                result = await self.blocking(query_table, path, args)
            content = json.dumps(result, ensure_ascii=False)
            evidence = Evidence(source_id=source.id, modality="doc", file_name=source.name, content=content,
                version=fingerprint({"source_version": source.version, "query": args, "result": result}),
                observation="calculation", locator={"sheet": result["sheet"], "query": args},
                provenance={"source_version": source.version, "engine": "deterministic_table"},
                citation={"type": "doc", "file_name": source.name})
            return {"status": "partial" if result["truncated"] else "ok"}, [evidence], None
        if name in {"check_answer", "submit_answer"}:
            from .plan import allows_input_only_answer
            allow_uncited = self.answer_plan_enabled and allows_input_only_answer(self.answer_plan)
            delivery_errors = []
            if self.answer_plan_enabled:
                from .plan import validate_delivery
                try:
                    validate_delivery(args, self.answer_plan)
                except ToolError as error:
                    if name == "submit_answer":
                        raise
                    delivery_errors.append({"code": error.code, "message": str(error)})
            if self.answer_checks_enabled:
                args = apply_requirements(args, self.answer_requirements)
            assessment = assess_answer(args, self.delivered, allow_uncited=allow_uncited) if self.answer_checks_enabled else None
            if assessment and delivery_errors:
                assessment["errors"].extend(delivery_errors)
                assessment["protocol_valid"] = False
            media_errors = []
            if self.answer_plan_enabled and not allow_uncited:
                image_targets = {self.citation(self.delivered[number]).get("img_url")
                    for number in set(args["evidence_ids"]) & self.delivered.keys()
                    if self.delivered[number].modality == "image"} - {None}
                preserved_inputs = [quote for item in self.answer_plan["items"]
                    if item.get("basis", "sources") == "user_input" and item["status"] == "ready"
                    for quote in item.get("input_quotes", [])]
                media_errors = media_target_errors(args["answer"], image_targets, preserved_inputs=preserved_inputs)
                if assessment:
                    assessment["errors"].extend(media_errors)
                    assessment["protocol_valid"] = not assessment["errors"]
            if name == "check_answer":
                return {"status": "checked" if assessment["protocol_valid"] else "needs_revision", **assessment}, [], None
            used = {int(i) for i in re.findall(r"\[(\d+)\]", args["answer"])}
            if assessment and not assessment["protocol_valid"]:
                feedback = json.dumps(repair_feedback(assessment), ensure_ascii=False)
                raise ToolError(assessment["errors"][0]["code"], f"逐项检查未通过，请按宿主实际计数与正文单元整体修订：{feedback}")
            if not assessment:
                errors = citation_errors(args, self.delivered, allow_uncited=allow_uncited) + media_errors
                if errors:
                    raise ToolError(errors[0]["code"], errors[0]["message"])
            terminal = {"terminal": args["status"], "outcome": args["outcome"], "answer": args["answer"], "limitations": args["limitations"],
                        **({"answer_checks": compact_assessment(assessment)} if assessment else {}),
                        "citations": [self.citation(self._evidence(i)) for i in sorted(used)]}
            return {"status": "accepted"}, [], terminal
        terminal = {"terminal": "needs_input", "answer": args["question"], "question": args["question"], "options": args["options"], "citations": []}
        return {"status": "accepted"}, [], terminal
