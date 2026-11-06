# Architecture typography assets

The architecture page uses self-hosted Noto CJK subsets. The Color Atlas uses
**Tessmora Atlas Serif** for display text and **Tessmora Atlas Sans** for controls
and body text. The retained detailed components and CSS fallback stacks also
use **Tessmora Sans** and **Tessmora Serif**. No font CDN is required.

## Sources and license

All four subsets derive from the official [Google Fonts repository](https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0)
at commit `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0`:

- [NotoSansSC[wght].ttf](https://github.com/google/fonts/blob/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf), upstream weight axis 100–900.
- [NotoSerifSC[wght].ttf](https://github.com/google/fonts/blob/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf), upstream weight axis 200–900.

They remain licensed under the **SIL Open Font License 1.1**, distributed as
[OFL-NotoSansSC.txt](../frontend/public/architecture/fonts/OFL-NotoSansSC.txt)
and [OFL-NotoSerifSC.txt](../frontend/public/architecture/fonts/OFL-NotoSerifSC.txt).
Keep the licenses, source attribution and embedded copyright metadata with the
fonts. Internal names identify the modified subsets; Tessmora does not claim
authorship of the upstream typefaces.

## Published subsets

| Family | Directory | Weight axis | Recorded codepoints |
| --- | --- | --- | ---: |
| Tessmora Atlas Serif | `frontend/public/architecture/atlas/` | 400–900 | 808 |
| Tessmora Atlas Sans | `frontend/public/architecture/atlas/` | 400–750 | 808 |
| Tessmora Sans | `frontend/public/architecture/fonts/` | 400–650 | 967 |
| Tessmora Serif | `frontend/public/architecture/fonts/` | 400–700 | 967 |

[Atlas font-manifest.json](../frontend/public/architecture/atlas/font-manifest.json)
and [retained font manifest.json](../frontend/public/architecture/fonts/manifest.json)
record source/output SHA-256, byte sizes, weight ranges and the source files used
at generation time. Their file lists are build provenance, not a guarantee that
all subsequent copy is covered. The retained subset also has a
[Unicode inventory](../frontend/public/architecture/fonts/subset-unicodes.txt).

These fonts are deliberately page-specific, not complete Chinese character
sets. New copy outside their coverage uses the CSS fallback stack until the
subsets are regenerated. `colorAtlas.css` and `architectureFonts.css` advertise
the actual variable-weight ranges and use `font-display: swap`.

## Rebuilding and verifying

Use an isolated environment with FontTools and Brotli; they are not runtime
dependencies. The recorded builds used FontTools 4.67.0.

1. Download the pinned TTFs and neighboring `OFL.txt` files. Verify source hashes against the appropriate manifest.
2. Collect required printable codepoints from the current component and localized copy, plus printable ASCII. Check each source font's `getBestCmap()` before subsetting.
3. Subset with `fontTools.subset.Subsetter`, preserving layout closure and source attribution (`layout_features=['*']`, `name_IDs=['*']`, `name_legacy=True`, `name_languages=['*']`).
4. Limit `wght` with `fontTools.varLib.instancer.instantiateVariableFont`, using the published family's range and default 400. Rename family/full/PostScript records to the corresponding Tessmora family while preserving copyright and license records. Save with `font.flavor='woff2'`.
5. Reopen the outputs; check glyph coverage, family names, `fvar` ranges and variation tables. Update hashes, byte sizes, codepoint counts and source-file inventories together.
6. Verify Chinese/English layouts and actual font loading in the browser. Asset-level checks do not establish layout acceptance.
