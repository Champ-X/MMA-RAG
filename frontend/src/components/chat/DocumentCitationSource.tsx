import { ArrowUpRight, FileText } from 'lucide-react'
import { translate as tr, useTranslation } from '@/i18n'
import { documentCitationLocation, documentCitationUrl } from '@/lib/documentCitation'
import { apiClient } from '@/services/api_client'
import type { CitationReference } from '@/types/sse'

export function DocumentCitationSource({ reference }: { reference: CitationReference }) {
  useTranslation()
  const location = documentCitationLocation(reference)
  if (!location) return null
  const pages = location.endPage > location.page
    ? tr('第 {{start}}–{{end}} 页', { start: location.page, end: location.endPage })
    : tr('第 {{page}} 页', { page: location.page })
  return <a className="document-citation-source" href={documentCitationUrl(location, apiClient.getBaseURL())}
    target="_blank" rel="noopener noreferrer" title={tr('从第 {{page}} 页打开原件', { page: location.page })}>
    <FileText size={15} aria-hidden /><span>{tr('打开 PDF 原件')}<strong>{pages}</strong></span><ArrowUpRight size={15} aria-hidden />
  </a>
}
