import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('artifact coverage meter CSS loading boundary', () => {
  it('keeps shared meter appearance with the coverage component without pulling page layout into the entry stylesheet', () => {
    const files = import.meta.glob<string>(
      ['../features/artifacts/ArtifactCoverageMeter.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../features/artifacts/ArtifactCoverageMeter.tsx']
    const componentCss = readFileSync(new URL('../features/artifacts/ArtifactCoverageMeter.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './ArtifactCoverageMeter.css'")
    expect(componentCss).toContain('.artifact-coverage-meter')
    expect(componentCss).toContain('.artifact-coverage-meter > span')
    expect(componentCss).toContain('.artifact-coverage-meter > span > i')
    expect(componentCss).toContain('.artifact-coverage-meter.compact')
    expect(componentCss).toContain('html[data-theme="dark"] .artifact-coverage-meter > span')
    expect(entryCss).not.toContain('.artifact-readiness > .artifact-coverage-meter')
    expect(entryCss).not.toMatch(/^\.artifact-coverage-meter\b/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.artifact-coverage-meter\b/m)
  })
})
