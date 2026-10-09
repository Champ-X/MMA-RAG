# Vendor and provider logos

This directory currently contains:

| File | Display role |
|---|---|
| `anthropic.svg` | Anthropic / Claude |
| `chatgpt.png` | OpenAI / GPT |
| `gemini.png` | Google / Gemini |
| `qwen.png` | Qwen |
| `deepseek.png` | DeepSeek |
| `minimax.png` | MiniMax |
| `moonshot.png` | Moonshot |
| `zai.png`, `zhipu.png` | Z.AI / Zhipu assets |
| `openrouter.png` | OpenRouter provider fallback |
| `bailian.png` | Aliyun Bailian provider fallback |
| `siliconcloud.png` | SiliconFlow provider fallback |
| `openai.svg`, `openrouter.svg` | OpenAI and OpenRouter monochrome marks |
| `typesafe.png` | TypeSafe / Jev official favicon |
| `inception.svg`, `perplexity.svg`, `liquid.svg` | Decision model brands |
| `cloudflare.svg`, `together.svg`, `upstage.svg` | Decision model brands |
| `together-dark.svg` | Together mark adapted for dark surfaces |

The authoritative mapping lives in:

- `frontend/src/lib/modelVendors.ts`
- `frontend/src/lib/lobeOpenRouterIcons.ts`
- `frontend/src/components/settings/BrandIcon.tsx` (settings provider / Decision model marks)

OpenRouter models are normally classified by their actual model vendor. Provider logos are used when the UI needs to represent the provider itself or when a more specific vendor asset is unavailable.

When adding or renaming an asset, update the TypeScript mapping in the same change. Prefer a transparent, tightly cropped PNG or SVG and verify both light and dark themes. Missing assets must degrade to the existing text/icon fallback rather than breaking model selection.

## Sources for the settings brand marks

The SVG additions above, except `together-dark.svg`, are copied unchanged from [Lobe Icons](https://github.com/lobehub/lobe-icons), package `@lobehub/icons-static-svg@1.82.0` ([MIT license](https://github.com/lobehub/lobe-icons/blob/master/LICENSE)). The original assets are available under `https://unpkg.com/@lobehub/icons-static-svg@1.82.0/icons/`: `openai.svg`, `openrouter.svg`, `inception.svg`, `perplexity-color.svg`, `liquid.svg`, `cloudflare-color.svg`, `together-color.svg`, and `upstage-color.svg`.

`together-dark.svg` adapts that package's `together-color.svg` for dark surfaces: the three neutral dots use white at 40% opacity instead of black at 20%; the geometry and blue `#0F6FFF` brand dot are unchanged. The light asset remains unchanged. The bundled `LICENSE.lobe-icons.txt` applies to both variants.

`typesafe.png` is the icon referenced by [TypeSafe's official website](https://typesafe.ai), downloaded from `https://framerusercontent.com/images/aNFzSFxM4fjICmnibw7npfZjcQ.png` on 2026-10-09. These marks identify the corresponding providers and models; trademark rights remain with their respective owners. Brands without a verified mark use a text monogram.
