export interface StreamTextScheduler {
  requestFrame: (callback: () => void) => (() => void) | undefined
  setTimeout: (callback: () => void, delayMs: number) => () => void
}

const browserScheduler: StreamTextScheduler = {
  requestFrame(callback) {
    if (typeof requestAnimationFrame !== 'function') return undefined
    const id = requestAnimationFrame(callback)
    return () => cancelAnimationFrame(id)
  },
  setTimeout(callback, delayMs) {
    const id = setTimeout(callback, delayMs)
    return () => clearTimeout(id)
  },
}

export interface StreamTextBuffer {
  append: (delta: string) => void
  flush: () => void
  close: () => void
}

/** Flush received-but-unpainted text before saving when the page may be frozen. */
export function subscribeStreamTextLifecycle(
  flushText: () => void,
  flushPersistence: () => void,
  page: Window | undefined = typeof window === 'undefined' ? undefined : window,
) {
  const save = () => {
    flushText()
    flushPersistence()
  }
  const document = page?.document
  const saveWhenHidden = () => {
    if (document?.visibilityState === 'hidden') save()
  }
  page?.addEventListener('pagehide', save)
  document?.addEventListener('visibilitychange', saveWhenHidden)
  return () => {
    page?.removeEventListener('pagehide', save)
    document?.removeEventListener('visibilitychange', saveWhenHidden)
  }
}

/** Coalesce received text for the next paint; never delay it to simulate typing. */
export function createStreamTextBuffer(
  onFlush: (content: string) => void,
  { scheduler = browserScheduler, fallbackMs = 100 }: {
    scheduler?: StreamTextScheduler
    fallbackMs?: number
  } = {},
): StreamTextBuffer {
  let content = ''
  let dirty = false
  let closed = false
  let scheduled = false
  let generation = 0
  let cancelFrame: (() => void) | undefined
  let cancelTimeout: (() => void) | undefined

  const flush = () => {
    generation += 1
    cancelFrame?.()
    cancelTimeout?.()
    cancelFrame = cancelTimeout = undefined
    scheduled = false
    if (!dirty) return
    dirty = false
    onFlush(content)
  }

  return {
    append(delta) {
      if (closed || !delta) return
      content += delta
      dirty = true
      if (scheduled) return
      scheduled = true
      const pendingGeneration = generation
      const run = () => {
        if (!closed && pendingGeneration === generation) flush()
      }
      cancelFrame = scheduler.requestFrame(run)
      // Background tabs pause animation frames. Keep received text progressing there too.
      cancelTimeout = scheduler.setTimeout(run, fallbackMs)
    },
    flush,
    close() {
      if (closed) return
      closed = true
      flush()
    },
  }
}
