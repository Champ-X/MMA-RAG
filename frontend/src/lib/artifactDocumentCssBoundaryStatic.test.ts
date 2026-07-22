import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Artifact document CSS loading boundary', () => {
  it('keeps canonical document rendering and evidence receipt styles with ArtifactDocument', () => {
    const files = import.meta.glob<string>(
      ['../features/artifacts/ArtifactDocument.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../features/artifacts/ArtifactDocument.tsx']
    const componentCss = readFileSync(new URL('../features/artifacts/ArtifactDocument.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './ArtifactDocument.css'")
    expect(componentCss).toContain('.artifact-paper')
    expect(componentCss).toContain('.artifact-block')
    expect(componentCss).toContain('.block-origin')
    expect(componentCss).toContain('.artifact-inline-citation')
    expect(componentCss).toContain('.binding-line')
    expect(componentCss).toContain('.binding-overflow')
    expect(componentCss).toContain('.artifact-table-block')
    expect(componentCss).toContain('.artifact-sources')
    expect(componentCss).toContain('.artifact-source-receipt')
    expect(componentCss).toContain('.artifact-source-archive')
    expect(componentCss).toContain('html[data-theme="dark"] .artifact-paper')
    expect(componentCss).toContain('html[data-theme="dark"] .artifact-inline-citation')
    expect(componentCss).toContain('@media (max-width: 820px)')
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(entryCss).not.toMatch(/^\.artifact-paper\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-block\b/m)
    expect(entryCss).not.toMatch(/^\.block-origin\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-inline-citation\b/m)
    expect(entryCss).not.toMatch(/^\.binding-line\b/m)
    expect(entryCss).not.toMatch(/^\.binding-overflow\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-table-block\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-sources\b/m)
    expect(entryCss).not.toMatch(/^\.artifact-source-/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.artifact-paper\b/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.artifact-source-/m)
    expect(entryCss).not.toContain('.artifact-inline-citation:hover')
    expect(entryCss).not.toContain('.artifact-source-receipt:hover')
  })
})
