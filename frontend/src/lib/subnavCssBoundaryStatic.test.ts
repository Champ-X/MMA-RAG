import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Subnav CSS loading boundary', () => {
  it('keeps secondary navigation styles with the Subnav component', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/Subnav.tsx',
        '../features/models/ModelsPage.tsx',
        '../features/system/SystemPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/Subnav.tsx']
    const modelsPage = files['../features/models/ModelsPage.tsx']
    const systemPage = files['../features/system/SystemPage.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/Subnav.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './Subnav.css'")
    expect(component).toContain('aria-current')
    expect(componentCss).toContain('.subnav')
    expect(componentCss).toContain('.subnav a[aria-current="page"]')
    expect(modelsPage).toContain('<Subnav active={tab}')
    expect(systemPage).toContain('<Subnav active={tab}')
    expect(entryCss).not.toContain('.subnav')
  })
})
