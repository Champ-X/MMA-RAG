import type { Evidence } from '@/api/nexus'
import { locatorLabel } from './locatorLabel'

export type EvidenceMediaViewModel = {
  audioLabel: string
  contentLabel: string
  imageAlt: string
  videoLabel: string
  visualKindLabel: string
}

const modalityLabel = {
  audio: 'Audio evidence',
  image: 'Image evidence',
  table: 'Table visual evidence',
  text: 'Text evidence',
  video: 'Video evidence',
} satisfies Record<Evidence['modality'], string>

const normalize = (value: string | null | undefined, maxLength = 140) => {
  const normalized = (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized
}

export function buildEvidenceMediaViewModel(evidence: Evidence): EvidenceMediaViewModel {
  const kind = modalityLabel[evidence.modality] ?? 'Evidence media'
  const location = locatorLabel(evidence)
  const excerpt = normalize(evidence.text_content || evidence.searchable_text)
  const base = `${kind} from ${evidence.source_name} at ${location}`
  const withExcerpt = excerpt ? `${base}: ${excerpt}` : base

  return {
    audioLabel: withExcerpt,
    contentLabel: `${kind} content from ${evidence.source_name}`,
    imageAlt: withExcerpt,
    videoLabel: withExcerpt,
    visualKindLabel: evidence.modality === 'table' ? 'Table visual' : 'Image evidence',
  }
}
