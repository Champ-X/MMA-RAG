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

The authoritative mapping lives in:

- `frontend/src/lib/modelVendors.ts`
- `frontend/src/lib/lobeOpenRouterIcons.ts`

OpenRouter models are normally classified by their actual model vendor. Provider logos are used when the UI needs to represent the provider itself or when a more specific vendor asset is unavailable.

When adding or renaming an asset, update the TypeScript mapping in the same change. Prefer a transparent, tightly cropped PNG or SVG and verify both light and dark themes. Missing assets must degrade to the existing text/icon fallback rather than breaking model selection.
