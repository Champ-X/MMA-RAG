import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('recommended model setup CSS loading boundary', () => {
  it('keeps guided setup cards and task decision styles with RecommendedSetupPanel', () => {
    const files = import.meta.glob<string>(
      ['../features/models/RecommendedSetupPanel.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../features/models/RecommendedSetupPanel.tsx']
    const componentCss = readFileSync(new URL('../features/models/RecommendedSetupPanel.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './RecommendedSetupPanel.css'")
    expect(componentCss).toContain('.recommended-model-setup')
    expect(componentCss).toContain('.model-setup-hero')
    expect(componentCss).toContain('.model-setup-copy')
    expect(componentCss).toContain('.model-setup-checkpoints')
    expect(componentCss).toContain('.recommended-setup-feedback')
    expect(componentCss).toContain('.model-setup-groups')
    expect(componentCss).toContain('.setup-group-card')
    expect(componentCss).toContain('.route-decision')
    expect(componentCss).toContain('.model-setup-explanation')
    expect(componentCss).toContain('html[data-theme="dark"] .route-decision')
    expect(componentCss).toContain('@media (max-width: 820px)')
    expect(componentCss).toContain('@media (max-width: 520px)')
    expect(entryCss).not.toMatch(/^\.recommended-model-setup\b/m)
    expect(entryCss).not.toMatch(/^\.model-setup-/m)
    expect(entryCss).not.toMatch(/^\.recommended-setup-feedback\b/m)
    expect(entryCss).not.toMatch(/^\.setup-group-card\b/m)
    expect(entryCss).not.toMatch(/^\.route-decision\b/m)
    expect(entryCss).not.toMatch(/^html\[data-theme="dark"\] \.route-decision\b/m)
    expect(entryCss).not.toContain('.model-setup-checkpoints')
  })
})
