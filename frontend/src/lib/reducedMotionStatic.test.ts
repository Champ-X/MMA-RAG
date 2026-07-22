import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('reduced motion accessibility contract', () => {
  it('turns off decorative motion while preserving static loading affordances', () => {
    const reducedMotionBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

    expect(reducedMotionBlock).toContain('animation: none !important')
    expect(reducedMotionBlock).toContain('.skeleton-panel')
    expect(reducedMotionBlock).toContain('.skeleton-line')
    expect(reducedMotionBlock).toContain('.button:hover')
    expect(reducedMotionBlock).toContain('transform: none !important')
    expect(reducedMotionBlock).toContain('.spin,')
    expect(reducedMotionBlock).not.toContain('*, *::before, *::after { transform: none')
  })
})
