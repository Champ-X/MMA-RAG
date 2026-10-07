import type { CitationReference } from '@/types/sse'

/** Evidence IDs identify observations; this key identifies the original media. */
export function getMediaSourceKey(citation: CitationReference): string {
  const runId = citation.pi_run_id?.trim()
  if (runId) {
    let sourceId = citation.source_id?.trim()
    // Persisted Pi answers predate the explicit source_id field. Their original
    // content route already contains the same run/source identity. Debug fields
    // may be absent on direct observations and must not change this identity.
    if (!sourceId) {
      for (const address of [citation.file_path, citation.img_url, citation.audio_url, citation.video_url]) {
        if (!address) continue
        try {
          const path = new URL(address, 'https://tessmora.invalid').pathname
          const match = path.match(/^\/api\/pi\/runs\/([^/]+)\/sources\/([^/]+)\/content$/)
          if (match && decodeURIComponent(match[1]) === runId) {
            sourceId = decodeURIComponent(match[2])
            break
          }
        } catch { /* An invalid address cannot establish shared source identity. */ }
      }
    }
    return JSON.stringify(sourceId ? ['pi', runId, sourceId] : ['pi-ref', runId, citation.id])
  }

  if (citation.source === 'attachment') return `attachment:${citation.attachment_id ?? citation.id}`
  const kbId = citation.debug_info?.kb_id?.trim() || 'unknown-kb'
  const filePath = citation.file_path?.trim()
  if (filePath) return `kb:${kbId}:path:${filePath.replace(/\\+/g, '/')}`

  const mediaUrl = citation.img_url || citation.audio_url || citation.video_url
  if (mediaUrl) {
    try {
      const parsed = new URL(mediaUrl)
      return `kb:${kbId}:url:${parsed.origin}${parsed.pathname}`
    } catch {
      return `kb:${kbId}:url:${mediaUrl.split(/[?#]/, 1)[0]}`
    }
  }

  // A display filename alone cannot establish that two originals are equal.
  return `kb:${kbId}:ref:${String(citation.id)}`
}

export function getCitationIdentityKey(citation: CitationReference): string {
  const sourceKey = getMediaSourceKey(citation)
  if (citation.type === 'video') {
    // Preserve separate video shots, with the existing 0.1-second tolerance.
    const formatTime = (value: number | undefined) => {
      const time = Number(value)
      return Number.isFinite(time) ? (Math.round(time * 10) / 10).toFixed(1) : 'whole'
    }
    return `video:${sourceKey}:segment:${formatTime(citation.start_sec)}-${formatTime(citation.end_sec)}`
  }
  return `${citation.type}:${sourceKey}`
}
