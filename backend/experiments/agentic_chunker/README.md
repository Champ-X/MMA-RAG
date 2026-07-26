# Agentic Chunker comparison harness

This directory contains the standalone experiment that validated Tessmora's lossless semantic-boundary chunking design. It is intentionally not imported by `app.modules.ingestion.service`.

The production implementation has already shipped at:

- `backend/app/modules/ingestion/splitters/agentic.py`
- its integration in `backend/app/modules/ingestion/service.py`

Both designs keep source units immutable: the planner returns contiguous unit IDs, server code materializes content from the original units, validates coverage, applies a hard safety ceiling, and falls back to deterministic structural planning when model output is invalid or unavailable.

Use this directory only for isolated comparisons and regression investigation; do not modify it expecting production ingestion behavior to change.

Run a comparison from the repository root:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m experiments.agentic_chunker.run_demo \
  README.md --mode auto --output /private/tmp/agentic-readme-report.json
```

- `--mode heuristic` performs lossless validation without a remote model.
- `--mode llm` forces the experiment's model planner.
- `--mode auto` uses the model when available and otherwise falls back.

The experiment's 600 estimated-token hard ceiling is a guardrail for this harness, not the production target size.
