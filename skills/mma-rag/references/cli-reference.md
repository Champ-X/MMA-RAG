# Tessmora CLI reference (`mma-rag`)

The executable and `MMA_RAG_*` environment variables retain their original names for compatibility.

## Environment

- `MMA_RAG_BASE_URL`: API origin; default `http://127.0.0.1:8000`.
- `MMA_RAG_TIMEOUT_SECONDS`: ordinary request timeout; default `360`.
- `MMA_RAG_UPLOAD_TIMEOUT_SECONDS`: upload request timeout; default `1800`.
- `MMA_RAG_ALLOWED_ROOTS`: comma- or path-separator-delimited upload roots.

Without `MMA_RAG_ALLOWED_ROOTS`, uploads are allowed from the current working directory and the current user's `Desktop`, `Documents`, and `Downloads` directories.

## Global options

Place global options before the command:

```bash
scripts/mma-rag --base-url http://127.0.0.1:8000 --pretty health
```

All commands write one JSON object to stdout:

```json
{"ok":true,"schema_version":"1","command":"health","data":{}}
```

Inspect `ok` before using `data`. Diagnostics go to stderr only.

## Service

```bash
scripts/mma-rag health
```

## Knowledge bases

```bash
scripts/mma-rag kb list
scripts/mma-rag kb show --kb-id KB_ID
scripts/mma-rag kb create --name NAME [--description TEXT]
```

## Files

```bash
scripts/mma-rag file list --kb-id KB_ID
```

## Ingestion

Submit one or more files without waiting:

```bash
scripts/mma-rag ingest files \
  --kb-id KB_ID \
  --path /absolute/document.pdf \
  --path /absolute/video.mp4
```

Check or wait for jobs:

```bash
scripts/mma-rag ingest status \
  --processing-id JOB_ID \
  --processing-id ANOTHER_JOB_ID

scripts/mma-rag ingest wait \
  --processing-id JOB_ID \
  --timeout 5400 \
  --poll-interval 2
```

Without `--timeout`, `ingest wait` defaults to 5400 seconds.

If an approved upload path is outside the default safe roots, set an explicit root for that invocation:

```bash
MMA_RAG_ALLOWED_ROOTS=/approved/directory \
  scripts/mma-rag ingest files --kb-id KB_ID --path /approved/directory/file.pdf
```

Supported types include PDF, Word, PowerPoint, text, Markdown, spreadsheets, common images, common audio, and common video formats accepted by Tessmora.

## Evidence retrieval

`search` calls the read-only `POST /api/v1/retrieval/search` endpoint and returns compact evidence without generating an answer.

```bash
scripts/mma-rag search \
  --query "部署失败后如何回滚？" \
  --kb-id KB_ID \
  --top-k 8
```

Repeat `--kb-id` for multi-KB retrieval. Use a single `--kb-id` when also passing `--file-id`.

```bash
scripts/mma-rag search \
  --query "图中展示什么？" \
  --kb-id KB_ID \
  --file-id FILE_ID \
  --modality image
```

Repeat `--modality` to allow several of `doc`, `image`, `audio`, and `video`.

## Grounded answers

`ask` calls the Chat API and lets Tessmora synthesize an answer from retrieved evidence.

```bash
scripts/mma-rag ask \
  --query "总结部署流程" \
  --kb-id KB_ID \
  --agent-mode auto
```

Accepted modes are `direct`, `auto`, and `agent`. Pass `--session-id` to continue a prior local chat session.

## Exit codes

- `0`: success.
- `2`: invalid CLI arguments.
- `3`: Tessmora unavailable.
- `4`: API rejected or failed the request.
- `5`: ingestion job failed.
- `6`: ingestion wait timed out.
