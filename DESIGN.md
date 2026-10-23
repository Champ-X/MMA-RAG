---
name: "Tessmora Architecture Reading Surface"
description: "Focused, illustrated explanation of Tessmora design and implementation; scoped to /architecture."
colors:
  book-paper: "#fffefd"
  book-ink: "#292437"
  book-muted: "#655f72"
  book-line: "#e6e0ed"
  book-accent: "#6948a5"
  book-tint: "#f0eafa"
  book-teal: "#356f64"
  book-canvas: "#f7f4fa"
  book-dark-paper: "#211e29"
  book-dark-ink: "#f1edf8"
  book-dark-muted: "#beb6cd"
  book-dark-line: "#443a53"
  book-dark-accent: "#cbb0f5"
  book-dark-tint: "#33283f"
  book-dark-teal: "#a3d0c0"
  book-dark-canvas: "#1c1922"
  blueprint-paper: "#302846"
  blueprint-ink: "#f5f1ff"
  blueprint-muted: "#cec3dc"
  blueprint-rule: "#766686"
  blueprint-lilac: "#d8cef2"
  blueprint-mint: "#b9dfd3"
  blueprint-apricot: "#f2cfb2"
typography:
  display:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "clamp(2.5rem, 1.3rem + 3.1cqi, 4rem)"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.035em"
  headline:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "clamp(2rem, 1.15rem + 2.4cqi, 3rem)"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.035em"
  section:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1.625rem"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-.015em"
  subhead:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.6
  body:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.85
  prose:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1.125rem"
    lineHeight: 1.85
  support:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1rem"
    lineHeight: 1.8
  quote:
    fontFamily: "'Tessmora Serif', 'Noto Serif SC', 'Songti SC', Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.7
  label:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: ".875rem"
    lineHeight: 1.65
  small:
    fontFamily: "'Tessmora Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: ".8125rem"
    lineHeight: 1.7
  source:
    fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace"
    fontSize: ".875rem"
    lineHeight: 1.7
rounded:
  reader: "0px"
  control: "10px"
  note: "12px"
  illustrated: "16px"
  path: "6px"
  parsing: "8px"
  navigation: "8px"
  citation: "3px"
  blueprint: "8px"
spacing:
  article-top: "36px"
  article-inline: "48px"
  article-bottom: "56px"
  reading-section: "40px"
  reading-section-compact: "32px"
  prose-paragraph: "18px"
  paired-explanation: "32px"
  compact-inline: "20px"
components:
  opening-action:
    backgroundColor: "{colors.book-accent}"
    textColor: "{colors.book-paper}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "48px"
  navigation-current:
    backgroundColor: "{colors.book-tint}"
    textColor: "{colors.book-accent}"
    rounded: "{rounded.navigation}"
    padding: "10px 8px"
    height: "44px"
  mobile-topic-select:
    backgroundColor: "{colors.book-canvas}"
    textColor: "{colors.book-ink}"
    padding: "10px 28px 10px 12px"
  section-jump:
    textColor: "{colors.book-muted}"
    padding: "4px 0"
    height: "32px"
  pagination-next:
    textColor: "{colors.book-accent}"
    height: "44px"
  parsing-tab-selected:
    backgroundColor: "{colors.book-accent}"
    textColor: "{colors.book-paper}"
    rounded: "{rounded.parsing}"
    padding: "10px 18px"
  path-selected:
    backgroundColor: "{colors.book-tint}"
    textColor: "{colors.book-accent}"
    rounded: "{rounded.path}"
    padding: "14px 20px"
  citation:
    backgroundColor: "{colors.book-tint}"
    textColor: "{colors.book-accent}"
    rounded: "{rounded.citation}"
    padding: "3px 7px"
  comparison-table:
    textColor: "{colors.book-muted}"
    padding: "16px 20px 16px 0"
  mechanism-figure:
    textColor: "{colors.book-ink}"
    rounded: "{rounded.illustrated}"
  retrieval-illustration:
    textColor: "{colors.book-ink}"
    rounded: "{rounded.illustrated}"
    padding: "10px"
---

# Design System: Tessmora Architecture Reading Surface

## Overview

**Creative North Star: "以清晰的阅读路径与图文层次，讲清真实的设计与实现"**

This source snapshot records the focused `/architecture` surface on 2026-10-23. Tessmora presents an overview and seven substantive topics: design principles, parsing, storage, retrieval, execution paths, answers and citations, and runtime boundaries. Technical explanations, examples, tradeoffs and source links stay visible for the selected topic; only the retained reference appendices are folded.

The architecture surface remains inside the original application shell, as explicitly requested by the user. The conversation sidebar retains its brand, workspace navigation and global language/theme controls. The page adds only a “Design & implementation” header with GitHub, topic navigation and the reading area. Warm near-white paper, violet openings and purposeful diagram colors support the content. This is a route-specific design, not a product-wide restyle.

**Key Characteristics:**

- The original conversation sidebar remains visible; the architecture header contains only its subject and GitHub.
- An eight-column horizontal topic strip with an inline section outline at route widths above 1100px; previous/select/next navigation replaces it at 1100px and below.
- Self-hosted Sans 650 headings, 18px body text and 16px supporting prose; Serif is reserved for quoted and example material.
- The retained sculpture and transparent illustrations sit in tinted openings; storage/runtime diagrams and three retrieval illustrations use color to distinguish their subjects.
- One topic at a time, URL-based navigation, normal-flow article pagination, coordinated themes and Chinese/English copy.

## Colors

The light theme uses near-white paper, dark violet ink, a pale violet canvas and a stronger violet interaction accent. The dark theme replaces all eight `--book-*` surface and text colors together. The palette above is extracted from `architectureBook.css`; color names describe this route only.

Tinted fields group information: the cover and illustrated openings use `--book-tint`; the compact topic selector and pagination use `--book-canvas`, while the selected wide-screen topic uses `--book-tint`. Storage originals and the independent Node/Pi process use mint, while indexes and the Python host use lilac. Those diagram fields mix their accent at 13% with paper. Retrieval illustrations sit on 9% accent grounds, with violet for semantic, teal for lexical and apricot for media clues. Color is accompanied by text and structural relationships. The retained full-system blueprint keeps its separate dark palette.

## Typography

Self-hosted **Tessmora Sans** carries headings, prose and controls. Overview and topic headings use weight 650, as do primary section headings. **Tessmora Serif** is reserved for quoted/example material, including execution questions, document fragments and cited excerpts. The local font faces expose real 400–650 Sans and 400–700 Serif axes; preserve their subsets and licenses.

At a 16px root, the main scale is 18px body, 16px support, 14px labels, 13px compact captions, 20px subheads and 26px section headings. Overview headings range from 40–64px, topic headings from 32–48px. Reading prose normally stays within 76ch, with 1.85 line height and 18px between paragraphs. At route widths of 600px or below, body becomes 17px, support remains 16px, sections become 24px, and overview/topic headings become 36px/32px. At 320px or below, the overview heading becomes 28px. English openings use tighter line heights. Monospace is for actual paths, fields, identities and data.

**The Explanation First Rule.** State the choice, show its mechanism and limits, and connect the explanation to a concrete example, diagram or source.

## Layout

`AppLayout.tsx` retains the original `ConversationSidebar` on `/architecture`, honoring the user's explicit preference. Its expanded width defaults to 264px and respects the user's saved width; the existing collapsed width is 80px and the mobile rail is 72px at viewport widths of 640px or below. Chat and visited-page mounting behavior stay intact. The architecture content region removes its outer padding and uses the remaining viewport space.

`ArchitecturePage.tsx` adds a compact “设计与实现 / Design & implementation” header with an overview link and GitHub. It does not duplicate the application's logo, workspace-return, language or theme controls. The page and `.book-layout` use a column flex shell, with navigation outside the independently scrolling article.

Above an `atlas` container width of 1100px, topic navigation is an eight-column horizontal strip: overview plus seven topics. The existing `.book-sidebar` class names this top strip, not a second vertical sidebar. Links have 14px labels and a violet-tinted selected field; an inline, wrapping section-jump row follows when headings are available. Article scrolling updates the current section, and outline jumps focus the heading while respecting reduced motion.

At 1100px or below, the topic strip and section outline are hidden. A full-width row supplies previous/next buttons and a centered native topic select. This breakpoint responds to available architecture width after the original sidebar, not the whole browser viewport. The title and GitHub remain in the page header. No second contents column reduces the reading width.

The article is capped at 1540px with 36px top, 48px inline and 56px bottom padding. Padding becomes 28px/32px/40px at 1200px, 24px/20px/32px at 600px, and 20px/14px/28px at 320px. Sections are separated by 40px, or 32px on small screens. Previous/next pagination follows the article in normal flow. Hashes select topics, legacy hashes retain their mappings, and the `path` query parameter selects Direct, Agent or Pi. Topic changes reset article scroll and focus its heading.

The overview pairs copy with the retained sculpture in a tinted, two-column opening, followed by three themed topic groups. Design and citation topics use compact tinted openings with transparent artwork. At 600px, their heading spans the opening while the lead shares a row with a 120px illustration; at 320px the opening stacks. Reading explanations combine prose, definition rows, tables and diagrams. Parsing pairs a sticky specimen with processing steps on wide containers; at a 760px reader width it becomes a static stacked explanation. Other paired prose and evidence diagrams also stack there. Tables unfold into localized labeled fields at a 680px table-container width. Storage/runtime figures stack at 660px; retrieval illustration-and-caption pairs recompose at 540px and become vertical at 390px. Their image frames use a 3:2 aspect ratio, a 280px maximum height on wide layouts, 16px corners and 10px image padding; the smallest layout caps them at 240px.

## Elevation & Depth

Tinted surfaces, spacing and thin rules provide grouping within the architecture content. The selected topic uses a violet-tinted field without a shadow. The original application sidebar retains its existing visual treatment. Diagrams use crisp DOM/SVG geometry and HTML labels to explain source identity, process boundaries and search relationships.

Keep `evidence-sculpture.webp` on the overview and the transparent `representation-layers.webp` and `evidence-lens.webp` in their corresponding topic openings. The cover image uses multiply blending in light mode and normal blending in dark mode. Preserve intrinsic proportions, alpha and localized alternative text. These are conceptual illustrations, not system receipts.

Retrieval adds three transparent raster assets under `frontend/public/architecture/illustrations/`: `retrieval-semantic.webp`, `retrieval-lexical.webp` and `retrieval-media.webp`. A violet lens connects related documents; mint selections align matching terms; a landscape image and sculptural waveform connect to separate query markers. `RetrievalArtwork` supplies localized alternative text, lazy loading and asynchronous decoding. The shared caption explains that these images illustrate retrieval perspectives, not actual vector distributions or scores. The separate `PathFigure` execution diagrams retain their DOM/SVG geometry. Asset generation and provenance remain documented in `docs/architecture-visual-assets.md`.

Topic entry is one visible 5px upward movement over 240ms with `cubic-bezier(.16, 1, .3, 1)`, enabled only when reduced motion is not requested. The overview arrow uses a short 180ms response. Section jumps become immediate when reduced motion is requested.

## Shapes

The full reading surface is square-edged. Tinted illustrated openings and storage/runtime groups use 16px corners; notes and article pagination use 12px; the primary action uses 10px. Topic selection and parsing tabs use 8px. Execution choices retain 6px corners and inline citations 3px. Rounded fields identify a meaningful opening, grouped responsibility or control, rather than wrapping every paragraph.

## Components

- **Navigation:** the wide-screen topic strip uses `aria-current="page"`; its inline section outline uses `aria-current="location"`. At route widths of 1100px or below, a native select with previous/next buttons replaces both. The final next action returns to overview. Original application navigation remains in the conversation sidebar.
- **Openings:** the overview has a filled violet entry action and retained sculpture. Design/evidence openings pair Sans headings with transparent art capped at 240px, reducing to 120px on small screens.
- **Parsing and execution:** five modality tabs expose their specimen, mechanism, persisted fields and limits. At parsing-container widths of 560px or below, all five tabs stay visible in an icon-over-label grid; it has five columns above 240px and three columns at 240px or below. Each tab is at least 64px high. Labels use 16px text, reducing to the existing 14px label role at 340px. The English document label reads “Docs” narrowly while its accessible name remains “Documents”. The active tab has a filled violet field. Direct/Agent/Pi pressed-state controls expose complete mode-specific explanations without making model calls.
- **Storage and runtime:** mint/lilac groupings distinguish original objects from index records, and Python responsibilities from the independent Node/Pi loop. Explicit connectors and identity fields carry meaning. Persistence remains a separate labeled row.
- **Retrieval and citations:** three transparent illustrations introduce related meaning, shared terminology, and visual/acoustic links. Human-readable headings precede the Dense, Sparse and CLIP · CLAP labels; the media copy explicitly keeps image and audio representation spaces separate. The shared caption distinguishes conceptual perspectives from actual distributions or scores, and states that candidates still require content/applicability checks. Citation figures distinguish candidate identity, answer order and unused material. Example source controls focus the excerpt and return focus on close.
- **Sources and appendices:** implementation links accompany their explanation. Semantic comparisons keep localized field labels on narrow screens. Native disclosures are reserved for the retained system map, module index and runtime/configuration references.

Visible focus, themed selection and scrollbars remain part of the surface. Load the shared architecture base before component overrides so generic rules do not erase local control typography.

## Do's and Don'ts

- **Do** preserve the original conversation sidebar and use horizontal topics or the compact selector according to the available architecture width.
- **Do** keep technical depth, source links and illustrative boundaries visible in the selected topic.
- **Do** preserve the artwork, font licenses and asset provenance recorded in docs/architecture-visual-assets.md and docs/architecture-typography-assets.md.
- **Do** use color to clarify storage, process and retrieval relationships while keeping labels explicit.
- **Do** verify both languages, both themes, narrow layouts, keyboard focus and reduced motion after UI changes.
- **Don't** remove the original conversation sidebar or duplicate its logo, workspace-return, language and theme controls inside the architecture header.
- **Don't** replace substantive explanations with slogans or a repeated grid of generic cards.
- **Don't** pin article pagination over the content, hide the retained mobile artwork or continuously animate illustrations.
- **Don't** present conceptual diagrams, example citations or execution choices as live backend calls or measured performance.

Implementation sources: `frontend/src/components/layout/AppLayout.tsx`, `frontend/src/pages/ArchitecturePage.tsx`, and the architecture styles/components in `frontend/src/components/architecture/`, especially `architectureBook.css`, `architectureIllustrated.css`, `architectureFonts.css`, `storageVisuals.css` and `retrievalVisuals.css`. The sidecar carries matching component previews and metadata; synthesized tonal ramps are preview aids, not implementation tokens.
