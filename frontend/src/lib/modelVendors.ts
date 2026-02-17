/**
 * 对话模型按厂商分组展示
 * 厂商顺序：Qwen、DeepSeek、MiniMax、Moonshot、ZAI、其他
 */

export const VENDOR_ORDER = ['Qwen', 'DeepSeek', 'MiniMax', 'Moonshot', 'ZAI', '其他'] as const
export type VendorKey = (typeof VENDOR_ORDER)[number]

/** 厂商在 UI 中的显示名（保持首字母大小写，不大写） */
export const VENDOR_DISPLAY_NAMES: Record<VendorKey, string> = {
  Qwen: 'Qwen',
  DeepSeek: 'DeepSeek',
  MiniMax: 'MiniMax',
  Moonshot: 'Moonshot',
  ZAI: 'ZAI',
  其他: '其他',
}

/** 厂商 logo 路径（public/vendor-logos 下），无 logo 的厂商为 undefined */
export const VENDOR_LOGOS: Partial<Record<VendorKey, string>> = {
  Qwen: '/vendor-logos/qwen.png',
  DeepSeek: '/vendor-logos/deepseek.png',
  MiniMax: '/vendor-logos/minimax.png',
  Moonshot: '/vendor-logos/moonshot.png',
  ZAI: '/vendor-logos/zai.png',
}

/** 根据模型 ID 解析所属厂商 */
export function getModelVendor(modelId: string): VendorKey {
  const id = modelId.trim()
  if (id.startsWith('Qwen/')) return 'Qwen'
  if (id.startsWith('Pro/deepseek-ai/') || id.startsWith('deepseek-ai/') || id === 'deepseek-chat' || id === 'deepseek-reasoner') return 'DeepSeek'
  if (id.startsWith('Pro/MiniMaxAI/')) return 'MiniMax'
  if (id.startsWith('Pro/moonshotai/') || id.startsWith('moonshotai/')) return 'Moonshot'
  if (id.startsWith('Pro/zai-org/') || id.startsWith('zai-org/')) return 'ZAI'
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
