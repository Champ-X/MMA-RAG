import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
  type BrowserStorageLike,
} from '@/lib/browserStorage'
import { isEditableShortcutTarget } from '@/lib/keyboardShortcuts'

const legacyPinStorageKey = 'mma-rag-nexus-pinned-conversations'
const migratedPinStorageKey = 'mma-rag-nexus-pinned-conversations-server-migrated'

export function readLegacyPinnedConversationIds(storage: BrowserStorageLike | null | undefined): string[] {
  if (readStorageItem(storage, migratedPinStorageKey) === '1') return []
  try {
    const value: unknown = JSON.parse(readStorageItem(storage, legacyPinStorageKey, '[]') ?? '[]')
    return Array.isArray(value)
      ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string')))
      : []
  } catch {
    return []
  }
}

export function markLegacyPinsMigrated(storage: BrowserStorageLike | null | undefined) {
  writeStorageItem(storage, migratedPinStorageKey, '1')
  removeStorageItem(storage, legacyPinStorageKey)
}

export function shouldFocusConversationSearch({
  altKey,
  ctrlKey,
  key,
  metaKey,
  target,
}: {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  target: EventTarget | null
}) {
  return key === '/'
    && !altKey
    && !ctrlKey
    && !metaKey
    && !isEditableShortcutTarget(target)
}
