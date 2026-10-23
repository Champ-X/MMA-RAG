# Material-space empty-state illustration

Updated on 2026-10-23.

## Production record

- Source: built-in `image_gen.imagegen`, generated with `transparent_background: true`.
- Original generated PNG: `/Users/champ/.codex/generated_images/01a168f5-d088-76a0-9d2d-0f3edb00dc7d/exec-fd3e4657-b0aa-43cb-8100-89c6297876ad.png`.
- Published asset: `frontend/public/knowledge/empty-collection.webp` (browser URL `/knowledge/empty-collection.webp`).
- Verified output: 1536 × 1024 pixels, 159606 bytes, native alpha retained.
- Conversion: `cwebp -q 90 -m 6 -exact`; the generated composition and transparent background are retained. Re-encoding the original with these options reproduces the published asset's SHA-256 exactly.
- Exact prompt provenance is also saved beside the asset in `empty-collection.webp.json`.

## Layout and behavior

The collection illustration is the centered main subject, followed by the calligraphic “创建第一个素材空间” headline and a folder-styled creation action. The introductory description and three setup steps were removed at the user's request. The four text-based material groups were replaced by four generated illustrations without visible captions; accessible alternative text remains.

The page header uses the same collection illustration at a larger size, with a coordinated calligraphic “素材空间” title and a readable sans-serif subtitle. The shared header applies this icon and typography to both empty and populated collection views, as explicitly requested by the user.

This is a presentation change to the existing empty state. Actual collection data and the existing empty, loading and error conditions determine when it appears; the illustration does not represent uploaded user files.

## Exact generation prompt

```text
Use case: stylized-concept.
Asset type: transparent 3D editorial illustration for the empty state of a material collection web app.
Primary request: a refined, welcoming and neatly organized collection still life. An open, softly frosted blue-lavender document folder holds a few warm ivory paper pages. A small sage green landscape print with a restrained apricot sun is tucked beside the pages. A sculptural sage sound ribbon and a short restrained apricot filmstrip nest naturally into the collection, communicating documents, images, audio and video.
Style/medium: exquisitely crafted soft 3D illustration, subtly translucent glass and tactile matte paper, rounded precision edges, delicate material texture and fine physically plausible reflections. Contemporary editorial object illustration, calm and sophisticated.
Composition/framing: horizontal 3:2 image, isometric orthographic three-quarter view. One compact and coherent arrangement, occupying approximately 80–85% of the canvas, horizontally balanced. Every object is fully visible, a handful of useful objects grouped together, generous clean outer edges.
Lighting/mood: soft studio lighting with gentle ambient occlusion between objects, airy and welcoming.
Color palette: muted slate blue and lavender, warm ivory, sage green and a small amount of apricot. Designed to sit on a very pale blue-slate web page and also on a dark web page.
Background: genuine fully transparent background with native alpha. Object silhouettes should be crisp and naturally antialiased; all empty gaps must be transparent. No backdrop, no ground plane, no floor, no pedestal, no vignette, no halo, no large drop shadow.
Constraints: no UI, no interface screenshot, no text, no letters, no numbers, no logo, no watermark; no floating confetti, no unrelated ornaments. The pages may have a few subtle embossed line marks only. The image should read as a crafted collection of real media objects, not a collage of app icons.
```

## Display-font production record

- Family: Ma Shan Zheng Regular; weight 400, normal style. The UI uses the self-hosted font for the Chinese page title and empty-state headline; supporting text remains in the existing readable sans-serif font.
- Published asset: `frontend/public/knowledge/fonts/knowledge-display.woff2` (browser URL `/knowledge/fonts/knowledge-display.woff2`), 14,612 bytes.
- License: SIL Open Font License 1.1; redistributed in `frontend/public/knowledge/fonts/OFL-MaShanZheng.txt`, with trailing whitespace removed.
- Official source: https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/MaShanZheng-Regular.ttf
- Official license: https://raw.githubusercontent.com/google/fonts/main/ofl/mashanzheng/OFL.txt
- Subsetting: fontTools 4.67.0 with Brotli WOFF2; verified that all characters in “创建第一个素材空间” and ASCII U+0020–U+007E remain present. “素材空间” uses characters already in that verified subset.
- Source SHA-256: `6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb`.
- Published SHA-256: `801f34f250093322172bd617f73b6f0c1488f388efea9d7476dd28ad5146fb55`.
- Full font provenance and Unicode range: `frontend/public/knowledge/fonts/knowledge-display.json`.

## Material illustrations

The four generated objects use the same ivory, sage, apricot and frosted blue-lavender material palette as the central collection illustration. These are decorative material-type representations, not previews of uploaded files. All four published assets are 1254 × 1254 pixels; the requested 1024 × 1024 canvas in the original prompts is retained below as provenance rather than described as the actual output size.

| Material | Published asset | Bytes | Exact-prompt sidecar |
| --- | --- | ---: | --- |
| Documents | `frontend/public/knowledge/material-documents.webp` | 114,962 | `material-documents.webp.json` |
| Images | `frontend/public/knowledge/material-images.webp` | 175,600 | `material-images.webp.json` |
| Audio | `frontend/public/knowledge/material-audio.webp` | 134,406 | `material-audio.webp.json` |
| Video | `frontend/public/knowledge/material-video.webp` | 195,882 | `material-video.webp.json` |

### Documents: exact generation prompt

- Prompt sidecar: `frontend/public/knowledge/material-documents.webp.json`.
- Generated at: `2026-10-23T14:30:55.189Z`.

```text
Use case: stylized-concept. Asset type: isolated decorative illustration for a premium knowledge workspace empty state, matching a soft tactile 3D collection of ivory documents, translucent periwinkle blue glass, sage green and apricot accents. Primary request: a compact trio of ivory paper leaves gently fanned apart with rounded corners, quietly embossed abstract horizontal lines and one small folded page corner, held against a slim translucent blue-lavender backing. Only documents; no picture frame, no audio, no folder, no writing tools. Materials: thick warm ivory paper with extremely fine tactile grain and satin frosted glass backing, carefully sculpted clean bevels and believable thickness. Style: premium poetic miniature 3D still life, serene, warm, high craft, neither flat vector nor cartoon plastic. Composition: one cohesive centered object, square 1024 by 1024 canvas, occupies 80 to 85 percent of the canvas, orthographic three-quarter view, clear silhouette readable at 160px; all edges comfortably within frame. Diffuse studio illumination from upper left, very soft contact shading within the object. Native transparent alpha background, with clean transparent gaps; no opaque background or floor or pedestal or ground shadow. Absolutely no text, letters, numbers, logo, watermark, confetti, sparkles, UI, labels or border around the composition.
```

### Images: exact generation prompt

- Prompt sidecar: `frontend/public/knowledge/material-images.webp.json`.
- Generated at: `2026-10-23T14:30:55.378Z`.

```text
Use case: stylized-concept. Asset type: isolated decorative image-media illustration for a premium knowledge workspace empty state, matching soft tactile 3D ivory documents and translucent periwinkle blue glass with sage and apricot accents. Primary request: two overlapping thick miniature picture prints with rounded ivory borders and soft lavender-blue translucent edge backing, resting as a compact unified sculptural object in slight opposite tilts. The larger front print shows a calm landscape made of tactile layered sage-green hills, a pale warm sky, and one apricot circular sun. A second picture print peeks diagonally behind with a different soft sage mountain silhouette. Recognizably photographs or picture prints, without any camera, documents, film reels, audio waveform or folders. Materials: warm ivory paper with fine tactile grain, sculpted relief landscape, satin frosted blue-lavender glass edges, beautiful believable thickness and rounded bevels. Style: premium poetic miniature 3D still life, serene, warm, high craft; neither flat vector nor cartoon plastic. Composition: one cohesive centered object, square 1024 by 1024 canvas, occupies 80 to 85 percent of the canvas, orthographic three-quarter view, clear silhouette readable at 160px; all edges comfortably within frame. Diffuse studio illumination from upper left, very soft shading inside the object. Native transparent alpha background, with clean transparent gaps; no opaque background, no floor, no pedestal and no ground shadow. Absolutely no text, letters, numbers, logo, watermark, confetti, sparkles, UI, labels or border surrounding the composition.
```

### Audio: exact generation prompt

- Prompt sidecar: `frontend/public/knowledge/material-audio.webp.json`.
- Generated at: `2026-10-23T14:29:31.788Z`.

```text
Use case: stylized-concept
Asset type: transparent square illustration for the audio section of Tessmora, a refined knowledge workspace.
Primary request: Create a single beautiful, sophisticated soft 3D sculpture representing audio: one flowing sage-green sound ribbon sweeping in a gentle wave across a small group of frosted translucent lavender rounded equalizer bars, with delicate ivory waveform ridges embossed on the ribbon. All pieces form a coherent balanced composition, recognizable as sound and audio, no headphones and no person.
Reference style: the existing Tessmora collection illustration uses blue-lavender frosted glass, warm ivory paper, soft sage and apricot accents, rounded carefully crafted forms and calm diffuse studio lighting. Match those materials and restrained tonal warmth. This audio object should be distinct and simpler than a full folder collection.
Composition/framing: square 1024 by 1024 image, isolated subject centered, filling 80 to 85 percent of the canvas, orthographic three-quarter view, visible dimensional details with elegant soft edges.
Scene/backdrop: genuinely transparent native alpha background. No solid background, floor, pedestal or horizon. No cast ground shadow; only subtle self-shading.
Style/medium: polished 3D editorial object render, refined tactile matte sage with restrained frosted blue-lavender glass, warm ivory ridges. Gentle translucency, balanced contrast for a light or dark UI.
Constraints: no UI, words, letters, numbers, labels, logos, watermark, person, toy characters, confetti or unrelated particles. Preserve genuine empty transparent gaps around and between objects.
```

### Video: exact generation prompt

- Prompt sidecar: `frontend/public/knowledge/material-video.webp.json`.
- Generated at: `2026-10-23T14:29:31.806Z`.

```text
Use case: stylized-concept
Asset type: transparent square illustration for the video section of Tessmora, a refined knowledge workspace.
Primary request: Create one beautiful refined soft 3D sculpture representing video: an elegant gently curling apricot filmstrip, its regular rectangular sprocket holes clearly cut through, curling around one thick frosted blue-lavender cinema frame. The cinema frame contains a simple matte sage inset with one small warm ivory triangular play symbol. The filmstrip has just two graceful arcs, a clear silhouette and purposeful restraint. No landscape photograph.
Reference style: the existing Tessmora collection illustration uses blue-lavender frosted glass, warm ivory paper, soft sage and apricot accents, rounded carefully crafted forms and calm diffuse studio lighting. Match those material tones and tactile detail. The video asset is distinct from documents, photos, and audio.
Composition/framing: square 1024 by 1024 image, isolated composition centered, filling 80 to 85 percent of the canvas, orthographic three-quarter view, frame leaning subtly backward and film loop rising to one side. All objects wholly inside canvas.
Scene/backdrop: genuinely transparent native alpha background. No solid backdrop, floor, pedestal or horizon. No outer glow, no ground shadow, only subtle self-shading. Sprocket holes and interior gaps are actually transparent.
Style/medium: polished soft 3D editorial object render, refined not toyish; matte apricot flexible film, translucent frosted lavender frame, restrained sage inset. Diffuse studio lighting with gentle highlights, warm ivory accents. Balanced contrast for light and dark UI.
Constraints: no UI, words, letters, numbers, labels, logos, watermark, person, toy characters, confetti or unrelated particles. Native transparent alpha and clean edges.
```


## Final interaction and header reuse

The populated header reuses the four exact `material-*.webp` assets in its statistics row (44px, reducing to 36px in narrow headers), keeping text labels and counts separate. A temporary visual fixture was used to verify representative counts without writing knowledge data; it was removed after inspection.

On hover-capable devices, each empty-state material illustration lifts 8px, scales to 1.045 and gently tilts; alternate items tilt in the other direction. The effect transitions over 320ms and returns smoothly. Under `prefers-reduced-motion: reduce` the images stay still. The folder action opens the existing creation dialog; cancellation restores focus to the action.
