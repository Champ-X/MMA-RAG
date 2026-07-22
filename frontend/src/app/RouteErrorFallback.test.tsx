import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { describe, expect, it } from 'vitest'
import { RouteErrorFallbackContent } from './RouteErrorFallback'
import { buildRouteErrorViewModel } from './routeErrorViewModel'

describe('RouteErrorFallback', () => {
  it('renders a recoverable route error without stack details', () => {
    const markup = renderToStaticMarkup(
      <StaticRouter location="/runs/missing">
        <RouteErrorFallbackContent model={buildRouteErrorViewModel(new Error('Chunk failed to load'))} />
      </StaticRouter>,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-labelledby="route-error-title"')
    expect(markup).toContain('aria-describedby="route-error-detail route-error-status"')
    expect(markup).toContain('id="route-error-detail"')
    expect(markup).toContain('id="route-error-status"')
    expect(markup).toContain('Nexus hit a recoverable interface fault')
    expect(markup).toContain('Chunk failed to load')
    expect(markup).toContain('Return home')
    expect(markup).toContain('Reload this route')
    expect(markup).not.toContain('Error:')
    expect(markup).not.toContain('at ')
  })
})
