import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('SubmitReadinessCard CSS loading boundary', () => {
  it('keeps readiness feedback styles with the shared feedback component', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/SubmitReadinessCard.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/SubmitReadinessCard.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/SubmitReadinessCard.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './SubmitReadinessCard.css'")
    expect(componentCss).toContain('.submit-readiness-card')
    expect(componentCss).toContain('.submit-readiness-card.tone-ready')
    expect(componentCss).toContain('.submit-readiness-card.tone-error')
    expect(componentCss).toContain('.submit-readiness-card.tone-pending')
    expect(componentCss).toContain('html[data-theme="dark"] .submit-readiness-card')
    expect(entryCss).not.toContain('.submit-readiness-card')
  })
})
