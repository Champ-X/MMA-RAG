from __future__ import annotations

from nexus.modules.retrieval.domain import ScopeCapsule
from nexus.modules.runs.domain import RunCommand, RunView
from nexus.modules.runs.ports import AgentRuntimePort, RunRepositoryPort
from nexus.shared.domain.enums import QualityMode, RunKind
from nexus.shared.domain.errors import CapabilityUnavailableError, ValidationError


class RunService:
    def __init__(
        self,
        *,
        repository: RunRepositoryPort,
        runtime: AgentRuntimePort | None = None,
        research_enabled: bool = True,
    ) -> None:
        self.repository = repository
        self.runtime = runtime
        self.research_enabled = research_enabled

    def create(
        self,
        *,
        goal: str,
        kind: RunKind,
        scope: ScopeCapsule,
        quality_mode: QualityMode | None = None,
        idempotency_key: str | None = None,
        execute: bool = True,
        conversation_id: str | None = None,
        parent_run_id: str | None = None,
        attachment_source_ids: tuple[str, ...] = (),
        selected_model_deployment_id: str | None = None,
        routing_trace: dict[str, object] | None = None,
        scope_policy: dict[str, object] | None = None,
    ) -> RunView:
        clean_goal = goal.strip()
        if not clean_goal:
            raise ValidationError("Run goal must not be empty")
        if kind == RunKind.RESEARCH and not self.research_enabled:
            raise CapabilityUnavailableError("Deep Research is disabled by the active kill switch")
        quality = quality_mode or (
            QualityMode.DEEP if kind == RunKind.RESEARCH else QualityMode.QUALITY
        )
        history: list[dict[str, str]] = []
        if parent_run_id:
            parent = self.repository.get_run(parent_run_id)
            conversation_id = parent.conversation_id
            for previous in self.repository.list_conversation(parent.conversation_id)[-6:]:
                history.append({"role": "user", "content": previous.goal})
                if previous.result and previous.result.get("answer"):
                    history.append(
                        {
                            "role": "assistant",
                            "content": str(previous.result["answer"])[:4000],
                        }
                    )
        run = self.repository.create_run(
            RunCommand(
                goal=clean_goal,
                kind=kind,
                quality_mode=quality,
                scope=scope,
                idempotency_key=idempotency_key,
                conversation_id=conversation_id,
                parent_run_id=parent_run_id,
                request_context={
                    "conversation_history": history,
                    "attachment_source_ids": list(attachment_source_ids),
                    "routing_trace": routing_trace or {},
                    "scope_policy": scope_policy or {},
                },
                selected_model_deployment_id=selected_model_deployment_id,
            )
        )
        if execute and self.runtime and run.status.value == "created":
            return self.runtime.start(run.id)
        return run

    def get(self, run_id: str) -> RunView:
        return self.repository.get_run(run_id)

    def pause(self, run_id: str) -> RunView:
        return self.repository.request_pause(run_id)

    def resume(self, run_id: str) -> RunView:
        run = self.repository.request_resume(run_id)
        if self.runtime:
            return self.runtime.resume(run_id)
        return run

    def cancel(self, run_id: str) -> RunView:
        run = self.repository.request_cancel(run_id)
        if self.runtime:
            return self.runtime.cancel(run_id)
        return run
