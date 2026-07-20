import type { Evidence } from '@/api/nexus'

export const locatorLabel = (evidence: Evidence) => {
  const locator = evidence.locator
  if (evidence.modality === 'image') {
    const extra = locator.extra as Record<string, unknown>
    if (evidence.evidence_type === 'whole_image' || extra.scope === 'whole_image') {
      const dimensions = extra.width && extra.height ? ` · ${extra.width}×${extra.height}px` : ''
      return `whole image${dimensions}`
    }
    if (locator.page_no) return `page ${locator.page_no} · figure`
    if (locator.bbox?.length === 4) return `figure bounds · ${locator.bbox.map(Math.round).join(', ')}`
  }
  if (locator.page_no) return `page ${locator.page_no}`
  if (locator.start_ms !== null && locator.start_ms !== undefined) {
    return `${Math.floor(locator.start_ms / 1000)}s–${Math.floor((locator.end_ms ?? locator.start_ms) / 1000)}s`
  }
  if (locator.sheet) return `${locator.sheet} · ${locator.cell_range ?? 'range'}`
  if (locator.char_start !== null && locator.char_start !== undefined) {
    return `chars ${locator.char_start}–${locator.char_end ?? '…'}`
  }
  return locator.locator_type
}
