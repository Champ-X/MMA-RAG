import { describe, expect, it } from 'vitest'
import { resolveTheme } from './theme'

describe('theme resolution', () => {
  it('keeps explicit preferences stable', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('tracks the operating-system preference only in system mode', () => {
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
  })
})
