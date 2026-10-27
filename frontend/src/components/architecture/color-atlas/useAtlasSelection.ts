import { useState } from 'react'

const prefix = 'tessmora:atlas:v1:'

/** Reader preferences only: no playback, source data, or live retrieval state. */
export function useAtlasSelection<T extends string | number | boolean | null>(key: string, initial: T, options: readonly T[]) {
  const [selection, update] = useState<T>(() => {
    try {
      const saved: unknown = JSON.parse(window.sessionStorage.getItem(prefix + key) ?? 'null')
      return options.some(option => option === saved) ? saved as T : initial
    } catch { return initial }
  })
  const select = (value: T) => {
    update(value)
    try { window.sessionStorage.setItem(prefix + key, JSON.stringify(value)) } catch { /* Reading remains usable without storage. */ }
  }
  return [selection, select] as const
}

export function readAtlasScroll(key: string) {
  try {
    const value = Number(window.sessionStorage.getItem(prefix + 'scroll:' + key))
    return Number.isFinite(value) && value >= 0 ? value : 0
  } catch { return 0 }
}

export function saveAtlasScroll(key: string, value: number) {
  try { window.sessionStorage.setItem(prefix + 'scroll:' + key, String(value)) } catch { /* Optional reading position. */ }
}
