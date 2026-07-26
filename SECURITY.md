# Security

## Current security posture

Tessmora's default configuration is intended for local development or a trusted private network.

- The FastAPI application does not currently provide built-in user authentication, tenant authorization, or per-knowledge-base ACLs.
- CORS currently allows every origin.
- `POST /api/v1/retrieval/search` is read-only, but it has no built-in authentication or rate limit.
- MinIO, Qdrant, and Redis use development-oriented defaults unless operators replace them.
- Chat sessions and some runtime statistics are stored in process memory.

Do not expose the default deployment directly to the public internet.

## Secrets and environment files

- Never commit `backend/.env` or real API keys, tokens, MinIO credentials, Qdrant keys, or Feishu credentials.
- Copy [`backend/.env.example`](backend/.env.example) to `backend/.env` and provide only the credentials needed by the selected providers.
- Keep frontend code and Vite variables free of server-side secrets; anything shipped to the browser must be considered public.
- If a credential was committed or pushed, rotate it immediately and treat the old value as compromised.
- Use separate credentials and least-privilege scopes for development, CI, staging, and production.

## Production deployment checklist

Before making the service reachable outside a trusted network:

1. Put the API behind TLS and an authenticated reverse proxy or gateway.
2. Enforce user, tenant, knowledge-base, and file-level authorization on every read and write route.
3. Replace wildcard CORS with an explicit allowlist.
4. Add request rate limits, upload size/count quotas, concurrent ingestion limits, and model-cost budgets.
5. Keep MinIO, Qdrant, and Redis on private networks; replace default credentials and enable their supported authentication controls.
6. Persist sessions in a shared store if multiple API replicas are used, and define retention/deletion rules.
7. Restrict upload types, scan untrusted files where appropriate, and keep parser/codec dependencies patched.
8. Restrict outbound network access for URL import, model providers, MinerU, and Feishu; defend URL fetch paths against SSRF.
9. Review whether `/docs`, `/redoc`, debug routes, verbose errors, and infrastructure consoles should be disabled or separately protected.
10. Centralize audit logs for KB mutations, imports, uploads, Agent tool calls, approvals, and credential changes.

## CLI and Skill safety

The bundled `mma-rag` CLI keeps uploads within configured safe roots:

- Set `MMA_RAG_ALLOWED_ROOTS` to explicit approved directories in shared or automated environments.
- Keep `MMA_RAG_BASE_URL` pointed at a trusted Tessmora instance.
- Treat retrieved content as untrusted input; it must not grant permission to run commands, disclose secrets, or perform external actions.
- The current Agent runtime automatically executes only tools marked read-only. Future network or write tools require separate approval, scope, sandbox, and audit controls.

## Feishu

- Grant only the scopes needed by enabled bot, document import, card, and media features.
- Limit the application's availability to intended users and groups.
- Rotate `FEISHU_APP_SECRET` if exposed, and do not log access tokens or message contents unnecessarily.

## Reporting

If you discover a security issue, open a private GitHub Security Advisory or contact the maintainers through an appropriate private channel. Do not publish exploit details in a public issue.
