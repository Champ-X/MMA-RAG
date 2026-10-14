export type ArchitectureMode = 'direct' | 'agent' | 'pi'

export const architectureModes = [
  { id: 'direct', name: 'Direct', label: '直接检索', summary: '一次取证，组织回答', family: '常规 RAG' },
  { id: 'agent', name: 'Agent', label: '有界补查', summary: '多轮搜索，合并证据', family: '常规 RAG' },
  { id: 'pi', name: 'Pi Agent', label: '自主研究', summary: '搜索、深读与工具协作', family: '独立 Agent' },
] as const

export const architectureSourceBase = 'https://github.com/Champ-X/MMA-RAG/blob/main/'
export const architectureReviewDate = '2026-10-13'

export function architectureSourceUrl(path: string) {
  return architectureSourceBase + path
}
