import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import {
  focusTrapTargetElement,
  getFocusableElements,
  resolveFocusTrapAction,
} from '@/lib/focusTrap'
import { buildConfirmDialogActionViewModel } from './ConfirmDialogViewModel'
import { SubmitReadinessCard } from './SubmitReadinessCard'
import './ConfirmDialog.css'

type ConfirmDialogProps = {
  body: string
  busy?: boolean
  confirmLabel?: string
  open: boolean
  title: string
  tone?: 'danger' | 'neutral'
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  body,
  busy = false,
  confirmLabel = 'Confirm',
  open,
  title,
  tone = 'danger',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const bodyId = useId()
  const statusId = useId()
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)
  const action = buildConfirmDialogActionViewModel({ busy, confirmLabel })

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useLayoutEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const initialTarget = cancelRef.current ?? getFocusableElements(dialogRef.current)[0] ?? dialogRef.current
    initialTarget?.focus({ preventScroll: true })
    return () => {
      const dialogElement = dialogRef.current
      window.setTimeout(() => {
        if (dialogElement && document.contains(dialogElement)) return
        const previousFocus = previousFocusRef.current
        if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true })
        previousFocusRef.current = null
      }, 0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.hasAttribute('inert') ?? false
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden')
    const previousOverflow = document.body.style.overflow
    appRoot?.setAttribute('inert', '')
    appRoot?.setAttribute('aria-hidden', 'true')
    document.body.style.overflow = 'hidden'
    return () => {
      if (previousInert) appRoot?.setAttribute('inert', '')
      else appRoot?.removeAttribute('inert')
      if (previousAriaHidden == null) appRoot?.removeAttribute('aria-hidden')
      else appRoot?.setAttribute('aria-hidden', previousAriaHidden)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busy) onCancelRef.current()
        return
      }
      const focusables = getFocusableElements(dialogRef.current)
      const action = resolveFocusTrapAction({
        activeElement: document.activeElement,
        activeInside: Boolean(dialogRef.current?.contains(document.activeElement)),
        emptyTarget: 'container',
        firstElement: focusables[0],
        key: event.key,
        lastElement: focusables[focusables.length - 1],
        shiftKey: event.shiftKey,
      })
      if (!action.preventDefault) return
      event.preventDefault()
      focusTrapTargetElement({ action, container: dialogRef.current, focusable: focusables })?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [busy, open])

  if (!open) return null
  return createPortal(<div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && action.canCancel) onCancel() }}>
    <section className={`confirm-dialog tone-${tone}`} ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${bodyId} ${statusId}`} tabIndex={-1}>
      <header><span><AlertTriangle /></span><div><p className="eyebrow">Action checkpoint</p><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-disabled={action.cancelAriaDisabled || undefined} aria-describedby={statusId} aria-label="Close confirmation" onClick={() => { if (action.canCancel) onCancel() }}><X size={16} /></button></header>
      <p id={bodyId}>{body}</p>
      <SubmitReadinessCard className="confirm-status" detail={action.statusDetail} id={statusId} label={action.statusLabel} liveMode={action.statusLive} pending={action.statusVisible} role={action.statusRole} tone="pending" visible={action.statusVisible} />
      <footer><button className="button" ref={cancelRef} type="button" aria-disabled={action.cancelAriaDisabled || undefined} aria-describedby={statusId} onClick={() => { if (action.canCancel) onCancel() }}>Cancel</button><button className={`button ${tone === 'danger' ? 'danger-quiet' : 'primary'}`} type="button" aria-disabled={action.confirmAriaDisabled || undefined} aria-describedby={statusId} onClick={() => { if (action.canConfirm) onConfirm() }}>{action.confirmLabel}</button></footer>
    </section>
  </div>, document.body)
}
