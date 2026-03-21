/**
 * 对话模型按厂商分组展示
 * 厂商顺序：Qwen、DeepSeek、MiniMax、Moonshot、ZAI、Gemini、OpenAI、其他
 *
 * `openrouter:*` 一律归入「其他」：避免在 Gemini/ChatGPT 等直连卡上显示「当前使用」，
 * 实际选用状态只在 OpenRouter 区块展示（与聚合路由语义一致）。
 * AliyunBailian 仍按去前缀后的名称归厂商。
 */

export const VENDOR_ORDER = ['Qwen', 'DeepSeek', 'MiniMax', 'Moonshot', 'ZAI', 'Gemini', 'OpenAI', '其他'] as const
export type VendorKey = (typeof VENDOR_ORDER)[number]

/** 厂商在 UI 中的显示名（保持首字母大小写，不大写） */
export const VENDOR_DISPLAY_NAMES: Record<VendorKey, string> = {
  Qwen: 'Qwen',
  DeepSeek: 'DeepSeek',
  MiniMax: 'MiniMax',
  Moonshot: 'Moonshot',
  ZAI: 'ZAI',
  Gemini: 'Gemini',
  OpenAI: 'ChatGPT',
  其他: '其他',
}

/** 厂商 logo 路径（public/vendor-logos 下），无 logo 的厂商为 undefined */
export const VENDOR_LOGOS: Partial<Record<VendorKey, string>> = {
  Qwen: '/vendor-logos/qwen.png',
  DeepSeek: '/vendor-logos/deepseek.png',
  MiniMax: '/vendor-logos/minimax.png',
  Moonshot: '/vendor-logos/moonshot.png',
  ZAI: '/vendor-logos/zai.png',
  Gemini: '/vendor-logos/gemini.png',
  OpenAI: '/vendor-logos/chatgpt.png',
}

/** 根据模型 ID 解析所属厂商（用于直连厂商卡片分组与高亮） */
export function getModelVendor(modelId: string): VendorKey {
  const raw = modelId.trim()
  if (raw.startsWith('openrouter:')) {
    return '其他'
  }

  let id = raw
  if (id.startsWith('aliyun_bailian:')) {
    id = id.substring('aliyun_bailian:'.length)
  }

  // Gemini 模型（Google）
  if (id.includes('google/gemini') || id.includes('gemini-') || id.includes('gemini')) {
    return 'Gemini'
  }

  // Anthropic Claude：勿归入 ChatGPT（OpenRouter 下已整体进「其他」，此处兜底直连 id）
  if (id.startsWith('anthropic/') || id.includes('claude')) {
    return '其他'
  }

  // OpenAI/ChatGPT
  if (id.startsWith('openai/') || id.includes('gpt-') || id.includes('chatgpt')) {
    return 'OpenAI'
  }
  
  // Qwen 模型（包括通过 OpenRouter 和 AliyunBailian 提供的）
  if (id.startsWith('Qwen/') || id.startsWith('qwen/') || id.startsWith('qwen3') || id.startsWith('qwen-') || id.includes('qwen')) {
    return 'Qwen'
  }
  
  // DeepSeek 模型
  if (id.startsWith('Pro/deepseek-ai/') || id.startsWith('deepseek-ai/') || id === 'deepseek-chat' || id === 'deepseek-reasoner' || id.includes('deepseek')) {
    return 'DeepSeek'
  }
  
  // MiniMax 模型
  if (id.startsWith('Pro/MiniMaxAI/') || id.includes('minimax')) {
    return 'MiniMax'
  }
  
  // Moonshot 模型
  if (id.startsWith('Pro/moonshotai/') || id.startsWith('moonshotai/') || id.includes('kimi') || id.includes('moonshot')) {
    return 'Moonshot'
  }
  
  // ZAI 模型
  if (id.startsWith('Pro/zai-org/') || id.startsWith('zai-org/') || id.includes('glm') || id.includes('zai')) {
    return 'ZAI'
  }
  
  return '其他'
}

/** 将模型列表按厂商分组，返回 [厂商, 模型列表][]，顺序固定 */
export function groupChatModelsByVendor(models: string[]): [VendorKey, string[]][] {
  const map = new Map<VendorKey, string[]>()
  for (const key of VENDOR_ORDER) {
    map.set(key, [])
  }
  for (const m of models) {
    const vendor = getModelVendor(m)
    const list = map.get(vendor) ?? []
    list.push(m)
    map.set(vendor, list)
  }
  return VENDOR_ORDER.map(key => [key, map.get(key) ?? []] as [VendorKey, string[]]).filter(([, list]) => list.length > 0)
}

/** 供应商类型（提供商） */
export type ProviderKey = 'OpenRouter' | 'AliyunBailian' | 'SiliconFlow' | 'DeepSeek' | null

/** 供应商 logo 路径映射 */
export const PROVIDER_LOGOS: Record<Exclude<ProviderKey, null>, string> = {
  OpenRouter: '/vendor-logos/openrouter.png',
  AliyunBailian: '/vendor-logos/bailian.png',
  SiliconFlow: '/vendor-logos/siliconcloud.png',
  DeepSeek: '/vendor-logos/deepseek.png',
}

/**
 * 从模型名称中提取供应商（provider）信息
 * 首先检查是否有供应商前缀，如果没有则根据模型名称模式推断供应商
 */
export function getModelProvider(modelId: string): ProviderKey {
  const id = modelId.trim()
  
  // 1. 检查是否有供应商前缀
  if (id.startsWith('openrouter:')) {
    return 'OpenRouter'
  }
  if (id.startsWith('aliyun_bailian:')) {
    return 'AliyunBailian'
  }
  if (id.startsWith('siliconflow:') || id.startsWith('siliconcloud:')) {
    return 'SiliconFlow'
  }
  if (id.startsWith('deepseek:')) {
    return 'DeepSeek'
  }
  
  // 2. 如果没有前缀，根据模型名称模式推断供应商
  // DeepSeek 官方 API 直接提供的模型（provider 是 "deepseek"）
  if (id === 'deepseek-chat' || id === 'deepseek-reasoner') {
    return 'DeepSeek'
  }
  
  // SiliconFlow 提供的模型（provider 是 "siliconflow"）
  // 包括：Qwen 模型、通过 SiliconFlow 提供的 DeepSeek 模型、MiniMax、Moonshot、ZAI 等
  if (
    id.startsWith('Qwen/') ||
    id.startsWith('Pro/deepseek-ai/') ||
    id.startsWith('deepseek-ai/') ||
    id.startsWith('Pro/MiniMaxAI/') ||
    id.startsWith('Pro/moonshotai/') ||
    id.startsWith('moonshotai/') ||
    id.startsWith('Pro/zai-org/') ||
    id.startsWith('zai-org/')
  ) {
    return 'SiliconFlow'
  }
  
  return null
}
