# Architecture: Color Atlas

The architecture route implements the approved **C · 彩色图志** designs from 2026-10-25. The application sidebar, conversation state, knowledge workspace and theme/language controls are unchanged.

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

The user authorized reuse of the current material spaces. Shipping assets live in `frontend/public/architecture/atlas/`; `provenance.json` records the original source filenames, transformations and hashes. These are existing user materials, not newly generated factual evidence.

- The concrete-library, botanical and architectural-plan illustrations come from the visual-style material space.
- The garden document is an unmodified copy of `中国古典园林的意境与哲学.md`.
- The musical excerpt is a 16-second listening preview of `半山听雨.mp3` starting at 30 seconds. This does not imply timestamped audio indexing; standalone audio search remains file-level.
- The forest preview uses the first 10 seconds of `forest.mp4`, with frames extracted at 1, 4 and 8 seconds. These are preview assets, not claimed backend scene boundaries or garden-query evidence.
- `retrieval-examples.json` contains results captured from the local Tessmora service on 2026-10-25: an architectural-light query against the visual-style space and a framing/borrowed-scenery query against the landscape space. Scores are returned candidate scores, not fabricated per-channel measurements or a performance benchmark. The garden document has chunk indices but no page numbers.

## File organization

`ArchitecturePage.tsx` owns navigation and URL state. `color-atlas/` contains the overview, parsing views, storage/retrieval/runtime views, narrative views and shared paper/waveform primitives. Existing detailed system-map, module and runtime references are retained as disclosures on the runtime chapter.

Local design drafts, original generations, downloaded font sources and review screenshots remain in ignored `output/` and `.impeccable/review*/` directories. Production assets are explicitly outside those ignored directories. No original material-space files are deleted or overwritten.

## Verification

Verified on 2026-10-25: TypeScript checking, the production build and all 109 frontend DOM tests passed, including eight focused architecture regressions. Browser checks covered all eight chapters and five parsing states at a 390px viewport without content overflow, desktop comparison with the approved designs, working audio/video playback, and citation navigation. The polish pass also checked modality deep links, title wrapping, source selection and narrow-screen source labels. Shipping assets and the final 798-codepoint font subsets passed their manifest hash and coverage checks. Vite still reports the application's existing large-chunk advisory.
