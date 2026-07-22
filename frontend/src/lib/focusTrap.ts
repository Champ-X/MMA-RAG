export type FocusTrapAction = {
  preventDefault: boolean
  target: 'container' | 'first' | 'last' | null
}

export const focusTrapFocusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'audio[controls]',
  'video[controls]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function focusableCandidateVisible(element: HTMLElement): boolean {
  if (element.hasAttribute('hidden')) return false
  if (element.closest('[hidden]')) return false
  if (element.closest('[aria-hidden="true"]')) return false
  if (element.closest('[inert]')) return false
  const style = globalThis.window?.getComputedStyle?.(element)
  if (style?.visibility === 'hidden' || style?.visibility === 'collapse') return false
  return (
    element.offsetParent !== null
    || element.getClientRects().length > 0
    || element === globalThis.document?.activeElement
  )
}

export function getFocusableElements(
  container: HTMLElement | null,
  selector = focusTrapFocusableSelector,
): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
    .filter((element) => element.tabIndex >= 0 && focusableCandidateVisible(element))
}

export function resolveFocusTrapAction({
  activeElement,
  activeInside,
  emptyTarget = null,
  firstElement,
  key,
  lastElement,
  shiftKey,
}: {
  activeElement: unknown
  activeInside: boolean
  emptyTarget?: FocusTrapAction['target']
  firstElement?: unknown
  key: string
  lastElement?: unknown
  shiftKey: boolean
}): FocusTrapAction {
  if (key !== 'Tab') return { preventDefault: false, target: null }
  if (!firstElement || !lastElement) {
    return emptyTarget
      ? { preventDefault: true, target: emptyTarget }
      : { preventDefault: false, target: null }
  }
  if (shiftKey && (activeElement === firstElement || !activeInside)) {
    return { preventDefault: true, target: 'last' }
  }
  if (!shiftKey && (activeElement === lastElement || !activeInside)) {
    return { preventDefault: true, target: 'first' }
  }
  return { preventDefault: false, target: null }
}

export function focusTrapTargetElement({
  action,
  container,
  focusable,
}: {
  action: FocusTrapAction
  container: HTMLElement | null
  focusable: HTMLElement[]
}): HTMLElement | null {
  if (action.target === 'container') return container
  if (action.target === 'first') return focusable[0] ?? null
  if (action.target === 'last') return focusable[focusable.length - 1] ?? null
  return null
}
