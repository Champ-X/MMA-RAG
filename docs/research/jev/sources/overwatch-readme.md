# Overwatch

Overwatch is a local browser service for cloud resources and training workloads.
It starts with a complete SkyPilot inventory so missing telemetry can never hide
a running machine, then adds training context when W&B, CloudWatch, durable
storage, or Zymtrace data is available.

## Capabilities

- Cloud resources
  - Shows SkyPilot managed jobs, standalone clusters, and development nodes,
    including resources without W&B telemetry.
  - Prioritizes running jobs and active clusters and hides terminal resources
    after two days.
- Training telemetry
  - Enriches matching jobs with W&B project, run status, progress, throughput,
    cost, retry, and ETA data.
  - Streams ANSI-colored CloudWatch logs in a full-screen drawer.
  - Links directly to SkyPilot, W&B, Zymtrace, and cloud storage.
  - Provides a dedicated per-run page for status, timing, retries,
    infrastructure, cost, links, and logs.
- Cost and waste
  - Charts 30 days of AWS and GCP spend, stacked by cloud and by compute,
    storage, and other costs.
  - Flags idle GPUs, orphaned jobs, and zombie dev boxes.
  - Summarizes estimated spend by user, project, and cloud and reports retained
    recovery and preemption counts.
- Browser interface
  - Supports system, light, and dark color schemes.
  - Starts immediately, refreshes inventory periodically, and live-reloads
    Python and frontend changes while recovering from build or runtime errors.

SkyPilot is the authoritative inventory provider, and Flow/W&B is optional
training enrichment. The browser renders only local raw cache files; a standalone
collector owns provider access and refreshes those files before on-demand views.

## Install and run

Install the repository as an editable global uv tool:

```sh
uv run npm install
uv run npm run build
uv tool install --reinstall --editable /Users/erik/code/Overwatch \
  --overrides /Users/erik/code/Overwatch/overrides.txt
overwatch
```

Open <http://127.0.0.1:8765>. Chrome opens automatically unless `--no-open` is
passed. Auto-reload is enabled unless `--no-reload` is passed.

Useful options:

```sh
overwatch --help
overwatch --port 8877 --no-open
overwatch --no-log-enrichment
overwatch --gcp-billing-table my-project.billing.gcp_billing_export_v1_XXXXXX-XXXXXX-XXXXXX
```

## Raw metric cache

The standalone collector writes versioned, human-readable files beneath
`~/.cache/overwatch/raw-v1`:

```sh
uv run python -m overwatch.collector
uv run python -m overwatch.collector --job-id 183
uv run python -m overwatch.collector --job-id 183 --full-logs
cd ~/.cache/overwatch/raw-v1/jobs/183
```

Global provider snapshots live under `global/`. Each `jobs/<job_id>/` directory
contains raw SkyPilot and W&B snapshots plus append-only CloudWatch
`events.jsonl.zst`, its human-readable `events.index.json` block index, stream
metadata, and a cursor. Use `zstdcat events.jsonl.zst` to inspect the raw JSONL.
Finished jobs with a settled cursor are served from disk immediately. Bumping
`raw-v1` is the migration strategy when the cache shape changes.

## Billing history

AWS billing history uses the current AWS credentials and requires
`ce:GetCostAndUsage`. GCP billing history requires the Standard Cloud Billing
export in BigQuery. Set its fully qualified table in the environment or pass it
on the command line:

```sh
export GCP_BILLING_EXPORT_TABLE=my-project.billing.gcp_billing_export_v1_XXXXXX-XXXXXX-XXXXXX
overwatch
```

Both providers are optional: a missing permission or billing export produces a
warning without hiding the cloud resource inventory. GCP line series use the
billing export's project IDs. The stacked categories use AWS service names and
GCP service/SKU descriptions to classify compute and storage; all remaining
charges are grouped as everything else.
