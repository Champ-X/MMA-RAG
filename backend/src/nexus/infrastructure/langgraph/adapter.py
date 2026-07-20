from __future__ import annotations

from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from nexus.modules.runs.domain import RunView
from nexus.modules.runs.ports import AgentRuntimePort, RunRepositoryPort


class _DispatchState(TypedDict):
    """Adapter-only state: domain objects never enter a LangGraph checkpoint."""

    run_id: str
    dispatch: str


class LangGraphRuntimeAdapter(AgentRuntimePort):
    """LangGraph execution adapter over the authoritative Nexus Run Driver.

    LangGraph owns node scheduling. PostgreSQL remains authoritative for Run state,
    fencing, public events, ledgers, and durable runtime checkpoints. Replaying this
    one-ID dispatch after a process restart is safe because the delegated driver
    enforces those contracts.
    """

    runtime_version = "langgraph-adapter-v1"

    def __init__(self, *, harness: AgentRuntimePort, runs: RunRepositoryPort) -> None:
        self.harness = harness
        self.runs = runs
        builder = StateGraph(_DispatchState)
        builder.add_node("advance_domain_run", self._advance_node)
        builder.add_edge(START, "advance_domain_run")
        builder.add_edge("advance_domain_run", END)
        # The graph checkpoint is deliberately a small dispatch cache. Durable
        # product checkpoints are written transactionally by the domain driver.
        self._graph = builder.compile(checkpointer=InMemorySaver())

    def _advance_node(self, state: _DispatchState) -> _DispatchState:
        self.harness.advance(state["run_id"])
        return {"run_id": state["run_id"], "dispatch": "committed"}

    def _dispatch(self, run_id: str, command: str) -> RunView:
        self._graph.invoke(
            {"run_id": run_id, "dispatch": command},
            config={"configurable": {"thread_id": f"run:{run_id}:{command}"}},
        )
        return self.runs.get_run(run_id)

    def start(self, run_id: str) -> RunView:
        return self._dispatch(run_id, "start")

    def advance(self, run_id: str) -> RunView:
        return self._dispatch(run_id, "advance")

    def resume(self, run_id: str) -> RunView:
        return self._dispatch(run_id, "resume")

    def cancel(self, run_id: str) -> RunView:
        return self._dispatch(run_id, "cancel")

    def recover(self, run_id: str) -> RunView:
        return self._dispatch(run_id, "recover")

    def inspect(self, run_id: str) -> dict[str, object]:
        run = self.runs.get_run(run_id)
        checkpoint = self.runs.load_checkpoint(run_id)
        return {
            "runtime": self.runtime_version,
            "run_id": run.id,
            "status": run.status.value,
            "state_version": run.state_version,
            "checkpoint": checkpoint,
        }
