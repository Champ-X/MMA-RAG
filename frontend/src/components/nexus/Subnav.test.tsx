import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { describe, expect, it } from 'vitest'
import { Subnav } from './Subnav'

describe('Subnav', () => {
  it('marks the active destination with page-current semantics', () => {
    const markup = renderToStaticMarkup(
      <StaticRouter location="/system/status">
        <Subnav
          active="status"
          ariaLabel="System sections"
          items={[
            { value: 'status', label: 'Status', to: '/system/status' },
            { value: 'settings', label: 'Settings', to: '/system/settings' },
          ]}
        />
      </StaticRouter>,
    )

    expect(markup).toContain('class="subnav"')
    expect(markup).toContain('aria-label="System sections"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('class="active"')
    expect(markup).toContain('href="/system/status"')
  })
})
