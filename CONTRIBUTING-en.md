# Contributing to Tessmora

[简体中文](CONTRIBUTING.md) · **English**

Issues and pull requests are welcome in English or Chinese. For a bug report, include your OS, installation method, commit SHA, and steps to reproduce it. For retrieval issues, include the mode, model, search scope, and a small shareable example. Use the [security reporting channel](SECURITY-en.md#reporting) for credentials or private data.

## Set up a checkout

Create a branch from your fork. Replace `YOUR_GITHUB_USERNAME` with your GitHub username.

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/MMA-RAG.git
cd MMA-RAG
git remote add upstream https://github.com/Champ-X/MMA-RAG.git
git switch -c docs/my-change
```

For a documentation change, Git and Python 3 are enough. To run the app, use Python 3.11 or 3.12, Node.js 22.19+, Docker, and Compose. Follow [Develop from source](README-en.md#develop-from-source) to install the backend, frontend, and Pi dependencies. For installer work, also run `npm --prefix packages/cli ci`. Media processing uses FFmpeg/ffprobe and Office conversion uses LibreOffice.

The development launcher runs FastAPI and Vite on the host and starts or reuses storage in Docker. After configuring `backend/.env`, run `./start-dev.sh doctor` to inspect the environment, then `./start-dev.sh` to start it. Use a separate `PI_AGENT_DATA_DIR` for Pi recovery tests. Each directory has one host writer. [Local startup](docs/LOCAL_STARTUP.md) · [Pi recovery](docs/pi-agent-durable.md)

## Choose the checks for your change

Run these commands from the repository root. Use dedicated MinIO, Qdrant, and Redis services for the full backend suite. Point `PORTRAIT_TRIGGER_TEST_REDIS_URL` at a disposable Redis database for the portrait-trigger tests, which write trigger state. `test-only` is a placeholder key for model tests. Use a separate instance for live providers and private corpora.

| Change | Checks |
| --- | --- |
| Docs and assets | `python3 scripts/check_repository.py --worktree` · `git diff --check` |
| Frontend | `npm --prefix frontend test` · `npm --prefix frontend run test:dom` · `npm --prefix frontend run build` |
| Pi Node runtime | `npm --prefix agent-runtime test` |
| Installer CLI | `npm --prefix packages/cli test` · `(cd packages/cli && npm pack --dry-run)` |
| Launcher and Nginx | `python3 scripts/test_dev.py` · `python3 scripts/test_deploy_nginx.py` |
| Evaluation inputs | `./scripts/rag-eval validate` |

To run the full backend suite, use the command below. For a focused change, replace the last line with the affected test file.

```bash
SILICONFLOW_API_KEY=test-only PYTHONPATH=backend .venv/bin/python -m pytest \
  backend/tests backend/test_*.py -q
```

The repository checker’s `--worktree` mode includes unignored additions and excludes working-tree deletions. Its default mode reads the indexed file list and checks the files on disk. `npm pack --dry-run` runs `prepack`, which syncs `packages/cli/assets/`. The Nginx tests need Docker. For UI changes, check the affected languages, interactions, and viewport sizes in a browser.

Pushes to `main` and pull requests run repository, launcher, Nginx, frontend, Pi, and installer checks. Pull requests touching distribution paths, or a manual dispatch, also build Linux AMD64 and ARM64 images and check an empty installation, worker tasks, and restart. The full backend suite and live model evaluations run separately. [Repository workflow](.github/workflows/checks.yml) · [Distribution workflow](.github/workflows/distribution.yml)

## Submit a change

1. Update the owning guide when behavior or options change. For a bilingual page, match commands, defaults, and limits in both languages and follow the links from each version.
2. Commit the change with its regression coverage and required fixtures. Keep runtime data, credentials, logs, and model caches out of Git. Existing published diagrams are tracked and new drafts are ignored. The default file size limit is 5 MiB, with a 24 MiB exception for each of the two introduction videos.
3. Open the pull request against upstream `main`. Describe the observable change, the commands you ran, and the results. Include enough material to reproduce the issue. For retrieval changes, identify the inputs, mode, and quality metrics used in the comparison.

Some evaluation inputs are hash-bound to historical admission records. Write new experiment output to ignored directories. The repository has no project-wide open-source license. [Evaluation inputs](evals/README.md) · [Repository maintenance](docs/REPOSITORY.md)
