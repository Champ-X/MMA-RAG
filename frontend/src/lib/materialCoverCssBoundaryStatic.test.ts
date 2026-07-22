import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('MaterialCover CSS loading boundary', () => {
  it('keeps reusable material cover appearance with the shared component', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/MaterialCover.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/MaterialCover.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/MaterialCover.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './MaterialCover.css'")
    expect(componentCss).toContain('.material-cover')
    expect(componentCss).toContain('.material-cover.compact')
    expect(componentCss).toContain('.material-cover-type')
    expect(componentCss).toContain('.material-cover-glyph')
    expect(componentCss).toContain('.audio-cover-mark')
    expect(componentCss).toContain('.document-cover-mark')
    expect(entryCss).not.toMatch(/^\.material-cover\b/m)
    expect(entryCss).not.toContain('.space-material-copy')
    expect(entryCss).not.toContain('.collection-create-materials .material-cover')
    expect(entryCss).not.toMatch(/^\.audio-cover-/m)
    expect(entryCss).not.toMatch(/^\.document-cover-/m)
  })
})
