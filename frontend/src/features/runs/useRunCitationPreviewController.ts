import { useEffect, useState } from 'react'
import type { Evidence } from '@/api/nexus'

export type RunCitationPreviewState = {
  anchorRect: DOMRect
  evidence: Evidence
  trigger: HTMLElement | null
  triggerKey: string
}

export type RunCitationPreviewController = {
  activeTriggerKey: string | null
  closePreview: (options?: { restoreFocus?: boolean }) => void
  openPreview: (evidence: Evidence, anchorRect: DOMRect, trigger: HTMLElement, triggerKey: string) => void
  preview: RunCitationPreviewState | null
}

const citationTriggerSelector = '[data-citation-trigger-key]'

export function findCitationPreviewTrigger({
  documentRoot,
  preview,
}: {
  documentRoot: Pick<Document, 'querySelectorAll'>
  preview: Pick<RunCitationPreviewState, 'trigger' | 'triggerKey'>
}): HTMLElement | null {
  if (preview.trigger?.isConnected) return preview.trigger
  return Array.from(documentRoot.querySelectorAll<HTMLElement>(citationTriggerSelector))
    .find((element) => element.dataset.citationTriggerKey === preview.triggerKey)
    ?? null
}

export function useRunCitationPreviewController(runId: string): RunCitationPreviewController {
  const [preview, setPreview] = useState<RunCitationPreviewState | null>(null)

  useEffect(() => {
    setPreview(null)
  }, [runId])

  const openPreview = (evidence: Evidence, anchorRect: DOMRect, trigger: HTMLElement, triggerKey: string) => {
    setPreview({ anchorRect, evidence, trigger, triggerKey })
  }

  const closePreview = ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
    setPreview((current) => {
      if (restoreFocus && current) {
        window.requestAnimationFrame(() => {
          findCitationPreviewTrigger({ documentRoot: document, preview: current })?.focus({ preventScroll: true })
        })
      }
      return null
    })
  }

  return {
    activeTriggerKey: preview?.triggerKey ?? null,
    closePreview,
    openPreview,
    preview,
  }
}
