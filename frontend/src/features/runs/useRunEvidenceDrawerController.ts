import { useEffect, useRef, useState, type RefObject } from 'react'

export type RunEvidenceLocationState = {
  openEvidence?: boolean
}

export type UseRunEvidenceDrawerControllerInput = {
  locationPathname: string
  locationState: RunEvidenceLocationState | null
  onConsumeOpenEvidenceState: () => void
}

export type RunEvidenceDrawerController = {
  closeButtonRef: RefObject<HTMLButtonElement>
  closeEvidence: () => void
  evidenceOpen: boolean
  openEvidence: () => void
  toggleEvidence: () => void
}

export function shouldOpenEvidenceFromLocationState(locationState: RunEvidenceLocationState | null): boolean {
  return locationState?.openEvidence === true
}

export function shouldDismissEvidenceDrawer(event: Pick<KeyboardEvent, 'key'>): boolean {
  return event.key === 'Escape'
}

export function useRunEvidenceDrawerController({
  locationPathname,
  locationState,
  onConsumeOpenEvidenceState,
}: UseRunEvidenceDrawerControllerInput): RunEvidenceDrawerController {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)

  const closeEvidence = () => setEvidenceOpen(false)
  const openEvidence = () => setEvidenceOpen(true)
  const toggleEvidence = () => setEvidenceOpen((current) => !current)

  useEffect(() => {
    if (!shouldOpenEvidenceFromLocationState(locationState)) return
    setEvidenceOpen(true)
    onConsumeOpenEvidenceState()
  }, [locationPathname, locationState?.openEvidence, onConsumeOpenEvidenceState])

  useEffect(() => {
    if (!evidenceOpen) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      const previousFocus = previousFocusRef.current
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true })
      }
      previousFocusRef.current = null
    }
  }, [evidenceOpen])

  useEffect(() => {
    if (!evidenceOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldDismissEvidenceDrawer(event)) return
      event.preventDefault()
      setEvidenceOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [evidenceOpen])

  return {
    closeButtonRef,
    closeEvidence,
    evidenceOpen,
    openEvidence,
    toggleEvidence,
  }
}
