import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  focusTrapFocusableSelector,
  getFocusableElements,
  resolveFocusTrapAction,
} from './focusTrap'

function focusableElementDouble({
  ariaHiddenTree = false,
  hidden = false,
  hiddenTree = false,
  inertTree = false,
}: {
  ariaHiddenTree?: boolean
  hidden?: boolean
  hiddenTree?: boolean
  inertTree?: boolean
} = {}): HTMLElement {
  return {
    closest: (selector: string) => {
      if (selector === '[hidden]' && hiddenTree) return {}
      if (selector === '[aria-hidden="true"]' && ariaHiddenTree) return {}
      if (selector === '[inert]' && inertTree) return {}
      return null
    },
    getClientRects: () => ({ length: 1 }),
    hasAttribute: (name: string) => name === 'hidden' && hidden,
    offsetParent: {},
    tabIndex: 0,
  } as unknown as HTMLElement
}

describe('focus trap utilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the shared focusable selector aligned with interactive overlay content', () => {
    expect(focusTrapFocusableSelector).toContain('button:not([disabled])')
    expect(focusTrapFocusableSelector).toContain('a[href]')
    expect(focusTrapFocusableSelector).toContain('audio[controls]')
    expect(focusTrapFocusableSelector).toContain('video[controls]')
    expect(focusTrapFocusableSelector).toContain('summary')
    expect(focusTrapFocusableSelector).toContain('iframe')
    expect(focusTrapFocusableSelector).toContain('[tabindex]:not([tabindex="-1"])')
    expect(focusTrapFocusableSelector).not.toContain('aria-disabled')
  })

  it('excludes candidates from hidden accessibility trees', () => {
    const visible = focusableElementDouble()
    const hiddenElement = focusableElementDouble({ hidden: true })
    const hiddenAncestor = focusableElementDouble({ hiddenTree: true })
    const ariaHiddenAncestor = focusableElementDouble({ ariaHiddenTree: true })
    const inertAncestor = focusableElementDouble({ inertTree: true })
    const container = {
      querySelectorAll: () => [visible, hiddenElement, hiddenAncestor, ariaHiddenAncestor, inertAncestor],
    } as unknown as HTMLElement

    expect(getFocusableElements(container)).toEqual([visible])
  })

  it('excludes candidates hidden by CSS visibility', () => {
    const visible = focusableElementDouble()
    const visibilityHidden = focusableElementDouble()
    const visibilityCollapsed = focusableElementDouble()
    vi.stubGlobal('window', {
      getComputedStyle: (element: HTMLElement) => ({
        visibility: element === visibilityHidden
          ? 'hidden'
          : element === visibilityCollapsed
            ? 'collapse'
            : 'visible',
      }),
    })
    const container = {
      querySelectorAll: () => [visible, visibilityHidden, visibilityCollapsed],
    } as unknown as HTMLElement

    expect(getFocusableElements(container)).toEqual([visible])
  })

  it('wraps Tab from the last control to the first', () => {
    const first = {}
    const last = {}

    expect(resolveFocusTrapAction({
      activeElement: last,
      activeInside: true,
      firstElement: first,
      key: 'Tab',
      lastElement: last,
      shiftKey: false,
    })).toEqual({ preventDefault: true, target: 'first' })
  })

  it('wraps Shift+Tab from the first control to the last', () => {
    const first = {}
    const last = {}

    expect(resolveFocusTrapAction({
      activeElement: first,
      activeInside: true,
      firstElement: first,
      key: 'Tab',
      lastElement: last,
      shiftKey: true,
    })).toEqual({ preventDefault: true, target: 'last' })
  })

  it('pulls stray focus back into the focus trap', () => {
    const first = {}
    const last = {}
    const outside = {}

    expect(resolveFocusTrapAction({
      activeElement: outside,
      activeInside: false,
      firstElement: first,
      key: 'Tab',
      lastElement: last,
      shiftKey: false,
    })).toEqual({ preventDefault: true, target: 'first' })
    expect(resolveFocusTrapAction({
      activeElement: outside,
      activeInside: false,
      firstElement: first,
      key: 'Tab',
      lastElement: last,
      shiftKey: true,
    })).toEqual({ preventDefault: true, target: 'last' })
  })

  it('can route empty focus loops back to their container', () => {
    expect(resolveFocusTrapAction({
      activeElement: null,
      activeInside: false,
      emptyTarget: 'container',
      key: 'Tab',
      shiftKey: false,
    })).toEqual({ preventDefault: true, target: 'container' })
  })

  it('lets non-boundary focus movement proceed normally', () => {
    const first = {}
    const middle = {}
    const last = {}

    expect(resolveFocusTrapAction({
      activeElement: middle,
      activeInside: true,
      firstElement: first,
      key: 'Tab',
      lastElement: last,
      shiftKey: false,
    })).toEqual({ preventDefault: false, target: null })
    expect(resolveFocusTrapAction({
      activeElement: middle,
      activeInside: true,
      firstElement: first,
      key: 'Escape',
      lastElement: last,
      shiftKey: false,
    })).toEqual({ preventDefault: false, target: null })
  })
})
