# Tessmora security policy

[简体中文](SECURITY.md) · **English**

Tessmora is designed for one local user or a trusted network. The standard API lacks application-wide login, tenant isolation, and per-knowledge-base authorization. Anyone with network access to those routes may be able to read or change data.

<a id="reporting"></a>

## Report a security issue privately

Check the repository’s [Security page](https://github.com/Champ-X/MMA-RAG/security). If **Report a vulnerability** is available, use it to send a private report. You can also use a private contact supplied by the maintainer. If neither is available, request a private contact through [Issues](https://github.com/Champ-X/MMA-RAG/issues). Send technical details only through the private channel.

Include the output of `git rev-parse HEAD`, installation method, affected permissions or data, expected and actual behavior, and a minimal example using synthetic material. Remove keys, connection links, and user content from logs. The project has no published supported-version matrix or response SLA. For ordinary installation issues, follow the [contributing guide](CONTRIBUTING-en.md).

## Routes and credentials

| Entry point | Current behavior |
| --- | --- |
| Knowledge bases, upload, import, retrieval, standard chat | Routes validate their inputs. Network reachability determines access in the absence of a deployment-level authorization layer. FastAPI CORS allows all origins. |
| Pi and web collection | Both use workspace checks. When `PI_AGENT_API_TOKEN` is configured, a workspace credential is required. Otherwise the service checks the loopback connection, host, and optional Origin. The Pi session cookie lasts six hours and is scoped to `/api/pi`. Use a bearer token for collection requests. |
| Installation settings | Reading or saving configuration, testing providers, and preparing models require `X-Tessmora-Setup-Token`. The `status`, `storage`, and `progress` routes are publicly readable. |
| Pi source tools | The host enforces the run’s allowed knowledge bases, files, and attachments. An `@` mention adds reading material. Separate selectors determine the search scope. |

[API and CORS](backend/app/main.py) · [Workspace checks](backend/app/api/pi_agent.py) · [Collection](backend/app/api/collection.py) · [Setup](backend/app/api/setup.py)

## Deployment and data

- **Full installation.** Docker publishes the web port `3001` and MinIO object port `9000` on `127.0.0.1` by default. Nginx forwards `/api/` and `/health`. The installer generates an instance token and storage password. `tessmora open --print-url` explicitly prints a private link containing the token. [Distribution Compose](deploy/compose.yaml)
- **Source development.** Vite and FastAPI bind locally. The root Compose file publishes storage ports without a loopback restriction and includes development MinIO credentials. Starting the entire root Compose stack also publishes backend and monitoring ports. [Development Compose](docker-compose.yml)
- **Local files.** `backend/.env`, the CLI’s `runtime.env`, and server-side `state/setup.json` can contain secrets. Restrict file access and protect the complete backup. Browser storage and IndexedDB also contain conversations or attachments that others sharing a browser profile may read. [Backup scope](packages/cli/README.md#配置与数据)
- **Model requests.** Cloud parsing, embedding, reranking, generation, and media inspection can send queries or source content to the configured providers. Check their data policies before deployment. Pi has no cumulative token, time, or tool-call quota. Retrying interrupted calls can cost extra.

## Files, networking, and shared access

Treat uploads, webpages, and retrieved material as external input. The web collection downloader checks public destinations, ports, and redirects. Legacy URL imports and remote images in parsers have their own download paths. Restrict outbound traffic at the network level for a shared deployment. Server folder imports are disabled by default and require `IMPORT_FOLDER_ALLOWED_BASE_PATHS`. `MMA_RAG_ALLOWED_ROOTS` limits uploads made with the `mma-rag` CLI. [Collection downloader](backend/app/modules/collection/providers.py) · [CLI options](skills/mma-rag/references/cli-reference.md)

Pi exposes scoped source tools and predefined table operations. The host also runs parsers, FFmpeg, and LibreOffice. Run them with limited privileges. Before sharing an instance, configure TLS, authentication, knowledge-base authorization, CORS, request and spending limits, and isolate storage and management ports. Pi and collection have exclusive directory locks, and standard chat retains process-local state. Test backup restoration in a separate instance. [Architecture](docs/MMA_ARCHITECTURE.md) · [Pi recovery](docs/pi-agent-durable.md)

## If credentials are exposed

Revoke or rotate affected credentials and restrict access if needed. Review provider usage and access logs, keep redacted evidence privately, and follow the [reporting process](#reporting). Rotate exposed keys even if they have been removed from Git history.
