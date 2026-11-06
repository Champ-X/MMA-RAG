# Tessmora security policy

[简体中文](SECURITY.md) · **English** · [Project home](README-en.md)

Tessmora currently targets a **local single-user workspace or trusted network**. Some routes have dedicated access controls, but the application does not provide a complete user authentication, tenant isolation, or knowledge-base authorization system. The default deployment is not ready to serve untrusted users on the public internet.

This policy describes the current code's security boundaries, protections operators need to configure, and how to report a vulnerability.

<a id="reporting"></a>

## Reporting a security issue

**Do not publish exploit steps, real credentials, private materials, or unredacted logs in public issues, pull requests, or discussions.**

As of **November 7, 2026**, this repository has not enabled GitHub Private Vulnerability Reporting and has not published a dedicated security email address. Follow these steps to find an available private channel:

1. Check the repository's [Security page](https://github.com/Champ-X/MMA-RAG/security). If **Report a vulnerability** is available, use it to submit a private report.
2. If that option is unavailable, use a private contact method the maintainer has already provided to you. If you have none, you may open an [issue](https://github.com/Champ-X/MMA-RAG/issues) solely to request a private channel, for example with the title “Request a private security reporting channel.” Do not include the vulnerability type, affected endpoint, reproduction material, or exploit details yet.
3. Once a private channel is established, send the information below. Report ordinary bugs and installation problems publicly using the [contributing guide](CONTRIBUTING-en.md).

A useful security report includes:

- The affected commit SHA, operating system, and whether you use a source checkout or the complete Docker installation.
- Attack prerequisites, access scope, expected and actual behavior, and the potential impact on data or permissions.
- Reproduction steps on your own instance with minimal synthetic data; include redacted requests, logs, or a proposed fix where useful.
- Whether information has already been disclosed, and a way to follow up with you.

Test only instances you own or are authorized to assess. Avoid accessing other people's materials, damaging data, or causing sustained resource consumption. The maintainer has not published response deadlines, security maintenance periods, or a bounty program; this document does not promise them.

## Versions and fix scope

The repository [does not yet use semantic versioned releases](CHANGELOG.md) and currently has no release tags or supported-version matrix. Include the output of `git rev-parse HEAD` in reports rather than only saying “latest.” Where safe, check whether current `main` is affected; do not upgrade or modify an active data directory merely to reproduce a problem.

Keep the corresponding code and dependency lockfiles when evaluating a fix. Historical commits, old branches, and experimental run records do not imply ongoing security maintenance.

## Current access controls

| Surface | Existing mechanism | Remaining boundary |
| --- | --- | --- |
| Standard knowledge-base, upload, import, chat, and retrieval APIs | Individual routes validate their inputs and business rules | No application-wide user authentication, tenant isolation, or per-knowledge-base ACLs; read-only retrieval can still disclose materials |
| Pi and network collection | Shared workspace access checks. Without a token, they check the local connection, request hostname, and optional Origin; with a token, they validate workspace credentials | A single workspace identity, not an application-wide login system. Pi's browser session cookie applies only to `/api/pi` |
| Setup API | Configuration writes, model tests, and model preparation require `X-Tessmora-Setup-Token` | `status`, `storage`, and `progress` are public status routes; the setup token does not protect every business endpoint |
| Pi source tools | The host validates permitted knowledge bases, files, and reference materials; tools cannot expand the run's search scope | Reference materials can be read without automatically broadening search; these checks do not authorize other APIs |
| Browser cross-origin access and API docs | FastAPI currently allows all CORS origins and exposes OpenAPI, `/docs`, and `/redoc` on the development API | CORS is not authentication and does not limit data access to the frontend |

Implementation references: [routes and CORS](backend/app/main.py), [workspace credentials](backend/app/api/pi_agent.py), [collection API](backend/app/api/collection.py), [setup API](backend/app/api/setup.py), and [Pi source scope](backend/app/modules/pi_agent/policy.py).

## Network boundaries by installation mode

| Mode | Default host ports and credentials |
| --- | --- |
| CLI complete Docker installation | The [distribution Compose file](deploy/compose.yaml) publishes only Web `3001` and MinIO object access `9000` on `127.0.0.1`, with configurable ports. The backend, Qdrant, Redis, and MinIO Console have no published host ports. The installer generates an instance token and random storage password |
| Source development | The API and Vite started by `start-dev.sh` bind locally, but storage ports in the [root Compose file](docker-compose.yml) are published without a loopback restriction and use development MinIO credentials. Starting the full root Compose stack also publishes backend and monitoring ports |

The complete installation's Nginx proxies `/api/` and `/health`, not FastAPI's documentation routes. It does not include a public TLS or user authentication gateway. Port changes, reverse proxies, tunnels, and container networking can change these boundaries. Check the firewall and actual Docker listeners in development too.

## Data, credentials, and model providers

- **Local storage does not imply offline processing.** Embedding, reranking, answer generation, media inspection, and selected cloud parsers may send questions, text passages, images, or audio/video to configured providers. Before using sensitive materials, check the actual model routing, provider data policies, and authorized scope.
- **Configuration files are not encrypted vaults.** The CLI's `runtime.env`, the server's `state/setup.json`, and a source checkout's `backend/.env` may contain credentials. The installer uses restrictive file permissions, not encryption at rest. Protect configuration directories and backups, and keep them out of Git.
- **Workspace connection links are credentials.** For a local instance managed by the CLI, the full URL from `tessmora open --print-url` contains the instance token. The UI removes the URL fragment and uses the credential within the tab, but the original link must still stay out of screenshots, issues, chats, and public logs. The complete installation also uses this token for Pi access.
- **The browser stores conversation data.** Conversation snapshots and attachments use local browser storage and IndexedDB. People sharing a browser profile may access them; clearing browser data does not delete server-side originals or run records.
- **Review logs before sharing.** Some known credentials are redacted, but original materials, questions, tool outputs, exceptions, and signed media links can still be sensitive. Share only the minimum necessary, redacted information.
- Frontend code and `VITE_*` variables reach the browser and must not contain server-side secrets. Use separate, least-privilege model and Feishu credentials, and restrict Feishu application availability to intended users and groups.

For data locations and backup scope, see the [installer guide](packages/cli/README.md#配置与数据) and [distribution guide](docs/DISTRIBUTION.md).

## Files, external links, and agents

Uploaded files, web pages, transcripts, text in images, and retrieval results are untrusted input. They cannot grant permission to execute commands, read unrelated directories, disclose credentials, or expand access scope.

**External links follow different paths.** The network collection [downloader](backend/app/modules/collection/providers.py) permits public HTTP(S) on ports 80/443, validates DNS addresses, pins the connection IP, rechecks redirects, and limits download size and time. These protections do not cover the entire project: legacy URL import and network images fetched by parsers do not share equivalent public-address validation. Before accepting untrusted links, operators must still restrict outbound network access and block connections to private networks, loopback addresses, and cloud metadata endpoints.

**Local paths require explicit scope.** Server-side folder import is disabled by default; configure `IMPORT_FOLDER_ALLOWED_BASE_PATHS` when enabling it, and retain Markdown local-image allowlist checks. The `mma-rag` CLI's `MMA_RAG_ALLOWED_ROOTS` limits that CLI's upload paths, not the server filesystem. Configure explicit roots in shared or automated environments; see the [CLI reference](skills/mma-rag/references/cli-reference.md).

**Pi has a limited toolset, not a malicious-file sandbox.** Pi exposes no arbitrary Shell, Python, or SQL execution tool; table operations are constrained, and network collection is a separate ingestion feature. The host still invokes parsers, FFmpeg, LibreOffice, and other programs. Run them with restricted system privileges and maintain their dependencies. The standard Agent's read-only tool gate does not mean Pi never writes run state, calls external models, or incurs costs.

**Resource and cost controls need separate configuration.** Pi has no cumulative limit on tokens, total runtime, or tool calls. Concurrency slots and failure stop conditions are not cost quotas. Durable recovery may retry interrupted model requests and incur additional charges. The complete installation's Nginx has a request-body limit, but it does not replace file-size, count, memory, or parsing limits for every route. Direct development API access does not inherit that proxy limit.

## Before broadening access

These are measures operators need to implement and verify, not features already supplied by the product:

1. Use TLS and an authentication gateway, and enforce the required user, knowledge-base, and file permissions on all read, write, download, and streaming routes. A Pi or setup token alone is insufficient.
2. Set an explicit CORS allowlist. Isolate storage, administration, debugging, and console endpoints; replace development credentials. Review expiry and access scope when sharing object links.
3. Apply request-rate, request-body, storage, concurrent parsing, and model-cost limits. Isolate processes and network access for uploaded files and external URLs; maintain parser dependencies and container images.
4. Define retention, deletion, access auditing, and encrypted backups, and test restoration. Pi and collection hold exclusive data-directory locks, while ordinary backend sessions still have process-local state; adding API workers that share a directory is not a supported shortcut to horizontal scaling.

See [Pi Agent](docs/PI_AGENT_MODE.md), [Pi Durable](docs/pi-agent-durable.md), and the [architecture guide](docs/MMA_ARCHITECTURE.md) for runtime details.

## After credential leakage or unintended exposure

Revoke or rotate affected credentials first and restrict external access where needed; do not wait for Git history cleanup. Review access records and provider usage, keeping investigation evidence private and redacted. Deleting a file or reverting a commit does not make an exposed credential safe again.

Coordinate recovery and notification scope with the maintainer when shared Git history, backups, or data cleanup are involved. Irreversible deletion is not a substitute for investigation. Follow the [reporting process](#reporting) for vulnerabilities.
