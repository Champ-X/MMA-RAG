import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('focus appearance accessibility contract', () => {
  it('uses shared high-contrast focus tokens for keyboard navigation', () => {
    expect(css).toContain('--focus-ring: #1739bb')
    expect(css).toContain('--focus-ring-soft: rgb(49 92 255 / 0.18)')
    expect(css).toContain('--focus-ring-contrast: #f8faf9')
    expect(css).toContain('--focus-ring: #9fb2ff')
    expect(css).toContain(':focus-visible {\n  outline: 3px solid var(--focus-ring);\n  outline-offset: 3px;')
  })

  it('keeps form and dark rail focus indicators visible without fragmenting styles', () => {
    expect(css).toContain('input:focus-visible,\ntextarea:focus-visible,\nselect:focus-visible')
    expect(css).toContain('box-shadow: 0 0 0 4px var(--focus-ring-soft);')
    expect(css).toContain('.app-rail :is(a, button, summary):focus-visible')
    expect(css).toContain('outline-color: var(--focus-ring-contrast);')
    expect(css).not.toContain('.mobile-bar .icon-button:focus-visible {\n  outline-color: var(--focus-ring-contrast);')
  })
})
