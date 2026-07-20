export type Brand = {
  name: string
  logo: string
  color: string
}

const brands: Record<string, Brand> = {
  siliconflow: { name: 'SiliconFlow', logo: '/vendor-logos/siliconcloud.png', color: '#5d5fef' },
  openrouter: { name: 'OpenRouter', logo: '/vendor-logos/openrouter.png', color: '#111827' },
  deepseek: { name: 'DeepSeek', logo: '/vendor-logos/deepseek.png', color: '#4d6bfe' },
  aliyun: { name: 'Aliyun Bailian', logo: '/vendor-logos/bailian.png', color: '#ff6a00' },
  qwen: { name: 'Qwen', logo: '/vendor-logos/qwen.png', color: '#615ced' },
  minimax: { name: 'MiniMax', logo: '/vendor-logos/minimax.png', color: '#f04b4b' },
  moonshot: { name: 'Moonshot', logo: '/vendor-logos/moonshot.png', color: '#111827' },
  zai: { name: 'ZAI', logo: '/vendor-logos/zai.png', color: '#2457f5' },
  openai: { name: 'OpenAI', logo: '/vendor-logos/chatgpt.png', color: '#10a37f' },
  google: { name: 'Google', logo: '/vendor-logos/gemini.png', color: '#4285f4' },
  anthropic: { name: 'Anthropic', logo: '/vendor-logos/anthropic.svg', color: '#d97757' },
}

export function providerBrand(name: string, endpoint = ''): Brand {
  const value = `${name} ${endpoint}`.toLowerCase()
  if (value.includes('silicon')) return brands.siliconflow
  if (value.includes('openrouter')) return brands.openrouter
  if (value.includes('deepseek')) return brands.deepseek
  if (value.includes('aliyun') || value.includes('dashscope') || value.includes('bailian')) return brands.aliyun
  return { name, logo: '/favicon.svg', color: '#596579' }
}

export function modelBrand(modelId: string, fallback: Brand): Brand {
  const value = modelId.toLowerCase()
  if (value.includes('qwen')) return brands.qwen
  if (value.includes('deepseek')) return brands.deepseek
  if (value.includes('minimax')) return brands.minimax
  if (value.includes('moonshot') || value.includes('kimi')) return brands.moonshot
  if (value.includes('zai') || value.includes('glm')) return brands.zai
  if (value.includes('openai') || value.includes('gpt-')) return brands.openai
  if (value.includes('gemini') || value.includes('google/')) return brands.google
  if (value.includes('claude') || value.includes('anthropic')) return brands.anthropic
  return fallback
}
