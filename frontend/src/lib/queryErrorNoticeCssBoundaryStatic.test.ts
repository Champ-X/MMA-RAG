import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('query error notice CSS loading boundary', () => {
  it('keeps QueryErrorNotice styles with the shared error recovery component', () => {
    const files = import.meta.glob<string>(
      ['../components/nexus/QueryErrorNotice.tsx'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const component = files['../components/nexus/QueryErrorNotice.tsx']
    const componentCss = readFileSync(new URL('../components/nexus/QueryErrorNotice.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(component).toContain("import './QueryErrorNotice.css'")
    expect(componentCss).toContain('.query-error-notice')
    expect(componentCss).toContain('.query-error-notice.tone-blocking')
    expect(componentCss).toContain('html[data-theme="dark"] .query-error-notice')
    expect(entryCss).not.toContain('.query-error-notice')
    expect(entryCss).not.toContain('query-error-notice')
  })
})
