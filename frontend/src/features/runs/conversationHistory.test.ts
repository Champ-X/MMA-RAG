import { describe, expect, it } from 'vitest'
import { markLegacyPinsMigrated, readLegacyPinnedConversationIds } from './conversationHistory'

function memoryStorage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value },
    removeItem: (key: string) => { delete values[key] },
    values,
  }
}

describe('conversation history migration', () => {
  it('deduplicates valid legacy local pins', () => {
    const storage = memoryStorage({
      'mma-rag-nexus-pinned-conversations': JSON.stringify(['one', 'one', 2, 'two']),
    })

    expect(readLegacyPinnedConversationIds(storage)).toEqual(['one', 'two'])
  })

  it('removes legacy state after server migration', () => {
    const storage = memoryStorage({
      'mma-rag-nexus-pinned-conversations': JSON.stringify(['one']),
    })

    markLegacyPinsMigrated(storage)

    expect(readLegacyPinnedConversationIds(storage)).toEqual([])
    expect(storage.values['mma-rag-nexus-pinned-conversations']).toBeUndefined()
  })
})
