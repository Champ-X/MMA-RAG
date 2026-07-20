# Nexus security model

Nexus is local-first, but local deployment is not a substitute for explicit trust boundaries.

## Secrets

- Never commit `backend/.env`, API keys, provider tokens, database passwords, or MinIO credentials.
- Copy `backend/.env.example` and replace every development credential before exposing a service.
- Provider credentials are read from environment variables or stored as `env://NAME` references. The
  PostgreSQL catalog must never contain their plaintext values.
- If a secret was committed or printed in a shared log, rotate it; deleting the file is not sufficient.

## Network and execution boundaries

- Compose publishes only the Web/API and MinIO console on `127.0.0.1`; PostgreSQL, Qdrant, and Redis
  remain on the internal project network.
- API and worker containers run as non-root with `no-new-privileges` and read-only root filesystems.
- PDF/DOC/PPT input is sent only to the explicitly configured MinerU endpoint. There is no silent parser
  or remote-provider fallback.
- External Web/MCP tools and external writes are disabled by default. Tool output is untrusted evidence
  input and may not widen a frozen Run scope or override system policy.
- The production path does not execute arbitrary shell or Python submitted by a user. A future code tool
  must use a separately deployed sandbox controller and fixed, unprivileged payload image.

## Data integrity and privacy

- Raw objects are content-addressed by SHA-256 and written before parsing.
- Evidence revisions and Artifact evidence bindings are immutable; user edits create a new Artifact
  revision with optimistic concurrency.
- PostgreSQL is authoritative. Qdrant and Redis are rebuildable projections/coordination state.
- Backup manifests contain database and object hashes and deliberately exclude secrets. Restore refuses a
  non-empty target.
- Normal logs and public Run events must not include raw prompts, complete tool output, object bytes, or
  credentials.

## Reporting

Report vulnerabilities through a private GitHub Security Advisory or another private maintainer channel.
Do not file a public issue containing exploit details or sensitive data.
