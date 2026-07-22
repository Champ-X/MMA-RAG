import { describe, expect, it } from 'vitest'
import {
  markLegacyPinsMigrated,
  readLegacyPinnedConversationIds,
  shouldFocusConversationSearch,
} from './conversationHistory'

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

  it('treats unavailable legacy storage as an empty migration queue', () => {
    const storage = {
      getItem: () => { throw new Error('storage unavailable') },
      setItem: () => { throw new Error('storage unavailable') },
      removeItem: () => { throw new Error('storage unavailable') },
    }

    expect(readLegacyPinnedConversationIds(storage)).toEqual([])
    expect(() => markLegacyPinsMigrated(storage)).not.toThrow()
    expect(readLegacyPinnedConversationIds(null)).toEqual([])
  })
})

describe('conversation history search shortcut', () => {
  const target = (value: { isContentEditable?: boolean; tagName?: string }) => value as unknown as EventTarget

  it('focuses search for an unmodified slash outside editable targets', () => {
    expect(shouldFocusConversationSearch({
      altKey: false,
      ctrlKey: false,
      key: '/',
      metaKey: false,
      target: target({ tagName: 'BODY' }),
    })).toBe(true)
  })

  it('lets fields and rich text editors own slash input', () => {
    for (const editableTarget of [
      target({ tagName: 'INPUT' }),
      target({ tagName: 'textarea' }),
      target({ tagName: 'SELECT' }),
      target({ isContentEditable: true, tagName: 'DIV' }),
    ]) {
      expect(shouldFocusConversationSearch({
        altKey: false,
        ctrlKey: false,
        key: '/',
        metaKey: false,
        target: editableTarget,
      })).toBe(false)
    }
  })

  it('ignores modified shortcut chords', () => {
    expect(shouldFocusConversationSearch({
      altKey: true,
      ctrlKey: false,
      key: '/',
      metaKey: false,
      target: null,
    })).toBe(false)
    expect(shouldFocusConversationSearch({
      altKey: false,
      ctrlKey: true,
      key: '/',
      metaKey: false,
      target: null,
    })).toBe(false)
  })
})
