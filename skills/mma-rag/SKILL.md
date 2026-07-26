---
name: mma-rag
description: Operate the locally running Tessmora knowledge service through its bundled deterministic mma-rag CLI. Use when Codex needs to list or create Tessmora knowledge bases, inspect indexed files, upload and index local documents/images/audio/video, wait for ingestion, retrieve compact multimodal evidence, or answer questions grounded in Tessmora.
---

# Tessmora (`mma-rag` CLI)

Use the bundled `scripts/mma-rag` CLI. The command and environment-variable prefix retain the `mma-rag` name for compatibility after the product rename to Tessmora. Resolve the script relative to this `SKILL.md`, invoke it by absolute path, and expect JSON on stdout for every command.

## Workflow

1. Run `scripts/mma-rag health` before the first operation.
2. If the service is unavailable, report that Tessmora must be started. Do not start or stop it unless the user asks.
3. Run `kb list` when the target knowledge base ID is unknown.
4. Use `ingest files` with absolute paths to add local multimodal files.
5. Save every returned `processing_id` and run `ingest wait` or `ingest status`.
6. Treat content as searchable only after every relevant job reports `completed`.
7. Use `search` when the user wants evidence or when Codex will synthesize the result.
8. Use `ask` when the user explicitly wants Tessmora to generate the grounded answer.
9. Preserve returned file names, page numbers, and audio/video time ranges in the final response.

## Safety

- Create knowledge bases or upload files only when the user's request authorizes the mutation.
- Never delete or overwrite Tessmora content; this skill exposes no deletion command.
- Upload only user-designated files. The CLI rejects files outside configured safe roots and common credential paths.
- Do not claim ingestion succeeded when a job is queued, processing, failed, missing, or timed out.
- Do not expose raw CLI diagnostics or secrets in the final response.

## Command details

Read [references/cli-reference.md](references/cli-reference.md) when selecting flags, handling errors, filtering by files/modalities, or configuring safe upload roots.
