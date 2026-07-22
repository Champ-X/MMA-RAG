import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PageHeader CSS loading boundary', () => {
  it('keeps page header layout styles with PageHeader while preserving shared eyebrow text style globally', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/PageHeader.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/PageHeader.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/PageHeader.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './PageHeader.css'")
    expect(componentCss).toContain('.page-header')
    expect(componentCss).toContain('.page-description')
    expect(componentCss).toContain('.page-actions')
    expect(componentCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toContain('.page-header')
    expect(entryCss).not.toContain('.page-description')
    expect(entryCss).not.toContain('.page-actions')
    expect(entryCss).toContain('.eyebrow')
  })
})
