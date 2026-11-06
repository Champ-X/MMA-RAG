# Architecture: Color Atlas

The `/architecture` route uses a **Color Atlas · 彩色图志** reading layout. This document describes its maintained component and asset boundaries.

## Visual system

- Chalk white `#F7F9F4`, ink `#20262B`, periwinkle `#8998E8`, pale periwinkle `#C9CEFF`, pistachio `#D7EA8E`, mandarin `#EF8D51`.
- Self-hosted Noto-derived Song/Ming display typography, with an actual 400–900 weight range; sans serif controls and body text. Font source, subset coverage, hashes and license locations are recorded in `frontend/public/architecture/atlas/font-manifest.json`.
- A horizontal chapter index above an independently scrolling reading surface. The app's existing conversation sidebar is not part of this component.
- Paper stacks, folder tabs, original photographs, audio waveforms and film contact strips explain different stages. Orange connectors represent a relationship or flow. Text and interactions are real DOM elements, not flattened screenshots.
- Eight chapters, including five parsing states. Local previews are intentionally distinct from backend execution. Native media controls, Radix tab navigation, citation focus management, URL history, legacy deep links and reduced-motion preferences remain available.
- Paper and photograph depth use separate shadow tokens. Controls share restrained hover, pressed and focus treatments. Inline citation numbers stay with their sentence ending, and narrow layouts wrap source names so the entries remain distinguishable.
- Overview image, audio and video specimens link directly to the corresponding parsing view. The `material` query parameter preserves the selected modality alongside the existing `path` parameter.

The route uses the approved light paper canvas even when the surrounding application uses a dark theme. This is a page-specific art direction; it does not change the global theme.

## Assets and recorded examples

Shipping assets live in `frontend/public/architecture/atlas/`; `provenance.json` records the original source filenames, transformations and hashes. These are recorded presentation examples, not newly generated factual evidence. Provenance does not establish a general redistribution license for unrelated uses.

- The concrete-library, botanical and architectural-plan illustrations come from the visual-style material space.
- The garden document is an unmodified copy of `中国古典园林的意境与哲学.md`.
- The musical excerpt is a 16-second listening preview of `半山听雨.mp3` starting at 30 seconds. This does not imply timestamped audio indexing; standalone audio search remains file-level.
- The forest preview uses the first 10 seconds of `forest.mp4`, with frames extracted at 1, 4 and 8 seconds. These are preview assets, not claimed backend scene boundaries or garden-query evidence.
- `retrieval-examples.json` contains results captured from the local Tessmora service on 2026-10-25: an architectural-light query against the visual-style space and a framing/borrowed-scenery query against the landscape space. Scores are returned candidate scores, not fabricated per-channel measurements or a performance benchmark. The garden document has chunk indices but no page numbers.

## File organization

`ArchitecturePage.tsx` owns navigation and URL state. `color-atlas/` contains the overview, parsing views, storage/retrieval/runtime views, narrative views and shared paper/waveform primitives. Existing detailed system-map, module and runtime references are retained as disclosures on the runtime chapter.

Local design drafts, original generations, downloaded font sources and review screenshots remain in ignored `output/` and `.impeccable/review*/` directories. Production assets are explicitly outside those ignored directories. Raw material-space files are not part of these published presentation assets.

## Verification

Run `npm --prefix frontend run type-check`, `npm --prefix frontend test`, `npm --prefix frontend run test:dom`, and `npm --prefix frontend run build` after changing this page. Verify asset bytes against `provenance.json` and font bytes/coverage against `font-manifest.json` when replacing resources.

Browser acceptance covers all eight chapters and five parsing states, desktop and narrow layouts, Chinese/English copy, keyboard navigation, audio/video playback, citation navigation, modality deep links and reduced motion. Local screenshots and test receipts belong in ignored directories; a build or historical test count is not current visual acceptance.
