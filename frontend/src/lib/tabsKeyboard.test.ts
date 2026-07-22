import { describe, expect, it } from 'vitest'
import { moveTabsValue, resolveHorizontalTabsDirection } from './tabsKeyboard'

describe('tabs keyboard helpers', () => {
  it('maps horizontal APG tab keys without stealing vertical scroll keys', () => {
    expect(resolveHorizontalTabsDirection('ArrowRight')).toBe('next')
    expect(resolveHorizontalTabsDirection('ArrowLeft')).toBe('previous')
    expect(resolveHorizontalTabsDirection('Home')).toBe('first')
    expect(resolveHorizontalTabsDirection('End')).toBe('last')
    expect(resolveHorizontalTabsDirection('ArrowDown')).toBeNull()
    expect(resolveHorizontalTabsDirection('ArrowUp')).toBeNull()
    expect(resolveHorizontalTabsDirection('Escape')).toBeNull()
  })

  it('moves tab values with wrapping semantics', () => {
    const options = ['Sheet 1', 'Sheet 2', 'Sheet 3'] as const
    expect(moveTabsValue(options, 'Sheet 1', 'next')).toBe('Sheet 2')
    expect(moveTabsValue(options, 'Sheet 3', 'next')).toBe('Sheet 1')
    expect(moveTabsValue(options, 'Sheet 1', 'previous')).toBe('Sheet 3')
    expect(moveTabsValue(options, 'Sheet 2', 'previous')).toBe('Sheet 1')
    expect(moveTabsValue(options, 'Sheet 2', 'first')).toBe('Sheet 1')
    expect(moveTabsValue(options, 'Sheet 2', 'last')).toBe('Sheet 3')
  })

  it('falls back without throwing for empty or stale tab lists', () => {
    expect(moveTabsValue([], 2, 'next')).toBe(2)
    expect(moveTabsValue([0, 1] as const, 8, 'next')).toBe(0)
    expect(moveTabsValue([0, 1] as const, 8, 'previous')).toBe(0)
  })
})
