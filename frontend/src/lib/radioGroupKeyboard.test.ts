import { describe, expect, it } from 'vitest'
import { moveRadioGroupValue, resolveRadioGroupDirection } from './radioGroupKeyboard'

describe('radio group keyboard helpers', () => {
  it('maps APG radio keys to movement directions', () => {
    expect(resolveRadioGroupDirection('ArrowRight')).toBe('next')
    expect(resolveRadioGroupDirection('ArrowDown')).toBe('next')
    expect(resolveRadioGroupDirection('ArrowLeft')).toBe('previous')
    expect(resolveRadioGroupDirection('ArrowUp')).toBe('previous')
    expect(resolveRadioGroupDirection('Home')).toBe('first')
    expect(resolveRadioGroupDirection('End')).toBe('last')
    expect(resolveRadioGroupDirection('Escape')).toBeNull()
  })

  it('moves radio values with wrapping arrow-key semantics', () => {
    const options = ['fast', 'quality', 'deep'] as const
    expect(moveRadioGroupValue(options, 'fast', 'next')).toBe('quality')
    expect(moveRadioGroupValue(options, 'deep', 'next')).toBe('fast')
    expect(moveRadioGroupValue(options, 'fast', 'previous')).toBe('deep')
    expect(moveRadioGroupValue(options, 'quality', 'previous')).toBe('fast')
    expect(moveRadioGroupValue(options, 'quality', 'first')).toBe('fast')
    expect(moveRadioGroupValue(options, 'quality', 'last')).toBe('deep')
  })

  it('falls back without throwing for empty or stale radio groups', () => {
    expect(moveRadioGroupValue([], 'fast', 'next')).toBe('fast')
    expect(moveRadioGroupValue(['fast', 'quality'] as const, 'missing', 'next')).toBe('fast')
    expect(moveRadioGroupValue(['fast', 'quality'] as const, 'missing', 'previous')).toBe('fast')
  })
})
