import type { Evidence } from '@/api/nexus'
import { buildEvidenceDetailPath } from '@/lib/evidenceRoutes'
import { locatorLabel } from './locatorLabel'

export type EvidenceReceiptFacet = {
  label: string
  value: string
}

export type EvidenceReceiptViewModel = {
  ariaLabel: string
  copiedLabel: string
  copyLabel: string
  detail: string
  failedLabel: string
  facets: EvidenceReceiptFacet[]
  href: string
  locatorLabel: string
  path: string
  revisionLabel: string
  shortLabel: string
  sourceVersionLabel: string
  statusLabel: string
  title: string
}

export type EvidenceReceiptCopyState = 'copied' | 'copying' | 'failed' | 'idle'

export type EvidenceReceiptCopyActionViewModel = {
  feedbackDetail: string
  feedbackLabel: string
  feedbackTone: 'error' | 'pending' | 'ready'
  liveMode: 'assertive' | 'polite'
  role: 'alert' | 'status'
  submitLabel: string
  visible: boolean
}

export function buildEvidenceReceiptViewModel({
  copyLabel = 'Copy receipt link',
  copiedLabel = 'Evidence receipt copied',
  detail = 'Share this stable URL to preserve the Evidence revision, source version, locator and inspection signal.',
  evidence,
  failedLabel = 'Copy failed',
  origin,
  path,
  title = 'Evidence receipt',
}: {
  copyLabel?: string
  copiedLabel?: string
  detail?: string
  evidence: Evidence
  failedLabel?: string
  origin: string
  path: string
  title?: string
}): EvidenceReceiptViewModel {
  const locator = locatorLabel(evidence)
  const revisionLabel = evidence.id.slice(0, 8)
  const sourceVersionLabel = evidence.source_version_id.slice(0, 8)
  const statusLabel = evidence.status
  const shortLabel = path.length > 76 ? `${path.slice(0, 75)}…` : path

  return {
    ariaLabel: `Copy evidence receipt link for revision ${evidence.id} from ${evidence.source_name}.`,
    copiedLabel,
    copyLabel,
    detail,
    failedLabel,
    facets: [
      { label: 'Revision', value: revisionLabel },
      { label: 'Source', value: sourceVersionLabel },
      { label: 'Status', value: statusLabel },
      { label: 'Locator', value: locator },
    ],
    href: `${origin}${path}`,
    locatorLabel: locator,
    path,
    revisionLabel,
    shortLabel,
    sourceVersionLabel,
    statusLabel,
    title,
  }
}

export function buildEvidenceReceiptCopyActionViewModel({
  receipt,
  state,
}: {
  receipt: EvidenceReceiptViewModel
  state: EvidenceReceiptCopyState
}): EvidenceReceiptCopyActionViewModel {
  if (state === 'copying') {
    return {
      feedbackDetail: `Copying the stable receipt URL for Evidence revision ${receipt.revisionLabel}. The Evidence record and Source Version remain unchanged.`,
      feedbackLabel: 'Copying receipt link',
      feedbackTone: 'pending',
      liveMode: 'polite',
      role: 'status',
      submitLabel: 'Copying...',
      visible: true,
    }
  }

  if (state === 'copied') {
    return {
      feedbackDetail: `The receipt URL for Evidence revision ${receipt.revisionLabel} is on the clipboard. It preserves source version ${receipt.sourceVersionLabel} and locator ${receipt.locatorLabel}.`,
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
      feedbackDetail: `Clipboard access failed. Copy the visible receipt URL manually; revision ${receipt.revisionLabel}, source version ${receipt.sourceVersionLabel} and locator ${receipt.locatorLabel} remain stable.`,
      feedbackLabel: receipt.failedLabel,
      feedbackTone: 'error',
      liveMode: 'assertive',
      role: 'alert',
      submitLabel: 'Try copy again',
      visible: true,
    }
  }

  return {
    feedbackDetail: `Copies a stable Evidence receipt URL for revision ${receipt.revisionLabel}; it does not change the Source Version, locator or inspection state.`,
    feedbackLabel: 'Evidence receipt ready',
    feedbackTone: 'ready',
    liveMode: 'polite',
    role: 'status',
    submitLabel: receipt.copyLabel,
    visible: false,
  }
}

export function buildRunEvidenceReceiptViewModel({
  evidence,
  origin,
  runId,
}: {
  evidence: Evidence
  origin: string
  runId: string
}): EvidenceReceiptViewModel {
  return buildEvidenceReceiptViewModel({
    copiedLabel: 'Receipt copied',
    copyLabel: 'Copy receipt',
    detail: 'Copies the stable Evidence receipt without leaving this Run.',
    evidence,
    origin,
    path: buildEvidenceDetailPath(evidence.id, runId),
  })
}
