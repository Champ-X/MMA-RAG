import { FileAudio, FileImage, Film } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { Evidence } from '@/api/nexus'
import { buildEvidenceMediaViewModel } from '@/components/nexus/evidenceMediaViewModel'
import {
  buildCitationMarkdown,
  buildCitationRenderModel,
  createCitationRenderState,
} from './runCitationAnswerViewModel'
import { runCitations } from './runEvidenceBindingsViewModel'

function InlineMedia({
  activeTriggerKey,
  evidence,
  onPreview,
  onPreviewIntent,
  triggerKey,
}: {
  activeTriggerKey?: string | null
  evidence: Evidence
  onPreview: (evidence: Evidence, anchorRect: DOMRect, trigger: HTMLElement, triggerKey: string) => void
  onPreviewIntent?: () => void
  triggerKey: string
}) {
  const start = Number(evidence.locator.start_ms ?? 0) / 1000
  const end = Number(evidence.locator.end_ms ?? 0) / 1000
  const timedUrl = start ? `${evidence.asset_url}#t=${start}${end > start ? `,${end}` : ''}` : evidence.asset_url
  const hasDerivedVisual = Boolean(evidence.locator.extra?.object_key)
  const media = buildEvidenceMediaViewModel(evidence)
  if (evidence.modality === 'image' || hasDerivedVisual) return <span className="inline-evidence-media"><img src={evidence.asset_url} alt={media.imageAlt} /><span><FileImage />{media.visualKindLabel} · <button type="button" aria-expanded={activeTriggerKey === triggerKey} aria-haspopup="dialog" data-citation-trigger-key={triggerKey} onFocus={onPreviewIntent} onPointerEnter={onPreviewIntent} onClick={(event) => onPreview(evidence, event.currentTarget.getBoundingClientRect(), event.currentTarget, triggerKey)}>{evidence.source_name}</button></span></span>
  if (evidence.modality === 'audio') return <span className="inline-evidence-media"><audio src={timedUrl} controls preload="metadata" aria-label={media.audioLabel} /><span><FileAudio />Audio evidence · {(start).toFixed(1)}-{(end).toFixed(1)}s</span></span>
  if (evidence.modality === 'video') return <span className="inline-evidence-media"><video src={timedUrl} controls preload="metadata" aria-label={media.videoLabel} /><span><Film />Video evidence · {(start).toFixed(1)}-{(end).toFixed(1)}s</span></span>
  return null
}

export function EvidenceAnswer({
  activeTriggerKey,
  evidenceById,
  onPreview,
  onPreviewIntent,
  result,
}: {
  activeTriggerKey?: string | null
  evidenceById: Map<string, Evidence>
  onPreview: (evidence: Evidence, anchorRect: DOMRect, trigger: HTMLElement, triggerKey: string) => void
  onPreviewIntent?: () => void
  result: Record<string, unknown> | null
}) {
  const answer = String(result?.answer ?? '')
  const citations = runCitations({ result })
  const prepared = buildCitationMarkdown(answer, citations)
  const citationState = createCitationRenderState()
  return <ReactMarkdown components={{
    a: ({ href, children }) => {
      const citation = buildCitationRenderModel({ evidenceById, href, state: citationState })
      if (!citation.id) return <a href={href}>{children}</a>
      if (!citation.evidence || !citation.triggerKey) return <span className="inline-citation unavailable" title="Citation is unavailable">{children}</span>
      return <><button type="button" className="inline-citation" aria-expanded={activeTriggerKey === citation.triggerKey} aria-haspopup="dialog" data-citation-trigger-key={citation.triggerKey} onFocus={onPreviewIntent} onPointerEnter={onPreviewIntent} onClick={(event) => onPreview(citation.evidence!, event.currentTarget.getBoundingClientRect(), event.currentTarget, citation.triggerKey!)} title={`${citation.evidence.source_name} · ${citation.evidence.locator.locator_type}`} aria-label={`Preview citation from ${citation.evidence.source_name}`}>{children}</button>{citation.shouldRenderMedia && citation.mediaTriggerKey ? <InlineMedia activeTriggerKey={activeTriggerKey} evidence={citation.evidence} onPreview={onPreview} onPreviewIntent={onPreviewIntent} triggerKey={citation.mediaTriggerKey} /> : null}</>
    },
  }}>{prepared}</ReactMarkdown>
}
