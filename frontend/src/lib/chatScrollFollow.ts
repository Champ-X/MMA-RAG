/** Keep a growing conversation at the bottom until its reader scrolls away. */
export interface ChatScrollFollower {
  reset: () => void
  destroy: () => void
}

interface ScrollEnvironment {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  observeSizes: (viewport: HTMLElement, content: HTMLElement, changed: () => void) => () => void
}

function observeSizes(viewport: HTMLElement, content: HTMLElement, changed: () => void) {
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(changed)
  resize?.observe(viewport, { box: 'border-box' })
  // The content's bottom padding reserves space for the floating composer.
  resize?.observe(content, { box: 'border-box' })
  // Older embedded browsers still follow text and asynchronously loaded media.
  const mutation = !resize && typeof MutationObserver !== 'undefined' ? new MutationObserver(changed) : null
  mutation?.observe(content, { childList: true, subtree: true, characterData: true, attributes: true })
  const window = viewport.ownerDocument.defaultView
  window?.addEventListener('resize', changed)
  content.addEventListener('load', changed, true)
  content.addEventListener('loadedmetadata', changed, true)
  return () => {
    resize?.disconnect()
    mutation?.disconnect()
    window?.removeEventListener('resize', changed)
    content.removeEventListener('load', changed, true)
    content.removeEventListener('loadedmetadata', changed, true)
  }
}

export function attachChatScrollFollow(
  viewport: HTMLElement,
  content: HTMLElement,
  environment: Partial<ScrollEnvironment> = {},
): ChatScrollFollower {
  const requestFrame = environment.requestFrame ?? requestAnimationFrame
  const cancelFrame = environment.cancelFrame ?? cancelAnimationFrame
  let following = true
  let destroyed = false
  let frame: number | null = null
  let lastTop = viewport.scrollTop
  let lastHeight = viewport.scrollHeight
  let touchY: number | undefined

  const schedule = () => {
    if (destroyed || !following || frame !== null) return
    frame = requestFrame(() => {
      frame = null
      if (destroyed || !following) return
      // Read geometry once, then write. Never animate or restart smooth scrolling
      // for each token; ResizeObserver notifications share this single frame.
      const height = viewport.scrollHeight
      const bottom = Math.max(0, height - viewport.clientHeight)
      lastHeight = height
      lastTop = bottom
      viewport.scrollTop = bottom
    })
  }

  const pause = () => {
    if (viewport.scrollTop > 0) following = false
  }
  const onScroll = () => {
    const wasFollowing = following
    const top = viewport.scrollTop
    const height = viewport.scrollHeight
    const nearBottom = height - viewport.clientHeight - top <= 24
    // Content growing under a stationary reader must not look like user intent.
    // A layout shrink may also clamp scrollTop without an upward user scroll.
    if (top < lastTop - 1 && height >= lastHeight) following = false
    else if (top > lastTop + 1 && nearBottom) following = true
    lastTop = top
    lastHeight = height
    if (following && !wasFollowing) schedule()
  }
  const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) pause() }
  const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY }
  const onTouchMove = (event: TouchEvent) => {
    const nextY = event.touches[0]?.clientY
    if (touchY !== undefined && nextY !== undefined && nextY > touchY) pause()
    touchY = nextY
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) pause()
  }
  viewport.addEventListener('scroll', onScroll, { passive: true })
  viewport.addEventListener('wheel', onWheel, { passive: true })
  viewport.addEventListener('touchstart', onTouchStart, { passive: true })
  viewport.addEventListener('touchmove', onTouchMove, { passive: true })
  viewport.addEventListener('keydown', onKeyDown)
  const disconnect = (environment.observeSizes ?? observeSizes)(viewport, content, schedule)
  schedule()

  return {
    reset() {
      following = true
      lastTop = viewport.scrollTop
      lastHeight = viewport.scrollHeight
      schedule()
    },
    destroy() {
      destroyed = true
      if (frame !== null) cancelFrame(frame)
      frame = null
      disconnect()
      viewport.removeEventListener('scroll', onScroll)
      viewport.removeEventListener('wheel', onWheel)
      viewport.removeEventListener('touchstart', onTouchStart)
      viewport.removeEventListener('touchmove', onTouchMove)
      viewport.removeEventListener('keydown', onKeyDown)
    },
  }
}
