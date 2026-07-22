export type ArtifactEvidenceItemInput = {
  evidence_revision_id?: string
  source?: string
  locator?: string | Record<string, unknown>
}

export type ArtifactEvidenceRegisterItem = {
  ariaLabel: string
  bound: boolean
  evidenceRevisionId?: string
  key: string
  locatorDetail: string
  locatorLabel: string
  shortRevisionId: string
  sourceLabel: string
}

export type ArtifactEvidenceRegister = {
  archivedItems: ArtifactEvidenceRegisterItem[]
  archiveSummary: string
  boundCount: number
  hiddenCount: number
  items: ArtifactEvidenceRegisterItem[]
  summary: string
  unboundCount: number
  visibleCount: number
  visibleItems: ArtifactEvidenceRegisterItem[]
}

const DEFAULT_VISIBLE_RECEIPT_LIMIT = 12
const DEFAULT_VISIBLE_BINDING_LIMIT = 8
const DEFAULT_ID_PREFIX_LENGTH = 8
const MIN_COLLISION_TAIL_LENGTH = 4
const MAX_COLLISION_TAIL_LENGTH = 12

export type ArtifactEvidenceBinding = {
  ariaLabel: string
  id: string
  label: string
  shortId: string
}

export type ArtifactEvidenceBindingStrip = {
  archivedItems: ArtifactEvidenceBinding[]
  hiddenCount: number
  items: ArtifactEvidenceBinding[]
  visibleItems: ArtifactEvidenceBinding[]
}

export type ArtifactInlineCitationReference = {
  ariaLabel: string
  evidenceRevisionId: string
  key: string
  label: string
  shortRevisionId: string
}

export type ArtifactInlineCitationText = {
  citationCount: number
  markdown: string
  rawMarkerCount: number
  references: ArtifactInlineCitationReference[]
}

const formatLabel = (value: string) => value
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null

const objectValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const evidenceIdPrefix = (id: string) => id.slice(0, Math.min(DEFAULT_ID_PREFIX_LENGTH, id.length))

const compactIdPart = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '')

const evidenceMarkerPattern = () => /\[evidence:([0-9a-f-]{36})\]/gi

const uniqueEvidenceIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)))

function compactIdTail(id: string, prefix: string, tailLength: number) {
  const compactRemainder = compactIdPart(id.slice(prefix.length))
  const compactFullId = compactIdPart(id)
  const source = compactRemainder || compactFullId || id
  return source.length <= tailLength ? source : source.slice(-tailLength)
}

function collidingEvidenceLabels(ids: string[], prefix: string, tailLength: number) {
  return ids.map((id) => `${prefix}/${compactIdTail(id, prefix, tailLength)}`)
}

function buildEvidenceRevisionLabels(ids: string[]) {
  const labels = new Map<string, string>()
  const groups = new Map<string, string[]>()
  Array.from(new Set(ids.filter(Boolean))).forEach((id) => {
    const prefix = evidenceIdPrefix(id)
    const currentGroup = groups.get(prefix) ?? []
    groups.set(prefix, [...currentGroup, id])
  })

  groups.forEach((group, prefix) => {
    if (group.length === 1) {
      labels.set(group[0], prefix)
      return
    }

    let tailLength = MIN_COLLISION_TAIL_LENGTH
    let candidateLabels = collidingEvidenceLabels(group, prefix, tailLength)
    while (new Set(candidateLabels).size < group.length && tailLength < MAX_COLLISION_TAIL_LENGTH) {
      tailLength += 2
      candidateLabels = collidingEvidenceLabels(group, prefix, tailLength)
    }

    const collisionCounts = new Map<string, number>()
    group.forEach((id, index) => {
      const candidate = candidateLabels[index]
      const seenCount = collisionCounts.get(candidate) ?? 0
      collisionCounts.set(candidate, seenCount + 1)
      labels.set(id, seenCount ? `${candidate}.${seenCount + 1}` : candidate)
    })
  })

  return labels
}

function evidenceMarkerIds(text: string) {
  return Array.from(text.matchAll(evidenceMarkerPattern()), (match) => match[1])
}

function buildArtifactInlineCitationReferences(ids: string[]): ArtifactInlineCitationReference[] {
  const uniqueIds = uniqueEvidenceIds(ids)
  const revisionLabels = buildEvidenceRevisionLabels(uniqueIds)
  return uniqueIds.map((id, index) => {
    const label = `E${index + 1}`
    const shortRevisionId = revisionLabels.get(id) ?? evidenceIdPrefix(id)
    return {
      ariaLabel: `Open Evidence reference ${label}, revision ${shortRevisionId}.`,
      evidenceRevisionId: id,
      key: id,
      label,
      shortRevisionId,
    }
  })
}

export function buildArtifactInlineCitationText(
  text = '',
  evidenceRevisionIds: string[] = [],
): ArtifactInlineCitationText {
  const markerIds = evidenceMarkerIds(text)
  const references = buildArtifactInlineCitationReferences([...markerIds, ...evidenceRevisionIds])
  const referenceById = new Map(references.map((reference) => [
    reference.evidenceRevisionId.toLowerCase(),
    reference,
  ]))
  const markdown = text.replace(evidenceMarkerPattern(), (_match, id: string) => {
    const reference = referenceById.get(id.toLowerCase())
    return reference ? `[${reference.label}](#artifact-evidence-${reference.evidenceRevisionId})` : ''
  })

  return {
    citationCount: markerIds.length,
    markdown,
    rawMarkerCount: markerIds.length,
    references,
  }
}

const formatMs = (value: number) => `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}s`

const formatBbox = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 4) return null
  const numbers = value.slice(0, 4).map(numberValue)
  if (numbers.some((item) => item === null)) return null
  return `Bounding box ${numbers.map((item) => Math.round(item ?? 0)).join(', ')}`
}

function locatorSource(locator: Record<string, unknown> | null) {
  const extra = objectValue(locator?.extra)
  return stringValue(extra?.filename) ?? undefined
}

function summarizeLocator(locator: string | Record<string, unknown> | undefined): {
  detail: string
  label: string
  sourceFallback?: string
} {
  if (!locator) return { detail: 'Open exact locator', label: 'Locator' }
  if (typeof locator === 'string') return { detail: locator, label: 'Locator' }

  const locatorType = stringValue(locator.locator_type) ?? 'locator'
  const sourceFallback = locatorSource(locator)
  const pageNo = numberValue(locator.page_no)
  const charStart = numberValue(locator.char_start)
  const charEnd = numberValue(locator.char_end)
  const startMs = numberValue(locator.start_ms)
  const endMs = numberValue(locator.end_ms)
  const sheet = stringValue(locator.sheet)
  const cellRange = stringValue(locator.cell_range)
  const bbox = formatBbox(locator.bbox)
  const extra = objectValue(locator.extra)
  const width = numberValue(extra?.width)
  const height = numberValue(extra?.height)

  if (locatorType === 'text_range') {
    return {
      detail: charStart !== null && charEnd !== null
        ? `Characters ${charStart}-${charEnd}`
        : 'Text span in source',
      label: 'Text span',
      sourceFallback,
    }
  }

  if (locatorType === 'page_region') {
    return {
      detail: [pageNo !== null ? `Page ${pageNo}` : null, bbox].filter(Boolean).join(' · ') || 'Page region',
      label: 'Page region',
      sourceFallback,
    }
  }

  if (locatorType === 'cell_range') {
    return {
      detail: [sheet ?? 'Sheet', cellRange].filter(Boolean).join(' · '),
      label: 'Table cells',
      sourceFallback,
    }
  }

  if (locatorType === 'time_range') {
    return {
      detail: startMs !== null && endMs !== null
        ? `${formatMs(startMs)}-${formatMs(endMs)}`
        : 'Timed media segment',
      label: 'Media segment',
      sourceFallback,
    }
  }

  if (locatorType === 'image') {
    return {
      detail: width !== null && height !== null ? `Original image · ${width}x${height}` : 'Original image',
      label: 'Image asset',
      sourceFallback,
    }
  }

  if (locatorType === 'document_asset') {
    return {
      detail: 'Original document asset',
      label: 'Document asset',
      sourceFallback,
    }
  }

  return {
    detail: [pageNo !== null ? `Page ${pageNo}` : null, cellRange, bbox].filter(Boolean).join(' · ') || 'Open exact locator',
    label: formatLabel(locatorType),
    sourceFallback,
  }
}

export function buildArtifactEvidenceRegister(
  items: ArtifactEvidenceItemInput[] = [],
  visibleLimit = DEFAULT_VISIBLE_RECEIPT_LIMIT,
): ArtifactEvidenceRegister {
  const dedupedItems: ArtifactEvidenceItemInput[] = []
  const itemIndexByRevision = new Map<string, number>()
  items.forEach((item) => {
    if (!item.evidence_revision_id) {
      dedupedItems.push(item)
      return
    }
    const existingIndex = itemIndexByRevision.get(item.evidence_revision_id)
    if (existingIndex === undefined) {
      itemIndexByRevision.set(item.evidence_revision_id, dedupedItems.length)
      dedupedItems.push(item)
      return
    }
    if (!dedupedItems[existingIndex].locator && item.locator) {
      dedupedItems[existingIndex] = item
    }
  })

  const revisionLabels = buildEvidenceRevisionLabels(dedupedItems.flatMap((item) =>
    item.evidence_revision_id ? [item.evidence_revision_id] : [],
  ))

  const presented = dedupedItems.map((item, index) => {
    const locator = summarizeLocator(item.locator)
    const evidenceRevisionId = item.evidence_revision_id
    const sourceLabel = item.source || locator.sourceFallback || 'Evidence source'
    const shortRevisionId = evidenceRevisionId
      ? revisionLabels.get(evidenceRevisionId) ?? evidenceIdPrefix(evidenceRevisionId)
      : 'unbound'
    const bound = Boolean(evidenceRevisionId)
    return {
      ariaLabel: bound
        ? `${sourceLabel}. ${locator.label}. ${locator.detail}. Evidence ${shortRevisionId}.`
        : `${sourceLabel}. Unbound evidence reference.`,
      bound,
      evidenceRevisionId,
      key: evidenceRevisionId ?? `unbound-${index}`,
      locatorDetail: locator.detail,
      locatorLabel: locator.label,
      shortRevisionId,
      sourceLabel,
    }
  })
  const boundCount = presented.filter((item) => item.bound).length
  const unboundCount = presented.length - boundCount
  const safeVisibleLimit = Math.max(0, visibleLimit)
  const visibleItems = presented.slice(0, safeVisibleLimit)
  const archivedItems = presented.slice(safeVisibleLimit)
  const hiddenCount = archivedItems.length
  return {
    archivedItems,
    archiveSummary: hiddenCount
      ? `${hiddenCount} additional receipt${hiddenCount === 1 ? '' : 's'} are archived behind this review fold.`
      : 'All source receipts are visible.',
    boundCount,
    hiddenCount,
    items: presented,
    summary: boundCount
      ? `${boundCount} unique source receipt${boundCount === 1 ? ' preserves' : 's preserve'} exact locator context for audit.`
      : 'No bound Evidence receipts are attached to this Artifact block.',
    unboundCount,
    visibleCount: visibleItems.length,
    visibleItems,
  }
}

export function buildArtifactEvidenceBindingStrip(
  ids: string[] = [],
  visibleLimit = DEFAULT_VISIBLE_BINDING_LIMIT,
): ArtifactEvidenceBindingStrip {
  const uniqueIds = uniqueEvidenceIds(ids)
  const revisionLabels = buildEvidenceRevisionLabels(uniqueIds)
  const items = uniqueIds.map((id) => {
    const shortId = revisionLabels.get(id) ?? evidenceIdPrefix(id)
    return {
      ariaLabel: `Open Evidence revision ${shortId}.`,
      id,
      label: `Evidence ${shortId}`,
      shortId,
    }
  })
  const safeVisibleLimit = Math.max(0, visibleLimit)
  const visibleItems = items.slice(0, safeVisibleLimit)
  const archivedItems = items.slice(safeVisibleLimit)
  return {
    archivedItems,
    hiddenCount: archivedItems.length,
    items,
    visibleItems,
  }
}
