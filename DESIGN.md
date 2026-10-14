---
name: Tessmora Architecture Reading Surface
description: Current visual implementation of /architecture only; not a product-wide identity or an approved brand specification.
colors:
  atlas-paper: "#f8f7fb"
  atlas-surface: "#fff"
  atlas-ink: "#302b42"
  atlas-muted: "#686276"
  atlas-line: "#dfdbe8"
  atlas-accent: "#6852b5"
  atlas-tint: "#eeebf7"
  atlas-teal: "#266b63"
  atlas-purple: "#765591"
  atlas-dark-paper: "#191f2d"
  atlas-dark-surface: "#232b3b"
  atlas-dark-ink: "#e6eaf3"
  atlas-dark-accent: "#c4b6ef"
  atlas-dark-action: "#a28add"
  atlas-dark-on-action: "#201a30"
  blueprint-paper: "#302846"
  blueprint-ink: "#f5f1ff"
  blueprint-lilac: "#d8cef2"
  blueprint-mint: "#b9dfd3"
  blueprint-apricot: "#f2cfb2"
  blueprint-retrieval-ink: "#293c37"
typography:
  display:
    fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif"
    fontSize: "clamp(32px,1.6rem + 2cqi,56px)"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-.025em"
  headline:
    fontFamily: "'Noto Serif SC', 'Songti SC', STSong, serif"
    fontSize: "clamp(28px,1.25rem + 1.1cqi,36px)"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-.02em"
  body:
    fontFamily: "'Manrope', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.7
  label:
    fontFamily: "'Manrope', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: "13px"
  source:
    fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.7
rounded:
  control: "7px"
  button: "8px"
  panel: "12px"
  viewport: "18px"
  blueprint: "8px"
  blueprint-node: "8px"
  retrieval: "8px"
spacing:
  control-gap: "6px"
  inline-gap: "12px"
  content-inset: "clamp(18px,3.5cqi,48px)"
  section: "56px"
  compact-section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.atlas-accent}"
    textColor: "{colors.atlas-surface}"
    rounded: "{rounded.button}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "{colors.atlas-purple}"
  button-primary-dark:
    backgroundColor: "{colors.atlas-dark-action}"
    textColor: "{colors.atlas-dark-on-action}"
  link-secondary:
    textColor: "{colors.atlas-muted}"
  navigation-current:
    textColor: "{colors.atlas-accent}"
  mode-select:
    backgroundColor: "{colors.atlas-tint}"
    textColor: "{colors.atlas-accent}"
    rounded: "{rounded.control}"
    padding: "7px 28px 7px 12px"
  path-selected:
    backgroundColor: "{colors.atlas-surface}"
    textColor: "{colors.atlas-accent}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  blueprint-retrieval:
    backgroundColor: "{colors.blueprint-mint}"
    textColor: "{colors.blueprint-retrieval-ink}"
    rounded: "{rounded.retrieval}"
    padding: "11px 13px"
---

# Design System: Tessmora Architecture Reading Surface

## Overview

**Creative North Star: "沿证据阅读架构"**

This is a descriptive snapshot of the current v3 `/architecture` implementation, recorded on 2026-10-14. Its scope is the architecture reading surface inside the existing application shell. The metaphor describes the implementation; it is not a user-approved brand direction and must not be imposed on other routes.

The page moves from design principles to the system blueprint, execution paths, an illustrative evidence journey, module implementation and runtime boundaries. Editorial typography, a tactile illustration and varied diagram compositions support that reading sequence. Product facts remain in `PRODUCT.md`; source code remains the authority when this snapshot drifts.

**Key Characteristics:**
- A readable Chinese editorial hierarchy with restrained technical labels.
- Pale reading surfaces, a deep blueprint field and distinct evidence-path colors.
- Art introduces the idea; interactive diagrams explain actual responsibilities.
- Headings and their introductions share one left alignment; content groups stay close to their labels.
- Light and dark themes, container-aware layouts and optional short motion.

## Colors

Primary violet connects navigation, actions and the conventional execution path. Teal distinguishes Pi in the path explorer. Neutral paper, surface, ink, muted and line tokens provide the reading hierarchy; the dark theme overrides this local token scope.

The blueprint keeps its own deep field in both themes. Lilac identifies preparation, mint identifies conventional retrieval, and apricot identifies Pi. These are local diagram roles: Pi's teal in the explorer is not a global color identity. Preserve text labels alongside all color distinctions.

## Typography

Display and section headings use the declared Noto Serif SC / Songti stack; prose and controls use Manrope with Chinese system fallbacks. Source paths use IBM Plex Mono with monospace fallbacks. These are CSS stacks, not a promise that every font is installed or downloaded.

Use the display and headline roles for the reading hierarchy. Body defaults are in frontmatter; the hero description uses a looser line height (1.95) and a bounded measure (29em). Technical labels remain subordinate to prose. Source paths may wrap anywhere.

## Layout

The architecture panel owns its scroll viewport and sticky section navigation. Content is centered at a maximum width of 1360px with fluid inline padding. Desktop hero copy and artwork use a 1:1.12 grid. Section introductions are a single block: the heading comes first, followed by the introduction with a 12px top margin on the same left axis. Their outer spacing tightens on narrow containers.

Breakpoints refer to the `atlas` container, not the browser viewport. Module tabs use eight columns, four at 1100px and below, and two at 540px and below. At 820px the blueprint's execution lanes and two storage groups become stacked; at 700px its overview follows a vertical reading order with downward arrows in their own rows; at 510px the two shared stores stack. At 660px the hero and principles become one column, the design thread becomes two columns, and navigation gains its own horizontally scrollable row. The execution-path explorer retains its own 780px and 480px layout changes.

Module panels and the evidence journey use natural content height. Their headings, explanations and controls remain near the content they describe instead of being separated by reserved empty space. Mechanism disclosures place their explanation immediately below their title. Runtime storage descriptions keep their scope labels on the next line in the same content column; disclosure tags sit next to their title.

At 350px and below, module tabs show names only, and contract labels stack above their descriptions. This keeps the two-column directory readable within the existing application sidebar. Module prose uses a 58em maximum measure and progressive `text-wrap: pretty`; narrow layouts use their available width.

## Elevation & Depth

Depth comes mainly from contrasting fields, thin rules, deliberate corners and the generated sculpture's material lighting. Most panels stay flat. The selected execution-path control uses one quiet shadow (`0 3px 12px #3028460a`); avoid spreading that effect to every section.

The original `frontend/public/architecture/evidence-sculpture.webp` illustration expresses documents, images, audio and video converging into organized evidence. It is conceptual artwork, not a topology or evidence of a live backend state. Retain its transparent background, 4:3 proportions and empty decorative alternative text; adjacent prose carries its meaning.

## Shapes

Controls use small, consistent curves; the reading viewport and ordinary panels use broader curves. The blueprint board, its overview nodes, execution nodes, host boundary and storage groups use 8px corners. Its modality labels use 4px corners. The principles statement retains asymmetric corners as a separate editorial element; those corners are not applied to the system diagram.

## Components

- **Primary action and secondary link:** the hero action has a minimum height of 46px; its secondary document link has a minimum height of 44px. The dark theme explicitly changes the primary action's fill and text.
- **Section navigation and mode selector:** sticky, compact and keyboard reachable. The current section has both a colored label and a bottom rule. The native select controls the entire page's execution mode.
- **Execution-path selector:** three pressed-state buttons share one rail. Selection changes the diagram and its nearby explanation; expanded node details remain next to the diagram. Pi uses the explorer's teal path tokens.
- **Blueprint overview and entry:** four bordered content nodes occupy four flexible grid tracks; the three arrows each occupy a separate 24px track with 12px gaps on either side. A compact entry strip groups the available entrances with FastAPI. There are no floating distribution buses or decorative percentage-positioned routes.
- **Blueprint execution and storage:** source-linked preparation, conventional RAG and Pi responsibilities retain their lilac, mint and apricot roles. Short 14px vertical connectors directly join internal nodes. The bottom has two actual groups: shared knowledge storage contains MinIO and Qdrant with a write/read responsibility sentence; Pi runtime records contain SQLite and local files with an explicit Pi-host-only persistence sentence. Storage icons use Lucide at 22px and stroke width 1.5. The static modality chips label content; they are not filters.
- **Module explorer and mechanisms:** horizontal tabs reflow to 8/4/2 columns. The selected panel grows naturally around its introduction, input/process/output contract and source links. Mechanism titles and descriptions are vertically adjacent within the same summary copy block.
- **Evidence journey:** explanatory and evidence columns align at their top and use natural height; controls follow the current stage content. The demonstration remains explicitly illustrative.
- **Runtime boundaries:** storage descriptions and scope labels stay together; lifecycle labels precede their explanations, and disclosure scope tags remain adjacent to their title.
- **Principle disclosures:** native details/summary retain their text context while opening supporting explanations and source links.

Interactive elements use a visible 2px focus outline with a 4px offset; blueprint links adjust the outline color for their background. Motion is limited to short state transitions (180–200ms), disclosure icons and a subtle detail reveal. `prefers-reduced-motion: reduce` removes animation, transitions and smooth scrolling across this surface. Do not animate the hero sculpture continuously.

## Do's and Don'ts

- **Do** keep this document scoped to `/architecture` and refresh it against the actual CSS when that surface changes.
- **Do** use source-linked explanatory content and label the evidence journey as illustrative.
- **Do** verify both themes, narrow layouts, keyboard focus and reduced-motion behavior.
- **Don't** imply this snapshot is a user-approved product-wide identity.
- **Don't** treat conceptual artwork, illustrative traces or color coding as proof of runtime behavior.
- **Don't** flatten the page into repeated cards or add continuous motion that competes with reading.
- **Don't** reintroduce overlaid arrows, floating buses, fixed-height empty panels or detached labels in the system diagram and reading sections.

Implementation references: `frontend/src/components/architecture/architecture.css`, `architectureBlueprint.css`, `architecturePrinciples.css`, `architectureMap.css`, `architectureDetails.css`, `evidenceJourney.css`, `architectureRuntime.css` and `frontend/src/pages/ArchitecturePage.tsx`. `.impeccable/design.json` adds compact component previews and extension metadata; it does not redefine the CSS source of truth. Its synthesized OKLCH ramps support palette previews only and are not additional implementation tokens.
