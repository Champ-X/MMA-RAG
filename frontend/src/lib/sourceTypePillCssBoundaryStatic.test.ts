import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('SourceTypePill CSS loading boundary', () => {
  it('keeps modality pill styles with SourceTypePill instead of entry CSS', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/SourceTypePill.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/SourceTypePill.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/SourceTypePill.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './SourceTypePill.css'")
    expect(componentCss).toContain('.source-type')
    expect(componentCss).toContain('.source-type.modality-image')
    expect(componentCss).toContain('.source-type.modality-audio')
    expect(componentCss).toContain('.source-type.modality-video')
    expect(componentCss).toContain('.source-type.modality-table')
    expect(entryCss).not.toContain('.source-type')
  })
})
