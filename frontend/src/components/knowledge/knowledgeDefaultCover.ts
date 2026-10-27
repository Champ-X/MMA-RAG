import type { KnowledgeBase } from '@/store/useKnowledgeStore'

const MATERIAL_KINDS = ['documents', 'images', 'audio', 'video'] as const

/** Match the fallback artwork to uploaded materials; chunks are derived data. */
export function getKnowledgeDefaultCover(stats?: Partial<NonNullable<KnowledgeBase['stats']>>): string {
  const present = MATERIAL_KINDS.filter(kind => (stats?.[kind] ?? 0) > 0)
  const theme = present.length > 1 ? 'multimodal' : present[0] ?? 'collection'
  return `/knowledge/covers-v2/${theme}.webp`
}
