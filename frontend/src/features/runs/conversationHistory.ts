const legacyPinStorageKey = 'mma-rag-nexus-pinned-conversations'
const migratedPinStorageKey = 'mma-rag-nexus-pinned-conversations-server-migrated'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem' | 'removeItem'>

export function readLegacyPinnedConversationIds(storage: StorageReader): string[] {
  if (storage.getItem(migratedPinStorageKey) === '1') return []
  try {
    const value: unknown = JSON.parse(storage.getItem(legacyPinStorageKey) ?? '[]')
    return Array.isArray(value)
      ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string')))
      : []
  } catch {
    return []
  }
}

export function markLegacyPinsMigrated(storage: StorageWriter) {
  storage.setItem(migratedPinStorageKey, '1')
  storage.removeItem(legacyPinStorageKey)
}
