---
name: "Color Atlas / 彩色图志"
description: "A paper-and-media atlas explaining Tessmora's architecture, scoped to /architecture."
colors:
  ca-paper: "#f7f9f4"
  ca-ink: "#20262b"
  ca-muted: "#646d65"
  ca-purple: "#8998e8"
  ca-lilac: "#c9ceff"
  ca-green: "#d7ea8e"
  ca-orange: "#ef8d51"
  ca-line: "#dbe0d6"
typography:
  display:
    fontFamily: "'Tessmora Atlas Serif', 'Tessmora Serif', 'Songti SC', Georgia, serif"
    fontSize: "clamp(42px, 6.7cqi, 100px)"
    fontWeight: 900
    lineHeight: 1.23
    letterSpacing: "-.055em"
  headline:
    fontFamily: "'Tessmora Atlas Serif', 'Tessmora Serif', 'Songti SC', Georgia, serif"
    fontSize: "clamp(32px, 4.5cqi, 64px)"
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: "-.045em"
  body:
    fontFamily: "'Tessmora Atlas Sans', 'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  navigation:
    fontFamily: "'Tessmora Atlas Sans', 'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    lineHeight: 1.4
rounded:
  control: "3px"
  chapter: "4px"
spacing:
  page-inline: "clamp(22px, 3.2cqi, 54px)"
  page-max: "1560px"
  page-top: "25px"
  page-bottom: "24px"
  pagination-top: "42px"
components:
  primary-action:
    backgroundColor: "{colors.ca-ink}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 24px"
    minHeight: "45px"
  chapter-current:
    backgroundColor: "{colors.ca-purple}"
    textColor: "#18213d"
    rounded: "{rounded.chapter}"
    padding: "9px 16px"
  paper:
    backgroundColor: "#fffdf6"
  citation:
    backgroundColor: "transparent"
    textColor: "#3c4841"
    padding: "4px 5px"
---

# Design System: Color Atlas / 彩色图志

## Scope and direction

Color Atlas explains how material becomes searchable clues and inspectable evidence through paper stacks, folder tabs, photographs, waveforms and film strips. It is the current design for `/architecture`, based on the approved C · 彩色图志 direction. It does not restyle the conversation sidebar, knowledge workspace or global language and theme controls.

The eight chapters are Overview, Principles, Parsing, Storage, Retrieval, Research, Citations and Runtime. The route uses a light paper canvas in both application themes. This is an intentional page-specific treatment: surrounding application controls keep their own theme.

The current implementation lives in `frontend/src/pages/ArchitecturePage.tsx` and `frontend/src/components/architecture/color-atlas/`. See [the implementation and asset notes](docs/architecture-color-atlas.md) for scope and recorded verification.

## Colors and material

Chalk paper (`ca-paper`) and dark ink (`ca-ink`) carry the reading surface. Periwinkle (`ca-purple`) marks selected chapters and supporting objects; pale periwinkle (`ca-lilac`) and pistachio (`ca-green`) distinguish paper and folder layers. Mandarin (`ca-orange`) connects related objects and stages. Muted text (`ca-muted`) and fine rules (`ca-line`) provide hierarchy without competing with the source material.

The primary action uses dark ink with white text. Source sheets use `#fffdf6`, a subtle inline SVG paper texture and small attached shadows. Rotations and overlaps belong to the explanatory objects; copy and controls remain real DOM elements. Component CSS also contains role-specific neutral and accent colors; the frontmatter records the shared palette rather than claiming to enumerate every literal color.

## Typography

Tessmora Atlas Serif carries the large Song/Ming display titles and source-like text. Tessmora Atlas Sans carries the body, navigation and controls. Both are self-hosted Noto-derived subsets with `font-display: swap`, explicit fallback families and supplied SIL Open Font License notices.

The declared weight ranges are Serif 400–900 and Sans 400–750. Source revision, hashes, subset counts and license locations are recorded in `frontend/public/architecture/atlas/font-manifest.json`. Update the subset and manifest together when new copy needs additional characters; a declared font family alone does not guarantee glyph coverage.

The overview title uses 900-weight Serif at `clamp(42px, 6.7cqi, 100px)` with a 1.23 line height. General chapter titles use `clamp(32px, 4.5cqi, 64px)` at 1.25. English, wide systems chapters and narrow containers have their own overrides in the component styles; preserve those overrides when editing copy. The route's base body is 15px Sans at 1.65.

## Layout and navigation

The architecture route is a column layout with a masthead, a horizontal chapter index and an independently scrolling reading viewport. The chapter index remains horizontally scrollable in narrow containers; it does not switch to the old topic-select layout. The selected chapter uses `aria-current="page"` and is brought into view after navigation.

The reading page is capped at 1560px and uses a fluid `clamp(22px, 3.2cqi, 54px)` horizontal gutter. The overview pairs an editorial title with a collage and three linked journey panels. The cover and journey panels stack below a 760px architecture-container width. Individual parsing, systems and narrative compositions use their own container breakpoints to preserve reading order after the sidebar takes space.

Chapter navigation retains the route query and hash, resets the reading scroll and moves focus to the chapter heading. Previous/next controls stay in document flow; the final next control returns to Overview. Direct, Agent and Pi selections preserve the `path` query parameter. Legacy architecture links still resolve to the appropriate chapter or open Runtime appendix.

## Interaction and evidence

- Parsing uses five accessible modality tabs. Preserve keyboard operation and the separate document, table, image, audio and video explanations.
- Audio and video previews use local media and native controls. A preview is an illustration of material; it is not a backend ingestion run or proof of a scene boundary.
- Research mode choices explain Direct, Agent and Pi behavior without invoking a model. Keep the selected mode in the URL.
- Citation controls focus the source excerpt and return focus when closed. Preserve the difference between a candidate and a cited source.
- Visible focus, localized accessible names, Chinese and English copy, and reduced-motion rules are part of the interaction contract. Reduced motion disables the route's animations and transitions.
- Saved retrieval examples are recorded results, not a live status display or a performance benchmark. Standalone audio remains a file-level search unit; the listening preview does not establish timestamped audio indexing.

## Assets and retained components

Shipping Color Atlas assets live in `frontend/public/architecture/atlas/`. Keep `provenance.json`, `font-manifest.json`, saved retrieval examples and the referenced media together. Preserve source identities, transformations and file hashes. Font licenses are distributed in `frontend/public/architecture/fonts/`.

Runtime retains `ArchitectureBlueprint`, `ArchitectureDetails` and `ArchitectureRuntime` inside native disclosure sections. Existing architecture components, illustrations, font fallbacks and legacy CSS remain available for those detailed references or older component exports; they are not the visual specification for the active Color Atlas chapter shell. The active route and `color-atlas/` styles are authoritative for the current presentation. Earlier asset records remain in [visual asset provenance](docs/architecture-visual-assets.md) and [legacy typography notes](docs/architecture-typography-assets.md).

Local proposals, downloaded source fonts, intermediate generations and review captures belong under ignored `output/` or `.impeccable/review*/` paths. The superseded Evidence Exhibition design documents and proposal briefs are preserved locally in `output/release-design-archive-20261025/`; they do not define the current route.

## Maintenance boundaries

Keep the architecture scope, application shell, substantive mechanisms, source links, route state and accessible interactions intact. Source code and current manifests take precedence over an outdated design description. Do not turn conceptual diagrams, stored examples or preview controls into claims about live backend execution, measured retrieval quality or production acceptance.

This document describes the checked source implementation. It does not itself establish a new browser or backend acceptance result; consult the implementation notes and run the checks appropriate to a future change.
