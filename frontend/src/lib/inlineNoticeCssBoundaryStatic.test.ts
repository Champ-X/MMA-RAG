import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('InlineNotice CSS loading boundary', () => {
  it('keeps notice styles with InlineNotice instead of entry CSS', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/InlineNotice.tsx',
        '../app/**/*.tsx',
        '../features/**/*.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/InlineNotice.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/InlineNotice.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './InlineNotice.css'")
    expect(componentCss).toContain('.notice')
    expect(componentCss).toContain('.notice.negative')
    expect(componentCss).toContain('.notice.warning')
    expect(componentCss).toContain('.notice.positive')
    expect(entryCss).not.toContain('.notice')

    const rogueOwners = Object.entries(files)
      .filter(([filePath]) => filePath !== '../components/nexus/InlineNotice.tsx')
      .filter(([, source]) => source.includes('className="notice') || source.includes("className='notice"))
      .map(([filePath]) => filePath.replace('../', ''))
    expect(rogueOwners).toEqual([])
  })
})
