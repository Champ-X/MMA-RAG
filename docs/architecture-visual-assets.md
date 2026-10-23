# Architecture illustration assets

Generated on 2026-10-23 for the architecture page's illustration and spacing refinement.

## Production record

- Source tool: built-in `image_gen.imagegen` via `functions.exec`; no external API or CLI generation.
- Mode: new image generation, `transparent_background: true`.
- Style reference: the existing `frontend/public/architecture/evidence-sculpture.webp`, inspected with `view_image` before generation and retained unchanged.
- Image generation produced 1254 × 1254 RGBA PNGs. The project assets were converted to WebP with `cwebp -q 90 -m 6 -exact`; no cropping, painting, compositing, or background removal was performed.
- WebP alpha is losslessly encoded. Both outputs retain 256-level transparency and were reopened using `view_image` after conversion. `sips` reports 1254 × 1254 and `hasAlpha: yes` for each.
- Illustrations are conceptual explanations. They do not encode real source data, benchmark results, implementation diagrams, or user documents. Interface captions provide their specific meaning.

| Asset | Subject | Final bytes | Original generated file |
| --- | --- | ---: | --- |
| `frontend/public/architecture/illustrations/representation-layers.webp` | Original source and its separate searchable representations | 136316 | `/Users/champ/.codex/generated_images/01a167ae-607c-7001-a6fc-13c0b0baf5b9/exec-72045ada-ba3f-4f24-b4b8-46a9d2568787.png` |
| `frontend/public/architecture/illustrations/evidence-lens.webp` | Selection of evidence with traceable links to an answer | 138180 | `/Users/champ/.codex/generated_images/01a167ae-607c-7001-a6fc-13c0b0baf5b9/exec-26e6a54d-3ee7-4a57-8b89-b40fbc32fc17.png` |

## Provenance metadata verification

The exact requirement is documented in the installed Impeccable skill's `reference/new-work.md` and `reference/visualize.md`: generated rasters retain the exact generation prompt, and shipping asset directories are scanned for missing provenance. The two images were processed with `/Users/champ/.agents/skills/impeccable/scripts/impeccable embed-prompt <image> --prompt <exact prompt>`.

For WebP, this version of the tool reports **sidecar fallback for this format**. It created `representation-layers.webp.json` and `evidence-lens.webp.json` beside the images; it did not embed a metadata chunk inside the WebP or alter their image bytes. Each sidecar contains `prompt` and `createdAt`. `embed-prompt <image> --read` successfully recovered the exact original prompt for both images.

`embed-prompt --scan frontend/public/architecture/illustrations` returned `SCAN: 2 rasters, 0 missing` on 2026-10-23. This scan verifies the tool's provenance records, not copyright, model origin cryptography, or visual correctness. The separate original overview illustration was retained unchanged and is outside this two-asset scan.

## Prompt: representation layers

```text
Use case: stylized-concept.
Asset type: one transparent-background editorial illustration for a technical project architecture reading page, square format approximately 1024 by 1024.
Primary request: show that an original source and its derived searchable representations coexist without replacing the original. An elegant warm-ivory paper document with a softly curled corner stands at the left; a small translucent lavender framed landscape picture nestles beside it. From these originals, exactly three slightly offset translucent lavender semantic slices fan forward toward the right, each containing only a few restrained grey or sage embossed horizontal strokes and one small warm-apricot locator bead. Subtle lavender strands tie each slice back to a precise point on the original. The original paper remains whole and visibly distinct.
Style/medium: a beautifully crafted soft 3D editorial still life, with restrained smooth matte paper, softly frosted lavender glass, sage-green and warm-apricot accents. Rounded tactile edges, delicate studio highlights, gentle internal depth, high-end rendered material treatment. The reference illustration already shown in this conversation is a style reference only: retain its pastel materials and calm orthographic three-quarter view, but make this new composition simpler and more focused.
Composition/framing: centered compact sculpture, orthographic three-quarter view, all objects fully visible, occupying roughly 80 percent of the square; well-separated silhouettes that stay clear at small website sizes. Transparent air between objects. One composition, no split panels.
Lighting/mood: soft studio illumination, calm and precise; subtle contact shading only attached to objects.
Constraints: genuinely transparent background with alpha, no white or colored backdrop, no floor or pedestal, no frame around the whole image; no text, no letters, no numbers, no labels, no logos, no watermark, no UI screenshot, no extra decorative objects. Preserve clean edges and semi-transparent glass.
```

## Prompt: evidence lens

```text
Use case: stylized-concept.
Asset type: one transparent-background editorial illustration for a technical project architecture reading page, square format approximately 1024 by 1024.
Primary request: a compact sculptural still life explaining traceable evidence. At the left, just two slightly overlapping warm-ivory source sheets with a few embossed grey lines and a small soft-apricot video film frame; at the center, one beautifully crafted lavender-glass magnifying lens held at a three-quarter angle enlarges a small sage-highlighted passage and one source locator bead. To the right, one clean warm-ivory answer sheet with three restrained raised lavender lines. Two fine lavender arcs connect the selected source markers directly to small matching warm-apricot beads beside the lines on the answer sheet. The readable visual story is source, focused selection, traceable answer.
Style/medium: high-end soft 3D editorial still life with smooth paper, softly frosted lavender glass, sage green and warm-apricot accents, rounded tactile edges, subtle studio highlights and visible material depth. Match the pastel 3D visual family of the architecture illustration and the generated representation-layers asset already shown. More sculptural than flat iconography, simple and focused.
Composition/framing: centered compact composition, orthographic three-quarter view, all objects fully visible and occupying about 80 percent of the square; distinctive silhouettes and only a few objects, clear at small website sizes. Lens is the main focal point but does not obscure all source markers. Transparent air between forms.
Lighting/mood: calm, bright diffuse studio lighting with highlights that read on both warm white and charcoal website backgrounds; attached contact shading only.
Constraints: genuine transparent background with alpha, no white or colored backdrop, no floor, no pedestal, no framing box, no text, no letters, no numbers, no labels, no logo, no watermark, no UI or computer-screen mockup, no decorative sparkles or unrelated objects. Keep semitransparent glass and crisp alpha edges.
```



## Retrieval illustrations refinement

On 2026-10-23 the three initial SVG scatterplots were replaced at the user's request with a coherent soft 3D illustration set. The original overview sculpture and the two earlier editorial images remain unchanged.

- Generated with the built-in `image_gen` tool, using native transparent backgrounds. No API/CLI image generation.
- All three are 1536 × 1024 RGBA images. Converted with `cwebp -q 90 -m 6 -exact`, with no crop, repaint, composite or background removal. Alpha was checked against each original and matches exactly.
- Only WebP and prompt provenance sidecars are published. Intermediate PNGs are retained in ignored `tmp/imagegen/architecture-retrieval/`; original generated files also remain under `$CODEX_HOME/generated_images`.
- Art explains conceptual retrieval perspectives, not actual vector positions, distances, scores or measured results. CLIP and CLAP retain separate depicted query connections.

| Asset | Subject | Bytes |
| --- | --- | ---: |
| `frontend/public/architecture/illustrations/retrieval-semantic.webp` | Related meanings across different document fragments | 120158 |
| `frontend/public/architecture/illustrations/retrieval-lexical.webp` | Matching term blocks across documents | 186280 |
| `frontend/public/architecture/illustrations/retrieval-media.webp` | Independent image and audio retrieval spaces | 128824 |

### Exact prompt: retrieval semantic

```text
Use case: stylized-concept.
Asset type: production transparent raster illustration for the Tessmora architecture section, Dense semantic retrieval.
Primary request: a premium soft 3D editorial still life, orthographic three-quarter view, horizontally composed on a 3:2 canvas. One lavender frosted-glass semantic lens or orb joins three warm-ivory document fragments in a compact constellation through gracefully curved violet ribbons. The lens contains a small central faceted violet query token. Different subtle raised abstract strokes on each fragment suggest different language expressing the same underlying meaning; the strokes are sculpted marks only, never readable writing. Treat the lens and query token as one integrated object, with just three surrounding document fragments: four useful object groups total.
Style and materials: beautiful tactile paper, softly curled paper edges, rounded sculptural edges, delicate highlights, refined translucency and convincing dimensional depth. Match an established premium soft 3D illustration family using lavender glass, warm ivory paper, and small muted sage and apricot accents. Soft studio lighting, gentle self-shadows, carefully crafted physical materials.
Composition: compact horizontally flowing sculptural arrangement, all objects fully visible, filling approximately 85 percent of the canvas with comfortable transparent margins. Distinct conceptual focus on shared semantic meaning, not literal keyword matching or multimedia.
Scene and backdrop: genuine transparent background with native alpha. Isolated floating still life without a floor, pedestal, environmental backdrop, or opaque backdrop.
Avoid: axes, dotted scatterplots, decorative sparkles, clouds of dots, generic network diagrams, magnifying glass handles, floors, pedestals, text, letters, numerals, labels, UI, logos, watermarks, cropped objects.
```

### Exact prompt: retrieval lexical

```text
Use case: stylized-concept
Asset type: production raster illustration for a Tessmora architecture page card about sparse lexical retrieval.
Primary request: Create a beautiful premium soft 3D editorial still life that makes exact matching terms across documents immediately visible, with genuine transparent alpha background. This is a tangible sculptural illustration, never a diagram or a UI screenshot.
Subject: Exactly three warm-ivory paper documents fan gently in depth. Exactly three clearly matching raised sage rectangular tokens, one per sheet, line up across the sheets. One elegant frosted mint-glass rectangular search lens / selection window floats close in front of the matching tokens and illuminates their alignment. Fine mint connecting tabs demonstrate these exact shared terms. Add one small warm-apricot index marker. Other quiet embossed text-like strokes in lavender-gray provide document context; these are purely abstract horizontal strokes, never readable letters.
Style/medium: Premium art-directed soft 3D editorial product still life, sophisticated and tactile, softly rounded edges, tangible warm paper, polished frosted mint glass, delicate lavender edge accents, clear shadowed depth, soft studio highlights and careful surface finish. Match the material spirit of a luxurious pastel sculpture with paper, mint glass, lavender highlights and a tiny apricot accent.
Composition/framing: Horizontal 3:2 canvas, orthographic three-quarter camera, compact centered composition occupies about 85 percent of the canvas, all objects fully visible with a little breathing room. Arrange the sheets and glass into a strong cohesive silhouette and legible focal point. Focus on repeated matching rectangular markers within documents. Keep the composition distinctive from semantic clustering, scatterplots, and multimedia illustrations.
Scene/backdrop: Completely transparent background, isolated floating objects, genuine alpha, no floor or background plane.
Lighting/mood: Soft luminous studio lighting, calm intelligent premium editorial mood, natural self-shadowing between objects.
Constraints: No floor, pedestal, axes, dotted scatterplot, watermark, labels, text, numbers, UI, sparkles, logos, readable words, readable letters, scenery, extra media objects, or decorative floating balls. Render as a finished refined 3D artwork, not flat vector artwork, not simplistic icons. Preserve genuine transparency around and between the objects.
```

### Exact prompt: retrieval media

```text
Use case: stylized-concept.
Asset type: a production transparent editorial 3D illustration for the Tessmora architecture page, explaining independent CLIP image retrieval and CLAP audio retrieval.
Scene/backdrop: a genuinely transparent 3:2 horizontal canvas, with clear transparent air around all objects.
Subject: two clearly separated, balanced groups. On the left, a thick softly frosted lavender picture frame contains layered sage rolling hills and one soft apricot sun. On the right, a sculptural sage audio waveform, formed as a gently bending translucent ribbon with smoothly rounded vertical ridges of varied heights. Beneath each media object is its own small apricot faceted query token; connect that token only to the media object directly above it, using one short thin curved lavender strand. Keep the two groups visibly separate: absolutely no strand, ribbon, arrow, or other connection between the picture and the waveform, because they represent separate spaces.
Style/medium: premium soft 3D editorial still life, a refined tactile sculpture with fine paper, soft ceramic, and softly frosted glass materials. Rounded carefully crafted edges, subtle translucency, restrained soft studio highlights, delicate material gradients. Sophisticated and elegant, not toyish.
Composition/framing: orthographic three-quarter view, horizontally composed, two groups of comparable visual weight, all objects fully visible. The compact centered composition occupies about 85 percent of the canvas, with no clipping. Few objects and calm spacing. Muted lavender, sage green, soft apricot, and warm ivory. No environment or floor.
Avoid: pedestal, ground plane, cast shadow on an opaque background, axes, scatterplot, dotted plot, labels, text, letters, numbers, interface elements, watermark, decorative sparkles, extra media types, global shared connector.

```

### Original generated retrieval files

- Semantic: `/Users/champ/.codex/generated_images/01a1687c-6ef7-7da2-85b3-8eb0ab15c95a/exec-b57569f1-54b2-4cdc-bfa3-58b1ddce4f1c.png`
- Lexical: `/Users/champ/.codex/generated_images/01a1687c-c28e-7970-93bc-6548560bf92c/exec-f528748d-f43f-452f-b217-375207faeeb1.png`
- Media: `/Users/champ/.codex/generated_images/01a1687d-1385-7a52-aa59-d590f7ad569b/exec-9536d139-3934-41cd-b114-dc6c87cca8c6.png`

Provenance scan after integration: `SCAN: 5 rasters, 0 missing` (the two earlier editorial illustrations plus these three).
