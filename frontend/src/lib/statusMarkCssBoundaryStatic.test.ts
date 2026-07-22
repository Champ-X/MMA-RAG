import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('StatusMark CSS loading boundary', () => {
  it('keeps status marker styles with the shared StatusMark component', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/StatusMark.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/StatusMark.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/StatusMark.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './StatusMark.css'")
    expect(componentCss).toContain('.status-mark')
    expect(componentCss).toContain('.status-dot')
    expect(componentCss).toContain('.status-positive .status-dot')
    expect(componentCss).toContain('.status-warning .status-dot')
    expect(componentCss).toContain('.status-negative .status-dot')
    expect(entryCss).not.toContain('.status-mark')
    expect(entryCss).not.toContain('.status-dot')
  })
})
