import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RunWorkspaceSkeleton } from './RunWorkspaceSkeleton'

describe('RunWorkspaceSkeleton', () => {
  it('renders a stable route-level loading landmark for recovered runs', () => {
    const markup = renderToStaticMarkup(<RunWorkspaceSkeleton />)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('Recovering conversation state')
    expect(markup).toContain('Conversation &amp; process')
    expect(markup).toContain('Evidence conversation')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('retrieving the saved turn')
  })
})
