import type { Evidence } from '@/api/nexus'
import {
  buildRunEvidenceReceiptViewModel,
  type EvidenceReceiptCopyState,
  type EvidenceReceiptViewModel,
} from './evidenceReceiptViewModel'

export type CitationPreviewReceiptViewModel = {
  ariaLabel: string
  copiedLabel: string
  copyLabel: string
  detail: string
  failedLabel: string
  href: string
  locatorLabel: string
  openLabel: string
  path: string
  revisionLabel: string
  shortLabel: string
  sourceVersionLabel: string
}

export type CitationPreviewReceiptCopyState = EvidenceReceiptCopyState

export type CitationPreviewReceiptCopyActionViewModel = {
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  submitLabel: string
  visible: boolean
}

export type CitationPreviewPlacementViewModel = {
  className: string
  maxHeight: number
  placement: 'above' | 'below'
  style: {
    left: number
    maxHeight: number
    top: number
    width: number
  }
}

type CitationPreviewAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'top' | 'width'>

export type CitationPreviewPlacementInput = {
  anchorRect: CitationPreviewAnchorRect
  modality: Evidence['modality']
  viewportHeight: number
  viewportWidth: number
}

const previewViewportGutter = 16
const previewPreferredWidth = 390
const previewMinimumWidth = 240
const previewMinimumHeight = 220
const previewMaximumHeight = 420
const previewAnchorGap = 12
const previewPlacementThreshold = 300
const previewVerticalMargin = 28

function toCitationPreviewReceipt(evidence: Evidence, receipt: EvidenceReceiptViewModel): CitationPreviewReceiptViewModel {
  const shortLabel = `${receipt.revisionLabel} · ${receipt.locatorLabel}`
  return {
    ariaLabel: `Copy evidence receipt for ${evidence.source_name}, revision ${evidence.id}.`,
    copiedLabel: receipt.copiedLabel,
    copyLabel: receipt.copyLabel,
    detail: receipt.detail,
    failedLabel: receipt.failedLabel,
    href: receipt.href,
    locatorLabel: receipt.locatorLabel,
    openLabel: 'Open detail',
    path: receipt.path,
    revisionLabel: receipt.revisionLabel,
    shortLabel: shortLabel.length > 62 ? `${shortLabel.slice(0, 61)}…` : shortLabel,
    sourceVersionLabel: receipt.sourceVersionLabel,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(min, value), max)
}

export function buildCitationPreviewPlacementViewModel({
  anchorRect,
  modality,
  viewportHeight,
  viewportWidth,
}: CitationPreviewPlacementInput): CitationPreviewPlacementViewModel {
  const safeViewportWidth = Math.max(viewportWidth, previewMinimumWidth + (previewViewportGutter * 2))
  const safeViewportHeight = Math.max(viewportHeight, previewMinimumHeight + (previewViewportGutter * 2))
  const width = Math.min(previewPreferredWidth, safeViewportWidth - 24)
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - width / 2
  const left = clamp(centeredLeft, previewViewportGutter, safeViewportWidth - width - previewViewportGutter)
  const roomBelow = safeViewportHeight - anchorRect.bottom - previewVerticalMargin
  const roomAbove = anchorRect.top - previewVerticalMargin
  const placeAbove = roomBelow < previewPlacementThreshold && roomAbove > roomBelow
  const availableRoom = placeAbove ? roomAbove : roomBelow
  const maxHeight = Math.max(previewMinimumHeight, Math.min(previewMaximumHeight, availableRoom - 8))
  const top = placeAbove
    ? Math.max(previewViewportGutter, anchorRect.top - maxHeight - previewAnchorGap)
    : Math.min(anchorRect.bottom + previewAnchorGap, safeViewportHeight - maxHeight - previewViewportGutter)
  const placement = placeAbove ? 'above' : 'below'

  return {
    className: `citation-preview-popover modality-${modality}${placeAbove ? ' place-above' : ''}`,
    maxHeight,
    placement,
    style: {
      left,
      maxHeight,
      top,
      width,
    },
  }
}

export function buildCitationPreviewReceiptCopyActionViewModel({
  receipt,
  state,
}: {
  receipt: CitationPreviewReceiptViewModel
  state: CitationPreviewReceiptCopyState
}): CitationPreviewReceiptCopyActionViewModel {
  if (state === 'copying') {
    return {
      feedbackDetail: `Copying the citation receipt for Evidence revision ${receipt.revisionLabel}. The preview stays open and the Source Version remains unchanged.`,
      feedbackLabel: 'Copying receipt',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copying...',
      visible: true,
    }
  }

  if (state === 'copied') {
    return {
      feedbackDetail: `The citation receipt is on the clipboard. It preserves revision ${receipt.revisionLabel}, source version ${receipt.sourceVersionLabel} and locator ${receipt.locatorLabel}.`,
      feedbackLabel: receipt.copiedLabel,
      feedbackTone: 'ready',
      liveMode: 'polite',
      role: 'status',
      submitLabel: receipt.copiedLabel,
      visible: true,
    }
  }

  if (state === 'failed') {
    return {
      feedbackDetail: `Clipboard access failed. Open the detail view or copy the visible receipt URL manually; revision ${receipt.revisionLabel} and locator ${receipt.locatorLabel} remain stable.`,
      feedbackLabel: receipt.failedLabel,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try copy again',
      visible: true,
    }
  }

  return {
    feedbackDetail: `Copies a stable citation receipt for revision ${receipt.revisionLabel} without closing the preview or changing the Evidence ledger.`,
    feedbackLabel: 'Citation receipt ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    submitLabel: receipt.copyLabel,
    visible: false,
  }
}

export function buildCitationPreviewReceiptViewModel({
  evidence,
  origin,
  runId,
}: {
  evidence: Evidence
  origin: string
  runId: string
}): CitationPreviewReceiptViewModel {
  return toCitationPreviewReceipt(
    evidence,
    buildRunEvidenceReceiptViewModel({ evidence, origin, runId }),
  )
}
