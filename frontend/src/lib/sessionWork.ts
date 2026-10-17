// Cancellation is explicit: changing routes or losing an event stream is not a
// request to stop paid work. Register local requests before their first await.
const work = new Map<string, Set<() => void>>()

export function registerSessionWork(sessionId: string, cancel: () => void) {
  const callbacks = work.get(sessionId) ?? new Set<() => void>()
  callbacks.add(cancel)
  work.set(sessionId, callbacks)
  return () => {
    callbacks.delete(cancel)
    if (!callbacks.size && work.get(sessionId) === callbacks) work.delete(sessionId)
  }
}

export function cancelSessionWork(sessionId: string) {
  for (const cancel of [...(work.get(sessionId) ?? [])]) cancel()
}
