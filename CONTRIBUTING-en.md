# Contributing to Tessmora

[简体中文](CONTRIBUTING.md) · **English**

Contributions to Tessmora's code, documentation, interface, and evaluation tools are welcome. Issues and pull requests may be written in Chinese or English. Start with the [project overview and quick start](README-en.md#quick-start), then prepare the environment and checks relevant to your change.

For vulnerabilities, exposed credentials, or problems involving private data, follow the [security reporting process](SECURITY-en.md#reporting). Do not disclose sensitive details in a public issue.

## Report a problem or propose an improvement

Search existing [Issues](https://github.com/Champ-X/MMA-RAG/issues) and [Pull Requests](https://github.com/Champ-X/MMA-RAG/pulls) first to find related work already in progress.

- **Bug reports:** Include the commit SHA, operating system, Python / Node versions, installation method, selected mode (standard retrieval or Pi), minimal reproduction, and expected versus actual behavior.
- **Model or retrieval problems:** Include the provider and model, materials and search scope, failing stage, and a minimal example you can share publicly. Preserve failures and fallback behavior, not just successful answers.
- **Interface problems:** Include redacted screenshots, interface language, theme, and viewport size. Explain any effect on keyboard navigation or media playback.
- **Feature proposals:** Describe the use case, current obstacle, and desired behavior. For larger architectural changes, an issue can help discuss tradeoffs before splitting the work into independently verifiable changes.

Do not paste API keys, connection credentials, private file URLs, complete user conversations, or unredacted logs.

## Start on a contribution branch

Fork the repository on GitHub, then replace `YOUR_GITHUB_USERNAME` below with your username:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/MMA-RAG.git
cd MMA-RAG
git remote add upstream https://github.com/Champ-X/MMA-RAG.git
git switch -c feat/your-change
```

If you already have a writable checkout, inspect `git status --short --branch`, preserve uncommitted work, and create a branch for this change. This guide does not require rewriting existing history. See [repository maintenance](docs/REPOSITORY.md) for retrieving history in a shallow clone.

## Local development environment

Documentation changes can be edited directly and checked for links, assets, and staged scope. To run the application, use the source workflow below on macOS / Linux; Windows users can use WSL2.

| Dependency | Purpose |
| --- | --- |
| Python 3.11 or 3.12 | Backend and Python tests; the example below uses 3.12 |
| Node.js ≥22.19 and npm | Frontend, Pi workers, and installation CLI |
| Docker / Compose | Local MinIO, Qdrant, and Redis; the complete installer requires Compose 2.20+ |
| FFmpeg / ffprobe and LibreOffice | Audio/video processing and Office conversion; install `fonts-noto-cjk` for Chinese documents on Linux |

Prepare dependencies from the repository root. Preserve an existing `backend/.env`:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix agent-runtime ci
npm --prefix packages/cli ci
cp -n backend/.env.example backend/.env
```

Edit `backend/.env` with the required credentials and clear placeholders for unused services. Default text routes use DeepSeek and SiliconFlow; default image, audio, and video capabilities also use Alibaba Cloud Bailian. See the [README](README-en.md#develop-from-source) for configuration. Keep real credentials out of test fixtures and frontend variables.

```bash
./start-dev.sh doctor
./start-dev.sh
```

The script runs the frontend and backend locally and starts or reuses only MinIO / Qdrant / Redis from the root Compose file. The Web UI defaults to `http://localhost:3001`; backend OpenAPI is at `http://localhost:8000/docs`. The complete container installation is a separate path using `deploy/compose.yaml`. See [local startup](docs/LOCAL_STARTUP.md) for restarts, ports, and data recovery.

The example configuration enables local model preloading, so first startup may download models and use substantial memory. Real model calls may transmit content and incur charges. Use dedicated development data and credentials. For Pi recovery or storage changes, use a separate `PI_AGENT_DATA_DIR` and never share one run directory between multiple hosts; see [Pi Durable](docs/pi-agent-durable.md).

## Source layout

| Directory | Responsibility |
| --- | --- |
| `frontend/src/`, `frontend/public/`, `frontend/tests/` | Web UI, distributed assets, and frontend regressions |
| `backend/app/` | APIs, ingestion, collection, retrieval, generation, model and storage adapters |
| `backend/app/modules/pi_agent/`, `agent-runtime/` | Pi Python host, source tools, run ledger, Node / Durable loop, and protocol regressions |
| `backend/tests/`, `backend/test_*.py` | Backend regressions, fixtures, and legacy test entry points |
| `packages/cli/` | `tessmora` installation, configuration, diagnostics, and instance management |
| `deploy/` | Complete container distribution, Nginx, image builds, and isolated installation smoke tests |
| `skills/mma-rag/` | The `mma-rag` knowledge-base CLI and Codex Skill |
| `backend/evaluation/`, `evals/` | Evaluation tools and explicitly retained minimal datasets |
| `scripts/`, `backend/scripts/`, `docs/` | Operations and verification tools, current usage and architecture documentation |

## Verification

Run checks relevant to your change from the repository root. Behavior fixes should cover the actual failing path; UI and model behavior also need appropriate manual or live acceptance checks. A wording change does not call for every application test.

| Changed area | Suggested checks |
| --- | --- |
| Documentation, assets, or distributed files | `git diff --check`; after staging explicit paths, run `python3 scripts/check_repository.py` |
| Frontend | `npm --prefix frontend test`, `npm --prefix frontend run test:dom`, and `npm --prefix frontend run build` |
| Pi Node runtime, tool protocol, or Durable | `npm --prefix agent-runtime test`, plus relevant Python host regressions |
| Python backend | Run pytest for affected modules with the project virtual environment; see below |
| Installation CLI | `npm --prefix packages/cli test`; run `npm pack --dry-run` from `packages/cli/` |
| Local startup controller | `python3 scripts/test_dev.py`; it uses substitutes without starting real Docker or model services |
| Nginx / deployment routing | `python3 scripts/test_deploy_nginx.py`; requires Docker and creates and removes an isolated Nginx container |
| Retrieval, indexing, or evaluation | `./scripts/rag-eval validate` checks the synthetic baseline; then verify affected behavior using the [evaluation guide](docs/RAG_EVALUATION.md) |

`npm pack --dry-run` runs `prepack`, synchronizing distribution assets into `packages/cli/assets/`. Review whether those changes belong in your contribution. Frontend DOM regressions use React / jsdom and do not replace browser checks: verify affected flows, narrow layouts, light/dark themes, keyboard focus, and media states for interaction changes.

Choose test files that match your change. For example, the Durable host regressions:

```bash
SILICONFLOW_API_KEY=test-only PYTHONPATH=backend .venv/bin/python -m pytest \
  backend/tests/test_pi_durable_recovery.py -q
```

When a complete backend run is needed:

```bash
SILICONFLOW_API_KEY=test-only PYTHONPATH=backend .venv/bin/python -m pytest \
  backend/tests backend/test_*.py -q
```

Some modules initialize storage clients during import, so complete collection requires reachable local MinIO / Qdrant services. `test-only` is a nonsecret placeholder, not a network isolation switch. Tests usually replace model calls, but manual scripts and live evaluations may access real services. When prerequisites are unavailable, run independent modules and state what remains untested. A stalled, interrupted, or empty test collection is not a passing result.

### What CI actually covers

- [Repository checks](.github/workflows/checks.yml) runs on pushes to `main` and pull requests: repository rules, startup controller, Nginx routing, diff formatting, frontend tests / DOM / build, Pi Node tests, installer tests, and npm packaging validation. It uses Python 3.12 and Node 22.19.0.
- [Distribution images](.github/workflows/distribution.yml) runs for pull requests affecting selected paths or by manual dispatch. It builds images and exercises isolated installation and restart smoke tests without real model credentials on Ubuntu x64 / ARM.
- Complete backend pytest, real model / corpus evaluations, and browser acceptance are outside these automated checks. Synthetic baseline `validate` checks structure and fingerprints, not online retrieval quality. See [Pi evaluation limits](docs/pi-agent-durable.md#对比评测与已知问题) for additional boundaries.

## Commit scope

Ship code with necessary tests, small fixtures, and current documentation. Update the corresponding lockfile when changing dependencies. Keep technical guides and both READMEs aligned with behavior; do not present experimental candidates as delivered features.

| Content | Location and commit policy |
| --- | --- |
| Temporary scripts, raw screenshots, logs, and per-run model receipts | Use ignored `ops/`; keep them outside the distributed product source |
| Downloaded corpora, user knowledge, model caches, Pi databases, and attachments | Use ignored `data/` or a configured private data directory; do not commit them |
| Evaluation run outputs and reports | Use `evals/runs/` / `evals/reports/`; new maintained inputs need a clear purpose, license, hash, test consumer, and an explicit checker allowlist update |
| Credentials and mutable configuration | Do not commit `.env`, real credentials, `backend/data/llm_task_overrides.json`, or `backend/data/jev_settings.json`; `.env.example` must contain only nonsecret examples |
| Images, videos, diagrams, or document samples needed for distribution | Use explicit distribution directories, check provenance, licensing, and redaction, retain necessary manifests, and avoid duplicate large files |
| Dependencies, builds, and caches | Do not commit `node_modules/`, `frontend/dist/`, virtual environments, or model weights |

The repository checker uses the **file list in the Git index** to check working-tree files and documentation links. Stage new files explicitly before running it, or they will appear to be missing distribution targets. This does not mean staging the entire workspace. The default per-file limit is 5 MiB; only the two README introduction videos currently have 24 MiB exceptions. Prefer separate release assets for new large files, and adjust specific file rules explicitly when necessary.

Replace the example paths with the files you actually changed and review the staged content:

```bash
git status --short
git diff --check
git add -- path/to/changed-file path/to/new-file
git diff --cached --name-status
git diff --cached --check
python3 scripts/check_repository.py
git diff --cached
```

`.gitignore` does not remove files already tracked. Do not delete unrelated work, overwrite frozen evaluation inputs, or rewrite shared history as part of cleanup. See [repository maintenance](docs/REPOSITORY.md) for history and large-file handling.

## Submit a pull request

Open a focused PR from your branch against upstream `main`. Use the title and description to explain the concrete problem and final behavior. A change that needs more work can start as a draft PR.

- **What changed and why:** Describe the trigger and resulting behavior, and link relevant issues. Present the final design rather than a transcript of the discussion.
- **How it was verified:** List commands actually run, their results, and the environment. Distinguish passed, failed, skipped, and unrun checks; record warnings that affect the conclusion.
- **Evidence and limits:** Include redacted screenshots for UI changes. For retrieval / model changes, provide inputs, source versions, mode, coverage, and failures. Report quality and cost boundaries alongside performance comparisons.
- **Compatibility and risk:** Explain configuration, API, or data-format changes. For persistence changes, describe migration, backup, and rollback conditions. A successful build is not complete acceptance.

An example report: “Frontend unit tests, DOM tests, and build passed. Checked light/dark themes and citation previews at 390px / 1280px. Complete backend and real-model evaluations were not run; this change only adjusts frontend layout.” Replace this with your actual results; do not copy claims for checks you did not perform.

The repository does not currently provide an open-source license. This contribution workflow does not change existing permissions.
