# MMA-RAG Nexus v2

Nexus is an evidence-first, recoverable local multimodal agentic knowledge base. PostgreSQL is authoritative, MinIO/filesystem blobs retain raw and derived objects, Qdrant is a rebuildable projection, and Redis is transient coordination only.

The normative implementation plan is [MULTIMODAL_AGENTIC_KNOWLEDGE_BASE_ARCHITECTURE_IMPLEMENTATION.md](docs/MULTIMODAL_AGENTIC_KNOWLEDGE_BASE_ARCHITECTURE_IMPLEMENTATION.md). The [implementation audit](docs/architecture/NEXUS_V2_IMPLEMENTATION_AUDIT.md) maps every large deletion to its replacement and real acceptance evidence. Legacy chat sessions, the in-memory stream manager, vector-store authority, old frontend pages, and static OpenAPI have been removed only after their product semantics moved to the single v2 domain path.

## Start

```bash
cp backend/.env.example backend/.env
./start-dev.sh --profile standard
```

Open <http://127.0.0.1:3000> and <http://127.0.0.1:8000/docs>. The launcher diagnoses missing prerequisites but never installs system packages.

For a Docker-free development smoke environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e 'backend[dev,media,agents,tools]'
corepack enable
cd frontend && pnpm install && cd ..
./start-dev.sh --local
```

Local mode uses SQLite, filesystem blobs, and in-memory Qdrant while preserving the same domain contracts.

## Guarantees

- Raw bytes are content-addressed before parsing.
- PDF/DOC/DOCX/PPT/PPTX use MinerU only and fail explicitly without semantic fallback.
- Evidence and locators are immutable and citations use stable Evidence Revision IDs.
- Retrieval channel failures are visible; quality mode is never silently relabeled.
- Conversation titles, pins, archives, and revisions are authoritative server state; cursor pagination and search span every Run goal and power both History and the command palette.
- Global search spans destinations, Spaces, full conversation history, and all published Evidence content/source names. Evidence results open the exact locator, and the mobile header search icon now invokes this same command surface instead of masquerading as a new-research shortcut.
- Every Space exposes browsable Verified knowledge compiled only from T2/T3 Claims. Supported conclusions and partial/conflicted/stale items remain explicitly filterable, T0/T1 never enter the view, and every Claim links back to its originating Run and exact Evidence Revision locator.
- Per-material health distinguishes retained Raw, searchable Evidence, and advanced projection readiness. Connected sources can check upstream into a new immutable version, while snapshot reprocessing remains an explicit separate action with a direct link to its durable job timeline.
- Connected sources support durable hourly-to-weekly upstream schedules. Manual and scheduled checks share the same idempotent version contract, unchanged content creates no duplicate Source Version, and every changed/no-change execution remains visible with a direct job-timeline link.
- Recommended model setup groups real tasks by user intent, fills only missing routes with probe-verified capabilities, preserves every active custom route, and keeps unavailable audio or retrieval capabilities on an explicit fallback.
- Empty workspaces show a server-state-driven path from first Space to original material to first cited answer. The guide is skippable and recoverable, while a global Chinese/English concept drawer explains Space, Source, Evidence, Run, and Artifact in product language.
- Light, Dark, and System appearance modes restore the legacy personalization affordance with a low-glare evidence theme, live OS following, a compact sidebar toggle, and a persistent browser preference.
- Artifact Studio summarizes candidates, published outcomes, review needs, and block-level Evidence coverage. Evidence brief, Decision memo, and Review packet layouts derive only from an original traceable Artifact, preserve its Evidence IDs, and collect genuine human-review text during creation. Revision-safe publish/withdraw actions are authoritative on the server, stale or unsupported outcomes cannot publish, and published Artifacts expose a stable workspace link plus Markdown, JSON, HTML, and PDF exports.
- Quick Runs require at least T1 and Research at least T2; numeric, date, version, and action claims automatically require T3.
- Pinned BGE-M3, CLIP, and CLAP revisions provide native sparse/image/audio/video projections; a model failure is explicit and never becomes a zero vector.
- Source changes create an Artifact Refresh Proposal and diff. Only explicit acceptance creates a revision, and user-authored blocks are preserved.
- Feishu IM remains supported through an authenticated long connection, stable Space scope, Quick/Research Runs, rich static cards, and Raw-first file/media ingestion. See [FEISHU_BOT_SETUP](docs/FEISHU_BOT_SETUP.md).
- Backup restore is allowed only into an empty target, verifies every object hash, and marks search indexes for rebuild.

## Verify

```bash
./scripts/verify-nexus.sh

# With Docker Desktop and real provider credentials configured:
.venv/bin/python scripts/verify-compose-e2e.py --mineru --timeout 1800
```

See the Chinese [README](README.md) for configuration, operations, restore, and repository layout.
