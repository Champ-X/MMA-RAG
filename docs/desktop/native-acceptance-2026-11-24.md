# Native transfer and offline capability acceptance — 2026-11-24

These checks exercised the current desktop-branch backend with the assembled
runtime's Python and native executables on macOS 27.2.1, Apple Silicon. They did
not exercise an installed release's frozen backend, a clean Windows machine or
cloud generation. All documents, objects, vectors and Pi records were synthetic;
the existing user's knowledge bases and containers were not opened or changed.

## Runtime and inputs

- CPython 3.11.18, Qdrant 1.16.2, LibreOffice 26.8.0.3.
- Runtime directory: `ops/desktop-qa/runtime`; model cache:
  `ops/desktop-qa/model-state/models/huggingface`.
- MinIO image: `tessmora-minio:review`, image ID
  `sha256:33cff63d1cd5a6f06f5083757cf3c299b9bf1d24a1f4600fbd4a2d9e244e9ff2`.
- Docker context `colima-mma-rag` was selected per command. The QA container used
  a random name, a loopback-only random port, synthetic credentials and a new
  bind-mounted data directory. It was removed at the end; the default context
  and existing services were left unchanged.
- Inputs came from `packages/desktop/qa/fixtures.py`: two-page PDF with `CEDAR-17`
  on page 2, blue rectangle/tone at seconds 6–8 of a 12-second video, extracted
  PNG/WAV, and other independent synthetic fixtures.

To generate a new fixture directory with the assembled runtime:

```sh
ops/desktop-qa/runtime/python/bin/python3.11 packages/desktop/qa/fixtures.py \
  --runtime ops/desktop-qa/runtime --output ops/desktop-qa/new-fixtures
```

## Real migration, backup, restore and old references

```sh
ops/desktop-qa/runtime/python/bin/python3.11 packages/desktop/qa/native-transfer.py \
  --runtime ops/desktop-qa/runtime \
  --fixtures ops/desktop-qa/fixtures \
  --output ops/desktop-qa/m4-real-minio-20261124-verified \
  --docker-context colima-mma-rag \
  --minio-image tessmora-minio:review
```

Use a new output directory for every run. This script starts isolated source and
target services and calls the actual migration CLI subprocess. It then starts
the restored FastAPI service and makes real HTTP requests.

The recorded run passed in 20.453 seconds:

| Check | Observed result |
| --- | --- |
| MinIO objects | Six objects, 23,111,262 bytes, including a 22,020,096-byte multipart upload |
| Source integrity | MinIO inventory and Qdrant points, configurations, payload schemas and aliases unchanged after migration |
| Object identity | Original bytes match SHA-256; original ETags, including multipart `-5` suffix, preserved |
| Vector identity | Named dense/sparse channels, IDs, payload index and alias preserved |
| Backup and restore | 495 files; workspace UUID preserved; application credentials removed |
| Old image/audio/video links | Old MinIO URL accepted by reference refresh; new signed local URL returns correct bytes through Range and HEAD |
| Authorization | Unauthenticated knowledge request rejected with 401; unsigned object request rejected with 403 |
| PDF citation | Restored original stream contains `CEDAR-17` on page 2 |
| Pi source | Saved run/source content endpoint returns original PDF bytes; imported source version remains valid |
| Video reference | Point 42 retains seconds 6–8; sparse query returns the same point |
| Cleanup | QA MinIO container removed; Qdrant/API children stopped |

The backup's recorded SHA-256 is
`67920fdb8b6d45187122446e9a55ca691e292afd7a6ed43f31b148ad538a0f1c`.
The report and private data remain under the ignored QA output directory.
No browser history bundle was supplied in this run; that receipt explicitly
reports `client_history_included: false`. Client-history acceptance is separate.

The migration's temporary Qdrant service now uses a private working directory
inside staging. Its config/log and initialization files cannot collide with the
repository or a workspace's root configuration.

After this change, the transfer test file passed all 11 tests, including the
optional native Qdrant migration/restore/query test:

```sh
TESSMORA_TEST_QDRANT=/absolute/runtime/bin/qdrant PYTHONPATH=backend \
  python -m pytest -q backend/tests/test_desktop_transfer.py
```

## Offline models and Office conversion

```sh
ops/desktop-qa/runtime/python/bin/python3.11 packages/desktop/qa/native-capabilities.py \
  --runtime ops/desktop-qa/runtime \
  --fixtures ops/desktop-qa/fixtures \
  --cache ops/desktop-qa/model-state/models/huggingface \
  --output ops/desktop-qa/capabilities-real-20261124-verified
```

The script enables `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`, then invokes
the application's real image/audio encoding paths and matching text encoders.
Both models loaded once from the existing local cache. No cloud provider method
was called.

| Operation | Result | Single-run elapsed time |
| --- | --- | --- |
| CLIP image | 768 finite, normalized dimensions | 2.491 s |
| CLIP text | 768 finite, normalized dimensions | 0.589 s |
| CLAP audio | 512 finite, normalized dimensions | 1.097 s |
| CLAP text | 512 finite, normalized dimensions | 0.866 s |
| DOCX → PDF | One page; English marker and Chinese text preserved; Chinese glyphs visible | 2.840 s |
| PPTX → PDF | One page; English marker and Chinese text preserved; Chinese glyphs visible | 2.706 s |

The Python process peak RSS was 2,749,759,488 bytes (about 2.56 GiB), with both
models loaded. This excludes the LibreOffice child and the rest of the desktop
application. Timings and diagnostic cosine values are observations, not a
performance baseline or a retrieval-quality score.

This acceptance found and fixed a real preview defect: the bundled macOS
headless Office build omitted system fonts from its fontconfig search path.
Chinese text could be extracted from its PDF even while every glyph was blank.
Desktop conversions now use a private Office profile, private fontconfig cache,
bundled and system font directories, and macOS CJK fallbacks. This also prevents
joining the user's open Office session or sharing conversion profiles.

The QA checks the actual Chinese crop in the rasterized PDF, in addition to
text extraction. The final DOCX and PPTX had 2,033 and 5,306 dark pixels in those
crops at 3× scale (required >100); both rendered preview images were visually
inspected. The system fonts are referenced on the host and are not redistributed
as runtime assets. Other operating systems still need their own font and visual
acceptance.

## Limits of this evidence

This proves synthetic technical compatibility of the stated paths on this Mac.
It does not establish a migrated user's whole installation, clean-install model
downloads, Windows native restore, cross-OS physical Qdrant-index restore,
cloud answer quality, exact Office layout fidelity, application-wide memory
budgets or public-release signing/notarization. The offline encoders themselves
do not make cloud-backed chat, captions or speech transcription offline.

## PDF citation repair after cloud acceptance

The two-page synthetic manual exposed a separate provenance gap: existing
chunks carried `metadata.page/page_end`, but generation prompts and the chat
JSON serializer dropped those locators. The fix keeps observed `page_number`,
`page_end`, `file_id` and `kb_id` through retrieval, ordinary/compressed prompts,
streaming/non-streaming citations, `debug_info` and saved history.

Existing multi-page chunks remain page ranges. The prompt explicitly says that
a range alone cannot locate one statement to an exact page. Records without an
observed page stay unlocated; chunk order is never used as a substitute.

New PDF ingestion retains the semantic plan, intersects its chunks with actual
physical page spans, and rebuilds each fragment's embedding input from its own
text plus semantic headings/title. Markdown source text remains lossless.
Page text must align exactly and unambiguously to a richer document Markdown
representation to attach physical anchors; incompatible or unmapped content
remains unlocated. Existing indexes are not silently rewritten and require
re-ingestion to gain finer page-level evidence.

The citation contract tests passed 56 checks. The physical-page/source and
citation suite passed 53 checks, including a real generated PDF parsed by
PyMuPDF and a deterministic encoder verifying that the production vectorization
loop receives independent page-specific inputs. No cloud calls were made by
these tests. A bundled-Python smoke check also verifies the existing synthetic
`manual.pdf` via the real parser and both citation serializers:

```sh
ops/desktop-qa/runtime/python/bin/python3.11 packages/desktop/qa/pdf-citations.py \
  --fixtures ops/desktop-qa/fixtures --output ops/desktop-qa/new-pdf-citation-check
```

Pass `--backend ops/desktop-qa/runtime/backend` to test the frozen backend after
assembling it. The checker makes a deterministic cross-page planning decision,
then requires two lossless page fragments and the `CEDAR-17` evidence to carry
page 2 through the prompt and citation fields. It does not call a model to
generate an answer or infer a dense embedding.
