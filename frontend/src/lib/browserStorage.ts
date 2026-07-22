export type BrowserStorageArea = 'local' | 'session'
export type BrowserStorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

export function getBrowserStorage(area: BrowserStorageArea): BrowserStorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function readStorageItem(
  storage: BrowserStorageLike | null | undefined,
  key: string,
  fallback: string | null = null,
) {
  try {
    return storage?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function writeStorageItem(
  storage: BrowserStorageLike | null | undefined,
  key: string,
  value: string,
) {
  try {
    storage?.setItem(key, value)
    return Boolean(storage)
  } catch {
    return false
  }
}

export function removeStorageItem(storage: BrowserStorageLike | null | undefined, key: string) {
  try {
    storage?.removeItem(key)
    return Boolean(storage)
  } catch {
    return false
  }
}

export function readBrowserStorageItem(
  area: BrowserStorageArea,
  key: string,
  fallback: string | null = null,
) {
  return readStorageItem(getBrowserStorage(area), key, fallback)
}

export function writeBrowserStorageItem(area: BrowserStorageArea, key: string, value: string) {
  return writeStorageItem(getBrowserStorage(area), key, value)
}

export function removeBrowserStorageItem(area: BrowserStorageArea, key: string) {
  return removeStorageItem(getBrowserStorage(area), key)
}
