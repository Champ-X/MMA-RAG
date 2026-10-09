import type { PersistStorage, StorageValue } from 'zustand/middleware'

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

interface ChatPersistenceOptions<State> {
  isStreaming: () => boolean
  equals: (left: State, right: State) => boolean
  serialize?: (value: StorageValue<State>) => string
  getStorage?: () => BrowserStorage | undefined
  intervalMs?: number
}

/** Defer serialization itself, not only localStorage writes, while tokens arrive. */
export function createChatPersistence<State>({
  isStreaming,
  equals,
  serialize = JSON.stringify,
  getStorage = () => typeof window === 'undefined' ? undefined : window.localStorage,
  intervalMs = 500,
}: ChatPersistenceOptions<State>) {
  const pending = new Map<string, StorageValue<State>>()
  const latest = new Map<string, StorageValue<State>>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancelTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function flush() {
    cancelTimer()
    for (const [name, value] of pending) {
      try {
        const target = getStorage()
        if (!target) continue
        target.setItem(name, serialize(value))
        pending.delete(name)
      } catch {
        // Quota / private-mode storage failures must not interrupt the SSE
        // callback. Keep the latest value available for a later save attempt.
      }
    }
  }

  const storage: PersistStorage<State> = {
    getItem(name) {
      const unsaved = pending.get(name)
      if (unsaved) return unsaved
      try {
        const value = getStorage()?.getItem(name)
        return value ? JSON.parse(value) as StorageValue<State> : null
      } catch {
        return null
      }
    },
    setItem(name, value) {
      const previous = latest.get(name)
      if (!previous || previous.version !== value.version || !equals(previous.state, value.state)) {
        latest.set(name, value)
        pending.set(name, value)
      }
      if (!pending.size) return
      if (!isStreaming()) {
        flush()
      } else if (timer === undefined) {
        // A throttle, rather than a debounce: long streams still checkpoint.
        timer = setTimeout(flush, intervalMs)
      }
    },
    removeItem(name) {
      pending.delete(name)
      latest.delete(name)
      if (!pending.size) cancelTimer()
      try {
        getStorage()?.removeItem(name)
      } catch {
        // Never let a failed browser-storage deletion break the chat UI.
      }
    },
  }

  const page = typeof window === 'undefined' ? undefined : window
  const document = page?.document
  const flushWhenHidden = () => {
    if (document?.visibilityState === 'hidden') flush()
  }
  page?.addEventListener('pagehide', flush)
  document?.addEventListener('visibilitychange', flushWhenHidden)

  return {
    storage,
    flush,
    dispose() {
      flush()
      page?.removeEventListener('pagehide', flush)
      document?.removeEventListener('visibilitychange', flushWhenHidden)
    },
  }
}
