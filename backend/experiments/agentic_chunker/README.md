# Standalone Agentic Chunker experiment

This directory is intentionally not imported by `app.modules.ingestion.service`.
It validates a lossless semantic-boundary chunking design before production
integration.

The planner can only return contiguous ranges over immutable source-unit IDs.
The implementation rebuilds each chunk from original offsets, verifies exact
source coverage, enforces a hard safety ceiling, and falls back to a
deterministic structural planner if an LLM response is invalid or unavailable.
The standalone default hard ceiling is 600 estimated tokens; it is a guardrail,
not a target size.

Run a real-document comparison from the repository root:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m experiments.agentic_chunker.run_demo \
  README.md --mode auto --output /private/tmp/agentic-readme-report.json
```

`--mode heuristic` performs the same lossless validation without calling a
remote model. `--mode llm` and `--mode auto` use the existing generic chat
route only for this experiment; no production task routing is changed.
