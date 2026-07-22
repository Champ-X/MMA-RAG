import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('run progress summary CSS loading boundary', () => {
  it('keeps RunProgressSummary styles with the lazy Run workspace component', () => {
    const files = import.meta.glob<string>(
      ['../features/runs/RunProgressSummary.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../features/runs/RunProgressSummary.tsx']
    const componentCss = readFileSync(new URL('../features/runs/RunProgressSummary.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './RunProgressSummary.css'")
    expect(componentCss).toContain('.run-progress-summary')
    expect(componentCss).toContain('.retrieval-health')
    expect(componentCss).toContain('.run-degradation')
    expect(componentCss).toContain('html[data-theme="dark"] .run-progress-summary')
    expect(entryCss).not.toContain('.run-progress-summary')
    expect(entryCss).not.toContain('.retrieval-health')
    expect(entryCss).not.toContain('.run-degradation')
  })
})
