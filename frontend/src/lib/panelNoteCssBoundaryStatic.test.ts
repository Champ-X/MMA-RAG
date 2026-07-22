import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PanelNote CSS loading boundary', () => {
  it('keeps panel note styles with PanelNote instead of entry CSS or page markup', () => {
    const files = import.meta.glob<string>(
      [
        '../components/nexus/PanelNote.tsx',
        '../app/**/*.tsx',
        '../features/**/*.tsx',
        '../components/nexus/**/*.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/PanelNote.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/PanelNote.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './PanelNote.css'")
    expect(componentCss).toContain('.panel-note')
    expect(componentCss).toContain('.panel-note.align-end')
    expect(componentCss).toContain('.panel-note.align-start')
    expect(entryCss).not.toContain('.panel-note')

    const rogueOwners = Object.entries(files)
      .filter(([filePath]) => filePath !== '../components/nexus/PanelNote.tsx')
      .filter(([, source]) => source.includes('className="panel-note') || source.includes("className='panel-note"))
      .map(([filePath]) => filePath.replace('../', ''))
    expect(rogueOwners).toEqual([])
  })
})
