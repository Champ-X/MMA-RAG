import type { CitationReference } from '@/types/sse'

export interface DocumentCitationLocation { kbId: string; fileId: string; page: number; endPage: number }
const positivePage = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const identity = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length < 2048 && !/[\x00-\x1f]/.test(value)

/** Physical PDF pages only. Attachment and Pi originals keep their existing owner-checked routes. */
export function documentCitationLocation(reference: CitationReference): DocumentCitationLocation | null {
  if (reference.type !== 'doc' || reference.source === 'attachment' || reference.pi_run_id) return null
  if (!/\.pdf$/i.test(reference.file_name || '') && !/\.pdf$/i.test(reference.file_path || '')) return null
  const metadata = reference.metadata
  const page = reference.page_number ?? metadata?.page_number ?? metadata?.page ?? reference.debug_info?.page_number
  const endPage = reference.page_end ?? metadata?.page_end ?? reference.debug_info?.page_end
  const kbId = reference.kb_id ?? metadata?.kb_id ?? reference.debug_info?.kb_id
  const fileId = reference.file_id ?? metadata?.file_id ?? reference.debug_info?.file_id
  if (!positivePage(page) || !identity(kbId) || !identity(fileId)) return null
  return { kbId, fileId, page, endPage: positivePage(endPage) && endPage >= page ? endPage : page }
}

export function documentCitationUrl(location: DocumentCitationLocation, apiBase = '/api'): string {
  return `${apiBase.replace(/\/$/, '')}/knowledge/${encodeURIComponent(location.kbId)}/files/${encodeURIComponent(location.fileId)}/stream#page=${location.page}`
}
