FROM postgres:16.4-bookworm AS postgres-tools

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/src

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       curl espeak-ng ffmpeg git libmagic1 postgresql-client tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY docker-cpu.constraints.txt ./
RUN pip install --upgrade pip \
    && python -c "import tomllib; p=tomllib.load(open('pyproject.toml','rb')); e=p['project']['optional-dependencies']; print('\\n'.join(p['project']['dependencies'] + sum((e[k] for k in ('media','agents','tools','models')), [])))" \
       | xargs -d '\n' pip install \
       --extra-index-url https://download.pytorch.org/whl/cpu \
       --constraint docker-cpu.constraints.txt

# Keep backup/restore clients on the exact server major/minor image instead of
# Debian Bookworm's default PostgreSQL 15 client.
COPY --from=postgres-tools /usr/lib/postgresql/16/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=postgres-tools /usr/lib/postgresql/16/bin/pg_restore /usr/local/bin/pg_restore

COPY src ./src
COPY migrations ./migrations
COPY alembic.ini ./
RUN pip install --no-deps .

RUN groupadd --system nexus \
    && useradd --system --gid nexus --home-dir /home/nexus --create-home nexus \
    && mkdir -p /data/nexus \
    && chown -R nexus:nexus /data/nexus /app

USER nexus
EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["nexus", "serve"]
