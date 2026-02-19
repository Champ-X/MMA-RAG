/**
 * 对话模型按厂商分组展示
 * 厂商顺序：Qwen、DeepSeek、MiniMax、Moonshot、ZAI、Gemini、OpenAI、其他
 * 注意：OpenRouter 和 AliyunBailian 是提供商，不是厂商，它们提供的模型按实际厂商分类
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

/** 根据模型 ID 解析所属厂商
 * OpenRouter 和 AliyunBailian 是提供商，需要提取实际模型名来判断厂商
 */
export function getModelVendor(modelId: string): VendorKey {
  let id = modelId.trim()
  
  // 提取实际模型名（移除提供商前缀）
  if (id.startsWith('openrouter:')) {
    // openrouter:google/gemini-3-flash-preview -> google/gemini-3-flash-preview
    id = id.substring('openrouter:'.length)
  } else if (id.startsWith('aliyun_bailian:')) {
    // aliyun_bailian:qwen3.5-plus -> qwen3.5-plus
    id = id.substring('aliyun_bailian:'.length)
  }
  
  // Gemini 模型（Google）
  if (id.includes('google/gemini') || id.includes('gemini-') || id.includes('gemini')) {
    return 'Gemini'
  }
  
  // OpenAI/ChatGPT 模型
  if (id.startsWith('openai/') || id.includes('gpt-') || id.includes('chatgpt') || id.includes('claude')) {
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
