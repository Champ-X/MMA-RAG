import type { Evidence } from '@/api/nexus'
import {
  buildEvidenceReceiptViewModel,
  type EvidenceReceiptFacet,
  type EvidenceReceiptViewModel,
} from '@/components/nexus/evidenceReceiptViewModel'
import { locatorLabel } from '@/components/nexus/locatorLabel'

export type EvidenceLocatorEntry = {
  key: string
  label: string
  value: string
}

export type EvidenceContextItem = {
  active: boolean
  excerpt: string
  id: string
  label: string
}

export type EvidenceDetailViewModel = {
  contextItems: EvidenceContextItem[]
  custodySignals: Array<{ label: string; value: string }>
  evidenceTypeLabel: string
  hasDerivedVisual: boolean
  locatorEntries: EvidenceLocatorEntry[]
  locatorSummary: string
  modalityLabel: string
  primaryMaterialLabel: string
  qualityFlags: string[]
  trustState: {
    label: string
    tone: 'clean' | 'attention'
    detail: string
  }
  visualEvidence: boolean
}

export type EvidenceReceiptLinkFacet = EvidenceReceiptFacet

export type EvidenceReceiptLinkViewModel = EvidenceReceiptViewModel

const modalityLabels: Record<Evidence['modality'], string> = {
  audio: 'Audio evidence',
  image: 'Image evidence',
  table: 'Table evidence',
  text: 'Text evidence',
  video: 'Video evidence',
}

export function buildEvidenceDetailViewModel(
  evidence: Evidence,
  contextItems: Evidence[] = [],
): EvidenceDetailViewModel {
  const hasDerivedVisual = Boolean(evidence.locator.extra?.object_key)
    && evidence.evidence_type !== 'whole_image'
    && evidence.locator.extra?.scope !== 'whole_image'
  const visualEvidence = evidence.modality === 'image' || hasDerivedVisual
  const qualityFlags = evidence.quality_flags.map(formatLabel)

  return {
    contextItems: contextItems.map((item) => ({
      active: item.id === evidence.id,
      excerpt: item.text_content.slice(0, 150) || 'No extracted text for this adjacent span.',
      id: item.id,
      label: formatLabel(item.evidence_type),
    })),
    custodySignals: [
      { label: 'Revision', value: evidence.id.slice(0, 8) },
      { label: 'Source version', value: evidence.source_version_id.slice(0, 8) },
      { label: 'Status', value: evidence.status },
      { label: 'Visible sequence', value: String(evidence.visible_from_sequence) },
    ],
    evidenceTypeLabel: formatLabel(evidence.evidence_type),
    hasDerivedVisual,
    locatorEntries: buildLocatorEntries(evidence),
    locatorSummary: locatorLabel(evidence),
    modalityLabel: modalityLabels[evidence.modality],
    primaryMaterialLabel: visualEvidence
      ? 'Original visual material'
      : evidence.modality === 'audio'
        ? 'Original audio material'
        : evidence.modality === 'video'
          ? 'Original video material'
          : 'Original source asset',
    qualityFlags,
    trustState: qualityFlags.length
      ? {
          label: 'Needs review',
          tone: 'attention',
          detail: `${qualityFlags.length} parser signal${qualityFlags.length > 1 ? 's' : ''} attached to this Evidence revision.`,
        }
      : {
          label: 'Clean locator',
          tone: 'clean',
          detail: 'No parser quality flags are attached to this Evidence revision.',
        },
    visualEvidence,
  }
}

export function buildEvidenceReceiptLinkViewModel({
  evidence,
  origin,
  pathname,
}: {
  evidence: Evidence
  origin: string
  pathname: string
}): EvidenceReceiptLinkViewModel {
  return buildEvidenceReceiptViewModel({ evidence, origin, path: pathname })
}

function buildLocatorEntries(evidence: Evidence): EvidenceLocatorEntry[] {
  return Object.entries(evidence.locator)
    .filter(([, value]) => value !== null && value !== undefined && (typeof value !== 'object' || Object.keys(value).length))
    .map(([key, value]) => ({
      key,
      label: formatLabel(key),
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }))
}

function formatLabel(value: string) {
  return value.replaceAll('_', ' ')
}
