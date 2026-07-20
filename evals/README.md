# Nexus evaluation assets

`corpus/smoke` is the committed deterministic text seed for the required Space → Source → Evidence →
Run → Artifact path. `scripts/verify-compose-e2e.py` creates deterministic table, image, audio, and
video fixtures at runtime. `gates/nexus-v2.0.0.yaml` freezes both the repository and real standard
Compose release contracts; `reports/nexus-v2.0.0-smoke.json` records the observed result.

The Docker-free test profile deliberately uses deterministic encoders and labels unavailable channels.
The standard Compose gate requires pinned BGE-M3, CLIP, and CLAP assets, non-zero native visual/acoustic/
frame roles, zero projection failures/degradations, and Rank@1 for all five modalities. A proxy channel
cannot satisfy the native release gate.

Run all offline gates with:

```bash
./scripts/verify-nexus.sh

# With Docker Desktop and real provider credentials:
.venv/bin/python scripts/verify-compose-e2e.py --mineru --timeout 1800
```
