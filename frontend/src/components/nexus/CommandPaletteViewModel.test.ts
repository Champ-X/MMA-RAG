import { describe, expect, it } from 'vitest'
import {
  buildCommandPaletteEmptyState,
  buildCommandPaletteSearchStatus,
  clampCommandPaletteIndex,
  commandPaletteOptionId,
  moveCommandPaletteIndex,
} from './CommandPaletteViewModel'

describe('CommandPaletteViewModel', () => {
  it('clamps active index to the available result range', () => {
    expect(clampCommandPaletteIndex(-4, 5)).toBe(0)
    expect(clampCommandPaletteIndex(2, 5)).toBe(2)
    expect(clampCommandPaletteIndex(8, 5)).toBe(4)
    expect(clampCommandPaletteIndex(8, 0)).toBe(0)
  })

  it('moves active index with keyboard boundaries', () => {
    expect(moveCommandPaletteIndex(0, 4, 'next')).toBe(1)
    expect(moveCommandPaletteIndex(3, 4, 'next')).toBe(3)
    expect(moveCommandPaletteIndex(0, 4, 'previous')).toBe(0)
    expect(moveCommandPaletteIndex(2, 4, 'previous')).toBe(1)
    expect(moveCommandPaletteIndex(2, 4, 'first')).toBe(0)
    expect(moveCommandPaletteIndex(2, 4, 'last')).toBe(3)
    expect(moveCommandPaletteIndex(2, 0, 'last')).toBe(0)
  })

  it('builds stable descendant ids for listbox options', () => {
    expect(commandPaletteOptionId('nexus-palette-results', 3)).toBe('nexus-palette-results-option-3')
  })

  it('keeps dynamic search-source failures visible without blocking static commands', () => {
    expect(buildCommandPaletteSearchStatus([
      { enabled: true, error: null, label: 'Spaces' },
      { enabled: true, error: new Error('Search timeout'), label: 'Conversations' },
      { enabled: false, error: new Error('Evidence disabled until query'), label: 'Evidence' },
    ])).toMatchObject({
      detail: 'Conversations: Search timeout Static navigation remains available while you retry.',
      label: 'Some command search sources could not load: Conversations.',
      role: 'status',
      visible: true,
    })
  })

  it('stays hidden when dynamic search sources are healthy', () => {
    expect(buildCommandPaletteSearchStatus([
      { enabled: true, error: null, label: 'Spaces' },
      { enabled: true, error: undefined, label: 'Conversations' },
    ])).toMatchObject({
      visible: false,
    })
  })

  it('builds live empty states for blank and searched palettes', () => {
    expect(buildCommandPaletteEmptyState('')).toMatchObject({
      detail: 'Start typing to search Spaces, conversations, Evidence and actions.',
      label: 'No command palette results yet.',
      role: 'status',
    })
    expect(buildCommandPaletteEmptyState('  launch memo  ')).toMatchObject({
      detail: 'Try a source name, quoted phrase, earlier question or action.',
      label: 'No matching place, conversation or Evidence for "launch memo".',
      liveMode: 'polite',
    })
  })
})
