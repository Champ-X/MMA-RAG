import type { Space } from '@/api/nexus'

export type SpaceProfile = Space['knowledge_profile']
export type RetrievalQuality = Space['default_quality']
export type RunKind = Space['policy']['recommended_run_kind']

export type SpacePolicyTemplate = {
  profile: SpaceProfile
  label: string
  summary: string
  defaultQuality: RetrievalQuality
  recommendedKind: RunKind
  routing: 'Automatic routing' | 'Manual scope only'
  behaviors: string[]
  accent: 'cobalt' | 'violet' | 'teal' | 'amber'
}

export const spacePolicyTemplates: SpacePolicyTemplate[] = [
  {
    profile: 'searchable',
    label: 'Balanced search',
    summary: 'A dependable default for everyday questions across text and structured material.',
    defaultQuality: 'quality',
    recommendedKind: 'quick',
    routing: 'Automatic routing',
    behaviors: ['Hybrid retrieval', 'Quick answers', 'Broad evidence'],
    accent: 'cobalt',
  },
  {
    profile: 'multimodal',
    label: 'Multimodal discovery',
    summary: 'Favor this Space when the question asks for figures, audio, video or visual proof.',
    defaultQuality: 'quality',
    recommendedKind: 'quick',
    routing: 'Automatic routing',
    behaviors: ['Media intent boost', 'Native media routes', 'Quick answers'],
    accent: 'teal',
  },
  {
    profile: 'research',
    label: 'Deep research',
    summary: 'Start planned, iterative research with stronger verification and reusable Artifacts.',
    defaultQuality: 'deep',
    recommendedKind: 'research',
    routing: 'Automatic routing',
    behaviors: ['Research intent boost', 'Deep retrieval', 'Artifact delivery'],
    accent: 'violet',
  },
  {
    profile: 'archive',
    label: 'Reference archive',
    summary: 'Keep historical evidence available for explicit lookup without automatic routing.',
    defaultQuality: 'fast',
    recommendedKind: 'quick',
    routing: 'Manual scope only',
    behaviors: ['Explicit lookup', 'Fast retrieval', 'Originals preserved'],
    accent: 'amber',
  },
]

export function getSpacePolicyTemplate(profile: SpaceProfile) {
  return spacePolicyTemplates.find((template) => template.profile === profile) ?? spacePolicyTemplates[0]
}

export function recommendSpaceSelection(spaces: Space[]): {
  kind: RunKind
  quality: RetrievalQuality
  labels: string[]
} {
  if (!spaces.length) return { kind: 'quick', quality: 'quality', labels: [] }
  const qualityRank: Record<RetrievalQuality, number> = { fast: 0, quality: 1, deep: 2 }
  const kind: RunKind = spaces.some((space) => space.policy.recommended_run_kind === 'research')
    ? 'research'
    : 'quick'
  const quality = kind === 'research'
    ? 'deep'
    : spaces.map((space) => space.policy.default_quality)
      .sort((left, right) => qualityRank[right] - qualityRank[left])[0]
  return {
    kind,
    quality,
    labels: [...new Set(spaces.map((space) => space.policy.label))],
  }
}
