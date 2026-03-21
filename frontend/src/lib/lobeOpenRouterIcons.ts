/**
 * OpenRouter 模型 id（org/model）→ [Lobe Icons](https://lobehub.com/zh/icons) 静态资源（unpkg）
 *
 * Lobe 的 `light/*.png` 不少是单色线稿；同 slug 的 `{slug}-color.svg` 往往是彩色，故默认 **先 SVG 彩色再 PNG**。
 * 对确认不存在 `-color.svg` 的 slug 则直接 PNG，避免列表里大量 404。
 * 见：https://github.com/lobehub/lobe-icons
 */

export const LOBE_ICONS_PKG_VERSION = '1.82.0'

export const LOBE_ICONS_PNG_LIGHT_BASE = `https://unpkg.com/@lobehub/icons-static-png@${LOBE_ICONS_PKG_VERSION}/light`

export const LOBE_ICONS_PNG_DARK_BASE = `https://unpkg.com/@lobehub/icons-static-png@${LOBE_ICONS_PKG_VERSION}/dark`

export const LOBE_ICONS_SVG_BASE = `https://unpkg.com/@lobehub/icons-static-svg@${LOBE_ICONS_PKG_VERSION}/icons`

/**
 * OpenRouter id 第一段（小写）→ Lobe 资源文件名（不含扩展名）。
 * 值为 `huggingface` 表示库中无独立品牌图，需在解析时先尝试 org 自身变体（如 aion-labs → aionlabs）。
 */
export const OPENROUTER_ORG_TO_LOBE_SLUG: Record<string, string> = {
  'meta-llama': 'meta',
  mistralai: 'mistral',
  moonshotai: 'moonshot',
  'z-ai': 'zhipu',
  'x-ai': 'xai',
  amazon: 'aws',
  'ibm-granite': 'ibm',
  'arcee-ai': 'arcee',
  'stepfun-ai': 'stepfun',
  'bytedance-seed': 'bytedance',
  cognitivecomputations: 'huggingface',
  eleutherai: 'huggingface',
  sao10k: 'huggingface',
  alpindale: 'huggingface',
  undi95: 'huggingface',
  thedrummer: 'huggingface',
  gryphe: 'huggingface',
  alfredpros: 'huggingface',
  'nex-agi': 'huggingface',
  switchpoint: 'huggingface',
  tngtech: 'huggingface',
  'prime-intellect': 'huggingface',
  'aion-labs': 'huggingface',
  allenai: 'huggingface',
  'anthracite-org': 'huggingface',
  mancer: 'huggingface',
  writer: 'huggingface',
  relace: 'huggingface',
  morph: 'huggingface',
  kwaipilot: 'huggingface',
  inflection: 'huggingface',
  essentialai: 'essentialai',
  deepcogito: 'deepcogito',
  upstage: 'upstage',
  meituan: 'openrouter',
  xiaomi: 'openrouter',
  '01-ai': 'openrouter',
  thudm: 'huggingface',
}

/**
 * 这些 slug 在 `@lobehub/icons-static-svg` 下无 `{slug}-color.svg`（unpkg 404），勿先请求以免浪费与闪烁。
 * 若 Lobe 后续补齐，可从集合中移除。
 */
const SLUGS_NO_COLOR_SVG = new Set([
  'openai',
  'anthropic',
  'tongyi',
  'groq',
  'ai21',
  'ai21labs',
  'elevenlabs',
  'openrouter',
  'ibm',
])

function uniqueStrings(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    if (!seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  return out
}

function urlsForSlug(slug: string): string[] {
  const pngLight = `${LOBE_ICONS_PNG_LIGHT_BASE}/${slug}.png`
  const pngDark = `${LOBE_ICONS_PNG_DARK_BASE}/${slug}.png`
  const colorSvg = `${LOBE_ICONS_SVG_BASE}/${slug}-color.svg`
  const monoSvg = `${LOBE_ICONS_SVG_BASE}/${slug}.svg`

  if (SLUGS_NO_COLOR_SVG.has(slug)) {
    return uniqueStrings([pngLight, pngDark, monoSvg])
  }
  return uniqueStrings([colorSvg, pngLight, pngDark, monoSvg])
}

/**
 * 按 org 得到要尝试的 Lobe slug 顺序（先专用别名，再 org 变体，最后 huggingface 兜底）。
 */
function getBrandSlugsForOrg(org: string): string[] {
  const mapped = OPENROUTER_ORG_TO_LOBE_SLUG[org]
  const stripped = org.replace(/-/g, '')

  if (mapped) {
    if (mapped === 'huggingface') {
      return uniqueStrings(
        [stripped !== org ? stripped : null, org, 'huggingface'].filter((s): s is string => Boolean(s))
      )
    }
    return [mapped]
  }

  if (stripped !== org) {
    return uniqueStrings([stripped, org])
  }
  return [org]
}

/** 按顺序尝试加载，img 的 onError 可递增下标切换下一 URL */
export function getOpenRouterIconUrlCandidates(modelId: string): string[] {
  const org = (modelId.split('/')[0] || '').trim().toLowerCase()
  if (!org) {
    return uniqueStrings([
      ...urlsForSlug('openrouter'),
      `${LOBE_ICONS_PNG_LIGHT_BASE}/openrouter.png`,
      `${LOBE_ICONS_SVG_BASE}/openrouter.svg`,
    ])
  }

  const slugs = getBrandSlugsForOrg(org)
  const chain: string[] = []
  for (const slug of slugs) {
    chain.push(...urlsForSlug(slug))
  }
  chain.push(`${LOBE_ICONS_PNG_LIGHT_BASE}/openrouter.png`, `${LOBE_ICONS_SVG_BASE}/openrouter.svg`)
  return uniqueStrings(chain)
}

/** 首选 URL */
export function getLobeIconUrlForOpenRouterModelId(modelId: string): string {
  const list = getOpenRouterIconUrlCandidates(modelId)
  return list[0] ?? `${LOBE_ICONS_PNG_LIGHT_BASE}/openrouter.png`
}

export function getOpenRouterFallbackIconUrl(): string {
  return `${LOBE_ICONS_PNG_LIGHT_BASE}/openrouter.png`
}
