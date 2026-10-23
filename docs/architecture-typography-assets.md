# Architecture typography assets

The architecture page uses self-hosted Chinese fonts with a shared Noto CJK lineage: **Tessmora Sans** for headings, reading and interface text, and **Tessmora Serif** for the quoted path examples. These are renamed, page-specific subsets of Noto Sans SC and Noto Serif SC, the Noto distributions of the Adobe/Google Source Han type families. The deployed page does not call Google Fonts or another font CDN.

## Sources and license

Both source fonts were downloaded from the official [Google Fonts repository](https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0) at commit `e7db6ca603fd4862010383ff17ffd6cc4ffac1c0` on 2026-10-23.

| Local family | Upstream source | Upstream weight axis | Subset weight axis |
| --- | --- | --- | --- |
| Tessmora Sans | [NotoSansSC[wght].ttf](https://github.com/google/fonts/blob/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf) | 100–900 | 400–650 |
| Tessmora Serif | [NotoSerifSC[wght].ttf](https://github.com/google/fonts/blob/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf) | 200–900 | 400–700 |

The fonts remain licensed under the **SIL Open Font License 1.1**. The upstream license texts are distributed beside them as [OFL-NotoSansSC.txt](../frontend/public/architecture/fonts/OFL-NotoSansSC.txt) and [OFL-NotoSerifSC.txt](../frontend/public/architecture/fonts/OFL-NotoSerifSC.txt); only trailing whitespace was removed. Original copyright, trademark and license metadata remain embedded. Internal family, full and PostScript names were changed from Noto to Tessmora to identify these modified subsets. Tessmora does not claim authorship of the typefaces.

## Coverage and loading

The build collected every printable Unicode character in these sources, including comments and code strings, plus all printable ASCII (`U+0020–U+007E`):

- `frontend/src/pages/ArchitecturePage.tsx`
- `frontend/src/components/architecture/*.tsx` and `*.ts`
- `frontend/src/data/architecture*.ts`

The exact input file list, SHA-256 digests, output sizes and axis limits are recorded in [manifest.json](../frontend/public/architecture/fonts/manifest.json). [subset-unicodes.txt](../frontend/public/architecture/fonts/subset-unicodes.txt) records the requested Unicode codepoints. Both fonts cover all **967 codepoints**, including Chinese copy, Latin letters, digits, punctuation, Greek symbols and arrows used by these sources. OpenType layout closure retains 1,346 glyphs per font, including alternate glyphs.

These are deliberately page-specific fonts, not a complete Chinese-language character set. New copy outside this set uses the CSS fallback stack until the subsets are regenerated. The CSS declarations use `font-display: swap`, so the page remains readable during loading. Ordinary `font-weight` values interpolate the real variable outlines; no synthetic bold is needed for the declared ranges.

| Asset | Bytes | KiB |
| --- | ---: | ---: |
| `tessmora-sans-sc.woff2` | 258,168 | 252.1 |
| `tessmora-serif-sc.woff2` | 352,480 | 344.2 |
| **Total font transfer** | **610,648** | **596.3** |

## Rebuilding the subsets

Use an isolated temporary Python environment; this tooling is not a project runtime dependency. The original build used Python 3.14, FontTools 4.67.0 and Brotli 1.2.1.

1. Download the two source TTFs from the pinned URLs above and the two neighboring `OFL.txt` files. Verify source SHA-256 values against the manifest.
2. Collect the printable codepoints from the source paths above, together with `range(0x20, 0x7f)`. Check that every requested character exists in each source font's `getBestCmap()`.
3. Subset with `fontTools.subset.Subsetter`, setting `layout_features = ['*']`, `name_IDs = ['*']`, `name_legacy = True` and `name_languages = ['*']`. Populate with the collected Unicode integers. This preserves layout closure and source attribution.
4. Limit the variable weight axis with `fontTools.varLib.instancer.instantiateVariableFont(font, {'wght': (400, 400, maximum)}, inplace=True, updateFontNames=True)`, where `maximum` is 650 for Sans or 700 for Serif. The middle value is the new default, 400.
5. Rename Noto family strings to Tessmora in name records 1, 3, 4, 6, 16, 21 and 25; retain copyright and license records. Use `TessmoraSans` / `TessmoraSerif` for names without spaces. Set `font.flavor = 'woff2'` and save.
6. Reopen the output, confirm full requested-codepoint coverage, confirm the `fvar` weight limits and default, and confirm `glyf` / `gvar` tables. Update the manifest and Unicode inventory. Recheck rendered Chinese and English page layouts when applying the fonts.

The CSS in `architectureFonts.css` must advertise the actual subset axis ranges. A full-family download or a second static copy for each weight is unnecessary for this page.

## Validation

Both saved WOFF2 files were reopened successfully with FontTools. Their requested glyph coverage is complete, their internal family names match the CSS, their weight axes match the advertised ranges, and their retained variation tables support interpolation. Source and output hashes are in the manifest. This asset-level validation does not replace browser layout and font-loading acceptance.
