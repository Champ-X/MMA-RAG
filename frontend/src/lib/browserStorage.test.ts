import { describe, expect, it } from 'vitest'
import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
  type BrowserStorageLike,
} from './browserStorage'

function memoryStorage(initial: Record<string, string> = {}): BrowserStorageLike {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

const throwingStorage: BrowserStorageLike = {
  getItem: () => { throw new Error('storage unavailable') },
  removeItem: () => { throw new Error('storage unavailable') },
  setItem: () => { throw new Error('storage unavailable') },
}

describe('browserStorage', () => {
  it('reads, writes and removes values when storage is available', () => {
    const storage = memoryStorage({ theme: 'dark' })

    expect(readStorageItem(storage, 'theme')).toBe('dark')
    expect(writeStorageItem(storage, 'theme', 'light')).toBe(true)
    expect(readStorageItem(storage, 'theme')).toBe('light')
    expect(removeStorageItem(storage, 'theme')).toBe(true)
    expect(readStorageItem(storage, 'theme', 'system')).toBe('system')
  })

  it('uses fallback values instead of throwing when storage is unavailable', () => {
    expect(readStorageItem(throwingStorage, 'theme', 'system')).toBe('system')
    expect(writeStorageItem(throwingStorage, 'theme', 'dark')).toBe(false)
    expect(removeStorageItem(throwingStorage, 'theme')).toBe(false)
  })

  it('treats missing storage as a non-fatal unavailable capability', () => {
    expect(readStorageItem(null, 'theme', 'system')).toBe('system')
    expect(writeStorageItem(undefined, 'theme', 'dark')).toBe(false)
    expect(removeStorageItem(null, 'theme')).toBe(false)
  })
})
