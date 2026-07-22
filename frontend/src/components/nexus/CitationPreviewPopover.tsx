import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlertTriangle, CheckCircle2, Copy, FileAudio, FileImage, FileText, Film, LocateFixed, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Evidence } from '@/api/nexus'
import { copyTextToClipboard } from '@/lib/clipboard'
import {
  focusTrapTargetElement,
  getFocusableElements,
  resolveFocusTrapAction,
} from '@/lib/focusTrap'
import {
  buildCitationPreviewPlacementViewModel,
  buildCitationPreviewReceiptCopyActionViewModel,
  buildCitationPreviewReceiptViewModel,
  type CitationPreviewReceiptCopyState,
} from './CitationPreviewPopoverViewModel'
import { buildEvidenceMediaViewModel } from './evidenceMediaViewModel'
import { locatorLabel } from './locatorLabel'
import { SubmitReadinessCard } from './SubmitReadinessCard'
import './CitationPreviewPopover.css'

type CitationPreviewPopoverProps = {
  anchorRect: DOMRect
  evidence: Evidence
  runId: string
  onClose: (options?: { restoreFocus?: boolean }) => void
}

const excerpt = (value: string, maxLength = 620) => {
  const normalized = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}…` : normalized
}

const timeRange = (evidence: Evidence) => {
  const start = evidence.locator.start_ms
  const end = evidence.locator.end_ms
  if (start === null || start === undefined) return ''
  return `#t=${start / 1000}${end && end > start ? `,${end / 1000}` : ''}`
}

export function CitationPreviewPopover({ anchorRect, evidence, runId, onClose }: CitationPreviewPopoverProps) {
  const root = useRef<HTMLElement>(null)
  const [receiptState, setReceiptState] = useState<CitationPreviewReceiptCopyState>('idle')
  const titleId = useId()
  const descriptionId = useId()
  const receiptFeedbackId = useId()
  const placement = buildCitationPreviewPlacementViewModel({
    anchorRect,
    modality: evidence.modality,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  })
  const mediaUrl = `${evidence.asset_url}${timeRange(evidence)}`
  const media = buildEvidenceMediaViewModel(evidence)
  const receipt = buildCitationPreviewReceiptViewModel({
    evidence,
    origin: typeof window === 'undefined' ? '' : window.location.origin,
    runId,
  })
  const receiptCopyAction = buildCitationPreviewReceiptCopyActionViewModel({
    receipt,
    state: receiptState,
  })

  useEffect(() => {
    root.current?.focus({ preventScroll: true })
  }, [evidence.id])
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])
  useEffect(() => {
    setReceiptState('idle')
  }, [receipt.href])
  useEffect(() => {
    if (receiptState === 'idle' || receiptState === 'copying') return
    const timer = window.setTimeout(() => setReceiptState('idle'), 2200)
    return () => window.clearTimeout(timer)
  }, [receiptState])
  const copyReceipt = async () => {
    if (receiptState === 'copying') return
    setReceiptState('copying')
    try {
      await copyTextToClipboard(receipt.href)
      setReceiptState('copied')
    } catch {
      setReceiptState('failed')
    }
  }
  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>) => {
    const focusable = getFocusableElements(root.current)
    const action = resolveFocusTrapAction({
      activeElement: document.activeElement,
      activeInside: Boolean(root.current?.contains(document.activeElement)),
      firstElement: focusable[0],
      key: event.key,
      lastElement: focusable[focusable.length - 1],
      shiftKey: event.shiftKey,
    })
    if (!action.preventDefault) return
    event.preventDefault()
    focusTrapTargetElement({ action, container: root.current, focusable })?.focus()
  }

  return <section
    ref={root}
    className={placement.className}
    role="dialog"
    aria-describedby={descriptionId}
    aria-labelledby={titleId}
    tabIndex={-1}
    onKeyDown={keepFocusInside}
    style={placement.style}
  >
    <header>
      <span className="citation-preview-icon">
        {evidence.modality === 'image' ? <FileImage /> : evidence.modality === 'audio' ? <FileAudio /> : evidence.modality === 'video' ? <Film /> : <FileText />}
      </span>
      <span>
        <p className="eyebrow">Citation preview</p>
        <strong id={titleId} title={evidence.source_name}>{evidence.source_name}</strong>
        <small id={descriptionId}>{evidence.evidence_type.replaceAll('_', ' ')} · {locatorLabel(evidence)}</small>
      </span>
      <button type="button" className="icon-button" onClick={() => onClose()} aria-label="Close citation preview"><X size={15} /></button>
    </header>
    <div className="citation-preview-content" tabIndex={0} aria-label={media.contentLabel}>
      {evidence.modality === 'image' && <img className="citation-preview-image" src={evidence.asset_url} alt={media.imageAlt} />}
      {evidence.modality === 'audio' && <audio src={mediaUrl} controls preload="metadata" aria-label={media.audioLabel} />}
      {evidence.modality === 'video' && <video src={mediaUrl} controls preload="metadata" aria-label={media.videoLabel} />}
      <blockquote>{excerpt(evidence.text_content) || 'This citation is represented by its original media.'}</blockquote>
      {evidence.quality_flags.length > 0 && <div className="citation-quality-flags">{evidence.quality_flags.map((flag) => <span key={flag}>{flag.replaceAll('_', ' ')}</span>)}</div>}
    </div>
    <footer>
      <span title={receipt.shortLabel}><LocateFixed size={13} />{receipt.shortLabel}</span>
      <div>
        <button
          type="button"
          aria-describedby={receiptFeedbackId}
          aria-disabled={receiptState === 'copying'}
          aria-label={receipt.ariaLabel}
          title={receipt.detail}
          onClick={copyReceipt}
        >
          {receiptState === 'copied' ? <CheckCircle2 size={12} /> : receiptState === 'failed' ? <AlertTriangle size={12} /> : <Copy size={12} />}
          {receiptCopyAction.submitLabel}
        </button>
        <Link to={receipt.path} onClick={() => onClose({ restoreFocus: false })}>{receipt.openLabel}</Link>
      </div>
      <SubmitReadinessCard
        className="citation-preview-copy-feedback"
        detail={receiptCopyAction.feedbackDetail}
        id={receiptFeedbackId}
        label={receiptCopyAction.feedbackLabel}
        liveMode={receiptCopyAction.liveMode}
        pending={receiptCopyAction.feedbackTone === 'pending'}
        role={receiptCopyAction.role}
        tone={receiptCopyAction.feedbackTone}
        visible={receiptCopyAction.visible}
      />
    </footer>
  </section>
}
