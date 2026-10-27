const highlightName = 'tessmora-citation-context'
const scopeSelector = 'p,li,th,td,h1,h2,h3,h4,h5,h6'
const nestedBlockSelector = `${scopeSelector},div,ul,ol,dl,dt,dd,blockquote,pre,figure,figcaption,table,thead,tbody,tfoot,tr,section,article,aside,details,summary`
const mediaSelector = '.answer-media-group,img,video,audio,canvas,svg,iframe,object,embed,math'
const excludedSelector = `button,input,textarea,select,script,style,noscript,${mediaSelector},[hidden],[aria-hidden="true"]`
const activeByDocument = new WeakMap<Document, () => void>()
const noop = () => {}

interface HighlightRegistry {
  get: (name: string) => unknown
  set: (name: string, highlight: unknown) => unknown
  delete: (name: string) => unknown
}
interface HighlightRealm {
  CSS?: { highlights?: HighlightRegistry }
  Highlight?: new (...ranges: Range[]) => unknown
}

/**
 * Highlight the active inline citation's own prose block without changing React's DOM.
 * Re-activate after childList/characterData changes to replace detached text ranges;
 * scrolling does not require rebuilding ranges. Each document owns at most one context.
 */
export function activateCitationContext(anchor: HTMLElement): () => void {
  const doc = anchor.ownerDocument
  activeByDocument.get(doc)?.()
  if (!anchor.isConnected || !anchor.matches('button[data-source="attachment"],button[data-source="knowledge"]')) return noop
  const markdown = anchor.closest('.rag-markdown')
  const scope = anchor.closest(scopeSelector)
  if (!markdown || !scope || !markdown.contains(scope) || anchor.closest('.answer-media-group')) return noop
  // Do not borrow an outer list item's prose when the anchor is inside an
  // unsupported nested block such as a generic div or a preformatted sample.
  for (let parent = anchor.parentElement; parent && parent !== scope; parent = parent.parentElement) {
    if (parent.matches(nestedBlockSelector) || parent.matches(excludedSelector)) return noop
  }
  if (scope.matches(excludedSelector)) return noop

  const ranges: Range[] = []
  let hasProse = false
  let hasExcludedStructure = false
  // Filter whole nested subtrees, including their text, rather than walking an answer.
  const walker = doc.createTreeWalker(scope, 5 /* SHOW_ELEMENT | SHOW_TEXT */, {
    acceptNode(node) {
      if (node.nodeType === 1) {
        const element = node as Element
        if (element.matches(nestedBlockSelector)) {
          hasExcludedStructure = true
          return 2 /* FILTER_REJECT */
        }
        if (element.matches(excludedSelector)) {
          // Buttons are inline; a block/media fallback would shade unrelated material.
          if (element.matches(mediaSelector)) hasExcludedStructure = true
          return 2
        }
        return 3 /* FILTER_SKIP */
      }
      return node.textContent?.length ? 1 /* FILTER_ACCEPT */ : 3
    },
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const range = doc.createRange()
    range.selectNodeContents(node)
    ranges.push(range)
    hasProse ||= Boolean(node.textContent?.trim())
  }
  if (!hasProse) return noop

  const realm = doc.defaultView as unknown as HighlightRealm | null
  const registry = realm?.CSS?.highlights
  let clearPaint: (() => void) | undefined
  if (realm?.Highlight && typeof registry?.set === 'function' && typeof registry.get === 'function' && typeof registry.delete === 'function') {
    try {
      const highlight = new realm.Highlight(...ranges)
      registry.set(highlightName, highlight)
      clearPaint = () => { if (registry.get(highlightName) === highlight) registry.delete(highlightName) }
    } catch { /* A partial implementation can use the same non-mutating fallback. */ }
  }
  if (!clearPaint) {
    // A parent <li> background also paints its nested list/media. Keep that case quiet.
    if (hasExcludedStructure) return noop
    const previous = scope.getAttribute('data-source-context')
    scope.setAttribute('data-source-context', 'true')
    clearPaint = () => {
      if (scope.getAttribute('data-source-context') !== 'true') return
      if (previous === null) scope.removeAttribute('data-source-context')
      else scope.setAttribute('data-source-context', previous)
    }
  }
  const removePaint = clearPaint
  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true
    removePaint()
    if (activeByDocument.get(doc) === cleanup) activeByDocument.delete(doc)
  }
  activeByDocument.set(doc, cleanup)
  return cleanup
}
