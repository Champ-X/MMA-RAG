import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('confirm dialog CSS loading boundary', () => {
  it('keeps ConfirmDialog styles with the component instead of the entry stylesheet', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/ConfirmDialog.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/ConfirmDialog.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/ConfirmDialog.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const reducedMotionBlock = entryCss.slice(entryCss.indexOf('@media (prefers-reduced-motion: reduce)'))

    expect(component).toContain("import './ConfirmDialog.css'")
    expect(componentCss).toContain('.confirm-backdrop')
    expect(componentCss).toContain('.confirm-dialog')
    expect(componentCss).toContain('.confirm-status')
    expect(componentCss).toContain('html[data-theme="dark"] .confirm-dialog')
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).toContain('@keyframes drawer-in')
    expect(entryCss).not.toContain('.confirm-backdrop')
    expect(entryCss).not.toContain('.confirm-dialog')
    expect(entryCss).not.toContain('.confirm-status')
    expect(reducedMotionBlock).not.toContain('.confirm-dialog')
    expect(reducedMotionBlock).toContain('.citation-preview-loading')
  })
})
