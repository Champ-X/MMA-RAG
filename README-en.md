<p align="center">
  <img src="frontend/public/tessmora-logo.png" alt="Tessmora" height="120" />
</p>

<p align="center"><strong>English | <a href="README.md">简体中文</a></strong></p>

# Tessmora — An Omni-Modal Agentic Retrieval Platform

<h3 align="center"><em>Every fragment finds its place.</em></h3>

<p align="center">
  <img src="docs/images/tessmora-omni-banner.png" alt="Tessmora brings documents, images, audio, and video into one agentic retrieval path" width="100%" />
</p>

Tessmora is a self-hostable omni-modal agentic retrieval platform. Documents, images, audio, and video retain modality-appropriate parsing units and specialized vectors, then converge through knowledge-base portrait routing, hybrid retrieval, two-stage ranking, and a bounded agent into one traceable answer pipeline.

It addresses three core questions:

- **How content enters the system**: lossless Agentic Chunking for documents; VLM + CLIP for images; ASR + CLAP for audio; Scene → Shot → Key Frame for video.
- **How a question finds evidence**: One-Pass intent, KB portrait routing, Dense / Sparse / Visual / Audio / Video retrieval, weighted RRF, and Cross-Encoder reranking.
- **How complex questions gather more evidence**: Auto, Direct, and Agent modes; the agent only calls the existing read-only retriever and is bounded by round, query, and evidence budgets.

## Why Tessmora

| Capability | Current implementation |
|---|---|
| **Omni-modal data plane** | Documents, images, audio, and video keep native semantic units instead of being flattened into plain text |
| **Intelligent search scope** | When no KB is pinned, topic portraits and multi-view queries choose one, several, or all KBs |
| **Cross-channel fusion** | Dense + BGE-M3 Sparse + Visual at the core, plus specialized audio/video vectors and intent-aware weights |
| **Agentic Evidence Loop** | A planner generates complementary queries; retrieval fans out; evidence is deduplicated and repeat hits add bounded confidence |
| **Budgeted conversation context** | Complete turns are selected under message and character budgets and reused across retrieval and generation |
| **Verifiable output** | SSE streams stage summaries, citations, and answer text; references retain sources, media URLs, time ranges, and `context_window` |
| **Multiple entry points** | Full Web UI, optional Feishu IM and Docx/Wiki import, plus a bundled Codex Skill/CLI |

## Architecture at a glance

![Tessmora system architecture covering access and routing, shared retrieval, the agent evidence loop, the offline data plane, and model routing](docs/images/tessmora-system-architecture.png)

Direct and Agent reuse the same Retrieval Core. Qdrant provides online retrieval vectors, while MinIO supplies original media to the citation context. After startup, open [http://localhost:3000/architecture](http://localhost:3000/architecture) for the interactive guide. See [MMA_ARCHITECTURE](docs/MMA_ARCHITECTURE.md) for code-level details.

## Core modules

| Module | Responsibility | Main entry |
|---|---|---|
| **Ingestion** | Multi-source parsing, agentic chunking, omni-modal vectorization, MinIO/Qdrant writes | `backend/app/modules/ingestion/` |
| **Knowledge** | KB lifecycle, omni-modal portraits, cross-KB routing | `backend/app/modules/knowledge/` |
| **Retrieval** | One-Pass intent, five retrieval routes, RRF, Cross-Encoder | `backend/app/modules/retrieval/` |
| **Agent Runtime** | Three-state mode selection, planning, read-only tools, evidence convergence | `backend/app/modules/agent/` |
| **Generation** | Multimodal context, ReferenceMap, streaming generation | `backend/app/modules/generation/` |
| **LLM Manager** | Unified `task_type` → model/provider routing | `backend/app/core/llm/` |

### Document and spreadsheet chunking

- PDF, DOCX, PPTX, TXT, Markdown, and other regular documents use the production Agentic Chunker.
- Source text is frozen into immutable headings, paragraphs, lists, tables, and code units. The LLM only plans contiguous unit ranges; it never emits or rewrites source text.
- The server validates lossless coverage, non-overlap, and a 600 estimated-token hard ceiling. Invalid or unavailable planning falls back to deterministic structural chunking.
- Excel/CSV keeps its dedicated sheet summary, header-preserving row blocks, and column profile strategy.

### Multimodal indexes

| Modality | Primary semantic unit | Qdrant |
|---|---|---|
| Document | Agentic Chunk | `text_chunks_agentic`: Dense + BGE-M3 Sparse |
| Image | One image | `image_vectors`: `text_vec` + `clip_vec` |
| Audio | One file/segment | `audio_vectors`: `text_vec` + `clap_vec` + optional Sparse |
| Video | Semantic Shot | `video_shot_vectors`: caption/ASR Dense+Sparse; `video_keyframe_vectors`: `frame_vec` + `clip_vec` |
| KB portrait | Cluster topic summary | `kb_portraits` |

See the [multimodal technical specification](docs/MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC.md) for Scene–Shot–ASR fields, long-video windows, and keyframe selection.

## Chat and retrieval examples

<details>
<summary>Expand Web and Feishu examples</summary>

### Document retrieval

Query: `Summarize the design of each stage in DeepSeek OCR2 training.`

![Document retrieval example](docs/images/chat-document.png)

### Image retrieval

Query: `Find one landscape image for each mood: rugged, delicate, and relaxed.`

![Image retrieval example](docs/images/chat-image.png)

### Audio retrieval

Query: `Find music that uses the same instrument as this audio.`

![Audio retrieval example](docs/images/chat-audio.png)

### Video retrieval

Query: `What is Tang Shiye's personality in Let the Bullets Fly?`

![Video retrieval example](docs/images/chat-video.png)

### Cross-modal retrieval

Query: `Choose a suitable poster and theme song for Peaky Blinders.`

![Cross-modal retrieval example](docs/images/chat-mix.png)

### Feishu IM (optional)

![Feishu IM example](docs/images/chat-feishu.png)

</details>

## Quick start

### Requirements

| Dependency | Purpose |
|---|---|
| Docker and Docker Compose | MinIO, Qdrant, Redis |
| Node.js ≥ 18 | Frontend; Node 20 LTS recommended |
| Python ≥ 3.11 | Docker image uses 3.11; Python 3.12 recommended locally |
| FFmpeg / ffprobe | Audio/video probing, segmentation, and frames |
| LibreOffice | DOCX/PPTX → PDF and in-app preview |

### 1. Clone and configure

```bash
git clone https://github.com/Champ-X/MMA-RAG.git
cd MMA-RAG
cp backend/.env.example backend/.env
```

The default model registry requires at least:

| Variable | Requirement |
|---|---|
| `SILICONFLOW_API_KEY` | **Required** for default LLM, embedding, and reranking tasks |
| `OPENROUTER_API_KEY` | Optional; required for OpenRouter models |
| `ALIYUN_BAILIAN_API_KEY` | Optional; required for Bailian models and configurations that use Omni video parsing |
| `DEEPSEEK_API_KEY` | Optional; required when a task routes to DeepSeek |
| `MINERU_TOKEN` | Optional; enables MinerU cloud parsing before local/other fallbacks |
| `PADDLEOCR_API_URL` / `PADDLEOCR_TOKEN` | Optional; enables the PaddleOCR parsing branch |
| `FEISHU_*` | Optional; Feishu IM or document import. See [FEISHU_BOT_SETUP](docs/FEISHU_BOT_SETUP.md) |

Use [`backend/.env.example`](backend/.env.example) as the complete source of variable names and defaults. Never commit live secrets; see [SECURITY](SECURITY.md).

### 2. Install backend dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r backend/requirements.txt
```

### 3. Start the development stack

```bash
source .venv/bin/activate
./start-dev.sh
```

`start-dev.sh`:

1. checks `backend/.env`;
2. checks or attempts to install FFmpeg and LibreOffice;
3. starts MinIO, Qdrant, and Redis with Docker Compose;
4. starts FastAPI and Vite locally.

Compose also defines optional `celery_worker` / `celery_flower` services; the development script does not start them by default.

### 4. URLs

| Service | URL |
|---|---|
| Web UI | [http://localhost:3000](http://localhost:3000) |
| Architecture | [http://localhost:3000/architecture](http://localhost:3000/architecture) |
| Backend API | [http://localhost:8000](http://localhost:8000) |
| OpenAPI | [http://localhost:8000/docs](http://localhost:8000/docs) |
| MinIO Console | [http://localhost:9001](http://localhost:9001) |
| Qdrant Dashboard | [http://localhost:6333/dashboard](http://localhost:6333/dashboard) |

## API and Codex Skill

The backend exposes a stable read-only evidence endpoint:

```text
POST /api/v1/retrieval/search
```

It returns a compact `doc | image | audio | video` evidence contract rather than internal Qdrant payloads. Chat and Agent modes continue to use `/api/chat/message` or `/api/chat/stream`.

The repository includes a Tessmora Codex Skill whose CLI command remains `mma-rag`:

```bash
./scripts/install-codex-skill.sh
skills/mma-rag/scripts/mma-rag health
skills/mma-rag/scripts/mma-rag kb list
skills/mma-rag/scripts/mma-rag search --query "How do I roll back a failed deployment?" --kb-id KB_ID
skills/mma-rag/scripts/mma-rag ask --query "Summarize the deployment flow" --kb-id KB_ID --agent-mode auto
```

The installer creates a symlink at `${CODEX_HOME:-$HOME/.codex}/skills/mma-rag` and never overwrites an existing directory. See the [CLI reference](skills/mma-rag/references/cli-reference.md) for every command, safe upload roots, and exit codes.

## Current boundaries

- The application API has **no built-in user authentication**, and development CORS allows every origin. Keep it on a trusted network; add authentication, TLS, origin restrictions, rate limits, and upload controls at a reverse proxy or API gateway before public deployment.
- Chat sessions and some statistics remain in process memory and are not ready for stateless multi-replica deployment.
- The Agent currently has one read-only `multimodal_knowledge_search` tool. There are no write tools, approval flow, MCP runtime, long-term memory, or sandbox.
- Feishu chat currently uses Direct retrieval. Three-state Agent mode is available through the Web Chat API and `mma-rag ask`.
- Retrieval weights and some thresholds are still code-level constants rather than fully centralized configuration.

See the [architecture document](docs/MMA_ARCHITECTURE.md) and [roadmap](docs/mira-plan.md) for the full implementation/status view.

## Documentation

| Document | Scope |
|---|---|
| [MMA_ARCHITECTURE](docs/MMA_ARCHITECTURE.md) | Current implementation: module boundaries, ingestion/query flows, data plane, Agent, and APIs |
| [MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC](docs/MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC.md) | Image, audio, and video fields, vectors, and retrieval |
| [AGENTIC_UPGRADE_WEKNORA_RESEARCH](docs/AGENTIC_UPGRADE_WEKNORA_RESEARCH.md) | Agent research baseline, shipped capabilities, and risk principles |
| [mira-plan](docs/mira-plan.md) | Roadmap maintained as shipped / partial / planned |
| [FEISHU_BOT_SETUP](docs/FEISHU_BOT_SETUP.md) | Feishu IM and Docx/Wiki permissions, variables, and verification |
| [CLI reference](skills/mma-rag/references/cli-reference.md) | Local Skill/CLI commands and safety boundaries |
| [SECURITY](SECURITY.md) | Current security posture and production checklist |
| [CHANGELOG](CHANGELOG.md) | Recent feature and documentation changes |

---

**Try it**: `./start-dev.sh` → open [http://localhost:3000](http://localhost:3000) → create a KB and upload content → choose Auto, Direct, or Agent → inspect the citations.
