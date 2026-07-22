import { describe, expect, it } from 'vitest'
import { moveSegmentedControlValue } from './SegmentedControlViewModel'

const options = [
  { label: 'All', value: 'all' },
  { label: 'Published', value: 'published' },
  { label: 'Needs review', value: 'attention' },
] as const

describe('SegmentedControlViewModel', () => {
  it('moves radio selection with wrapping arrow-key semantics', () => {
    expect(moveSegmentedControlValue(options, 'all', 'next')).toBe('published')
    expect(moveSegmentedControlValue(options, 'attention', 'next')).toBe('all')
    expect(moveSegmentedControlValue(options, 'all', 'previous')).toBe('attention')
    expect(moveSegmentedControlValue(options, 'published', 'previous')).toBe('all')
  })

  it('supports Home and End movement', () => {
    expect(moveSegmentedControlValue(options, 'published', 'first')).toBe('all')
    expect(moveSegmentedControlValue(options, 'published', 'last')).toBe('attention')
  })

  it('falls back to the current value when there are no options', () => {
    expect(moveSegmentedControlValue([], 'all', 'next')).toBe('all')
  })

  it('falls back to the first option if the current value is stale', () => {
    expect(moveSegmentedControlValue(options, 'missing', 'next')).toBe('all')
    expect(moveSegmentedControlValue(options, 'missing', 'previous')).toBe('all')
  })
})
